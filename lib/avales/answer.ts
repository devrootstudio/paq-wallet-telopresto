import { randomUUID } from "crypto"
import type { AirtableClient, AirtableRecord } from "@/lib/airtable"
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
 * One answer per guarantor at a time (`answer-claim`, like the job's release claim): the answer
 * writes a claim, waits ANSWER_CLAIM_SETTLE_MS and re-reads; only the holder calls RENAP and writes
 * the evidence, a concurrent answer gets `closed`. The claim is freed when the link stays open
 * (RENAP error, identity mismatch, self-guarantee, unexpected failure) and kept once the guarantor
 * is `authorized` or `rejected`. A claim older than ANSWER_CLAIM_LEASE_MS can be taken over.
 * The pause is shorter than the job's: no money moves here, and the worst case of an unusually slow
 * claim write is a duplicate evidence write, not a duplicate release.
 *
 * Privacy: never log the token, names, DPI or phones.
 */

/** Pause between writing the answer claim and re-reading it. */
export const ANSWER_CLAIM_SETTLE_MS = 1500

/** Longer than the slowest RENAP check (two authentications and two searches of 25 s). */
export const ANSWER_CLAIM_LEASE_MS = 120_000

/** Airtable long text holds 100,000 characters; keep the raw RENAP response below that. */
const RAW_LIMIT = 90_000

function truncate(raw: string): string {
  return raw.length <= RAW_LIMIT ? raw : `${raw.slice(0, RAW_LIMIT)}…[truncated ${raw.length - RAW_LIMIT} chars]`
}

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
  const linkState = (found: Parameters<typeof linkStateAt>[0]) => linkStateAt(found, now())

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

  const readAt = clock()
  const found = await repo.findByToken(token)
  if (!found) return { ok: false, code: "invalid" }
  const blocked = linkState(found)
  if (blocked) return blocked

  const id = found.guarantor.id
  const at = now().toISOString()
  const evidence = (extra: Record<string, unknown>) =>
    JSON.stringify({
      answer,
      at,
      ip: meta.ip,
      userAgent: meta.userAgent,
      ...(answer === "accept" ? { declarationVersion: DECLARATION_VERSION, declarationSha256: DECLARATION_SHA256 } : {}),
      ...extra,
    })

  // The confirmed data cannot be the applicant's nor another guarantor's of this request (no
  // self-guarantee). One generic message on both fields: it must not reveal which data matched whom.
  // The job also counts distinct DPIs for quorum, which covers two forms sent at the same moment.
  const reusesSomeoneElse = async () => {
    const others = (await repo.guarantorsOf(found.request.id)).filter((g) => g.id !== id && g.fields.status !== "closed")
    const r = found.request.fields
    return (
      confirmed!.identification === r.identification ||
      confirmed!.phone === r.phone ||
      others.some((g) => g.fields.identification === confirmed!.identification || g.fields.phone === confirmed!.phone)
    )
  }
  const SELF_GUARANTEE = "Estos datos no pueden usarse para avalar esta solicitud"
  const selfGuarantee: AnswerResult = { ok: false, code: "validation", fieldErrors: { identification: SELF_GUARANTEE, phone: SELF_GUARANTEE } }
  if (answer === "accept") {
    if (await reusesSomeoneElse()) return selfGuarantee
    if (!deps.renap) return { ok: false, code: "unavailable" }
  }

  // One answer at a time per guarantor: only the holder of the claim calls RENAP and writes the
  // evidence. A concurrent answer (another tab, a double click) gets `closed`.
  const existing = found.guarantor.fields["answer-claim"]
  if (existing && !claimExpired(existing, now())) return { ok: false, code: "closed" }
  const claim = `${randomUUID()}@${now().getTime()}`
  await deps.airtable.update(TABLES.guarantors, [{ id, fields: { "answer-claim": claim } }])
  if (clock() - readAt > settle / 2) {
    // Too slow to be sure no concurrent claim lands after our re-read: let the guarantor retry.
    // The claim (if still ours) expires with its lease.
    return { ok: false, code: "unavailable" }
  }
  await sleep(settle)
  const ownsClaim = async () => {
    const fresh = await deps.airtable.get<GuarantorFields>(TABLES.guarantors, id)
    return fresh?.fields["answer-claim"] === claim
  }
  if (!(await ownsClaim())) return { ok: false, code: "closed" }

  /** Releases our claim so the guarantor can answer again (link still open). */
  const release = (fields: Record<string, unknown> = {}) =>
    deps.airtable.update(TABLES.guarantors, [{ id, fields: { ...fields, "answer-claim": "" } }])

  try {
    if (answer === "reject") {
      if (!(await ownsClaim())) return { ok: false, code: "closed" }
      // The claim stays: the link no longer takes answers.
      await deps.airtable.update(TABLES.guarantors, [
        { id, fields: { status: "rejected" satisfies GuarantorStatus, "answered-at": at, evidence: evidence({}) } },
      ])
      return { ok: true, status: "rejected" }
    }

    const check = await deps.renap!(confirmed!)
    const renapFields = { "renap-result": check.result, "renap-raw": truncate(JSON.stringify(check.raw ?? null)) }

    // RENAP may take seconds: re-read, and write nothing if the link stopped taking answers
    // meanwhile, the claim was lost, or another guarantor confirmed the same data in the meantime.
    const again = await repo.findByToken(token)
    if (!again) return { ok: false, code: "invalid" }
    const changed = linkState(again)
    if (changed) return changed
    if (again.guarantor.fields["answer-claim"] !== claim) return { ok: false, code: "closed" }
    if (await reusesSomeoneElse()) {
      await release()
      return selfGuarantee
    }

    if (check.result === "ERROR") {
      // Keep the status and free the claim: the guarantor can try again. Store the attempt as evidence.
      await release(renapFields)
      return { ok: false, code: "unavailable" }
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
  } catch (error) {
    // Unexpected failure after claiming: free the claim (best effort) so a retry is not stuck on `closed`.
    await release().catch(() => undefined)
    throw error
  }
}

/** The error to return when the link no longer takes answers, or null when it shows the form. */
function linkStateAt(found: { guarantor: AirtableRecord<GuarantorFields>; request: AirtableRecord<RequestFields> }, now: Date): AnswerResult | null {
  const view = resolveView(found.guarantor, found.request, now)
  if (view.screen === "invalid") return { ok: false, code: "invalid" }
  if (view.screen === "expired") return { ok: false, code: "expired" }
  if (view.screen !== "form") return { ok: false, code: "closed" }
  return null
}

/** A claim older than its lease belongs to an answer that died: it can be taken over. */
export function claimExpired(claim: string, now: Date): boolean {
  const at = Number(claim.split("@")[1])
  return !Number.isFinite(at) || now.getTime() - at > ANSWER_CLAIM_LEASE_MS
}
