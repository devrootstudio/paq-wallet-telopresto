import { randomUUID } from "crypto"
import { isRecordId, type AirtableClient, type AirtableRecord } from "@/lib/airtable"
import { DECLARATION_SHA256, DECLARATION_TEXT, DECLARATION_VERSION } from "./declaration"
import type { RenapChecker } from "./renap"
import { createAvalesRepo, resolveView, TABLES, type GuarantorFields, type GuarantorStatus, type RequestFields } from "./repo"
import { guarantorAnswerSchema, toFieldErrors } from "./schema"
import type { AnswerResult, GuarantorAnswer, GuarantorAnswerInput } from "./types"

/**
 * The guarantor's answer on /aval/<token> (contract §5 `answerGuarantor`, §6 RENAP). Server-side only.
 * - `reject` → `rejected`.
 * - `accept` → checks the confirmed data and the accepted declaration, then RENAP:
 *   match → `authorized` (the confirmed data replaces what the applicant typed);
 *   no match → `identity_mismatch` (the link stays open to correct the data);
 *   RENAP error → `unavailable`, status unchanged.
 * The link stops taking answers once the guarantor is `authorized` or `rejected`, the request is
 * resolved, or it expired (by status or by `expires-at`). It never releases money.
 * Evidence (date, IP, user agent, declaration version and hash) is stored on every answer.
 *
 * One answer per guarantor at a time (`answer-claim`, like the job's release claim):
 * 1. read the guarantor (one call) — it must have no live claim;
 * 2. write our claim; if that read + write took longer than the pause, step back (`unavailable`);
 * 3. wait ANSWER_CLAIM_SETTLE_MS and re-read: only the holder goes on, a concurrent answer gets `busy` (or `closed` once the other one finished);
 * 4. the holder checks the claim again before writing the result.
 * Why it is sound: two answers can only both go on if one's claim lands more than the pause after
 * the other's; a claim lands at most "read + write" after its read, and slower answers step back.
 * Only 2 Airtable calls happen before the claim so this holds with slow calls (≈900 ms each).
 *
 * Every exit other than `authorized` / `rejected` frees our claim (if we still hold it), so the
 * guarantor can answer again right away; every `unavailable` exit logs its reason (ids only).
 * A claim older than ANSWER_CLAIM_LEASE_MS (an answer that died) can be taken over.
 *
 * Privacy: never log the token, names, DPI or phones.
 */

/** Pause between writing the answer claim and re-reading it. Longer than two slow Airtable calls. */
export const ANSWER_CLAIM_SETTLE_MS = 3000

/** Longer than the slowest RENAP check (two authentications and two searches of 25 s). */
export const ANSWER_CLAIM_LEASE_MS = 120_000

/** Airtable long text holds 100,000 characters; keep the raw RENAP response below that. */
const RAW_LIMIT = 90_000

function truncate(raw: string): string {
  return raw.length <= RAW_LIMIT ? raw : `${raw.slice(0, RAW_LIMIT)}…[truncated ${raw.length - RAW_LIMIT} chars]`
}

const OPEN: GuarantorStatus[] = ["pending", "invited", "identity_mismatch"]
const SELF_GUARANTEE = "Estos datos no pueden usarse para avalar esta solicitud"

export interface AnswerMeta {
  ip: string
  userAgent: string
}

export interface AnswerDeps {
  airtable: AirtableClient
  /** null when RENAP is not configured: `accept` answers `unavailable`. */
  renap: RenapChecker | null
  now?: () => Date
  /** Pause before re-reading the answer claim. Default ANSWER_CLAIM_SETTLE_MS. */
  claimSettleMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Real elapsed-time clock in ms. Default Date.now. */
  clock?: () => number
}

