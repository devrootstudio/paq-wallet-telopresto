import { answerGuarantor } from "@/app/avales-actions"
import { guarantorAnswerSchema, toFieldErrors } from "@/lib/avales/schema"
import type { AnswerResult, FieldErrors, GuarantorAnswer, GuarantorAnswerInput } from "@/lib/avales/types"

/**
 * Answer logic of /aval/<token>, kept out of the client component so server code (the dev preview)
 * and tests can import its values.
 */

/** What the form shows after the guarantor presses Avalar or confirms Rechazar. */
export type AnswerOutcome =
  /** The form stays: field errors and/or a message; `retry` offers to send the same answer again. */
  | { kind: "form"; fieldErrors: FieldErrors; message: string | null; retry?: boolean }
  /** The answer was registered: the form is replaced by a confirmation. */
  | { kind: "done"; status: "authorized" | "rejected" }
  /** The link can no longer be answered: the form is replaced by that screen. */
  | { kind: "ended"; screen: "closed" | "expired" | "invalid" }

export const EMPTY_OUTCOME: AnswerOutcome = { kind: "form", fieldErrors: {}, message: null }

/** identity_mismatch: ask to check the data, never what the official registry returned. */
export const CHECK_DATA_MESSAGE = "No pudimos confirmar tus datos. Revisa tu nombre, DPI y teléfono e intenta de nuevo."
export const RETRY_MESSAGE = "No pudimos registrar tu respuesta. Intenta de nuevo en unos minutos."

export const NOT_AVAILABLE_MESSAGE =
  "Todavía no podemos registrar tu respuesta. Estamos terminando de habilitar esta opción: vuelve a abrir este link más tarde."

function outcomeFor(result: Extract<AnswerResult, { ok: false }>): AnswerOutcome {
  switch (result.code) {
    case "closed":
    case "expired":
    case "invalid":
      return { kind: "ended", screen: result.code }
    case "validation":
      return { kind: "form", fieldErrors: result.fieldErrors ?? {}, message: "Revisa los datos marcados." }
    case "not_available":
      return { kind: "form", fieldErrors: {}, message: NOT_AVAILABLE_MESSAGE }
    case "unavailable":
    default:
      return { kind: "form", fieldErrors: {}, message: RETRY_MESSAGE, retry: true }
  }
}

/**
 * Validates (for `accept`) with the shared schema, calls `answerGuarantor` and turns the result into
 * what the form shows. Does not call the server when the data to accept is invalid.
 */
export async function submitAnswer(
  token: string,
  answer: GuarantorAnswer,
  data: GuarantorAnswerInput,
  send: typeof answerGuarantor = answerGuarantor,
): Promise<AnswerOutcome> {
  if (answer === "accept") {
    const parsed = guarantorAnswerSchema.safeParse(data)
    if (!parsed.success) {
      return { kind: "form", fieldErrors: toFieldErrors(parsed.error), message: "Revisa los datos marcados." }
    }
  }
  try {
    const result = await send(token, answer, data)
    if (result.ok) {
      if (result.status === "identity_mismatch") return { kind: "form", fieldErrors: {}, message: CHECK_DATA_MESSAGE }
      return { kind: "done", status: result.status }
    }
    return outcomeFor(result)
  } catch {
    return {
      kind: "form",
      fieldErrors: {},
      message: "No pudimos registrar tu respuesta. Revisa tu conexión e intenta de nuevo.",
      retry: true,
    }
  }
}

