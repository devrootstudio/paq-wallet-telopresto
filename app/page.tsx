"use client"

import { Suspense } from "react"
import { useWizardStore } from "@/lib/store"
import { Spinner } from "@/components/ui/spinner"
import Step0Phone from "@/components/steps/step-0-phone"
import Step1Form from "@/components/steps/step-1-form"
import Step2Phone from "@/components/steps/step-2-phone"
import Step3Approval from "@/components/steps/step-3-approval"
import Step4Success from "@/components/steps/step-4-success"
import Step5Error from "@/components/steps/step-5-error"
import { DevWizardSeed } from "@/components/dev-wizard-seed"
import { ClientInfoCollector } from "@/components/client-info-collector"

function HomeInner() {
  const { step, isLoading } = useWizardStore()

  const renderStep = () => {
    switch (step) {
      case 0:
        return <Step0Phone />
      case 1:
        return <Step1Form />
      case 2:
        return <Step2Phone />
      case 3:
        return <Step3Approval />
      case 4:
        return <Step4Success />
      case 5:
        return <Step5Error />
      default:
        return <Step0Phone />
    }
  }

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center bg-paq-green relative overflow-hidden">
      {/* Optional background decoration if needed to match exact style, 
          but plain color seems to match images best */}

      <div className="w-full max-w-lg relative z-10 flex justify-center">{isLoading ? <Spinner /> : renderStep()}</div>
    </main>
  )
}

export default function Home() {
  return (
    <>
      <Suspense fallback={null}>
        <ClientInfoCollector />
      </Suspense>
      {process.env.NODE_ENV === "development" && (
        <Suspense fallback={null}>
          <DevWizardSeed />
        </Suspense>
      )}
      <HomeInner />
    </>
  )
}
