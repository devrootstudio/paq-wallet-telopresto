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
}

interface WizardState {
  step: Step
  isLoading: boolean
  formData: FormData
  setStep: (step: Step) => void
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
    requestedAmount: 1500, // updated default requested amount to 1500
  },
  setStep: (step) => set({ step }),
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
        requestedAmount: 1500,
      },
    }),
}))
