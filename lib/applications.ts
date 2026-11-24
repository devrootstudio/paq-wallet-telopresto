import { AirtableError, airtableFromEnv, formulaString, type AirtableClient, type AirtableRecord, type Fields, type UpsertResult } from "@/lib/airtable"
import type { QueryClientResponse } from "@/lib/soap-client"

/**
 * The `applications` table: one record per request (`authorization`), created in Step 1 and
 * updated at every step (OTP, cupo, disbursement, errors). Replaces the old Make webhook, which
 * created a new record on every Step 1 retry. Server-side only.
 *
 * Every write is an upsert on `authorization` (Airtable `performUpsert`, no typecast), so a retry
 * updates the same record. If old duplicates already share the authorization, the newest one is
 * updated by id. Values a field cannot hold (an unknown select option, a malformed or impossible
 * date, a malformed email) are left out instead of failing the whole write.
 *
 * Callers await it (so the Step 1 record exists before the next event), so it is time-boxed:
 * - every step: at most WRITE_BUDGET_MS in total, no retries (not even on a 429);
 * - Step 1: STEP1_BUDGET_MS in total (it runs before the SMS, while the user sees the loader, and
 *   the first Airtable call of a cold server can take seconds), with the attempts read capped at
 *   ATTEMPTS_READ_MAX_MS, each write capped at WRITE_ATTEMPT_MAX_MS, and ONE retry of the write on a
 *   timeout, network error or 5xx if time is left.
 * If Step 1 still fails, the caller passes its data again with the next event of the same request
 * (`step1` on otp-enviado / cupo-validado / error), so the record never ends up without it.
 * It never throws: a failed write is logged with the step, the status, the Airtable error type and
 * a short authorization prefix (never personal data or the token), and reported by returning false.
 */

export const APPLICATIONS_TABLE = "applications"

/** Total time one recordApplication call may take (all its Airtable requests together). */
export const WRITE_BUDGET_MS = 3000
/** Total time for Step 1 (attempts read + write + one retry). */
export const STEP1_BUDGET_MS = 8000
/** The Step 1 attempts read may not eat the whole budget. */
export const ATTEMPTS_READ_MAX_MS = 3000
/** The one retry of the attempts read (after a timeout or network error), on a warm connection. */
export const ATTEMPTS_READ_RETRY_MAX_MS = 2000
/** Each Step 1 write attempt, so a slow first one leaves time for the retry. */
export const WRITE_ATTEMPT_MAX_MS = 4000
/** A retry is only started with at least this much budget left. */
const MIN_RETRY_MS = 500

export type ApplicationStep = "paso1" | "otp-enviado" | "otp-validado" | "cupo-validado" | "desembolsado" | "error"
export type ApplicationErrorStep = "paso1" | "otp" | "cupo" | "desembolso"

/** Step 1 form data, as submitStep1Form receives it. */
export interface Step1Data {
  identification: string
  fullName: string
  phone: string
  email: string
  nit: string
  /** dd-mm-yyyy (or already yyyy-mm-dd). */
  startDate: string
  salary: string
  paymentFrequency: string
  empresa?: string
  empresaOtra?: boolean
  empresaTelefono?: string
  empresaDireccion?: string
  edad?: string
  estadoCivil?: string
  domicilio?: string
}

export interface StepError {
  message: string
  code?: string | number
}

export type ApplicationPatch =
  /** Step 1 submitted: its data, the client response (if any) and, when creating/editing the client failed, the error. */
  | { step: "paso1"; data: Step1Data; client: QueryClientResponse | null; error?: StepError }
  /** OTP SMS sent (code 0). `step1`: Step 1 data again, when its own write failed in this request. */
  | { step: "otp-enviado"; step1?: Step1Snapshot }
  /** Cupo validated; `otpValidated` when the OTP was validated in the same call (Step 2). */
  | { step: "cupo-validado"; approvedAmount?: number; cupoId?: string; otpValidated?: boolean; step1?: Step1Snapshot }
  /** Disbursement done. */
  | { step: "desembolsado"; requestedAmount?: number; commission?: number; code: string | number; message?: string }
  /**
   * A step failed: step, last-error-step and last-error (plus the attempted amount and commission
   * of a failed disbursement). Never the disbursement code or message, so an error never overwrites
   * the evidence of an earlier success. `otpValidated` when the
   * OTP had been validated before the failure (Step 2). `step1`: as above.
   */
  | {
      step: "error"
      errorStep: ApplicationErrorStep
      error: StepError
      otpValidated?: boolean
      step1?: Step1Snapshot
      /** For a failed disbursement: the amount and commission attempted. */
      disbursement?: { requestedAmount?: number; commission?: number }
    }

