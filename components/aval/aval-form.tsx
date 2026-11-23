"use client"

import { useEffect, useRef, useState } from "react"
import type { GuarantorAnswer, GuarantorAnswerInput } from "@/lib/avales/types"
import { cn } from "@/lib/utils"
import { formatDPI, formatPhone, withoutCountryCode } from "./format"
import Message from "./message"
import { EMPTY_OUTCOME as EMPTY, submitAnswer, type AnswerOutcome } from "./answer"

interface AvalFormProps {
  token: string
  applicantName: string
  guarantor: GuarantorAnswerInput
  /** Initial step of the form: `confirm-reject` opens the rejection warning (used by the dev preview). */
  initialMode?: "form" | "confirm-reject"
  /** Rendered under the form only while it can still be answered (time left, "si no reconoces…"). */
  footer?: React.ReactNode
  /** Dev preview only: start on a given outcome (screens after answering). */
  initialOutcome?: AnswerOutcome
  /** Dev preview only: the answer a retry would resend. */
  initialAnswer?: GuarantorAnswer
}

const inputClass = (hasError: boolean) =>
  cn(
    "h-11 w-full rounded-lg border border-input bg-white px-3 text-[15px] text-black outline-none focus-visible:ring-2 focus-visible:ring-paq-light-green disabled:opacity-60",
    hasError && "border-red-500 focus-visible:ring-red-500",
  )

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 ml-1 text-xs font-semibold text-red-300">
      {message}
    </p>
  )
}

const ENDED: Record<"closed" | "expired" | "invalid", { title: string; text: string }> = {
  closed: { title: "Esta solicitud ya se resolvió", text: "Ya no es necesario tu aval. Gracias por tomarte el tiempo de revisarla." },
  expired: { title: "Esta solicitud venció", text: "Pasaron las 48 horas para responder y la solicitud ya no está activa." },
  invalid: { title: "Este link no es válido", text: "Revisa que hayas abierto el link completo que te llegó por WhatsApp." },
}

