"use client"

import { useRef, useState } from "react"
import { answerGuarantor } from "@/app/avales-actions"
import { guarantorAnswerSchema, toFieldErrors } from "@/lib/avales/schema"
import type { AnswerResult, FieldErrors, GuarantorAnswer, GuarantorAnswerInput } from "@/lib/avales/types"
import { cn } from "@/lib/utils"
import { formatDPI, formatPhone, onlyDigits, phoneDigits } from "./format"

/** What the form shows after the guarantor presses Avalar or confirms Rechazar. */
export interface AnswerOutcome {
  /** Final state reached (then the form is replaced by a thank-you message). */
  done?: "authorized" | "rejected"
  fieldErrors: FieldErrors
  message: string | null
}

export const NOT_AVAILABLE_MESSAGE =
  "Todavía no podemos registrar tu respuesta. Estamos terminando de habilitar esta opción: vuelve a abrir este link más tarde."

function messageFor(result: Extract<AnswerResult, { ok: false }>): string {
  switch (result.code) {
    case "not_available":
      return NOT_AVAILABLE_MESSAGE
    case "validation":
      return "Revisa los datos marcados."
    case "expired":
      return "Esta solicitud ya venció. No es necesario que respondas."
    case "closed":
      return "Esta solicitud ya se resolvió. No es necesario que respondas."
    case "invalid":
      return "Este link no es válido."
    case "unavailable":
    default:
      return "No pudimos registrar tu respuesta. Intenta de nuevo en unos minutos."
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
    if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error), message: "Revisa los datos marcados." }
  }
  try {
    const result = await send(token, answer, data)
    if (result.ok) {
      if (result.status === "identity_mismatch") {
        return {
          fieldErrors: {},
          message: "Tus datos no coinciden con el registro oficial. Revisa tu nombre, DPI y teléfono e intenta de nuevo.",
        }
      }
      return { done: result.status, fieldErrors: {}, message: null }
    }
    return { fieldErrors: result.fieldErrors ?? {}, message: messageFor(result) }
  } catch {
    return { fieldErrors: {}, message: "No pudimos registrar tu respuesta. Revisa tu conexión e intenta de nuevo." }
  }
}

interface AvalFormProps {
  token: string
  applicantFirstName: string
  guarantor: GuarantorAnswerInput
  /** Initial step of the form: `confirm-reject` opens the rejection warning (used by the dev preview). */
  initialMode?: "form" | "confirm-reject"
}

const inputClass = (hasError: boolean) =>
  cn(
    "h-11 w-full rounded-lg border border-input bg-white px-3 text-[15px] text-black outline-none focus-visible:ring-2 focus-visible:ring-paq-light-green disabled:opacity-60",
    hasError && "border-red-500 focus-visible:ring-red-500",
  )

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 ml-1 text-xs font-semibold text-red-300">{message}</p>
}

