"use client"

import { useState } from "react"

interface Report {
  httpStatus?: number
  ok?: boolean
  error?: string
  runId?: string
  invited?: number
  links?: { requestId: string; position: number; url: string }[]
  rejected?: string[]
  quorum?: string[]
  expired?: string[]
  released?: { requestId: string; status: string; returnCode?: string }[]
  unrecorded?: { requestId: string; returnCode: string }[]
  stuck?: string[]
  deferred?: string[]
  leads?: number
  thanked?: number
  errors?: { step: string; id?: string; error: string }[]
}

const list = (items?: string[]) => (items && items.length ? items.join(", ") : "—")

export default function DevRutina() {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const run = async () => {
    setRunning(true)
    try {
      const response = await fetch("/dev/avales/api/rutina", { method: "POST", cache: "no-store" })
      setReport((await response.json()) as Report)
    } catch {
      setReport({ ok: false, error: "network" })
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="min-h-screen w-full bg-paq-green text-white">
      <div className="bg-amber-400 px-3 py-1 text-center text-xs font-bold text-amber-950">
        DEV · rutina de avales (WhatsApp y desembolso simulados)
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <h1 className="mb-4 text-xl font-bold">Rutina de avales</h1>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="h-11 rounded-full bg-paq-light-green px-6 text-sm font-bold uppercase text-paq-green disabled:opacity-60"
        >
          {running ? "Corriendo..." : "Correr rutina"}
        </button>
        <p className="mt-2 text-xs text-white/60">Una corrida que libera tarda unos 15 s.</p>

        {report && (
          <section data-testid="reporte" data-ok={String(report.ok)} className="mt-6 space-y-4 text-sm">
            <p>
              <b>Resultado:</b> {report.ok ? "ok" : `con avisos (${report.error ?? "revisar"})`} · HTTP{" "}
              {report.httpStatus ?? "—"} · corrida {report.runId ?? "—"}
            </p>
            <ul className="space-y-1">
              <li>Invitados: {report.invited ?? 0}</li>
              <li>Rechazadas: {list(report.rejected)}</li>
              <li>Quórum: {list(report.quorum)}</li>
              <li>Vencidas: {list(report.expired)}</li>
              <li>
                Liberadas:{" "}
                {report.released?.length
                  ? report.released.map((r) => `${r.requestId} → ${r.status}${r.returnCode ? ` (${r.returnCode})` : ""}`).join(", ")
                  : "—"}
              </li>
              <li>Leads: {report.leads ?? 0} · agradecimientos: {report.thanked ?? 0}</li>
              <li>Requieren revisión: {list([...(report.stuck ?? []), ...(report.unrecorded ?? []).map((u) => u.requestId)])}</li>
              <li>Pospuestas: {list(report.deferred)}</li>
            </ul>
            {report.links && report.links.length > 0 && (
              <div>
                <h2 className="mb-1 font-bold">Links de avales (WhatsApp simulado)</h2>
                <ul className="space-y-1">
                  {report.links.map((l) => (
                    <li key={`${l.requestId}-${l.position}`}>
                      {l.requestId} · aval {l.position}:{" "}
                      <a className="break-all text-paq-yellow underline" href={l.url} target="_blank" rel="noreferrer">
                        {l.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.errors && report.errors.length > 0 && (
              <div>
                <h2 className="mb-1 font-bold">Errores</h2>
                <ul className="space-y-1">
                  {report.errors.map((e, i) => (
                    <li key={i}>
                      {e.step}
                      {e.id ? ` · ${e.id}` : ""}: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
