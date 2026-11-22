"use client"

import { useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { useWizardStore, type WizardState } from "@/lib/store"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ErrorTooltip } from "./step-1-form"
import { submitGuarantorRequest } from "@/app/avales-actions"
import { guarantorRequestSchema, toFieldErrors } from "@/lib/avales/schema"
import {
  RELATIONSHIPS,
  type FieldErrors,
  type GuarantorInput,
  type GuarantorRequestInput,
  type Relationship,
  type SubmitResult,
} from "@/lib/avales/types"

export const GUARANTOR_COUNT = 3

/** A guarantor while it is being typed: the relationship starts empty. */
export interface GuarantorDraft {
  fullName: string
  identification: string
  phone: string
  relationship: Relationship | ""
}

type GuarantorField = keyof GuarantorDraft

/** Field errors keyed by the input path (e.g. `guarantors.0.phone`), plus `form` for errors with no field on screen. */
export type GuarantorErrors = FieldErrors

const fieldKey = (index: number, field: GuarantorField) => `guarantors.${index}.${field}`

const FORM_DATA_ERROR =
  "Algunos datos de tu solicitud no son válidos. Recarga la página e inicia la solicitud de nuevo."

export const emptyGuarantors = (): GuarantorDraft[] =>
  Array.from({ length: GUARANTOR_COUNT }, () => ({ fullName: "", identification: "", phone: "", relationship: "" }))

const digits = (value: string) => value.replace(/\D/g, "")

/** "2456789010101" → "2456 78901 0101" */
export const formatDPI = (value: string) => {
  const d = digits(value).slice(0, 13)
  return [d.slice(0, 4), d.slice(4, 9), d.slice(9)].filter(Boolean).join(" ")
}

/** "55123478" → "5512 3478" */
export const formatPhone = (value: string) => {
  const d = digits(value).slice(0, 8)
  return [d.slice(0, 4), d.slice(4)].filter(Boolean).join(" ")
}

/**
 * Phone digits as typed or pasted. A Guatemala code is dropped only when it is clearly a prefix:
 * "+502 …", "00502 …" or 11 digits starting with 502 ("+502 5512 3478" → "55123478").
 */