/** Step 1 data and client response, resent with a later event when the Step 1 write failed. */
export interface Step1Snapshot {
  data: Step1Data
  client: QueryClientResponse | null
}

export interface RecordOptions {
  /** ENABLE_TEST_BYPASS: mark the record as test data. */
  test?: boolean
  /** Defaults to a time-boxed client from AIRTABLE_TOKEN / AIRTABLE_BASE_ID. */
  airtable?: AirtableClient | null
  now?: () => Date
  /** Total time budget. Default STEP1_BUDGET_MS for Step 1, WRITE_BUDGET_MS otherwise. */
  budgetMs?: number
}

// Select options that exist in the table (writing anything else would fail the whole write).
const FREQUENCY_OPTIONS = new Set(["M", "Q", "mensual"])
const WS_FREQUENCY_OPTIONS = new Set(["M", "Q", "mensual", "quincenal"])
const WS_STATUS_OPTIONS = new Set(["A", "ACTIVE"])
const WS_ACCEPTS_TERMS_OPTIONS = new Set(["N", "S"])

const AUTHORIZATION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** "mensual" → M, "quincenal" → Q, "semanal" → S (as the Make scenario did). */
export function normalizePaymentFrequency(frequency: string): string {
  const normalized = (frequency ?? "").toLowerCase().trim()
  if (normalized === "mensual") return "M"
  if (normalized === "quincenal") return "Q"
  if (normalized === "semanal") return "S"
  return frequency
}

/** dd-mm-yyyy → yyyy-mm-dd (yyyy-mm-dd is kept). */
export function normalizeStartDate(date: string): string {
  if (!date) return date
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const m = date.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : date
}

/** yyyy-mm-dd of a date that exists in the calendar (31-02 does not), or undefined. */
export function validIsoDate(value: unknown): string | undefined {
  const d = normalizeStartDate(value === undefined || value === null ? "" : String(value))
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, da))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === da ? d : undefined
}

const text = (v: unknown) => (v === undefined || v === null ? undefined : String(v))
const email = (v: unknown) => {
  const s = (text(v) ?? "").trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined
}
const amount = (v: unknown) => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : undefined
}
const option = (v: unknown, options: Set<string>) => {
  const s = (text(v) ?? "").trim()
  return options.has(s) ? s : undefined
}
const digits = (v: unknown) => (text(v) ?? "").replace(/\D/g, "") || undefined
const errorText = (e: StepError) =>
  e.code !== undefined && e.code !== null && e.code !== "" ? `${e.message} (código ${e.code})` : e.message

/** Drops undefined values so absent data never overwrites what the record already has. */
function compact(fields: Record<string, unknown>): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
}

function step1Fields(data: Step1Data, client: QueryClientResponse | null): Record<string, unknown> {
  const c = client && typeof client.client === "object" && client.client ? client.client : null
  const other = data.empresaOtra === true
  return {
    name: data.fullName,
    identification: data.identification,
    phone: digits(data.phone),
    email: email(data.email),
    nit: data.nit,
    "start-date": validIsoDate(data.startDate),
    salary: amount(data.salary),
    frequency: option(normalizePaymentFrequency(data.paymentFrequency), FREQUENCY_OPTIONS),
    company: data.empresa ?? "",
    "company-other": other,
    "company-phone": other ? (data.empresaTelefono ?? "") : "",
    "company-address": other ? (data.empresaDireccion ?? "") : "",
    age: data.edad,
    "marital-status": data.estadoCivil,
    address: data.domicilio,
    // Client response (what the Make scenario stored in the ws-* columns).
    ...(client
      ? {
          "ws-code": text(client.returnCode),
          "ws-message": text(client.message),
          "ws-id": text(c?.id),
          "ws-status": option(c?.status, WS_STATUS_OPTIONS),
          "ws-name": text(c?.fullName),
          "ws-identification": text(c?.identificationNumber),
          "ws-phone": digits(c?.phone),
          "ws-email": email(c?.email),
          "ws-nit": text(c?.nit),
          "ws-start-date": validIsoDate(c?.startDate),
          "ws-salary": amount(c?.monthlySalary),
          "ws-frequency": option(c?.paymentFrequency, WS_FREQUENCY_OPTIONS),
          "ws-number-of-dispersions": text(c?.numberOfDispersions),
          "wa-average-dispersion-amount": text(c?.averageDispersionAmount),
          "ws-accepts-terms": option(c?.acceptsTerms, WS_ACCEPTS_TERMS_OPTIONS),
        }
      : {}),
  }
}

