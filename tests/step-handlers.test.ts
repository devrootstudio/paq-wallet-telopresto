import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions", () => ({
  submitStep0Form: vi.fn(),
  submitStep1Form: vi.fn(),
  submitStep2Form: vi.fn(),
  resendToken: vi.fn(),
}))

import * as actions from "@/app/actions"
import { handleStep0Submit, handleStep1Submit, handleStep2Submit } from "@/lib/step-handlers"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function fakeStore(formData: Record<string, unknown> = {}) {
  return {
    formData: { autorizacion: "auth-1", nextAction: "continue", clientId: "", ...formData },
    updateFormData: vi.fn(),
    setLoading: vi.fn(),
    setErrorStep: vi.fn(),
    goToStepAsync: vi.fn(async () => undefined),
    nextStepAsync: vi.fn(async () => undefined),
  } as any
}

const form = {
  identification: "2456789010101", fullName: "Cliente", phone: "5512 3478", email: "c@example.com",
  nit: "1", startDate: "01-01-2024", salary: "5000", paymentFrequency: "mensual",
  empresa: "machete-circo", edad: "30", estadoCivil: "soltero", domicilio: "GT",
}

beforeEach(() => vi.clearAllMocks())

describe("step 0 handler", () => {
  it("always goes to step 1; with a client id the next action is edit", async () => {
    m(actions.submitStep0Form).mockResolvedValue({ success: true, clientId: "C-9", clientData: { fullName: "Cliente" } })
    const store = fakeStore()
    await handleStep0Submit("5512 3478", store)
    expect(actions.submitStep0Form).toHaveBeenCalledWith(expect.objectContaining({ phone: "55123478" }))
    expect(store.updateFormData).toHaveBeenCalledWith(expect.objectContaining({ clientId: "C-9", nextAction: "edit", fullName: "Cliente" }))
    expect(store.goToStepAsync).toHaveBeenCalledWith(1)
  })

  it("without a client id the next action is create", async () => {
    m(actions.submitStep0Form).mockResolvedValue({ success: true })
    const store = fakeStore()
    await handleStep0Submit("55123478", store)
    expect(store.updateFormData).toHaveBeenCalledWith(expect.objectContaining({ nextAction: "create" }))
    expect(store.goToStepAsync).toHaveBeenCalledWith(1)
  })

  it("an error is routed with its type", async () => {
    m(actions.submitStep0Form).mockResolvedValue({ success: false, errorType: "phone_number", error: "No registrado" })
    const store = fakeStore()
    await handleStep0Submit("55123478", store)
    expect(store.setErrorStep).toHaveBeenCalledWith("phone_number", "No registrado")
    expect(store.goToStepAsync).not.toHaveBeenCalled()
  })
})

describe("step 1 handler", () => {
  it("normal case goes to step 2", async () => {
    m(actions.submitStep1Form).mockResolvedValue({ success: true })
    const store = fakeStore()
    await handleStep1Submit(form, store)
    expect(store.nextStepAsync).toHaveBeenCalled()
    expect(store.goToStepAsync).not.toHaveBeenCalled()
  })

  it("code 24 (skipStep2) jumps to step 3 with the approved amount", async () => {
    m(actions.submitStep1Form).mockResolvedValue({ success: true, skipStep2: true, approvedAmount: 3500, idSolicitud: "SOL-24", comisionPorcentaje: 7.5 })
    const store = fakeStore()
    await handleStep1Submit(form, store)
    expect(store.updateFormData).toHaveBeenCalledWith(expect.objectContaining({ approvedAmount: 3500, idSolicitud: "SOL-24", comisionPorcentaje: 7.5 }))
    expect(store.goToStepAsync).toHaveBeenCalledWith(3)
    expect(store.nextStepAsync).not.toHaveBeenCalled()
  })
})

describe("step 2 handler", () => {
  it("valid token stores the amount and advances to step 3", async () => {
    m(actions.submitStep2Form).mockResolvedValue({ success: true, approvedAmount: 2000, idSolicitud: "SOL-2", otpHash: "h", comisionPorcentaje: 6.5 })
    const store = fakeStore()
    await handleStep2Submit("55123478", "123456", store)
    expect(store.updateFormData).toHaveBeenCalledWith(expect.objectContaining({ approvedAmount: 2000, idSolicitud: "SOL-2" }))
    expect(store.nextStepAsync).toHaveBeenCalled()
  })

  it("an error defaults to the token type", async () => {
    m(actions.submitStep2Form).mockResolvedValue({ success: false, error: "Token inválido" })
    const store = fakeStore()
    await handleStep2Submit("55123478", "123456", store)
    expect(store.setErrorStep).toHaveBeenCalledWith("token", "Token inválido")
  })
})
