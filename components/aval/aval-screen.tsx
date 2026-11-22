import type { GuarantorView, GuarantorViewBase } from "@/lib/avales/types"
import AvalForm from "./aval-form"
import { firstName, formatAmount, formatTimeLeft } from "./format"
import TimeLeft from "./time-left"

/**
 * The 5 screens of /aval/<token> (contract §4). Renders only what `GuarantorView` carries: the
 * applicant's first name, the amount, the time left and, on the form, the guarantor's own data.
 */
interface AvalScreenProps {
  view: GuarantorView
  token: string
  /** Current time in ms, injectable for tests and previews. */
  now?: number
  /** Dev preview only: open the form on the rejection warning. */
  initialMode?: "form" | "confirm-reject"
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen w-full bg-paq-green text-white">
      <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-10">{children}</div>
    </main>
  )
}

function RequestCard({ base, children }: { base: GuarantorViewBase; children: React.ReactNode }) {
  const initial = base.applicantFirstName.trim().charAt(0).toUpperCase() || "?"
  return (
    <section className="mb-6 rounded-3xl bg-paq-yellow px-5 py-6 text-center text-paq-green">
      <div
        aria-hidden="true"
        className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-paq-green text-xl font-extrabold text-paq-yellow"
      >
        {initial}
      </div>
      {children}
      <span className="mt-3 inline-block rounded-full bg-paq-green px-4 py-1.5 text-[15px] font-extrabold text-paq-yellow">
        {formatAmount(base.amount)}
      </span>
    </section>
  )
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/20 bg-white/5 p-5 text-center">
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      <div className="text-sm leading-relaxed text-white/80">{children}</div>
    </section>
  )
}

export default function AvalScreen({ view, token, now = Date.now(), initialMode }: AvalScreenProps) {
  if (view.screen === "invalid") {
    return (
      <Shell>
        <Message title="Este link no es válido">
          <p>Revisa que hayas abierto el link completo que te llegó por WhatsApp.</p>
        </Message>
      </Shell>
    )
  }

  const name = view.applicantFirstName
  const timeLeft = formatTimeLeft(view.expiresAt, now)

  if (view.screen === "form") {
    return (
      <Shell>
        <p className="mb-5 text-center text-xl font-bold">¡Hola, {firstName(view.guarantor.fullName)}!</p>
        <RequestCard base={view}>
          <h1 className="mb-2 text-lg font-bold leading-snug">{name} está solicitando un adelanto de salario</h1>
          <p className="text-sm leading-relaxed">
            Te eligió como una de sus referencias personales y necesitamos tu ayuda para avalar su solicitud.
          </p>
        </RequestCard>

        {view.identityMismatch && (
          <p role="alert" className="mb-4 rounded-lg border border-paq-yellow/60 bg-paq-yellow/10 px-3 py-2 text-sm">
            Tus datos no coincidieron con el registro oficial. Revisa tu nombre, DPI y teléfono antes de avalar.
          </p>
        )}

        <AvalForm
          token={token}
          applicantFirstName={name}
          guarantor={view.guarantor}
          initialMode={initialMode}
        />

        {timeLeft && (
          <p className="mt-4 text-center text-xs leading-relaxed text-white/60">
            Esta solicitud vence en{" "}
            <b className="text-white/90">
              <TimeLeft expiresAt={view.expiresAt} now={now} />
            </b>
            .
            <br />
            Si no reconoces a {name}, presiona <b className="text-white/90">Rechazar</b>.
          </p>
        )}
      </Shell>
    )
  }

  if (view.screen === "answered") {
    const authorized = view.answer === "authorized"
    return (
      <Shell>
        <RequestCard base={view}>
          <h1 className="text-lg font-bold leading-snug">Solicitud de adelanto de {name}</h1>
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
          <h1 className="text-lg font-bold leading-snug">Solicitud de adelanto de {name}</h1>
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
        <h1 className="text-lg font-bold leading-snug">Solicitud de adelanto de {name}</h1>
      </RequestCard>
      <Message title="Esta solicitud venció">
        <p>Pasaron las 48 horas para responder y la solicitud ya no está activa. No necesitas hacer nada.</p>
      </Message>
    </Shell>
  )
}