/**
 * The fields one event writes (besides authorization, updated-at and test). An event that carries
 * `step1` (its Step 1 write failed earlier in the same request) also writes the Step 1 data.
 */
export function patchFields(patch: ApplicationPatch, nowIso: string): Record<string, unknown> {
  const own = eventFields(patch, nowIso)
  if (patch.step !== "paso1" && "step1" in patch && patch.step1) {
    return { ...step1Fields(patch.step1.data, patch.step1.client), ...own }
  }
  return own
}

function eventFields(patch: ApplicationPatch, nowIso: string): Record<string, unknown> {
  switch (patch.step) {
    case "paso1":
      return {
        ...step1Fields(patch.data, patch.client),
        step: patch.error ? "error" : "paso1",
        ...(patch.error ? { "last-error-step": "paso1", "last-error": errorText(patch.error) } : {}),
      }
    case "otp-enviado":
      return { step: "otp-enviado" }
    case "cupo-validado":
      return {
        step: "cupo-validado",
        "approved-amount": amount(patch.approvedAmount),
        "cupo-id": text(patch.cupoId),
        "cupo-validated-at": nowIso,
        ...(patch.otpValidated ? { "otp-validated-at": nowIso } : {}),
      }
    case "desembolsado":
      return {
        step: "desembolsado",
        "disbursed-at": nowIso,
        "requested-amount": amount(patch.requestedAmount),
        commission: amount(patch.commission),
        "disbursement-code": text(patch.code),
        "disbursement-message": text(patch.message),
      }
    case "error":
      return {
        step: "error",
        "last-error-step": patch.errorStep,
        "last-error": errorText(patch.error),
        ...(patch.otpValidated ? { "otp-validated-at": nowIso } : {}),
        // The amount and commission of a failed disbursement never contradict an earlier success;
        // the disbursement code and message (a success's evidence) are never written by an error.
        ...(patch.errorStep === "desembolso" && patch.disbursement
          ? { "requested-amount": amount(patch.disbursement.requestedAmount), commission: amount(patch.disbursement.commission) }
          : {}),
      }
  }
}

function describe(error: unknown): string {
  if (error instanceof AirtableError) return `${error.status} ${error.type}`
  return error instanceof Error ? error.name : "unknown"
}

const isMultipleMatches = (error: unknown) => error instanceof AirtableError && error.status === 422 && /MULTIPLE/i.test(error.type)

const newest = <F extends Fields>(records: AirtableRecord<F>[]) =>
  [...records].sort((a, b) => (a.createdTime === b.createdTime ? b.id.localeCompare(a.id) : b.createdTime.localeCompare(a.createdTime)))[0]

/**
 * Records one event of the request `authorization` in `applications` (one record per
 * authorization). Step 1 also increments `attempts`. Returns true when written. Never throws.
 */
