"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useWizardStore } from "@/lib/store"
import Step3bAvales from "@/components/steps/step-3b-avales"
import Step3cEnRevision from "@/components/steps/step-3c-en-revision"

const TEST_AUTH = /^TEST-AVALES-[A-Za-z0-9_-]{1,48}$/

/** Fictitious applicant: never a real person. */
const APPLICANT = {
  phone: "90000001",
  identification: "9000000000101",
  fullName: "María Fernanda Solicitante Ejemplo",
  email: "solicitante@example.com",
  empresa: "Empresa Demo, S.A.",
  edad: "34",
  estadoCivil: "Casado/a",
  domicilio: "Zona 10, Ciudad de Guatemala",
}

function newAuth() {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  return `TEST-AVALES-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

export default function DevSolicitud() {
  const params = useSearchParams()
  const [auth, setAuth] = useState<string | null>(null)
  const avalStage = useWizardStore((s) => s.avalStage)

  useEffect(() => {
    const given = params.get("auth")
    const authorization = given && TEST_AUTH.test(given) ? given : newAuth()
    const monto = Number.parseInt(params.get("monto") ?? "", 10)
    const store = useWizardStore.getState()
    store.reset()
    store.updateFormData({ ...APPLICANT, autorizacion: authorization, idSolicitud: "TEST-001", approvedAmount: 3500 })
    store.updateFormData({ requestedAmount: Number.isFinite(monto) && monto >= 100 && monto <= 3500 ? monto : 2500 })
    store.setRuta("aval")
    store.setAvalStage("avales")
    useWizardStore.setState({ step: 3, isLoading: false })
    setAuth(authorization)
  }, [params])

  return (
    <main className="min-h-screen w-full bg-paq-green">
      <div className="bg-amber-400 px-3 py-1 text-center text-xs font-bold text-amber-950">
        DEV · solicitud de prueba · <span data-testid="auth">{auth ?? "…"}</span>
      </div>
      <div className="mx-auto flex w-full max-w-lg justify-center">
        {auth && avalStage === "avales" && <Step3bAvales />}
        {auth && avalStage === "en-revision" && <Step3cEnRevision />}
        {auth && avalStage === null && (
          <p className="p-6 text-center text-sm text-white">Recarga la página para volver al formulario.</p>
        )}
      </div>
    </main>
  )
}
