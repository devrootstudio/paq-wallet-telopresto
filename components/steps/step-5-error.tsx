"use client"

import { useWizardStore } from "@/lib/store"
import { Button } from "@/components/ui/button"

export default function Step5Error() {
  const { errorMessage, errorFromStep, setStep, setLoading, reset } = useWizardStore()

  const handleTryAgain = () => {    
    // Return to the step from which the error was triggered
    if (errorFromStep) {
      setLoading(false)
      setStep(errorFromStep)
    } else {
      // If no errorFromStep, reset to beginning
      reset()
    }
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[60vh] animate-in zoom-in-95 duration-500">
      <div className="bg-red-500/10 border border-red-500 rounded-3xl p-10 w-full aspect-square flex flex-col justify-center items-center text-center shadow-xl">
        <div className="mb-6">
          <svg
            className="w-20 h-20 mx-auto text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-red-500 mb-4 leading-snug">
          Ocurrió un error
        </h2>
        <p className="text-white text-lg mb-8 px-4">
          {errorMessage || "No se pudo procesar tu solicitud. Por favor, intenta de nuevo."}
        </p>
        <Button onClick={handleTryAgain} variant="paqPrimary" className="w-48">
          Intentar de nuevo
        </Button>
      </div>
    </div>
  )
}