export async function recordApplication(
  authorization: string | undefined,
  patch: ApplicationPatch,
  opts: RecordOptions = {},
): Promise<boolean> {
  if (!authorization || !AUTHORIZATION_PATTERN.test(authorization)) {
    console.warn(`[applications] ${patch.step}: missing or malformed authorization; not recorded`)
    return false
  }
  // Short prefix to identify the request in logs (the authorization is an opaque random id).
  const ref = `${authorization.slice(0, 6)}…`
  const isStep1 = patch.step === "paso1"
  const budgetMs = opts.budgetMs ?? (isStep1 ? STEP1_BUDGET_MS : WRITE_BUDGET_MS)
  const startedAt = Date.now()
  const remaining = () => budgetMs - (Date.now() - startedAt)
  // One overall deadline for every request of this call; each request also gets its own cap.
  const overall = AbortSignal.timeout(budgetMs)
  const clientFor = (capMs: number): AirtableClient | null =>
    opts.airtable !== undefined
      ? opts.airtable
      : airtableFromEnv({ timeoutMs: Math.max(1, Math.min(capMs, remaining())), rateLimitRetries: 0, signal: overall })
  if (!clientFor(budgetMs)) {
    console.warn(`[applications] ${patch.step} ${ref}: storage not configured; not recorded`)
    return false
  }
  const nowIso = (opts.now ?? (() => new Date()))().toISOString()
  const fields: Record<string, unknown> = {
    authorization,
    ...patchFields(patch, nowIso),
    "updated-at": nowIso,
    ...(opts.test ? { test: true } : {}),
  }
  const byAuthorization = (airtable: AirtableClient) =>
    airtable.list<{ attempts?: number }>(APPLICATIONS_TABLE, { filterByFormula: `{authorization} = ${formulaString(authorization)}` })
  const updateNewest = async (airtable: AirtableClient, records: AirtableRecord<{ attempts?: number }>[]) => {
    console.warn(`[applications] ${patch.step} ${ref}: ${records.length} records share this authorization; updating the newest`)
    await airtable.update(APPLICATIONS_TABLE, [{ id: newest(records).id, fields: compact(fields) }])
  }

  // Step 1: read attempts first (not atomic, which is enough: the Step 1 button is disabled while
  // the call runs), capped so it never eats the whole budget. A timeout or network error on a cold
  // server is retried once (the connection is warm by then, so with a shorter cap). If both fail,
  // write without attempts (see the created-record fix below).
  let existing: AirtableRecord<{ attempts?: number }>[] | null = null
  if (isStep1) {
    for (const [i, capMs] of [ATTEMPTS_READ_MAX_MS, ATTEMPTS_READ_RETRY_MAX_MS].entries()) {
      try {
        existing = await byAuthorization(clientFor(capMs)!)
        break
      } catch (error) {
        const again = i === 0 && transient(error) && !overall.aborted && remaining() > MIN_RETRY_MS
        console.error(
          `[applications] ${patch.step} ${ref}: attempts read failed (${describe(error)}); ${again ? "retrying the read" : "writing without attempts"}`,
        )
        if (!again) break
      }
    }
    if (existing) fields.attempts = ((existing.length > 0 ? newest(existing).fields.attempts : 0) ?? 0) + 1
  }

  /** Writes the record; returns the upsert outcome when there was one. */
  const write = async (): Promise<UpsertResult | null> => {
    const airtable = clientFor(isStep1 ? WRITE_ATTEMPT_MAX_MS : budgetMs)!
    if (existing && existing.length > 1) {
      await updateNewest(airtable, existing)
      return null
    }
    try {
      return await airtable.upsert(APPLICATIONS_TABLE, [compact(fields)], ["authorization"])
    } catch (error) {
      // Several records sharing the authorization make the upsert fail with a 422. The exact error
      // type of the live API is not confirmed, so outside Step 1 any 422 checks for duplicates.
      const duplicatesSuspected = isStep1 ? isMultipleMatches(error) : error instanceof AirtableError && error.status === 422
      if (!duplicatesSuspected) throw error
      const records = await byAuthorization(airtable)
      if (records.length < 2) throw error // not a duplicates problem: report the original failure
      await updateNewest(airtable, records)
      return null
    }
  }

  /** A later event carrying the Step 1 backup (its Step 1 write failed in this request). */
  const carriesStep1 = !isStep1 && "step1" in patch && Boolean(patch.step1)

  /**
   * Step 1 written without attempts (the read failed twice), or an event carrying the Step 1
   * backup: a record the upsert just created is the first attempt, so it gets attempts = 1. An
   * existing record is never given a made-up number (Step 1 logs that case).
   */
  const fixAttempts = async (outcome: UpsertResult | null) => {
    if (!outcome || !((isStep1 && fields.attempts === undefined) || carriesStep1)) return
    const created = outcome.records.find((r) => outcome.createdRecords.includes(r.id))
    if (!created) {
      if (isStep1) console.warn(`[applications] ${patch.step} ${ref}: attempts unknown for an existing record; left without a count`)
      return
    }
    try {
      await clientFor(budgetMs)!.update(APPLICATIONS_TABLE, [{ id: created.id, fields: { attempts: 1 } }])
    } catch (error) {
      console.error(`[applications] ${patch.step} ${ref}: attempts = 1 not written (${describe(error)})`)
    }
  }

  const maxAttempts = isStep1 ? 2 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fixAttempts(await write())
      return true
    } catch (error) {
      const again = attempt < maxAttempts && retryable(error) && !overall.aborted && remaining() > MIN_RETRY_MS
      console.error(`[applications] ${patch.step} ${ref} write failed${again ? ", retrying" : ""}: ${describe(error)}`)
      if (!again) return false
    }
  }
  return false
}

/** Timeout, network error or 5xx: worth one retry within the budget. */
const retryable = (error: unknown) => error instanceof AirtableError && (error.status === 0 || error.status >= 500)

/** Timeout or network error (no HTTP answer): worth retrying the attempts read once. */
const transient = (error: unknown) => error instanceof AirtableError && error.status === 0
