"use client"

import { useWizardStore } from "@/lib/store" // Import store

export default function Step5Success() {
  const { formData } = useWizardStore() // Get formData

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[60vh] animate-in zoom-in-95 duration-500">
      <div className="bg-paq-yellow rounded-3xl p-10 w-full aspect-square flex flex-col justify-center items-center text-center shadow-xl">
        <h2 className="text-2xl md:text-3xl font-bold text-paq-green leading-snug">
          ¡Listo! tu adelanto de salario de Q{formData.requestedAmount} ha sido acreditado en tu PAQ Wallet.
        </h2>
      </div>
    </div>
  )
}
