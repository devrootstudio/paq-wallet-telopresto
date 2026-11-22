"use client"

import { useWizardStore } from "@/lib/store"

/** Hours and minutes left until `expiresAt`, as "47:52 h". Never negative. */
export function formatTimeLeft(expiresAt: string, now: number = Date.now()): string | null {
  const end = Date.parse(expiresAt)
  if (Number.isNaN(end)) return null
  const minutes = Math.max(0, Math.floor((end - now) / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, "0")} h`
}

/**
 * Shown once the guarantor request is saved ("en revisión", pending_guarantors).
 * Nothing else happens on this screen: the person can close it and will hear back by WhatsApp.
 */
export default function Step3cEnRevision() {
  const { guarantorRequest, formData } = useWizardStore()
  const amount = guarantorRequest?.amount ?? formData.requestedAmount ?? 0
  const timeLeft = guarantorRequest ? formatTimeLeft(guarantorRequest.expiresAt) : null

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[60vh] animate-in zoom-in-95 duration-500">
      <div className="bg-paq-yellow rounded-3xl p-8 w-full flex flex-col justify-center items-center text-center shadow-xl">
        <span className="mb-4 inline-flex items-center rounded-full bg-paq-green px-4 py-1 text-xs font-bold uppercase tracking-wider text-paq-yellow">
          En revisión
        </span>
        <h2 className="text-2xl font-bold text-paq-green leading-tight mb-3">Enviamos tu solicitud a tus avales</h2>
        <p className="text-sm text-paq-green/90 leading-relaxed">
          Tu adelanto de <span className="font-bold">Q{amount.toFixed(2)}</span> está reservado.
        </p>

        <div className="w-full mt-6 rounded-2xl bg-paq-green/10 p-4 text-left space-y-3">
          <div className="flex items-start gap-3">
            <svg
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 flex-none text-paq-green"
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
            <p className="text-sm text-paq-green leading-relaxed">
              Necesitamos que <span className="font-bold">2 de tus 3 avales</span> aprueben en las{" "}
              <span className="font-bold">próximas 48 horas</span>.
              {timeLeft && (
                <>
                  {" "}
                  Tiempo restante: <span className="font-bold">{timeLeft}</span>.
                </>
              )}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <svg
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 flex-none text-paq-green"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.5 8.5 0 1 1 21 11.5Z" />
            </svg>
            <p className="text-sm text-paq-green leading-relaxed">
              Te avisaremos por <span className="font-bold">WhatsApp</span> cuando se realice el desembolso o si la
              solicitud no se aprueba.
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm font-bold text-paq-green">Ya puedes cerrar esta pantalla.</p>
      </div>
    </div>
  )
}