export const phoneDigits = (value: string) => {
  const trimmed = value.trim()
  const d = digits(value)
  let local = d
  if (trimmed.startsWith("+502")) local = d.slice(3)
  else if (d.startsWith("00502")) local = d.slice(5)
  else if (d.length === 11 && d.startsWith("502")) local = d.slice(3)
  return local.slice(0, 8)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Maximum lengths of the free-text fields that come from earlier steps or from the device, as in
 * lib/avales/schema.ts. Earlier steps do not limit them, and an error there would leave the person
 * with no way out of Step 3b, so they are clipped here instead of rejected.
 */
const MAX = {
  fullName: 120,
  email: 200,
  company: 200,
  age: 10,
  maritalStatus: 50,
  address: 300,
  fingerprint: 200,
  screenResolution: 50,
  idiomaBrowser: 50,
  otpHash: 128,
  ipShort: 64,
  ipText: 200,
  countryCode: 10,
} as const

/** Trims, collapses inner whitespace and cuts to `max` characters. */
export const clip = (value: string | null | undefined, max: number) =>
  (value ?? "").trim().replace(/\s+/g, " ").slice(0, max).trim()

type Store = Pick<WizardState, "formData">

/** Everything `submitGuarantorRequest` needs, from the wizard store plus the 3 guarantors. */
export function buildGuarantorRequest(formData: Store["formData"], guarantors: GuarantorDraft[]): GuarantorRequestInput {
  const requestedAmount = formData.requestedAmount || 0
  return {
    authorization: formData.autorizacion,
    applicant: {
      phone: digits(formData.phone),
      identification: digits(formData.identification),
      fullName: clip(formData.fullName, MAX.fullName),
      email: clip(formData.email, MAX.email),
      company: clip(formData.empresa, MAX.company),
      age: clip(formData.edad, MAX.age),
      maritalStatus: clip(formData.estadoCivil, MAX.maritalStatus),
      address: clip(formData.domicilio, MAX.address),
    },
    // valida_cupo may hand it over as a number: the contract stores text.
    cupoId: String(formData.idSolicitud ?? ""),
    approvedAmount: formData.approvedAmount || 0,
    requestedAmount,
    commission: round2(Math.max(0, requestedAmount - (formData.disbursementAmount || 0))),
    commissionPct: formData.comisionPorcentaje || 0,
    // An empty relationship is sent as is so the shared schema reports it ("Selecciona la relación").
    guarantors: guarantors.map(
      (g): GuarantorInput => ({
        fullName: g.fullName.trim(),
        identification: digits(g.identification),
        phone: digits(g.phone),
        relationship: g.relationship as Relationship,
      }),
    ) as GuarantorRequestInput["guarantors"],
    audit: {
      fingerprint: clip(formData.fingerprint, MAX.fingerprint),
      screenResolution: clip(formData.screenResolution, MAX.screenResolution),
      idiomaBrowser: clip(formData.idiomaBrowser, MAX.idiomaBrowser),
      ipInfo: formData.ipInfo
        ? {
            ip: clip(formData.ipInfo.ip, MAX.ipShort),
            isp: clip(formData.ipInfo.isp, MAX.ipText),
            ciudad: clip(formData.ipInfo.ciudad, MAX.ipText),
            pais: clip(formData.ipInfo.pais, MAX.ipText),
            geolocalizacion: clip(formData.ipInfo.geolocalizacion, MAX.ipText),
            countryCode: clip(formData.ipInfo.countryCode, MAX.countryCode),
          }
        : null,
      otpHash: clip(formData.otpHash, MAX.otpHash),
    },
  }
}

/**
 * Keeps the errors of the guarantor fields shown on screen. Any other path (applicant, amounts,
 * authorization…) comes from earlier steps, so it becomes a single `form` error.
 */
export function splitFieldErrors(fieldErrors: FieldErrors): GuarantorErrors {
  const errors: GuarantorErrors = {}
  for (const [path, message] of Object.entries(fieldErrors)) {
    if (/^guarantors\.\d\.(fullName|identification|phone|relationship)$/.test(path)) {
      errors[path] = message
    } else if (!errors.form) {
      errors.form = FORM_DATA_ERROR
    }
  }
  return errors
}

/**
 * Validates with the shared schema (the server validates again with the same one).
 * Only guarantor fields are shown to the person; any other issue becomes a `form` error.
 */
export function validateGuarantors(input: GuarantorRequestInput): GuarantorErrors {
  const parsed = guarantorRequestSchema.safeParse(input)
  return parsed.success ? {} : splitFieldErrors(toFieldErrors(parsed.error))
}

/** Message for a failed `submitGuarantorRequest`. Field errors are shown on their fields. */
export function submitErrorMessage(result: Extract<SubmitResult, { ok: false }>): string {
  switch (result.code) {
    case "validation":
      return "Revisa los datos marcados."
    case "unauthorized":
      return "Tu sesión expiró. Recarga la página e inicia de nuevo."
    case "route_disabled":
      return "La solicitud con avales no está disponible en este momento."
    case "unavailable":
    default:
      return "No pudimos enviar tu solicitud. Intenta de nuevo en unos minutos."
  }
}

export interface RequestOutcome {
  /** true when the request was saved and the store moved to "en revisión". */
  sent: boolean
  errors: GuarantorErrors
  message: string | null
}

/**
 * Validates, sends the request and, when it is saved, moves the wizard to "en revisión".
 * Does not call the server when the form is invalid.
 */
export async function requestGuarantors(
  formData: Store["formData"],
  guarantors: GuarantorDraft[],
  store: Pick<WizardState, "setGuarantorRequest" | "setAvalStage" | "setRuta">,
  send: typeof submitGuarantorRequest = submitGuarantorRequest,
): Promise<RequestOutcome> {
  const input = buildGuarantorRequest(formData, guarantors)
  const found = validateGuarantors(input)
  if (Object.keys(found).length > 0) return { sent: false, errors: found, message: found.form ?? null }

  try {
    const result = await send(input)
    if (result.ok) {
      store.setGuarantorRequest({
        // The amount as stored: the original one when the request already existed.
        amount: result.requestedAmount,
        expiresAt: result.expiresAt,
        reused: result.reused,
      })
      store.setAvalStage("en-revision")
      return { sent: true, errors: {}, message: null }
    }
    if (result.code === "route_disabled") {
      // The route changed to `normal` (or the first lookup failed): ask again and show today's Step 3.
      store.setAvalStage(null)
      store.setRuta(null)
      // This screen unmounts: no message to show here.
      return { sent: false, errors: {}, message: null }
    }
    const fromServer = result.fieldErrors ? splitFieldErrors(result.fieldErrors) : {}
    return { sent: false, errors: fromServer, message: fromServer.form ?? submitErrorMessage(result) }
  } catch {
    return {
      sent: false,
      errors: {},
      message: "No pudimos enviar tu solicitud. Revisa tu conexión e intenta de nuevo.",
    }
  }
}

export default function Step3bAvales() {
  const { formData, setAvalStage, setGuarantorRequest, setRuta } = useWizardStore()
  const [guarantors, setGuarantors] = useState<GuarantorDraft[]>(emptyGuarantors)
  const [errors, setErrors] = useState<GuarantorErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  const amount = formData.requestedAmount || 0

  const setField = (index: number, field: GuarantorField, value: string) => {
    setGuarantors((prev) => prev.map((g, i) => (i === index ? { ...g, [field]: value } : g)))
    setErrors((prev) => {
      const key = fieldKey(index, field)
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    // One request at a time, even with a double tap before React re-renders the disabled button.
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      const outcome = await requestGuarantors(formData, guarantors, { setGuarantorRequest, setAvalStage, setRuta })
      if (outcome.sent) return
      setErrors(outcome.errors)
      setSubmitError(outcome.message)
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const inputClass = (hasError: boolean) => cn("h-11", hasError && "border-red-500 focus-visible:ring-red-500")
  const selectClass = (hasError: boolean) =>
    cn(
      "flex h-11 w-full appearance-none rounded-lg border border-input bg-white px-3 py-2 text-sm text-black ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      hasError && "border-red-500 focus-visible:ring-red-500",
    )

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-xl font-bold text-white mb-2 text-center">Último paso: solicita tus avales</h1>
      <p className="text-sm text-white/80 text-center leading-relaxed mb-5">
        Tu adelanto de <span className="font-bold text-paq-yellow">Q{amount.toFixed(2)}</span> está reservado. Ingresa 3
        referencias personales y envíales la solicitud de aval.
      </p>

      <div className="bg-paq-yellow text-paq-green rounded-2xl px-4 py-4 mb-5 flex gap-3 items-start">
        <svg
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 flex-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <p className="text-sm leading-relaxed">
          Necesitamos que <strong className="font-extrabold">al menos 2 de tus 3 referencias</strong> aprueben su aval en
          las <strong className="font-extrabold">próximas 48 horas</strong> para realizar el desembolso. Si no,{" "}
          <strong className="font-extrabold">la solicitud se rechazará</strong>.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={submitting}
        className="rounded-2xl border border-white/20 bg-white/5 p-4"
      >
        {guarantors.map((g, i) => (
          <div key={i} className={cn(i > 0 && "mt-4 pt-4 border-t border-white/10")}>
          <fieldset disabled={submitting} className="space-y-3">
            <legend className="text-white text-sm font-bold mb-3">Referencia {i + 1}</legend>

            <div className="relative space-y-1">
              <label htmlFor={`aval-${i}-fullName`} className="text-white text-xs font-medium ml-1">
                Nombre completo
              </label>
              <div className="relative">
                <Input
                  id={`aval-${i}-fullName`}
                  autoComplete="off"
                  placeholder="Nombre y apellidos"
                  value={g.fullName}
                  onChange={(e) => setField(i, "fullName", e.target.value)}
                  aria-invalid={!!errors[`guarantors.${i}.fullName`]}
                  className={inputClass(!!errors[`guarantors.${i}.fullName`])}
                />
                {errors[`guarantors.${i}.fullName`] && <ErrorTooltip message={errors[`guarantors.${i}.fullName`]} />}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative space-y-1">
                <label htmlFor={`aval-${i}-identification`} className="text-white text-xs font-medium ml-1">
                  DPI
                </label>
                <div className="relative">
                  <Input
                    id={`aval-${i}-identification`}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0000 00000 0000"
                    value={formatDPI(g.identification)}
                    onChange={(e) => setField(i, "identification", digits(e.target.value).slice(0, 13))}
                    aria-invalid={!!errors[`guarantors.${i}.identification`]}
                    className={inputClass(!!errors[`guarantors.${i}.identification`])}
                  />
                  {errors[`guarantors.${i}.identification`] && <ErrorTooltip message={errors[`guarantors.${i}.identification`]} />}
                </div>
              </div>

              <div className="relative space-y-1">
                <label htmlFor={`aval-${i}-phone`} className="text-white text-xs font-medium ml-1">
                  Teléfono
                </label>
                <div className="relative">
                  <Input
                    id={`aval-${i}-phone`}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0000 0000"
                    value={formatPhone(g.phone)}
                    onChange={(e) => setField(i, "phone", phoneDigits(e.target.value))}
                    aria-invalid={!!errors[`guarantors.${i}.phone`]}
                    className={inputClass(!!errors[`guarantors.${i}.phone`])}
                  />
                  {errors[`guarantors.${i}.phone`] && <ErrorTooltip message={errors[`guarantors.${i}.phone`]} />}
                </div>
              </div>
            </div>

            <div className="relative space-y-1">
              <label htmlFor={`aval-${i}-relationship`} className="text-white text-xs font-medium ml-1">
                Relación contigo
              </label>
              <div className="relative">
                <select
                  id={`aval-${i}-relationship`}
                  value={g.relationship}
                  onChange={(e) => setField(i, "relationship", e.target.value as Relationship)}
                  aria-invalid={!!errors[`guarantors.${i}.relationship`]}
                  className={selectClass(!!errors[`guarantors.${i}.relationship`])}
                >
                  <option value="" disabled hidden>
                    Selecciona
                  </option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                {errors[`guarantors.${i}.relationship`] && <ErrorTooltip message={errors[`guarantors.${i}.relationship`]} />}
              </div>
            </div>
          </fieldset>
          </div>
        ))}

        {submitError && (
          <p role="alert" className="mt-4 rounded-lg bg-red-500/15 border border-red-400/60 px-3 py-2 text-sm text-white">
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          variant="paqPrimary"
          disabled={submitting}
          className="mt-5 w-full h-12 rounded-full text-sm font-bold uppercase text-paq-green"
        >
          {submitting ? "Enviando..." : "Solicitar avales"}
        </Button>
      </form>

      <p className="text-xs text-white/60 text-center leading-relaxed mt-3">
        Las 3 referencias recibirán un WhatsApp para aprobar o rechazar tu aval.
      </p>

      <button
        type="button"
        onClick={() => setAvalStage(null)}
        disabled={submitting}
        className="mt-4 block mx-auto text-xs font-semibold text-white/80 underline disabled:opacity-50"
      >
        Volver
      </button>
    </div>
  )
}
