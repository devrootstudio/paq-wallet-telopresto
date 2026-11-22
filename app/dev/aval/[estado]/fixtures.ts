import type { GuarantorView } from "@/lib/avales/types"

/** Fictitious data for the development preview of /aval/<token>. Never used in production. */
const base = (now: number) => ({
  applicantFirstName: "María",
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
] as const

export type PreviewState = (typeof PREVIEW_STATES)[number]

export function previewView(state: PreviewState, now: number): GuarantorView {
  switch (state) {
    case "formulario":
    case "formulario-rechazo":
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