export default function AvalForm({
  token,
  applicantName,
  guarantor,
  initialMode = "form",
  footer,
  initialOutcome = EMPTY,
  initialAnswer,
}: AvalFormProps) {
  // The guarantor's own DPI and phone are rendered only in the two inputs below (initial value here):
  // masking them later is a change in this component alone. The inputs keep what the person types
  // (spaces and dashes included) so the cursor never jumps; the shared schema strips separators.
  const [data, setData] = useState<GuarantorAnswerInput>({
    fullName: guarantor.fullName,
    identification: formatDPI(guarantor.identification),
    phone: formatPhone(guarantor.phone),
  })
  const [accepted, setAccepted] = useState(false)
  const [mode, setMode] = useState<"form" | "confirm-reject">(initialMode)
  const [outcome, setOutcome] = useState<AnswerOutcome>(initialOutcome)
  const [lastAnswer, setLastAnswer] = useState<GuarantorAnswer | null>(initialAnswer ?? null)
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
  const rejectButton = useRef<HTMLButtonElement>(null)
  const rejectDialog = useRef<HTMLElement>(null)
  const switchedMode = useRef(false)

  // Keyboard and screen-reader users land on the warning when it opens, and back on Rechazar after Volver.
  useEffect(() => {
    if (!switchedMode.current) return
    if (mode === "confirm-reject") rejectDialog.current?.focus()
    else rejectButton.current?.focus()
  }, [mode])

  const changeMode = (next: "form" | "confirm-reject") => {
    switchedMode.current = true
    setOutcome(EMPTY)
    setMode(next)
  }

  const set = (field: keyof GuarantorAnswerInput, value: string) => setData((prev) => ({ ...prev, [field]: value }))

  const send = async (answer: GuarantorAnswer) => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    setLastAnswer(answer)
    try {
      // The contract ignores the data on reject: do not send it.
      const payload =
        answer === "reject"
          ? { fullName: "", identification: "", phone: "" }
          : { ...data, phone: withoutCountryCode(data.phone) }
      setOutcome(await submitAnswer(token, answer, payload))
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  if (outcome.kind === "done") {
    return outcome.status === "authorized" ? (
      <Message title="¡Gracias por tu apoyo!" role="status">
        <p>Registramos tu aval para {applicantName}.</p>
        <p className="mt-2">No necesitas hacer nada más. Ya puedes cerrar esta pantalla.</p>
      </Message>
    ) : (
      <Message title="Registramos tu respuesta" role="status">
        <p>Registramos que no avalas la solicitud de {applicantName}.</p>
        <p className="mt-2">No necesitas hacer nada más. Ya puedes cerrar esta pantalla.</p>
      </Message>
    )
  }
  if (outcome.kind === "ended") {
    const ended = ENDED[outcome.screen]
    return (
      <Message title={ended.title} role="status">
        <p>{ended.text}</p>
      </Message>
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
            aria-describedby={errors.fullName ? "aval-fullName-error" : undefined}
            className={inputClass(!!errors.fullName)}
          />
          <FieldError id="aval-fullName-error" message={errors.fullName} />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          <div>
            <label htmlFor="aval-identification" className="block text-xs font-medium text-white mb-1 ml-1">
              DPI
            </label>
            <input
              id="aval-identification"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              value={data.identification}
              onChange={(e) => set("identification", e.target.value)}
              disabled={sending || mode === "confirm-reject"}
              aria-invalid={!!errors.identification}
              aria-describedby={errors.identification ? "aval-identification-error" : undefined}
              className={inputClass(!!errors.identification)}
            />
            <FieldError id="aval-identification-error" message={errors.identification} />
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
              maxLength={20}
              value={data.phone}
              onChange={(e) => set("phone", e.target.value)}
              disabled={sending || mode === "confirm-reject"}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? "aval-phone-error" : undefined}
              className={inputClass(!!errors.phone)}
            />
            <FieldError id="aval-phone-error" message={errors.phone} />
          </div>
        </div>
      </section>

      {outcome.message && (
        <div role="alert" className="mb-4 rounded-lg border border-paq-yellow/60 bg-paq-yellow/10 px-3 py-2 text-sm text-white">
          <p>{outcome.message}</p>
          {outcome.retry && lastAnswer && (
            <button
              type="button"
              onClick={() => send(lastAnswer)}
              disabled={sending}
              className="mt-2 rounded-full border border-white/60 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-60"
            >
              {sending ? "Enviando..." : "Intentar de nuevo"}
            </button>
          )}
        </div>
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
            <span>Conozco a {applicantName} y acepto avalar su solicitud de adelanto.</span>
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
            ref={rejectButton}
            type="button"
            onClick={() => changeMode("confirm-reject")}
            disabled={sending}
            className="h-12 w-full rounded-full border-[1.5px] border-white/50 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-60"
          >
            Rechazar
          </button>
        </>
      ) : (
        <section
          ref={rejectDialog}
          tabIndex={-1}
          role="alertdialog"
          aria-labelledby="aval-rechazo"
          aria-describedby="aval-rechazo-detalle"
          className="rounded-2xl bg-white p-5 text-paq-green outline-none focus-visible:ring-2 focus-visible:ring-paq-yellow"
        >
          <h2 id="aval-rechazo" className="mb-2 text-base font-bold">
            ¿Seguro que quieres rechazar?
          </h2>
          <ul id="aval-rechazo-detalle" className="mb-4 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>{applicantName} no contará con tu aval para su adelanto.</li>
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
            onClick={() => changeMode("form")}
            disabled={sending}
            className="h-12 w-full rounded-full border-[1.5px] border-paq-green/40 text-sm font-bold uppercase tracking-wide text-paq-green disabled:opacity-60"
          >
            Volver
          </button>
        </section>
      )}
      {footer}
    </div>
  )
}
