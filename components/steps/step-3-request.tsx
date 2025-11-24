"use client"

import { useWizardStore } from "@/lib/store"
import { Button } from "@/components/ui/button"

export default function Step3Request() {
  const { nextStepAsync } = useWizardStore()

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[60vh] animate-in zoom-in-95 duration-500">
      <div className="bg-paq-yellow rounded-3xl p-10 w-full aspect-square flex flex-col justify-center items-center text-center shadow-xl">
        <h2 className="text-2xl md:text-3xl font-bold text-paq-green mb-6">¿Cuánto deseas solicitar?</h2>

        <div className="text-6xl font-extrabold text-paq-green mb-10">Q150</div>

        <Button onClick={nextStepAsync} variant="paqDark" className="rounded-full px-8 w-full max-w-[200px]">
          Solicítalo ahora
        </Button>
      </div>
    </div>
  )
}
