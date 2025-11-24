"use client"

import { useWizardStore } from "@/lib/store"
import { Spinner } from "@/components/ui/spinner"
import Step1Form from "@/components/steps/step-1-form"
import Step2Phone from "@/components/steps/step-2-phone"
import Step3Request from "@/components/steps/step-3-request"
import Step4Approval from "@/components/steps/step-4-approval"
import Step5Success from "@/components/steps/step-5-success"
import Step6Error from "@/components/steps/step-6-error"

export default function Home() {
  const { step, isLoading } = useWizardStore()

  const renderStep = () => {
    switch (step) {
      case 1:
        return <Step1Form />
      case 2:
        return <Step2Phone />
      case 3:
        return <Step3Request />
      case 4:
        return <Step4Approval />
      case 5:
        return <Step5Success />
      case 6:
        return <Step6Error />
      default:
        return <Step1Form />
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
