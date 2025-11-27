"use client"

import type React from "react"
import { useState } from "react"
import { useWizardStore } from "@/lib/store"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ErrorTooltip } from "./step-1-form"
import { handleStep0Submit } from "@/lib/step-handlers"

export default function Step0Phone() {
  const { updateFormData, setLoading, setErrorStep, isLoading, goToStepAsync, formData } = useWizardStore()
  const [phone, setPhone] = useState("")
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [isTouched, setIsTouched] = useState(false)

  const validatePhone = (value: string) => {
    const cleanPhone = value.replace(/\s/g, "")
    if (cleanPhone.length !== 8) {
      setPhoneError("El teléfono debe tener 8 dígitos")
      return false
    }
    setPhoneError(null)
    return true
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "")
    if (value.length > 8) value = value.slice(0, 8)
    setPhone(value)
    if (isTouched) {
      validatePhone(value)
    }
  }

  const formatPhone = (value: string) => {
    if (!value) return ""
    const part1 = value.slice(0, 4)
    const part2 = value.slice(4, 8)
    let formatted = part1
    if (part2) formatted += " " + part2
    return formatted
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsTouched(true)

    // Validate phone format first
    if (!validatePhone(phone)) {
      return
    }

    // Use centralized handler
    await handleStep0Submit(phone, {
      updateFormData,
      setLoading,
      setErrorStep,
      goToStepAsync,
      formData,
    })
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center min-h-[50vh] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold text-white text-center mb-4">
            Aplica a tu adelanto de salario
          </h1>
          <label className="block text-lg text-white text-center">
            Ingresa aquí tu número de teléfono celular registrado en PAQ Wallet
          </label>
          <div className="relative">
            <Input
              placeholder="5201 8854"
              type="tel"
              maxLength={9}
              className={`h-14 text-lg tracking-widest text-center ${phoneError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              value={formatPhone(phone)}
              onChange={handlePhoneChange}
              onBlur={() => {
                setIsTouched(true)
                validatePhone(phone)
              }}
              autoFocus
            />
            {phoneError && <ErrorTooltip message={phoneError} />}
          </div>
        </div>

        <div className="flex justify-center">
          <Button type="submit" variant="paqPrimary" className="px-10 w-full max-w-xs" disabled={isLoading}>
            {isLoading ? "ENVIANDO..." : "ENVIAR"}
          </Button>
        </div>
      </form>
    </div>
  )
}

