import { randomUUID } from "crypto"
import { AIRTABLE_TIMEOUT_MS, isRecordId, type AirtableClient, type AirtableRecord } from "@/lib/airtable"
import { recordApplication, type ApplicationPatch } from "@/lib/applications"
import { generarPagare, type PagareInput } from "@/lib/pagare"
import { isDisbursed, releaseRequest, type ReleaseResult, type ReleaseStore } from "@/lib/release"
import { validateCupo } from "@/lib/soap-client"
import { createAvalesRepo, isTestRequest, TABLES, type GuarantorFields, type GuarantorStatus, type RequestFields, type RequestStatus } from "./repo"
import { simulatedCupo } from "./runtime"
import type { WhatsAppSender } from "./whatsapp"

/**
 * The guarantor job (contract §7), run by POST /api/jobs/guarantors. Server-side only.
 * It is the only process that releases money, one request at a time:
 * 1. invite `pending` guarantors (new link token, WhatsApp, `invited`);
 * 2. requests with 2 `rejected` guarantors → `rejected`, open guarantors `closed`, notice;
 * 3. requests with 2 `authorized` guarantors → `quorum`, open guarantors `closed`
 *    (checked before expiry: answers are refused after `expires-at`, so two authorizations are on time);
 * 4. `pending_guarantors` past `expires-at` → `expired`, open guarantors `expired`, notice;
 * 5. release each `quorum` request (see `releaseOne` for the claim);
 * 6. leads: `authorized` guarantors without a lead → `guarantor-leads`; leads without `thanked-at`
 *    → thanks over WhatsApp.
 *
 * Every transition re-reads the record right before writing and only moves on if it is still in
 * the expected state, so a run working from a stale list cannot undo another run's progress.
 *
 * Known window (fine while WhatsApp is simulated; close it before enabling real sends): two runs on
 * different instances working in lockstep can both invite the same guarantor (the second link
 * replaces the first) or thank the same lead twice, and notify the applicant twice. The route
 * allows one run per instance and the scheduler runs every 5 minutes.
 *
 * Simulation (test bypass, development/test only): valida_cupo and the disbursement return the fake
 * values the bypass uses in Step 3 (code 0) and the pagaré is generated as in that bypass; the
 * report lists the invitation links. WhatsApp is simulated in every mode for now (whatsapp.ts).
 *
 * Privacy: logs carry record ids, counts and return codes only, never names, DPI, phones or tokens.
 */

const OPEN_GUARANTOR: GuarantorStatus[] = ["pending", "invited", "identity_mismatch"]

/**
 * Pause between writing a release claim and re-reading it. Longer than one Airtable request may
 * take (AIRTABLE_TIMEOUT_MS; the claim write is never retried on a 429, and a claim write that
 * fails or times out makes its run abort). The guarantee is completed by the elapsed-time rule in
 * `releaseOne`: a run whose read-to-confirmed-claim takes more than half this pause does not release.
 */
export const CLAIM_SETTLE_MS = AIRTABLE_TIMEOUT_MS + 2000

export interface CupoCheck {
  ok: boolean
  cupoAutorizado: number
  idSolicitud: string
  message: string
}

export interface DisburseInput {
  request: AirtableRecord<RequestFields>
  idSolicitud: string
}

export type DisburseOutcome = { success: true; returnCode: string; message: string; contractUrl: string } | { success: false; returnCode: string; message: string }

export interface JobDeps {
  airtable: AirtableClient
  whatsapp: WhatsAppSender
  /** Origin used to build guarantor links, e.g. https://example.com (no trailing slash). */
  baseUrl: string
  /** Test bypass outside production: simulated cupo/disbursement, links in the report. */
  simulation: boolean
  now?: () => Date
  newToken?: () => string
  runId?: string
  /** Pause between claiming a release and re-reading the claim. Default CLAIM_SETTLE_MS. */
  claimSettleMs?: number
  sleep?: (ms: number) => Promise<void>
  cupo?: (request: AirtableRecord<RequestFields>) => Promise<CupoCheck>
  disburse?: (input: DisburseInput) => Promise<DisburseOutcome>
  /** Attempts for the write that records a completed disbursement. */
  recordAttempts?: number
  /** Real elapsed-time clock in ms (claim timing and release budget). Default Date.now. */
  clock?: () => number
  /** No new release starts after this many ms of the release step. Default RELEASE_BUDGET_MS. */
  releaseBudgetMs?: number
  /** Records release outcomes in the applications table (one record per authorization). Default recordApplication. */
  applications?: typeof recordApplication
}

