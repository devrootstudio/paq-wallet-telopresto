import type { GuarantorView, GuarantorViewBase } from "@/lib/avales/types"
import AvalForm from "./aval-form"
import type { AnswerOutcome } from "./answer"
import { firstName, formatAmount, formatTimeLeft } from "./format"
import Message from "./message"
import TimeLeft from "./time-left"

/**
 * The 5 screens of /aval/<token> (contract §4). Renders only what `GuarantorView` carries: the
 * applicant's full name (so the guarantor knows who is asking), the amount, the time left and, on the
 * form, the guarantor's own data.
 */
interface AvalScreenProps {
  view: GuarantorView
  token: string
  /** Current time in ms, injectable for tests and previews. */
  now?: number
  /** Dev preview only: open the form on the rejection warning. */
  initialMode?: "form" | "confirm-reject"
  /** Dev preview only: open the form on a screen shown after answering. */
  initialOutcome?: AnswerOutcome
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen w-full bg-paq-green text-white">
      <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-10">{children}</div>
    </main>
  )
}

/** Full name of the applicant; falls back to the first name if the full one is missing. */
export const applicantNameOf = (base: GuarantorViewBase) =>
  base.applicantName?.trim().replace(/\s+/g, " ") || base.applicantFirstName.trim()

/**
 * Avatar initials: first name + first surname, assuming the usual "names + two surnames" order
 * ("María Elena Vásquez Morales" → "MV", "María Vásquez" → "MV", "María" → "M").
 */
export function applicantInitials(fullName: string): string {
  const words = fullName.split(" ").filter(Boolean)
  if (words.length === 0) return "?"
  const surname = words.length >= 4 ? words[2] : words.length >= 2 ? words[1] : ""
  return (words[0].charAt(0) + surname.charAt(0)).toUpperCase()
}

function RequestCard({ base, children }: { base: GuarantorViewBase; children: React.ReactNode }) {
  const initials = applicantInitials(applicantNameOf(base))
  return (
    <section className="mb-6 rounded-3xl bg-paq-yellow px-5 py-6 text-center text-paq-green">
      <div
        aria-hidden="true"
        className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-paq-green text-xl font-extrabold text-paq-yellow"
      >
        {initials}
      </div>
      {children}
      <span className="mt-3 inline-block rounded-full bg-paq-green px-4 py-1.5 text-[15px] font-extrabold text-paq-yellow">
        {formatAmount(base.amount)}
      </span>
    </section>
  )
}

export default function AvalScreen({ view, token, now = Date.now(), initialMode, initialOutcome }: AvalScreenProps) {
  if (view.screen === "invalid") {
    return (
      <Shell>
        <Message title="Este link no es válido" level={1}>
          <p>Revisa que hayas abierto el link completo que te llegó por WhatsApp.</p>
        </Message>
      </Shell>
    )
  }

  const name = applicantNameOf(view)
  const timeLeft = formatTimeLeft(view.expiresAt, now)

  if (view.screen === "form") {
    return (
      <Shell>
        <p className="mb-5 text-center text-xl font-bold">¡Hola, {firstName(view.guarantor.fullName)}!</p>
        <RequestCard base={view}>
          <h1 className="mb-2 text-lg font-bold leading-snug break-words">{name} está solicitando un adelanto de salario</h1>
          <p className="text-sm leading-relaxed">
            Te eligió como una de sus referencias personales y necesitamos tu ayuda para avalar su solicitud.
          </p>
        </RequestCard>

        {view.identityMismatch && (
          <p role="alert" className="mb-4 rounded-lg border border-paq-yellow/60 bg-paq-yellow/10 px-3 py-2 text-sm">
            No pudimos confirmar tus datos. Revisa tu nombre, DPI y teléfono antes de avalar.
          </p>
        )}

        <AvalForm
          token={token}
          applicantName={name}
          // Only the three fields the guarantor confirms cross into the client bundle.
          guarantor={{
            fullName: view.guarantor.fullName,
            identification: view.guarantor.identification,
            phone: view.guarantor.phone,
          }}
          initialMode={initialMode}
          initialOutcome={initialOutcome}
          initialAnswer={initialOutcome ? "accept" : undefined}
          // Shown only while the form can still be answered.
          footer={
            <p className="mt-4 text-center text-xs leading-relaxed text-white/60">
              {timeLeft && (
                <>
                  Esta solicitud vence en{" "}
                  <b className="text-white/90">
                    <TimeLeft expiresAt={view.expiresAt} now={now} />
                  </b>
                  .
                  <br />
                </>
              )}
              Si no reconoces a {name}, presiona <b className="text-white/90">Rechazar</b>.
            </p>
          }
        />
      </Shell>
    )
  }

  if (view.screen === "answered") {
    const authorized = view.answer === "authorized"
    return (
      <Shell>
        <RequestCard base={view}>
          <h1 className="text-lg font-bold leading-snug break-words">Solicitud de adelanto de {name}</h1>
        </RequestCard>
        <Message title="Ya respondiste esta solicitud">
          <p>
            {authorized
              ? `Registramos tu aval para ${name}. ¡Gracias por tu apoyo!`
              : `Registramos que no avalas la solicitud de ${name}.`}
          </p>
          <p className="mt-2">No necesitas hacer nada más.</p>
        </Message>
      </Shell>
    )
  }

  if (view.screen === "closed") {
    return (
      <Shell>
        <RequestCard base={view}>
          <h1 className="text-lg font-bold leading-snug break-words">Solicitud de adelanto de {name}</h1>
        </RequestCard>
        <Message title="Esta solicitud ya se resolvió">
          <p>Ya no es necesario tu aval. Gracias por tomarte el tiempo de revisarla.</p>
        </Message>
      </Shell>
    )
  }

  return (
    <Shell>
      <RequestCard base={view}>
        <h1 className="text-lg font-bold leading-snug break-words">Solicitud de adelanto de {name}</h1>
      </RequestCard>
      <Message title="Esta solicitud venció">
        <p>Pasaron las 48 horas para responder y la solicitud ya no está activa. No necesitas hacer nada.</p>
      </Message>
    </Shell>
  )
}
