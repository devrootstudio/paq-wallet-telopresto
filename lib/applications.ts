import { AirtableError, airtableFromEnv, formulaString, type AirtableClient, type Fields } from "@/lib/airtable"
import type { QueryClientResponse } from "@/lib/soap-client"

/**
 * The `applications` table: one record per request (`authorization`), created in Step 1 and
 * updated at every step (OTP, cupo, disbursement, errors). Replaces the old Make webhook, which
 * created a new record on every Step 1 retry. Server-side only.
 *
 * Every write is an upsert on `authorization` (Airtable `performUpsert`, no typecast), so a retry
 * updates the same record. Values a field cannot hold (an unknown select option, a malformed
 * date or email) are left out instead of failing the whole write.
 *
 * Never throws and never blocks the flow: a failed write is logged (step, status and Airtable
 * error type only; never personal data or the token) and retried once on 5xx / network errors.
 */

export const APPLICATIONS_TABLE = "applications"

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
  /** OTP SMS sent (code 0). */
  | { step: "otp-enviado" }
  /** Cupo validated; `otpValidated` when the OTP was validated in the same call (Step 2). */
  | { step: "cupo-validado"; approvedAmount?: number; cupoId?: string; otpValidated?: boolean }
  /** Disbursement done. */
  | { step: "desembolsado"; requestedAmount?: number; commission?: number; code: string | number; message?: string }
  /** A step failed. `otpValidated` when the OTP had been validated before the failure (Step 2). */
  | {
      step: "error"
      errorStep: ApplicationErrorStep
      error: StepError
      otpValidated?: boolean
      disbursement?: { requestedAmount?: number; commission?: number }
    }

export interface RecordOptions {
  /** ENABLE_TEST_BYPASS: mark the record as test data. */
  test?: boolean
  /** Defaults to the client from AIRTABLE_TOKEN / AIRTABLE_BASE_ID. */
  airtable?: AirtableClient | null
  now?: () => Date
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

const text = (v: unknown) => (v === undefined || v === null ? undefined : String(v))
const isoDate = (v: unknown) => {
  const d = normalizeStartDate(text(v) ?? "")
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined
}
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
    "start-date": isoDate(data.startDate),
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
          "ws-start-date": isoDate(c?.startDate),
          "ws-salary": amount(c?.monthlySalary),
          "ws-frequency": option(c?.paymentFrequency, WS_FREQUENCY_OPTIONS),
          "ws-number-of-dispersions": text(c?.numberOfDispersions),
          "wa-average-dispersion-amount": text(c?.averageDispersionAmount),
          "ws-accepts-terms": option(c?.acceptsTerms, WS_ACCEPTS_TERMS_OPTIONS),
        }
      : {}),
  }
}

/** The fields one event writes (besides authorization, updated-at and test). */
export function patchFields(patch: ApplicationPatch, nowIso: string): Record<string, unknown> {
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
        ...(patch.errorStep === "desembolso"
          ? {
              "disbursement-code": text(patch.error.code),
              "disbursement-message": patch.error.message,
              "requested-amount": amount(patch.disbursement?.requestedAmount),
              commission: amount(patch.disbursement?.commission),
            }
          : {}),
      }
  }
}

function describe(error: unknown): string {
  if (error instanceof AirtableError) return `${error.status} ${error.type}`
  return error instanceof Error ? error.name : "unknown"
}

const retryable = (error: unknown) => error instanceof AirtableError && (error.status === 0 || error.status >= 500)

/**
 * Records one event of the request `authorization` in `applications` (upsert on authorization).
 * Step 1 also increments `attempts`. Never throws.
 */
export async function recordApplication(
  authorization: string | undefined,
  patch: ApplicationPatch,
  opts: RecordOptions = {},
): Promise<void> {
  if (!authorization || !AUTHORIZATION_PATTERN.test(authorization)) {
    console.warn(`[applications] ${patch.step}: missing or malformed authorization; not recorded`)
    return
  }
  const airtable = opts.airtable === undefined ? airtableFromEnv() : opts.airtable
  if (!airtable) {
    console.warn(`[applications] ${patch.step}: storage not configured; not recorded`)
    return
  }
  const nowIso = (opts.now ?? (() => new Date()))().toISOString()

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const fields: Record<string, unknown> = {
        authorization,
        ...patchFields(patch, nowIso),
        "updated-at": nowIso,
        ...(opts.test ? { test: true } : {}),
      }
      if (patch.step === "paso1") {
        // Not atomic, which is enough: the Step 1 button is disabled while the call runs.
        const [current] = await airtable.list<{ attempts?: number }>(APPLICATIONS_TABLE, {
          filterByFormula: `{authorization} = ${formulaString(authorization)}`,
          maxRecords: 1,
          fields: ["attempts"],
        })
        fields.attempts = (current?.fields.attempts ?? 0) + 1
      }
      await airtable.upsert(APPLICATIONS_TABLE, [compact(fields)], ["authorization"])
      return
    } catch (error) {
      const again = attempt === 1 && retryable(error)
      console.error(`[applications] ${patch.step} write failed${again ? ", retrying" : ""}: ${describe(error)}`)
      if (!again) return
    }
  }
}
