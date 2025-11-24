"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useWizardStore } from "@/lib/store"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ErrorTooltip } from "./step-1-form"

export default function Step2Phone() {
  const { goToStepAsync } = useWizardStore() // using goToStepAsync instead of nextStepAsync
  const [otp, setOtp] = useState("")
  const [otpError, setOtpError] = useState<string | null>(null)
  const [isTouched, setIsTouched] = useState(false)

  useEffect(() => {
    if (isTouched) {
      validateOtp(otp)
    }
  }, [otp, isTouched])

  const validateOtp = (value: string) => {
    if (value.length !== 6) {
      setOtpError("El código debe tener 6 dígitos")
      return false
    }
    setOtpError(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsTouched(true)

    if (validateOtp(otp)) {
      await goToStepAsync(4) // skip step 3 and go directly to step 4
    }
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center min-h-[50vh] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="block text-lg text-white text-center">
            Ingresa el código enviado por SMS al teléfono registrado:
          </label>
          <div className="relative">
            <Input
              placeholder="000000"
              type="text"
              maxLength={6}
              className={`h-14 text-lg tracking-widest text-center ${otpError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              value={otp}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "")
                setOtp(val)
              }}
              autoFocus
            />
            {otpError && <ErrorTooltip message={otpError} />}
          </div>
        </div>

        <div className="flex justify-center">
          <Button type="submit" variant="paqPrimary" className="px-10 w-full max-w-xs">
            ENVIAR
          </Button>
        </div>
      </form>
    </div>
  )
}
