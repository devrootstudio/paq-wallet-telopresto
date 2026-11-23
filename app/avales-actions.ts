"use server"

import { headers } from "next/headers"
import { validateSecurityToken } from "@/lib/security-token"
import { airtableFromEnv, AirtableError } from "@/lib/airtable"
import { answerGuarantorWith, type AnswerMeta } from "@/lib/avales/answer"
import { renapFromEnv } from "@/lib/avales/renap"
import { createAvalesRepo } from "@/lib/avales/repo"
import { guarantorRequestSchema, toFieldErrors } from "@/lib/avales/schema"
import { isWellFormedToken } from "@/lib/avales/tokens"
import type {
  AnswerResult,
  GuarantorAnswer,
  GuarantorAnswerInput,
  GuarantorRequestInput,
  GuarantorView,
  Ruta,
  SubmitResult,
} from "@/lib/avales/types"

/**
 * Server actions for the guarantor route (contract docs/contracts/avales.md §5).
 * Never log DPI, full phones, tokens or storage response bodies from here.
 */

function readRuta(): Ruta {
  return process.env.TELOPRESTO_RUTA === "normal" ? "normal" : "aval"
}

function repoFromEnv() {
  const airtable = airtableFromEnv()
  if (!airtable) {
    console.error("[avales] storage not configured: AIRTABLE_TOKEN or AIRTABLE_BASE_ID missing")
    return null
  }
  return createAvalesRepo({ airtable })
}

function describe(error: unknown): string {
  if (error instanceof AirtableError) return `${error.status} ${error.type}`
  return error instanceof Error ? error.name : "unknown"
}

/** Which Step 3 to show: `TELOPRESTO_RUTA`, `aval` unless it is exactly `normal`. */
export async function getRutaAction(): Promise<Ruta> {
  return readRuta()
}

/** Submits in flight on this server instance, by authorization: a double click shares one call. */
const inFlight = new Map<string, Promise<SubmitResult>>()

/**
 * Paso 3b: validates again and stores the request with its three guarantors.
 * Idempotent by `authorization`: a retry returns the existing request with `reused: true`.
 */
export async function submitGuarantorRequest(input: GuarantorRequestInput): Promise<SubmitResult> {
  if (!(await validateSecurityToken())) return { ok: false, code: "unauthorized" }
  if (readRuta() !== "aval") return { ok: false, code: "route_disabled" }

  const parsed = guarantorRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "validation", fieldErrors: toFieldErrors(parsed.error) }

  const key = parsed.data.authorization
  const pending = inFlight.get(key)
  if (pending) {
    const shared = await pending
    return shared.ok ? { ...shared, reused: true } : shared
  }

  const run = (async (): Promise<SubmitResult> => {
    const repo = repoFromEnv()
    if (!repo) return { ok: false, code: "unavailable" }
    try {
      const outcome = await repo.submit(parsed.data)
      return { ok: true, ...outcome }
    } catch (error) {
      console.error(`[avales] submit failed: ${describe(error)}`)
      return { ok: false, code: "unavailable" }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}

/**
 * /aval/<token>: which screen to render (contract §4).
 * Throws (without details) when storage is unavailable, so the route's error boundary handles it.
 */
export async function getGuarantorView(token: string): Promise<GuarantorView> {
  // A malformed token is `invalid` without touching storage (nor needing it configured).
  if (!isWellFormedToken(token)) return { screen: "invalid" }
  const repo = repoFromEnv()
  if (!repo) throw new Error("Guarantor view unavailable")
  try {
    return await repo.view(token)
  } catch (error) {
    console.error(`[avales] view failed: ${describe(error)}`)
    throw new Error("Guarantor view unavailable")
  }
}

/** IP and user agent of the guarantor, for the answer evidence. Empty when unavailable. */
async function requestMeta(): Promise<AnswerMeta> {
  try {
    const h = await headers()
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || ""
    return { ip, userAgent: h.get("user-agent") ?? "" }
  } catch {
    return { ip: "", userAgent: "" }
  }
}

/**
 * /aval/<token>: the guarantor accepts or rejects (contract §5, §6). The link token is the credential.
 * RENAP is simulated with the test bypass outside production; without it and without RENAP_*
 * credentials, `accept` answers `unavailable`.
 */
export async function answerGuarantor(
  token: string,
  answer: GuarantorAnswer,
  data: GuarantorAnswerInput,
): Promise<AnswerResult> {
  if (!isWellFormedToken(token)) return { ok: false, code: "invalid" }
  const airtable = airtableFromEnv()
  if (!airtable) {
    console.error("[avales] storage not configured: AIRTABLE_TOKEN or AIRTABLE_BASE_ID missing")
    return { ok: false, code: "unavailable" }
  }
  try {
    return await answerGuarantorWith({ airtable, renap: renapFromEnv() }, token, answer, data, await requestMeta())
  } catch (error) {
    console.error(`[avales] answer failed: ${describe(error)}`)
    return { ok: false, code: "unavailable" }
  }
}
