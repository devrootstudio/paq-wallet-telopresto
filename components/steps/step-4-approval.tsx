"use client"

import { useWizardStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { ErrorTooltip } from "./step-1-form" // importing ErrorTooltip

export default function Step4Approval() {
  const { nextStepAsync, formData, updateFormData } = useWizardStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editAmount, setEditAmount] = useState("")
  const [error, setError] = useState<string | null>(null) // state for validation error

  const APPROVED_AMOUNT = 1500 // constant for approved amount

  const handleEditClick = () => {
    setEditAmount(formData.requestedAmount.toString())
    setIsEditing(true)
    setError(null) // reset error on edit start
  }

  const handleFocus = () => {
    setEditAmount("")
  }

  const handleBlur = () => {
    if (editAmount.trim() === "") {
      setEditAmount(APPROVED_AMOUNT.toString())
    }
  }

  const handleSaveAmount = () => {
    const amount = Number.parseFloat(editAmount)

    if (isNaN(amount) || amount <= 0) {
      setError("Ingresa un monto válido")
      return
    }

    if (amount < 50) {
      setError("El monto mínimo es Q50")
      return
    }

    if (amount > APPROVED_AMOUNT) {
      setError(`El monto no puede ser mayor a Q${APPROVED_AMOUNT}`)
      return
    }

    updateFormData({ requestedAmount: amount })
    setIsEditing(false)
    setError(null)
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[60vh] animate-in zoom-in-95 duration-500">
      <div className="bg-paq-yellow rounded-3xl p-8 w-full aspect-square flex flex-col justify-center items-center text-center shadow-xl">
        {!isEditing ? (
          <div className="mb-6">
            {formData.requestedAmount === APPROVED_AMOUNT ? (
              <h2 className="text-2xl md:text-3xl font-bold text-paq-green leading-tight">
                ¡Felicidades! Tienes un adelanto de salario aprobado por un monto de Q{formData.requestedAmount}.
              </h2>
            ) : (
              <h2 className="text-2xl md:text-3xl font-bold text-paq-green leading-tight">
                Tu monto aprobado es Q{APPROVED_AMOUNT} pero estás solicitando Q{formData.requestedAmount}.
              </h2>
            )}
          </div>
        ) : (
          <div className="w-full mb-6 space-y-4">
            <h2 className="text-xl font-bold text-paq-green">Edita tu monto:</h2>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-paq-green font-bold text-lg">Q</span>
              <Input
                type="number"
                value={editAmount}
                onChange={(e) => {
                  setEditAmount(e.target.value)
                  setError(null) // clear error on type
                }}
                onFocus={handleFocus} // Added focus handler
                onBlur={handleBlur} // Added blur handler
                className={`text-center text-2xl font-bold text-paq-green border-paq-green bg-white/50 h-14 pl-8 ${error ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {error && <ErrorTooltip message={error} />}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 w-full mt-2">
          {!isEditing ? (
            <>
              <Button onClick={nextStepAsync} variant="paqDark" className="rounded-full w-full text-sm h-12">
                Solicítalo ahora
              </Button>

              <Button
                onClick={handleEditClick}
                variant="paqDark"
                className="rounded-full w-full text-sm h-12 bg-paq-green/80 hover:bg-paq-green/90"
              >
                Editar monto
              </Button>
            </>
          ) : (
            <Button onClick={handleSaveAmount} variant="paqDark" className="rounded-full w-full text-sm h-12">
              Guardar nuevo monto
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
