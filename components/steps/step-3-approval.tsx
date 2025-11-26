"use client"

import { useWizardStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { ErrorTooltip } from "./step-1-form" // importing ErrorTooltip
import { submitStep3Form } from "@/app/actions"

// Helper function to calculate disbursement amount
const calculateDisbursementAmount = (requestedAmount: number): number => {
  if (requestedAmount < 100) {
    return 0 // Invalid amount
  }

  let commission = 0
  const IVA_RATE = 0.12 // 12% IVA

  if (requestedAmount >= 100 && requestedAmount <= 250) {
    // Q100 - Q250: Q15.00 + IVA (12%)
    commission = 15 * (1 + IVA_RATE) // 15 * 1.12 = 16.80
  } else if (requestedAmount >= 251 && requestedAmount <= 700) {
    // Q251 - Q700: 6.5% + IVA (12%)
    commission = requestedAmount * 0.065 * (1 + IVA_RATE) // requestedAmount * 0.0728
  } else if (requestedAmount >= 701) {
    // Q701 en adelante: 7.5% + IVA (12%)
    commission = requestedAmount * 0.075 * (1 + IVA_RATE) // requestedAmount * 0.084
  }

  // Disbursement amount = requested amount - commission
  return requestedAmount - commission
}

export default function Step3Approval() {
  const { nextStepAsync, formData, updateFormData, setLoading, setErrorStep, isLoading } = useWizardStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editAmount, setEditAmount] = useState("")
  const [error, setError] = useState<string | null>(null) // state for validation error

  const APPROVED_AMOUNT = formData.approvedAmount || 0 // Get approved amount from store

  // Generate authorization number (timestamp-based)
  const generateAutorizacion = (): string => {
    return `AUTH-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
  }

  const handleRequestDisbursement = async () => {
    // Validate required data
    if (!formData.phone || !formData.idSolicitud || !formData.requestedAmount || formData.requestedAmount <= 0) {
      setError("Faltan datos necesarios para procesar la solicitud")
      return
    }

    // Calculate commission (monto - disbursementAmount)
    const comision = formData.requestedAmount - formData.disbursementAmount

    // Generate authorization number
    const autorizacion = generateAutorizacion()

    setLoading(true)
    setError(null)

    try {
      const result = await submitStep3Form({
        phone: formData.phone,
        idSolicitud: formData.idSolicitud,
        monto: formData.requestedAmount,
        comision: comision,
        autorizacion: autorizacion,
      })

      if (result.success) {
        // Disbursement successful, save commission issue flag if present
        if (result.hasCommissionIssue) {
          updateFormData({ hasCommissionIssue: true })
        }
        // Advance to step 4
        await nextStepAsync()
      } else {
        // Disbursement failed
        const errorMsg = result.error || "Error al ejecutar el desembolso"
        setLoading(false)
        setErrorStep("general", errorMsg)
      }
    } catch (error) {
      console.error("Error executing disbursement:", error)
      const errorMsg = error instanceof Error ? error.message : "Error desconocido al ejecutar el desembolso"
      setLoading(false)
      setErrorStep("general", errorMsg)
    }
  }

  // Calculate disbursement amount for display (use editAmount when editing, otherwise use formData)
  const currentAmount = isEditing
    ? Number.parseFloat(editAmount) || 0
    : formData.requestedAmount || 0
  const currentDisbursementAmount = calculateDisbursementAmount(currentAmount)

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

    if (amount < 100) {
      setError("Por favor, ingresa un monto igual o mayor a Q100.")
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
                min="0"
                step="1"
                value={editAmount}
                onChange={(e) => {
                  const value = e.target.value
                  // Prevent negative numbers and decimals - only allow integers
                  if (value === "" || (!isNaN(Number.parseInt(value)) && Number.parseInt(value) >= 0 && !value.includes("."))) {
                    setEditAmount(value)
                    setError(null) // clear error on type
                  }
                }}
                onFocus={handleFocus} // Added focus handler
                onBlur={handleBlur} // Added blur handler
                className={`text-center text-2xl font-bold text-paq-green border-paq-green bg-white/50 h-14 pl-8 ${error ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {error && <ErrorTooltip message={error} />}
            </div>
          </div>
        )}

        <div className="w-full px-4 mb-4 mt-4 space-y-2">
          <>
              <div className="text-xs text-paq-green/80 text-left leading-relaxed space-y-1">
                <p>
                  • Adelanto a solicitar: <span className="font-semibold">Q{currentAmount.toFixed(2)}</span> (Será debitado en tu próxima nómina). {currentDisbursementAmount > 0 && (<>Monto a depositar: <span className="font-semibold">Q{currentDisbursementAmount.toFixed(2)}</span></>)}
                </p>
                
              </div>
              {!isEditing && (
                <p className="text-xs text-paq-green/70 text-left leading-relaxed italic mt-2">
                  • <span className="font-semibold">Importante:</span> Al presionar <span className="font-semibold">"Solicítalo ahora"</span> se depositará automáticamente el adelanto solicitado.
                </p>
              )}
            </>
        </div>

        <div className="flex flex-col gap-3 w-full mt-2">
          {!isEditing ? (
            <>
              <Button
                onClick={handleRequestDisbursement}
                variant="paqDark"
                className="rounded-full w-full text-sm h-12"
                disabled={isLoading}
              >
                {isLoading ? "PROCESANDO..." : "Solicítalo ahora"}
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
