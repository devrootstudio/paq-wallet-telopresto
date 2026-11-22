"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { useWizardStore } from "@/lib/store"

/**
 * Development-only: seed wizard step via ?devStep=0..5 for screenshots / QA.
 * Aval route: ?devStep=3b (guarantors form) and ?devStep=3c ("en revisión").
 * Optional ?ruta=aval|normal forces the Step 3 route instead of asking the server.
 * Not used in production builds.
 */
export function DevWizardSeed() {
  const searchParams = useSearchParams()
  const done = useRef(false)

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    const raw = searchParams.get("devStep")
    if (raw === null) return
    if (done.current) return

    const avalStage = raw === "3b" ? "avales" : raw === "3c" ? "en-revision" : null
    const n = avalStage ? 3 : Number.parseInt(raw, 10)
    if (Number.isNaN(n) || n < 0 || n > 5) return
    done.current = true

    const reset = useWizardStore.getState().reset
    reset()
    useWizardStore.setState({ isLoading: false })

    const demo = {
      phone: "52018854",
      identification: "2987654321010",
      fullName: "María Elena Vásquez Morales",
      email: "maria.vasquez@ejemplo.com",
      nit: "8456123-7",
      startDate: "12-03-2021",
      salary: "5,200.00",
      paymentFrequency: "quincenal" as const,
      autorizacion: "AUTH-DOC-2025-EXAMPLE",
      idSolicitud: "SOL-PAQ-88421",
      approvedAmount: 3500,
      requestedAmount: 2500,
      empresa: "Empresa Demo, S.A.",
      edad: "34",
      estadoCivil: "Casado/a",
      domicilio: "5a. Av. 12-34, Zona 10, Ciudad de Guatemala",
      hasCommissionIssue: false,
      pagareUrl: "/contrato-adelanto-salario.pdf",
    }

    if (n === 5) {
      useWizardStore.setState({
        step: 5,
        errorMessage:
          "No fue posible procesar tu solicitud en este momento. Por favor intenta nuevamente o contacta a soporte.",
        errorFromStep: 2,
        isLoading: false,
      })
      return
    }

    if (n >= 1) {
      useWizardStore.getState().updateFormData({
        phone: demo.phone,
        identification: demo.identification,
        fullName: demo.fullName,
        email: demo.email,
        nit: demo.nit,
        startDate: demo.startDate,
        salary: demo.salary,
        paymentFrequency: demo.paymentFrequency,
        autorizacion: demo.autorizacion,
        empresa: demo.empresa,
        edad: demo.edad,
        estadoCivil: demo.estadoCivil,
        domicilio: demo.domicilio,
        clientId: "",
        nextAction: "continue",
      })
    }

    if (n >= 3) {
      useWizardStore.getState().updateFormData({
        idSolicitud: demo.idSolicitud,
        approvedAmount: demo.approvedAmount,
        requestedAmount: demo.requestedAmount,
      })
    }

    // Pagaré URL only exists after disbursement (Step 4) in the real flow
    if (n >= 4) {
      useWizardStore.getState().updateFormData({
        pagareUrl: demo.pagareUrl,
      })
    }

    const ruta = searchParams.get("ruta")
    if (ruta === "aval" || ruta === "normal") {
      useWizardStore.getState().setRuta(ruta)
    }

    if (avalStage) {
      useWizardStore.getState().setRuta("aval")
      useWizardStore.getState().setAvalStage(avalStage)
    }

    if (avalStage === "en-revision") {
      useWizardStore.getState().setGuarantorRequest({
        amount: useWizardStore.getState().formData.requestedAmount,
        // 47:52 h left, like the prototype
        expiresAt: new Date(Date.now() + (47 * 60 + 52) * 60_000 + 30_000).toISOString(),
        reused: false,
        open: true,
      })
    }

    useWizardStore.setState({ step: n as 0 | 1 | 2 | 3 | 4 | 5 })
  }, [searchParams])

  return null
}
