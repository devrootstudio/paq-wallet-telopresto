"use client"

/**
 * Shown when the guarantor's request could not be loaded (getGuarantorView threw, e.g. storage down).
 * Never shows the error details.
 */
export default function AvalError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen w-full bg-paq-green text-white">
      <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-10">
        <section role="alert" className="rounded-2xl border border-white/20 bg-white/5 p-5 text-center">
          <h1 className="mb-2 text-lg font-bold">No pudimos cargar tu solicitud</h1>
          <p className="mb-5 text-sm leading-relaxed text-white/80">
            Tuvimos un problema al consultar la solicitud. Intenta de nuevo en unos minutos.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="h-12 w-full rounded-full bg-paq-light-green text-sm font-bold uppercase tracking-wide text-paq-green"
          >
            Intentar de nuevo
          </button>
        </section>
      </div>
    </main>
  )
}