/**
 * Releases start only within this budget of the release step. With the route's maxDuration of
 * 300 s and at least CLAIM_SETTLE_MS per release, this leaves room for the release in progress.
 */
export const RELEASE_BUDGET_MS = 180_000

export interface JobReport {
  runId: string
  simulation: boolean
  invited: number
  /** Only in simulation: the links that would have gone out over WhatsApp. */
  links?: { requestId: string; position: number; url: string }[]
  rejected: string[]
  quorum: string[]
  expired: string[]
  released: { requestId: string; status: RequestStatus | "skipped"; returnCode?: string }[]
  /** Disbursed but the outcome could not be written: needs manual follow-up. */
  unrecorded: { requestId: string; returnCode: string }[]
  /** Requests that need a human: left in `releasing`, or in `quorum` after a release had started. */
  stuck: string[]
  /** `quorum` requests left for the next run because the time budget ran out. */
  deferred: string[]
  leads: number
  thanked: number
  errors: { step: string; id?: string; error: string }[]
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "unknown"
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function pagareInput(request: AirtableRecord<RequestFields>): PagareInput {
  const r = request.fields
  const audit = parseJson<Partial<Pick<PagareInput, "fingerprint" | "screenResolution" | "idiomaBrowser" | "ipInfo" | "otpHash">>>(r.audit) ?? {}
  return {
    phone: r.phone ?? "",
    identification: r.identification ?? "",
    fullName: r["full-name"] ?? "",
    email: r.email ?? "",
    empresa: r.company ?? "",
    edad: r.age ?? "",
    estadoCivil: r["marital-status"] ?? "",
    domicilio: r.address ?? "",
    autorizacion: r.authorization ?? "",
    requestedAmount: r["requested-amount"] ?? 0,
    comisionPorcentaje: r["commission-pct"] ?? 0,
    fingerprint: audit.fingerprint ?? "",
    screenResolution: audit.screenResolution ?? "",
    idiomaBrowser: audit.idiomaBrowser ?? "",
    ipInfo: audit.ipInfo ?? null,
    otpHash: audit.otpHash ?? "",
  }
}

/** A request that ever started a release: never claimed again (one-way). */
function everClaimed(r: RequestFields): boolean {
  return Boolean(r["release-claim"] || r["release-code"] || r["released-at"])
}

/** valida_cupo: simulated with the bypass, the real SOAP call otherwise. */
export function defaultCupo(simulation: boolean) {
  return async (request: AirtableRecord<RequestFields>): Promise<CupoCheck> => {
    if (simulation) {
      const fake = simulatedCupo()
      return { ok: true, cupoAutorizado: fake.cupoAutorizado, idSolicitud: fake.idSolicitud, message: "Simulated (test bypass)" }
    }
    const res = await validateCupo(request.fields.phone ?? "")
    const ok = res.returnCode === 0 || res.returnCode === "0"
    return { ok, cupoAutorizado: res.cupoAutorizado ?? 0, idSolicitud: res.idSolicitud ?? "", message: res.message ?? "" }
  }
}

/**
 * Disbursement: with the bypass, code 0 and the pagaré generated as the Step 3 bypass does; otherwise
 * releaseRequest (Ejecuta_Desembolso + pagaré) with a store backed by the request: a request that
 * already recorded a disbursed return code is never disbursed again, whatever its status says.
 */
export function defaultDisburse(simulation: boolean, airtable: AirtableClient) {
  return async ({ request, idSolicitud }: DisburseInput): Promise<DisburseOutcome> => {
    const r = request.fields
    const input = pagareInput(request)
    if (simulation) {
      const url = await generarPagare(input)
      return { success: true, returnCode: "0", message: "Simulated disbursement (test bypass)", contractUrl: url ?? "" }
    }
    const store: ReleaseStore = {
      async get() {
        const fresh = await airtable.get<RequestFields>(TABLES.requests, request.id)
        const code = fresh?.fields["release-code"]
        if (code && isDisbursed(code)) {
          return { success: true, hasCommissionIssue: code === "34", pagareUrl: String(fresh?.fields["contract-url"] ?? ""), returnCode: code }
        }
        return undefined
      },
      async set() {
        // The job writes the outcome on the request itself.
      },
    }
    const { phone, autorizacion, requestedAmount: _amount, ...pagare } = input
    void _amount
    const result: ReleaseResult = await releaseRequest(
      { phone, idSolicitud, monto: r["requested-amount"] ?? 0, comision: r.commission ?? 0, autorizacion, pagare },
      store,
    )
    return result.success
      ? { success: true, returnCode: result.returnCode, message: result.hasCommissionIssue ? "Disbursed, commission not collected" : "Disbursed", contractUrl: result.pagareUrl }
      : { success: false, returnCode: result.returnCode ?? "", message: result.error }
  }
}

export async function runGuarantorJob(deps: JobDeps): Promise<JobReport> {
  const { airtable, whatsapp } = deps
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const settle = deps.claimSettleMs ?? CLAIM_SETTLE_MS
  const recordAttempts = deps.recordAttempts ?? 4
  const clock = deps.clock ?? Date.now
  const budget = deps.releaseBudgetMs ?? RELEASE_BUDGET_MS
  const applications = deps.applications ?? recordApplication
  const cupo = deps.cupo ?? defaultCupo(deps.simulation)
  const disburse = deps.disburse ?? defaultDisburse(deps.simulation, airtable)
  const repo = createAvalesRepo({ airtable, now, newToken: deps.newToken })
  const report: JobReport = {
    runId: deps.runId ?? randomUUID(),
    simulation: deps.simulation,
    invited: 0,
    ...(deps.simulation ? { links: [] } : {}),
    rejected: [],
    quorum: [],
    expired: [],
    released: [],
    unrecorded: [],
    stuck: [],
    deferred: [],
    leads: 0,
    thanked: 0,
    errors: [],
  }
  const fail = (step: string, id: string | undefined, error: unknown) => {
    report.errors.push({ step, id, error: describe(error) })
    console.error(`[avales] job ${step} failed${id ? ` for ${id}` : ""}: ${describe(error)}`)
  }
  const nowIso = () => now().toISOString()
  const getRequest = (id: string) => airtable.get<RequestFields>(TABLES.requests, id)
  // Local and production share one base: a simulation run only touches test requests, a real run
  // only real ones (see isTestRequest).
  const inMode = (r: RequestFields | undefined | null) => !!r && isTestRequest(r) === deps.simulation
  const requestCache = new Map<string, Promise<AirtableRecord<RequestFields> | null>>()
  const requestOf = (id: string | undefined) => {
    if (!id || !isRecordId(id)) return Promise.resolve(null)
    if (!requestCache.has(id)) requestCache.set(id, getRequest(id))
    return requestCache.get(id)!
  }
  const notifyApplicant = async (request: AirtableRecord<RequestFields>, template: "request_rejected" | "request_expired" | "request_not_approved") => {
    const res = await whatsapp({ template, to: request.fields.phone ?? "", variables: { name: request.fields["full-name"] ?? "" } })
    if (!res.ok) fail("notify", request.id, new Error(res.reason))
  }

  // 1. Invite. Without a working WhatsApp no link is issued: guarantors stay `pending`.
  const pending = whatsapp.ready === false ? [] : await airtable.list<GuarantorFields>(TABLES.guarantors, { filterByFormula: `{status} = 'pending'` })
  if (whatsapp.ready === false) console.warn("[avales] job: WhatsApp not integrated; invitations skipped (guarantors stay pending)")
  for (const listed of pending) {
    try {
      const request = await requestOf(listed.fields.request?.[0])
      if (!request || !inMode(request.fields) || !repo.isOpen(request)) continue
      // Re-read: another run may have invited it since the list was taken.
      const g = await airtable.get<GuarantorFields>(TABLES.guarantors, listed.id)
      if (g?.fields.status !== "pending") continue
      const token = await repo.issueGuarantorToken(g.id)
      const url = `${deps.baseUrl}/aval/${token}`
      const sent = await whatsapp({
        template: "guarantor_invitation",
        to: g.fields.phone ?? "",
        variables: {
          guarantorName: g.fields["full-name"] ?? "",
          applicantName: request.fields["full-name"] ?? "",
          relationship: g.fields.relationship ?? "",
          amount: String(request.fields["requested-amount"] ?? ""),
          link: url,
        },
      })
      if (!sent.ok) {
        fail("invite", g.id, new Error(sent.reason))
        continue
      }
      // Local testing only: in simulation, a test request's guarantor link is also stored in
      // `dev-link` so it can be opened from Airtable (no WhatsApp yet). Never outside simulation
      // or for real requests; a re-invitation overwrites it with the new link.
      const devLink = deps.simulation && isTestRequest(request.fields) ? { "dev-link": url } : {}
      await airtable.update(TABLES.guarantors, [
        { id: g.id, fields: { status: "invited" satisfies GuarantorStatus, "invited-at": nowIso(), ...devLink } },
      ])
      report.invited++
      report.links?.push({ requestId: request.id, position: g.fields.position ?? 0, url })
    } catch (error) {
      fail("invite", listed.id, error)
    }
  }

  // 2–4. Rejections, quorum, expiry.
  type Next = { request: RequestStatus; guarantors: GuarantorStatus; extra?: Record<string, unknown> }
  const decide = async (requestId: string, pastDeadline: boolean) => {
    const rows = (await repo.guarantorsOf(requestId)).filter((g) => g.fields.status && g.fields.status !== "closed")
    const count = (s: GuarantorStatus) => rows.filter((g) => g.fields.status === s).length
    const open = rows.filter((g) => OPEN_GUARANTOR.includes(g.fields.status!))
    // Quorum needs two *different* people: authorized guarantors are counted by distinct DPI, so two
    // links confirmed with the same DPI at the same moment never make a quorum (no self-guarantee).
    const authorizedPeople = new Set(rows.filter((g) => g.fields.status === "authorized").map((g) => g.fields.identification || g.id))
    let next: Next | null = null
    if (count("rejected") >= 2) next = { request: "rejected", guarantors: "closed" }
    else if (authorizedPeople.size >= 2) next = { request: "quorum", guarantors: "closed", extra: { "quorum-at": nowIso() } }
    else if (pastDeadline) next = { request: "expired", guarantors: "expired" }
    return { rows, open, next }
  }

  for (const listed of await airtable.list<RequestFields>(TABLES.requests, { filterByFormula: `{status} = 'pending_guarantors'` })) {
    if (!inMode(listed.fields)) continue
    try {
      const deadline = Date.parse(listed.fields["expires-at"] ?? "")
      const pastDeadline = Number.isNaN(deadline) || now().getTime() >= deadline
      let { rows, open, next } = await decide(listed.id, pastDeadline)
      if (!next) continue
      // Expiring closes every open guarantor: re-read them right before, in case one just answered.
      if (next.request === "expired") ({ rows, open, next } = await decide(listed.id, pastDeadline))
      if (!next) continue

      // Re-read the request last, right before writing: act only if it is still waiting for guarantors.
      const r = await getRequest(listed.id)
      if (!r || r.fields.status !== "pending_guarantors" || everClaimed(r.fields) || !inMode(r.fields)) continue

      // Guarantors first: if the request write fails, the next run sees the same counts and retries.
      if (open.length > 0) {
        await airtable.update(TABLES.guarantors, open.map((g) => ({ id: g.id, fields: { status: next!.guarantors } })))
      }
      await airtable.update(TABLES.requests, [{ id: r.id, fields: { status: next.request, ...next.extra } }])
      if (next.request === "rejected") {
        report.rejected.push(r.id)
        await notifyApplicant(r, "request_rejected")
      } else if (next.request === "quorum") {
        report.quorum.push(r.id)
      } else {
        report.expired.push(r.id)
        // A request with no guarantors is an empty duplicate left by a race: expire it silently.
        if (rows.length > 0) await notifyApplicant(r, "request_expired")
      }
    } catch (error) {
      fail("resolve", listed.id, error)
    }
  }

  // 5. Release, one request at a time, within a time budget so the platform never cuts a run in the
  // middle of a release (each release waits CLAIM_SETTLE_MS). The rest wait for the next run.
  const releaseStart = clock()
  for (const q of await airtable.list<RequestFields>(TABLES.requests, { filterByFormula: `{status} = 'quorum'` })) {
    if (!inMode(q.fields)) continue
    if (everClaimed(q.fields)) {
      // In quorum but a release already started: inconsistent, needs a human. Never released again.
      report.stuck.push(q.id)
      continue
    }
    if (clock() - releaseStart > budget) {
      report.deferred.push(q.id)
      continue
    }
    try {
      report.released.push(await releaseOne(q.id))
    } catch (error) {
      fail("release", q.id, error)
    }
  }

  /**
   * Release claim (Airtable has no conditional writes):
   * - a request is claimed at most once ever (`everClaimed`), so a stale run can never start a
   *   second release of a request that already started one;
   * - the claim write sets `releasing` + `release-claim` = this run; if that write fails, abort;
   * - the time from the read that saw `quorum` to the confirmed claim write must stay under half the
   *   pause; a slower claim aborts (the request stays `releasing`, reported as stuck, no money moves);
   * - wait CLAIM_SETTLE_MS and re-read: only the run whose claim survived goes on (the last writer
   *   wins, and any concurrent claim fast enough to proceed has landed by then);
   * - the claim (and the absence of a recorded release) is checked once more right before disbursing.
   * Errors in valida_cupo or the disbursement → `release_failed`. Errors reading the claim leave the
   * request `releasing` (writing over another run's claim could hide its release). After a successful
   * disbursement the outcome write is retried; if it still fails the request stays `releasing` and
   * is reported as unrecorded.
   */
  async function releaseOne(id: string): Promise<JobReport["released"][number]> {
    const skipped = { requestId: id, status: "skipped" as const }
    const readAt = clock()
    const current = await getRequest(id)
    if (current?.fields.status !== "quorum" || everClaimed(current.fields)) return skipped
    // Never retried on a 429: a delayed claim write would only make this run step back below.
    await airtable.update(TABLES.requests, [{ id, fields: { status: "releasing" satisfies RequestStatus, "release-claim": report.runId } }], { rateLimitRetries: 0 })
    if (clock() - readAt > settle / 2) {
      console.warn(`[avales] job release claim too slow for ${id}; not releasing (left in releasing)`)
      return skipped
    }
    await sleep(settle)
    const ownsClaim = async () => {
      const fresh = (await getRequest(id))?.fields
      return fresh?.status === "releasing" && fresh["release-claim"] === report.runId && !fresh["release-code"] && !fresh["released-at"]
    }
    if (!(await ownsClaim())) return skipped

    // The release outcome also goes to the applications record of this authorization (same test
    // mark as the request). Best effort: it never affects the run, the claim or the release.
    const r = current.fields
    const amounts = { requestedAmount: r["requested-amount"], commission: r.commission }
    const noteApplication = async (patch: ApplicationPatch) => {
      try {
        await applications(r.authorization, patch, { test: isTestRequest(r) })
      } catch (error) {
        fail("application", id, error)
      }
    }

    const markFailed = async (message: string, returnCode?: string) => {
      await airtable.update(TABLES.requests, [
        { id, fields: { status: "release_failed" satisfies RequestStatus, "release-message": message, ...(returnCode ? { "release-code": returnCode } : {}) } },
      ])
      await noteApplication({ step: "error", errorStep: "desembolso", error: { message, code: returnCode }, disbursement: amounts })
      return { requestId: id, status: "release_failed" as const, ...(returnCode ? { returnCode } : {}) }
    }

    const claimed = (await getRequest(id)) ?? current
    let check: CupoCheck
    try {
      check = await cupo(claimed)
    } catch (error) {
      return await markFailed(`valida_cupo: ${describe(error)}`)
    }
    if (!check.ok) return await markFailed(`valida_cupo: ${check.message}`)
    if (check.cupoAutorizado < (claimed.fields["requested-amount"] ?? 0)) {
      await airtable.update(TABLES.requests, [{ id, fields: { status: "not_approved" satisfies RequestStatus, "release-message": "Cupo below the requested amount" } }])
      await noteApplication({ step: "error", errorStep: "cupo", error: { message: "Cupo below the requested amount" } })
      await notifyApplicant(claimed, "request_not_approved")
      return { requestId: id, status: "not_approved" }
    }
    if (!(await ownsClaim())) return skipped

    let outcome: DisburseOutcome
    try {
      outcome = await disburse({ request: claimed, idSolicitud: check.idSolicitud })
    } catch (error) {
      return await markFailed(`release error: ${describe(error)}`)
    }
    if (!outcome.success) return await markFailed(outcome.message, outcome.returnCode)
    // Money moved: record it in applications even if the request write below fails.
    await noteApplication({ step: "desembolsado", ...amounts, code: outcome.returnCode, message: outcome.message })

    const recorded = await recordRelease(id, outcome)
    if (!recorded) {
      report.unrecorded.push({ requestId: id, returnCode: outcome.returnCode })
      console.error(`[avales] RELEASED BUT NOT RECORDED: request ${id}, return code ${outcome.returnCode}. Record it by hand.`)
      return { requestId: id, status: "releasing", returnCode: outcome.returnCode }
    }
    const sent = await whatsapp({
      template: "contract_approved",
      to: claimed.fields.phone ?? "",
      variables: { name: claimed.fields["full-name"] ?? "", amount: String(claimed.fields["requested-amount"] ?? ""), contract: outcome.contractUrl },
    })
    if (!sent.ok) fail("notify", id, new Error(sent.reason))
    return { requestId: id, status: "disbursed", returnCode: outcome.returnCode }
  }

  async function recordRelease(id: string, outcome: Extract<DisburseOutcome, { success: true }>): Promise<boolean> {
    const fields = {
      status: "disbursed" satisfies RequestStatus,
      "released-at": nowIso(),
      "release-code": outcome.returnCode,
      "release-message": outcome.message,
      ...(outcome.contractUrl ? { "contract-url": outcome.contractUrl } : {}),
    }
    for (let attempt = 1; attempt <= recordAttempts; attempt++) {
      try {
        await airtable.update(TABLES.requests, [{ id, fields }])
        return true
      } catch (error) {
        fail("record", id, error)
        if (attempt < recordAttempts) await sleep(1000 * 2 ** (attempt - 1))
      }
    }
    return false
  }

  // Requests left in `releasing` need a human: an interrupted run or an unrecorded release.
  try {
    const releasing = (await airtable.list<RequestFields>(TABLES.requests, { filterByFormula: `{status} = 'releasing'` })).map((r) => r.id)
    report.stuck = [...new Set([...report.stuck, ...releasing])]
  } catch (error) {
    fail("stuck", undefined, error)
  }

  // 6. Leads.
  for (const g of await airtable.list<GuarantorFields>(TABLES.guarantors, { filterByFormula: `{status} = 'authorized'` })) {
    if ((g.fields["guarantor-leads"] ?? []).length > 0) continue
    try {
      if (!inMode((await requestOf(g.fields.request?.[0]))?.fields)) continue
      const evidence = parseJson<{ officialName?: string | null }>(g.fields.evidence)
      await airtable.upsert(
        TABLES.leads,
        [
          {
            "guarantor-id": g.id,
            "official-name": evidence?.officialName || g.fields["full-name"] || "",
            phone: g.fields.phone ?? "",
            identification: g.fields.identification ?? "",
            "certified-at": g.fields["answered-at"] ?? nowIso(),
            request: g.fields.request ?? [],
            guarantor: [g.id],
          },
        ],
        ["guarantor-id"],
      )
      report.leads++
    } catch (error) {
      fail("lead", g.id, error)
    }
  }
  type LeadFields = { phone?: string; "official-name"?: string; "thanked-at"?: string; request?: string[] }
  for (const listed of await airtable.list<LeadFields>(TABLES.leads, { filterByFormula: `{thanked-at} = BLANK()` })) {
    try {
      if (!inMode((await requestOf(listed.fields.request?.[0]))?.fields)) continue
      // Re-read: another run may have thanked it since the list was taken.
      const lead = await airtable.get<LeadFields>(TABLES.leads, listed.id)
      if (!lead || lead.fields["thanked-at"]) continue
      const sent = await whatsapp({ template: "guarantor_thanks", to: lead.fields.phone ?? "", variables: { name: lead.fields["official-name"] ?? "" } })
      if (!sent.ok) {
        fail("thanks", lead.id, new Error(sent.reason))
        continue
      }
      await airtable.update(TABLES.leads, [{ id: lead.id, fields: { "thanked-at": nowIso() } }])
      report.thanked++
    } catch (error) {
      fail("thanks", listed.id, error)
    }
  }

  return report
}
