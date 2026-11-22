import { describe, it, expect, beforeEach } from "vitest"
import { useWizardStore } from "@/lib/store"

const s = () => useWizardStore.getState()

beforeEach(() => {
  s().reset()
})

describe("commission and disbursement amount (store.updateFormData)", () => {
  const disbursedFor = (amount: number) => {
    s().reset()
    s().updateFormData({ requestedAmount: amount })
    return s().formData.disbursementAmount
  }

  it("Q100–250: flat Q15 + 12% IVA", () => {
    expect(disbursedFor(100)).toBeCloseTo(100 - 16.8, 2)
    expect(disbursedFor(250)).toBeCloseTo(250 - 16.8, 2)
  })

  it("Q251–700: 6.5% + IVA", () => {
    expect(disbursedFor(251)).toBeCloseTo(251 - 251 * 0.065 * 1.12, 2)
    expect(disbursedFor(700)).toBeCloseTo(700 - 700 * 0.065 * 1.12, 2)
  })

  it("Q701 and up: 7.5% + IVA", () => {
    expect(disbursedFor(701)).toBeCloseTo(701 - 701 * 0.075 * 1.12, 2)
    expect(disbursedFor(3500)).toBeCloseTo(3500 - 294, 2)
  })

  it("below Q100 there is no commission", () => {
    expect(disbursedFor(50)).toBe(50)
  })

  it("the first approved amount becomes the requested amount", () => {
    s().updateFormData({ approvedAmount: 1000 })
    expect(s().formData.requestedAmount).toBe(1000)
    expect(s().formData.disbursementAmount).toBeCloseTo(1000 - 84, 2)
  })
})

describe("error routing (store.setErrorStep)", () => {
  it("cupo: fallback, back to step 0 and the form is cleared", () => {
    useWizardStore.setState({ step: 3 })
    s().updateFormData({ fullName: "X", phone: "55123478" })
    s().setErrorStep("cupo", "Sin cupo")
    expect(s()).toMatchObject({ step: 5, errorFromStep: 0, errorMessage: "Sin cupo" })
    expect(s().formData.fullName).toBe("")
    expect(s().formData.phone).toBe("")
  })

  it("token: fallback that returns to the step where it failed", () => {
    useWizardStore.setState({ step: 2 })
    s().setErrorStep("token", "Token inválido")
    expect(s()).toMatchObject({ step: 5, errorFromStep: 2 })
  })

  it("phone_number: fallback that returns to step 0", () => {
    useWizardStore.setState({ step: 0 })
    s().setErrorStep("phone_number", "No registrado")
    expect(s()).toMatchObject({ step: 5, errorFromStep: 0 })
  })

  it("general on step 0 stays on step 0", () => {
    useWizardStore.setState({ step: 0 })
    s().setErrorStep("general", "Error")
    expect(s()).toMatchObject({ step: 0, errorFromStep: 0 })
  })

  it("disbursement on step 3: fallback that returns to step 3", () => {
    useWizardStore.setState({ step: 3 })
    // submitStep3Form returns errorType "disbursement", which is not in the store's ErrorType:
    // it falls through to the default branch (fallback that returns to the current step).
    s().setErrorStep("disbursement" as any, "Fondos insuficientes")
    expect(s()).toMatchObject({ step: 5, errorFromStep: 3 })
  })
})