export async function answerGuarantorWith(
  deps: AnswerDeps,
  token: string,
  answer: GuarantorAnswer,
  data: GuarantorAnswerInput,
  meta: AnswerMeta,
): Promise<AnswerResult> {
  const now = deps.now ?? (() => new Date())
  const settle = deps.claimSettleMs ?? ANSWER_CLAIM_SETTLE_MS
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const clock = deps.clock ?? Date.now
  const repo = createAvalesRepo({ airtable: deps.airtable, now })

  if (answer !== "accept" && answer !== "reject") return { ok: false, code: "validation", fieldErrors: { answer: "Respuesta inválida" } }

  // Validate the input before touching storage, so a bad form never costs a lookup.
  let confirmed: { fullName: string; identification: string; phone: string } | null = null
  if (answer === "accept") {
    const parsed = guarantorAnswerSchema.safeParse(data)
    const errors = parsed.success ? {} : toFieldErrors(parsed.error)
    if (data?.acceptedText !== DECLARATION_TEXT) errors.acceptedText = "Debes aceptar la declaración para avalar"
    if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, code: "validation", fieldErrors: errors }
    confirmed = parsed.data
  }

  // 1. One read before the claim: the guarantor (it carries the claim).
  const readAt = clock()
  const guarantor = await repo.findGuarantorByToken(token)
  const requestId = guarantor?.fields.request?.[0]
  if (!guarantor || !isRecordId(requestId)) return { ok: false, code: "invalid" }
  const status = guarantor.fields.status
  if (status === "expired") return { ok: false, code: "expired" }
  if (!status || !OPEN.includes(status)) return { ok: false, code: "closed" }
  const id = guarantor.id
  const unavailable = (reason: string): AnswerResult => {
    console.warn(`[avales] answer unavailable for ${id}: ${reason}`)
    return { ok: false, code: "unavailable" }
  }
  if (answer === "accept" && !deps.renap) return unavailable("identity check not configured")
  const existing = guarantor.fields["answer-claim"]
  // Another answer is in progress: the link is still open, so not `closed` (which would tell the
  // guarantor their answer is no longer needed).
  if (existing && !claimExpired(existing, now())) return { ok: false, code: "busy" }

  // 2. Claim.
  const claim = `${randomUUID()}@${now().getTime()}`
  await deps.airtable.update(TABLES.guarantors, [{ id, fields: { "answer-claim": claim } }])

  let released = false
  /** Writes `fields` and frees the claim (we hold it): the link stays open. */
  const release = async (fields: Record<string, unknown> = {}) => {
    await deps.airtable.update(TABLES.guarantors, [{ id, fields: { ...fields, "answer-claim": "" } }])
    released = true
  }
  /** Frees the claim only if it is still ours (never another answer's). */
  const releaseIfOurs = async () => {
    if (released) return
    const fresh = await deps.airtable.get<GuarantorFields>(TABLES.guarantors, id)
    if (fresh?.fields["answer-claim"] === claim) await release()
  }
  const holds = (rows: AirtableRecord<GuarantorFields>[]) => rows.find((g) => g.id === id)?.fields["answer-claim"] === claim
  const final = (r: AnswerResult) => r.ok && (r.status === "authorized" || r.status === "rejected")

  let result: AnswerResult
  try {
    result = await afterClaim()
  } catch (error) {
    // Unexpected failure after claiming: free the claim so a retry is not stuck on `closed`.
    await releaseIfOurs().catch(() => undefined)
    throw error
  }
  if (!final(result)) await releaseIfOurs().catch(() => undefined)
  return result

  async function afterClaim(): Promise<AnswerResult> {
    if (clock() - readAt > settle) return unavailable("claim confirmed too late; retry")

    // 3. Pause, then re-read guarantors and request: only the claim holder goes on.
    await sleep(settle)
    let state = await readState()
    if (!state) return { ok: false, code: "invalid" }
    // If the other answer already finished, the link is closed; if it is still running, `busy`.
    const blocked = linkState(state)
    if (blocked) return blocked
    if (!holds(state.rows)) return { ok: false, code: "busy" }

    const at = now().toISOString()
    const evidence = (extra: Record<string, unknown>) =>
      JSON.stringify({
        answer,
        at,
        ip: meta.ip,
        userAgent: meta.userAgent,
        // Contract §2: the accepted text itself, its version and its hash.
        ...(answer === "accept"
          ? { acceptedText: DECLARATION_TEXT, declarationVersion: DECLARATION_VERSION, declarationSha256: DECLARATION_SHA256 }
          : {}),
        ...extra,
      })

    if (answer === "reject") {
      // The claim stays: the link no longer takes answers.
      await deps.airtable.update(TABLES.guarantors, [
        { id, fields: { status: "rejected" satisfies GuarantorStatus, "answered-at": at, evidence: evidence({}) } },
      ])
      return { ok: true, status: "rejected" }
    }

    if (reusesSomeoneElse(state)) return selfGuarantee()

    const check = await deps.renap!(confirmed!)
    const renapFields = { "renap-result": check.result, "renap-raw": truncate(JSON.stringify(check.raw ?? null)) }

    // 4. RENAP may take seconds: re-read, and write nothing if the link stopped taking answers,
    // the claim was lost, or another guarantor confirmed the same data meanwhile.
    state = await readState()
    if (!state) return { ok: false, code: "invalid" }
    const changed = linkState(state)
    if (changed) return changed
    if (!holds(state.rows)) return { ok: false, code: "busy" }
    if (reusesSomeoneElse(state)) return selfGuarantee()

    if (check.result === "ERROR") {
      // Keep the status and free the claim: the guarantor can try again. Store the attempt as evidence.
      await release(renapFields)
      return unavailable("identity check failed; retry")
    }
    if (!check.matched) {
      // The link stays open to correct the data: free the claim.
      await release({ ...renapFields, status: "identity_mismatch" satisfies GuarantorStatus, evidence: evidence({ confirmed }) })
      return { ok: true, status: "identity_mismatch" }
    }

    // The claim stays: the link no longer takes answers.
    await deps.airtable.update(TABLES.guarantors, [
      {
        id,
        fields: {
          ...renapFields,
          status: "authorized" satisfies GuarantorStatus,
          "answered-at": at,
          "full-name": confirmed!.fullName,
          identification: confirmed!.identification,
          phone: confirmed!.phone,
          evidence: evidence({ confirmed, officialName: check.officialName ?? null }),
        },
      },
    ])
    return { ok: true, status: "authorized" }
  }

  async function readState() {
    const rows = await repo.guarantorsOf(requestId!)
    const me = rows.find((g) => g.id === id)
    const request = await deps.airtable.get<RequestFields>(TABLES.requests, requestId!)
    return me && request ? { rows, guarantor: me, request } : null
  }

  function linkState(state: { guarantor: AirtableRecord<GuarantorFields>; request: AirtableRecord<RequestFields> }): AnswerResult | null {
    const view = resolveView(state.guarantor, state.request, now())
    if (view.screen === "invalid") return { ok: false, code: "invalid" }
    if (view.screen === "expired") return { ok: false, code: "expired" }
    if (view.screen !== "form") return { ok: false, code: "closed" }
    return null
  }

  /**
   * The confirmed data cannot be the applicant's nor another guarantor's of this request (no
   * self-guarantee). The job also counts distinct DPIs for quorum, which covers simultaneous forms.
   */
  function reusesSomeoneElse(state: { rows: AirtableRecord<GuarantorFields>[]; request: AirtableRecord<RequestFields> }) {
    const others = state.rows.filter((g) => g.id !== id && g.fields.status !== "closed")
    const r = state.request.fields
    return (
      confirmed!.identification === r.identification ||
      confirmed!.phone === r.phone ||
      others.some((g) => g.fields.identification === confirmed!.identification || g.fields.phone === confirmed!.phone)
    )
  }

  /** One generic message on both fields: it must not reveal which data matched whom. */
  function selfGuarantee(): AnswerResult {
    return { ok: false, code: "validation", fieldErrors: { identification: SELF_GUARANTEE, phone: SELF_GUARANTEE } }
  }
}

/** A claim older than its lease belongs to an answer that died: it can be taken over. */
export function claimExpired(claim: string, now: Date): boolean {
  const at = Number(claim.split("@")[1])
  return !Number.isFinite(at) || now.getTime() - at > ANSWER_CLAIM_LEASE_MS
}
