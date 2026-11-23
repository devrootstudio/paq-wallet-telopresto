import type { AirtableClient } from "@/lib/airtable"
import { DECLARATION_SHA256, DECLARATION_TEXT, DECLARATION_VERSION } from "./declaration"
import type { RenapChecker } from "./renap"
import { createAvalesRepo, resolveView, TABLES, type GuarantorStatus } from "./repo"
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
 * Privacy: never log the token, names, DPI or phones.
 */

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
}

export async function answerGuarantorWith(
  deps: AnswerDeps,
  token: string,
  answer: GuarantorAnswer,
  data: GuarantorAnswerInput,
  meta: AnswerMeta,
): Promise<AnswerResult> {
  const now = deps.now ?? (() => new Date())
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

  const found = await repo.findByToken(token)
  if (!found) return { ok: false, code: "invalid" }
  const view = resolveView(found.guarantor, found.request, now())
  if (view.screen === "invalid") return { ok: false, code: "invalid" }
  if (view.screen === "expired") return { ok: false, code: "expired" }
  if (view.screen !== "form") return { ok: false, code: "closed" }

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
  const id = found.guarantor.id

  if (answer === "reject") {
    await deps.airtable.update(TABLES.guarantors, [
      { id, fields: { status: "rejected" satisfies GuarantorStatus, "answered-at": at, evidence: evidence({}) } },
    ])
    return { ok: true, status: "rejected" }
  }

  // The confirmed data cannot be the applicant's nor another guarantor's of this request (no self-guarantee).
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
  if (await reusesSomeoneElse()) return selfGuarantee

  if (!deps.renap) return { ok: false, code: "unavailable" }
  const check = await deps.renap(confirmed!)
  const renapFields = { "renap-result": check.result, "renap-raw": truncate(JSON.stringify(check.raw ?? null)) }

  // RENAP may take seconds: re-read, and write nothing if the link stopped taking answers meanwhile
  // or another guarantor confirmed the same data in the meantime.
  const again = await repo.findByToken(token)
  const stillOpen = again ? resolveView(again.guarantor, again.request, now()) : ({ screen: "invalid" } as const)
  if (stillOpen.screen === "invalid") return { ok: false, code: "invalid" }
  if (stillOpen.screen === "expired") return { ok: false, code: "expired" }
  if (stillOpen.screen !== "form") return { ok: false, code: "closed" }
  if (await reusesSomeoneElse()) return selfGuarantee

  if (check.result === "ERROR") {
    // Keep the status: the guarantor can try again. Store the attempt as evidence.
    await deps.airtable.update(TABLES.guarantors, [{ id, fields: renapFields }])
    return { ok: false, code: "unavailable" }
  }

  if (!check.matched) {
    await deps.airtable.update(TABLES.guarantors, [
      {
        id,
        fields: {
          ...renapFields,
          status: "identity_mismatch" satisfies GuarantorStatus,
          evidence: evidence({ confirmed }),
        },
      },
    ])
    return { ok: true, status: "identity_mismatch" }
  }

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
