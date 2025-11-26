"use client"

import { useWizardStore } from "@/lib/store" // Import store

export default function Step4Success() {
  const { formData } = useWizardStore() // Get formData

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[60vh] animate-in zoom-in-95 duration-500">
      <div className="bg-paq-yellow rounded-3xl p-10 w-full aspect-square flex flex-col justify-center items-center text-center shadow-xl">
        <h2 className="text-2xl md:text-3xl font-bold text-paq-green leading-snug mb-6">
          ¡Listo! tu adelanto de salario de Q{formData.requestedAmount} ha sido acreditado en tu PAQ Wallet.
        </h2>
        
        <div className="w-full px-4 mt-4 space-y-2">
          <div className="text-xs text-paq-green/80 text-center leading-relaxed space-y-1">
            <p>
              • Adelanto solicitado: <span className="font-semibold">Q{formData.requestedAmount.toFixed(2)}</span>.
            </p>
            <p>
              • {formData.disbursementAmount > 0 && (
                <>Monto desembolsado: <span className="font-semibold">Q{formData.disbursementAmount.toFixed(2)}</span></>
              )}
            </p>
          </div>
          {formData.hasCommissionIssue && (
            <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
              <p className="text-xs text-yellow-700 dark:text-yellow-600 font-semibold text-center leading-relaxed">
                ⚠️ Nota Administrativa: El desembolso se ejecutó correctamente, pero hubo un problema en el cobro de la comisión. 
                Este tema será resuelto de forma administrativa.
              </p>
            </div>
          )}
        </div>

        <div className="w-full px-4 mt-6 space-y-3">
          <p className="text-sm text-paq-green font-semibold text-center mb-2">
            Descarga Gratis El APP
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <a
              href="https://apps.apple.com/gt/app/paq-wallet/id6450115741"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center bg-black text-white rounded-lg px-4 py-3 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-6 h-6 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              <div className="text-left">
                <div className="text-sm font-semibold leading-tight">App Store</div>
              </div>
            </a>

            <a
              href="https://play.google.com/store/apps/details?id=com.paqwallet.app&hl=es_419"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center bg-black text-white rounded-lg px-4 py-3 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-6 h-6 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
              </svg>
              <div className="text-left">
                <div className="text-sm font-semibold leading-tight">Google Play</div>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
