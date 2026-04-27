"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { useWizardStore } from "@/lib/store"

/**
 * Development-only: seed wizard step via ?devStep=0..5 for screenshots / QA.
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

    const n = Number.parseInt(raw, 10)
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
      hasCommissionIssue: false,
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

    useWizardStore.setState({ step: n as 0 | 1 | 2 | 3 | 4 | 5 })
  }, [searchParams])

  return null
}
