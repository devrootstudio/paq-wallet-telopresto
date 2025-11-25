import { create } from "zustand"

type Step = 1 | 2 | 3 | 4 | 5

interface FormData {
  identification: string
  fullName: string
  phone: string
  email: string
  nit: string
  startDate: string
  salary: string
  paymentFrequency: string
  verificationPhone: string
  requestedAmount: number
  approvedAmount: number
}

type ErrorType = "token" | "cupo" | "general" | null

interface WizardState {
  step: Step
  isLoading: boolean
  formData: FormData
  errorMessage: string | null
  errorFromStep: Step | null
  setStep: (step: Step) => void
  setLoading: (loading: boolean) => void
  setErrorStep: (errorType?: ErrorType, errorMessage?: string) => void
  nextStep: () => void
  nextStepAsync: () => Promise<void>
  goToStepAsync: (step: Step) => Promise<void> // added goToStepAsync
  prevStep: () => void
  updateFormData: (data: Partial<FormData>) => void
  reset: () => void
}

export const useWizardStore = create<WizardState>((set) => ({
  step: 1,
  isLoading: false,
  errorMessage: null,
  errorFromStep: null,
  formData: {
    identification: "",
    fullName: "",
    phone: "",
    email: "",
    nit: "",
    startDate: "",
    salary: "",
    paymentFrequency: "",
    verificationPhone: "",
    requestedAmount: 0,
    approvedAmount: 0, // Default approved amount, will be updated from WS
  },
  setStep: (step) => set({ step }),
  setLoading: (loading) => set({ isLoading: loading }),
  setErrorStep: (errorType, errorMessage) =>
    set((state) => {
      // Analyze error type and current step to decide where to go
      const currentStep = state.step

      // If error is from cupo validation, reset everything and go to fallback
      if (errorType === "cupo") {
        return {
          step: 5, // Fallback step
          errorFromStep: 1, // force to step1
          errorMessage: errorMessage || "Error validating credit limit",
          formData: {
            identification: "",
            fullName: "",
            phone: "",
            email: "",
            nit: "",
            startDate: "",
            salary: "",
            paymentFrequency: "",
            verificationPhone: "",
            requestedAmount: 0,
            approvedAmount: 0,
          },
        }
      }

      // If error is from token validation in step2, stay in step2
      if (errorType === "token") {
        return {
          step: 5, // Fallback step
          errorFromStep: currentStep,
          errorMessage: errorMessage || "Error validating token",
        }
      }

      // If error is from step1, go back to step1
      if (errorType === "general") {
        return {
          step: 5, // Fallback step
          errorFromStep: 1, // force to step1
          errorMessage: errorMessage || "Error processing form",
        }
      }

      // Default: go to fallback (step 5)
      return {
        step: 5,
        errorFromStep: currentStep,
        errorMessage: errorMessage || "An error occurred",
      }
    }),
  nextStep: () => set((state) => ({ step: Math.min(state.step + 1, 5) as Step })),
  nextStepAsync: async () => {
    set({ isLoading: true })
    await new Promise((resolve) => setTimeout(resolve, 3000))
    set((state) => ({
      step: Math.min(state.step + 1, 5) as Step,
      isLoading: false,
    }))
  },
  goToStepAsync: async (step: Step) => {
    set({ isLoading: true })
    await new Promise((resolve) => setTimeout(resolve, 3000))
    set({ step, isLoading: false })
  },
  prevStep: () => set((state) => ({ step: Math.max(state.step - 1, 1) as Step })),
  updateFormData: (data) => set((state) => ({ formData: { ...state.formData, ...data } })),
  reset: () =>
    set({
      step: 1,
      isLoading: false,
      errorMessage: null,
      errorFromStep: null,
      formData: {
        identification: "",
        fullName: "",
        phone: "",
        email: "",
        nit: "",
        startDate: "",
        salary: "",
        paymentFrequency: "",
        verificationPhone: "",
        requestedAmount: 0,
        approvedAmount: 0,
      },
    }),
}))