export default function AvalForm({ token, applicantFirstName, guarantor, initialMode = "form" }: AvalFormProps) {
  const [data, setData] = useState<GuarantorAnswerInput>({
    fullName: guarantor.fullName,
    identification: onlyDigits(guarantor.identification),
    phone: phoneDigits(guarantor.phone),
  })
  const [accepted, setAccepted] = useState(false)
  const [mode, setMode] = useState<"form" | "confirm-reject">(initialMode)
  const [outcome, setOutcome] = useState<AnswerOutcome>({ fieldErrors: {}, message: null })
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)

  const set = (field: keyof GuarantorAnswerInput, value: string) => setData((prev) => ({ ...prev, [field]: value }))

  const send = async (answer: GuarantorAnswer) => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    try {
      setOutcome(await submitAnswer(token, answer, data))
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  if (outcome.done === "authorized") {
    return (
      <p role="status" className="rounded-2xl bg-white/10 p-5 text-center text-base font-semibold text-white">
        ¡Gracias! Registramos tu aval para {applicantFirstName}.
      </p>
    )
  }
  if (outcome.done === "rejected") {
    return (
      <p role="status" className="rounded-2xl bg-white/10 p-5 text-center text-base font-semibold text-white">
        Registramos que no avalas la solicitud de {applicantFirstName}.
      </p>
    )
  }

  const errors = outcome.fieldErrors

  return (
    <div>
      <section className="rounded-2xl border border-white/20 bg-white/5 p-4 mb-5" aria-labelledby="aval-datos">
        <h2 id="aval-datos" className="text-[15px] font-bold text-white">
          Confirma tus datos
        </h2>
        <p className="text-xs text-white/70 leading-relaxed mb-4">Revisa que tu información sea correcta.</p>

        <div className="mb-3">
          <label htmlFor="aval-fullName" className="block text-xs font-medium text-white mb-1 ml-1">
            Nombre completo
          </label>
          <input
            id="aval-fullName"
            autoComplete="name"
            value={data.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            disabled={sending || mode === "confirm-reject"}
            aria-invalid={!!errors.fullName}
            className={inputClass(!!errors.fullName)}
          />
          <FieldError message={errors.fullName} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="aval-identification" className="block text-xs font-medium text-white mb-1 ml-1">
              DPI
            </label>
            <input
              id="aval-identification"
              inputMode="numeric"
              autoComplete="off"
              value={formatDPI(data.identification)}
              onChange={(e) => set("identification", onlyDigits(e.target.value).slice(0, 13))}
              disabled={sending || mode === "confirm-reject"}
              aria-invalid={!!errors.identification}
              className={inputClass(!!errors.identification)}
            />
            <FieldError message={errors.identification} />
          </div>
          <div>
            <label htmlFor="aval-phone" className="block text-xs font-medium text-white mb-1 ml-1">
              Teléfono
            </label>
            <input
              id="aval-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={formatPhone(data.phone)}
              onChange={(e) => set("phone", phoneDigits(e.target.value))}
              disabled={sending || mode === "confirm-reject"}
              aria-invalid={!!errors.phone}
              className={inputClass(!!errors.phone)}
            />
            <FieldError message={errors.phone} />
          </div>
        </div>
      </section>

      {outcome.message && (
        <p role="alert" className="mb-4 rounded-lg border border-paq-yellow/60 bg-paq-yellow/10 px-3 py-2 text-sm text-white">
          {outcome.message}
        </p>
      )}

      {mode === "form" ? (
        <>
          <label className="mb-5 flex items-start gap-3 text-sm leading-relaxed text-white">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={sending}
              className="mt-0.5 h-5 w-5 flex-none rounded accent-paq-light-green"
            />
            <span>Conozco a {applicantFirstName} y acepto avalar su solicitud de adelanto.</span>
          </label>

          <button
            type="button"
            onClick={() => send("accept")}
            disabled={!accepted || sending}
            className="mb-3 h-12 w-full rounded-full bg-paq-light-green text-sm font-bold uppercase tracking-wide text-paq-green disabled:bg-paq-light-green/35 disabled:text-paq-green/70"
          >
            {sending ? "Enviando..." : "Avalar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOutcome({ fieldErrors: {}, message: null })
              setMode("confirm-reject")
            }}
            disabled={sending}
            className="h-12 w-full rounded-full border-[1.5px] border-white/50 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-60"
          >
            Rechazar
          </button>
        </>
      ) : (
        <section role="alertdialog" aria-labelledby="aval-rechazo" className="rounded-2xl bg-white p-5 text-paq-green">
          <h2 id="aval-rechazo" className="mb-2 text-base font-bold">
            ¿Seguro que quieres rechazar?
          </h2>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>{applicantFirstName} no contará con tu aval para su adelanto.</li>
            <li>Si 2 de sus 3 referencias rechazan, su solicitud se cancela.</li>
            <li>Ya no podrás cambiar tu respuesta.</li>
          </ul>
          <button
            type="button"
            onClick={() => send("reject")}
            disabled={sending}
            className="mb-3 h-12 w-full rounded-full bg-red-600 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-60"
          >
            {sending ? "Enviando..." : "Sí, rechazar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOutcome({ fieldErrors: {}, message: null })
              setMode("form")
            }}
            disabled={sending}
            className="h-12 w-full rounded-full border-[1.5px] border-paq-green/40 text-sm font-bold uppercase tracking-wide text-paq-green disabled:opacity-60"
          >
            Volver
          </button>
        </section>
      )}
    </div>
  )
}
