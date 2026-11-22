"use server"

import { validateSecurityToken } from "@/lib/security-token"
import { guarantorRequestSchema, toFieldErrors } from "@/lib/avales/schema"
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

/** Which Step 3 to show: `TELOPRESTO_RUTA`, `aval` unless it is exactly `normal`. */
export async function getRutaAction(): Promise<Ruta> {
  return readRuta()
}

/**
 * Paso 3b: validates again and stores the request with its three guarantors.
 * Idempotent by `authorization`: a retry returns the existing request with `reused: true`.
 */
export async function submitGuarantorRequest(input: GuarantorRequestInput): Promise<SubmitResult> {
  if (!(await validateSecurityToken())) return { ok: false, code: "unauthorized" }
  if (readRuta() !== "aval") return { ok: false, code: "route_disabled" }

  const parsed = guarantorRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "validation", fieldErrors: toFieldErrors(parsed.error) }

  // Storage lands in the next commit (lib/avales/repo.ts).
  return { ok: false, code: "unavailable" }
}

/** /aval/<token>: which screen to render (contract §4). */
export async function getGuarantorView(token: string): Promise<GuarantorView> {
  void token
  return { screen: "invalid" }
}

/** /aval/<token>: the guarantor accepts or rejects. Stub until the RENAP task implements it. */
export async function answerGuarantor(
  token: string,
  answer: GuarantorAnswer,
  data: GuarantorAnswerInput,
): Promise<AnswerResult> {
  void token
  void answer
  void data
  return { ok: false, code: "not_available" }
}
