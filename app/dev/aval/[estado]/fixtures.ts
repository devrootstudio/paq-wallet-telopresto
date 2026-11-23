import type { GuarantorView } from "@/lib/avales/types"
import { CHECK_DATA_MESSAGE, RETRY_MESSAGE, type AnswerOutcome } from "@/components/aval/answer"

/** Fictitious data for the development preview of /aval/<token>. Never used in production. */
const base = (now: number) => ({
  applicantFirstName: "María",
  applicantName: "María Fernanda Solicitante Ejemplo",
  amount: 3500,
  // 47:52 h left
  expiresAt: new Date(now + (47 * 60 + 52) * 60_000 + 30_000).toISOString(),
})

const guarantor = {
  fullName: "Carlos Ejemplo Prueba",
  phone: "10000001",
  identification: "1000000000101",
  relationship: "hermano/a" as const,
}

export const PREVIEW_STATES = [
  "formulario",
  "formulario-rechazo",
  "formulario-revisar-datos",
  "respondido",
  "respondido-rechazo",
  "cerrado",
  "vencido",
  "invalido",
  // Screens shown after answering (client state of the form)
  "tras-avalar",
  "tras-rechazar",
  "tras-revisar-datos",
  "tras-cerrado",
  "tras-error",
] as const

export type PreviewState = (typeof PREVIEW_STATES)[number]

export function previewView(state: PreviewState, now: number): GuarantorView {
  switch (state) {
    case "formulario":
    case "formulario-rechazo":
    case "tras-avalar":
    case "tras-rechazar":
    case "tras-revisar-datos":
    case "tras-cerrado":
    case "tras-error":
      return { ...base(now), screen: "form", guarantor, identityMismatch: false }
    case "formulario-revisar-datos":
      return { ...base(now), screen: "form", guarantor, identityMismatch: true }
    case "respondido":
      return { ...base(now), screen: "answered", answer: "authorized" }
    case "respondido-rechazo":
      return { ...base(now), screen: "answered", answer: "rejected" }
    case "cerrado":
      return { ...base(now), screen: "closed" }
    case "vencido":
      return { ...base(now - 49 * 3_600_000), screen: "expired" }
    case "invalido":
      return { screen: "invalid" }
  }
}

/** Outcome the form starts on for the "tras-*" preview states. */
export function previewOutcome(state: PreviewState): AnswerOutcome | undefined {
  switch (state) {
    case "tras-avalar":
      return { kind: "done", status: "authorized" }
    case "tras-rechazar":
      return { kind: "done", status: "rejected" }
    case "tras-revisar-datos":
      return { kind: "form", fieldErrors: {}, message: CHECK_DATA_MESSAGE }
    case "tras-cerrado":
      return { kind: "ended", screen: "closed" }
    case "tras-error":
      return { kind: "form", fieldErrors: {}, message: RETRY_MESSAGE, retry: true }
    default:
      return undefined
  }
}
