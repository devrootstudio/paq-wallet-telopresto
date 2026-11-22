import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// Components read the store through this mock: server rendering would otherwise always use the
// store's initial state (useSyncExternalStore server snapshot).
const view = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock("@/lib/store", () => ({ useWizardStore: () => view.state }))

vi.mock("@/app/actions", () => ({ submitStep3Form: vi.fn() }))
vi.mock("@/app/avales-actions", () => ({
  getRutaAction: vi.fn(async () => "aval"),
  submitGuarantorRequest: vi.fn(),
}))

import { submitStep3Form } from "@/app/actions"
import { submitGuarantorRequest } from "@/app/avales-actions"
import Step3Approval from "@/components/steps/step-3-approval"
import Step3bAvales, {
  buildGuarantorRequest,
  emptyGuarantors,
  formatDPI,
  formatPhone,
  requestGuarantors,
  splitFieldErrors,
  submitErrorMessage,
  validateGuarantors,
  type GuarantorDraft,
} from "@/components/steps/step-3b-avales"
import Step3cEnRevision, { formatTimeLeft } from "@/components/steps/step-3c-en-revision"
import { RELATIONSHIPS } from "@/lib/avales/types"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const formData = {
  identification: "2987654321010",
  fullName: "María Elena Vásquez Morales",
  phone: "52018854",
  email: "maria@example.com",
  nit: "",
  startDate: "",
  salary: "",
  paymentFrequency: "",
  verificationPhone: "",
  requestedAmount: 2500,
  approvedAmount: 3500,
  disbursementAmount: 2290,
  idSolicitud: "SOL-1",
  hasCommissionIssue: false,
  autorizacion: "a1b2c3d4e5f6a1b2c3d4e5f6",
  clientId: "",
  nextAction: "continue" as const,
  empresa: "Empresa Demo",
  edad: "34",
  estadoCivil: "Casado/a",
  domicilio: "Zona 10",
  fingerprint: "fp-1",
  screenResolution: "390x844 @3x",
  idiomaBrowser: "es-GT",
  ipInfo: null,
  otpHash: "hash-1",
  comisionPorcentaje: 7.5,
  pagareUrl: "",
}

const validGuarantors = (): GuarantorDraft[] => [
  { fullName: "Carlos Pérez", identification: "2456 78901 0101", phone: "5512 3478", relationship: "hermano/a" },
  { fullName: "Ana Gómez", identification: "3012456780108", phone: "47892210", relationship: "amigo/a" },
  { fullName: "Jorge Méndez", identification: "1987654320115", phone: "30216655", relationship: "otro" },
]

const fakeStore = () => ({ setGuarantorRequest: vi.fn(), setAvalStage: vi.fn() })

beforeEach(() => {
  vi.clearAllMocks()
  view.state = {
    formData,
    isLoading: false,
    ruta: "aval",
    avalStage: null,
    guarantorRequest: null,
    nextStepAsync: vi.fn(),
    updateFormData: vi.fn(),
    setLoading: vi.fn(),
    setErrorStep: vi.fn(),
    setRuta: vi.fn(),
    setAvalStage: vi.fn(),
    setGuarantorRequest: vi.fn(),
  }
})

describe("Paso 3 by route", () => {
  it("aval route: the button says Solicitar aval and there is no disbursement copy", () => {
    const html = renderToStaticMarkup(createElement(Step3Approval))
    expect(html).toContain("Solicitar aval")
    expect(html).not.toContain("Solicítalo ahora")
    expect(html).not.toContain("se depositará automáticamente")
  })

  it("normal route: the screen is today's (Solicítalo ahora, automatic deposit)", () => {
    view.state.ruta = "normal"
    const html = renderToStaticMarkup(createElement(Step3Approval))
    expect(html).toContain("Solicítalo ahora")
    expect(html).toContain("se depositará automáticamente")
    expect(html).not.toContain("Solicitar aval")
  })

  it("rendering Step 3 never disburses", () => {
    renderToStaticMarkup(createElement(Step3Approval))
    expect(submitStep3Form).not.toHaveBeenCalled()
  })
})

describe("Paso 3b form", () => {
  it("renders 3 references with name, DPI, phone and the contract relationships", () => {
    const html = renderToStaticMarkup(createElement(Step3bAvales))
    for (const n of [1, 2, 3]) expect(html).toContain(`Referencia ${n}`)
    expect(html.match(/Nombre completo/g)).toHaveLength(3)
    expect(html.match(/>DPI</g)).toHaveLength(3)
    expect(html.match(/>Teléfono</g)).toHaveLength(3)
    expect(html.match(/Relación contigo/g)).toHaveLength(3)
    for (const r of RELATIONSHIPS) expect(html).toContain(`value="${r}"`)
    expect(html).toContain("Q2500.00")
    expect(html).toContain("Solicitar avales")
  })

  it("formats DPI and phone like the prototype", () => {
    expect(formatDPI("2456789010101")).toBe("2456 78901 0101")
    expect(formatPhone("55123478")).toBe("5512 3478")
  })

  it("builds the request from the wizard data", () => {
    const input = buildGuarantorRequest(formData, validGuarantors())
    expect(input).toMatchObject({
      authorization: formData.autorizacion,
      cupoId: "SOL-1",
      approvedAmount: 3500,
      requestedAmount: 2500,
      commission: 210,
      commissionPct: 7.5,
      applicant: {
        phone: "52018854",
        identification: "2987654321010",
        company: "Empresa Demo",
        age: "34",
        maritalStatus: "Casado/a",
        address: "Zona 10",
      },
      audit: { fingerprint: "fp-1", screenResolution: "390x844 @3x", idiomaBrowser: "es-GT", otpHash: "hash-1" },
    })
    expect(input.guarantors[0]).toEqual({
      fullName: "Carlos Pérez",
      identification: "2456789010101",
      phone: "55123478",
      relationship: "hermano/a",
    })
  })

  it("valid data has no errors", () => {
    expect(validateGuarantors(buildGuarantorRequest(formData, validGuarantors()))).toEqual({})
  })

  it("an empty form has one error per field of every guarantor", () => {
    const errors = validateGuarantors(buildGuarantorRequest(formData, emptyGuarantors()))
    for (const i of [0, 1, 2]) {
      expect(errors[`guarantors.${i}.fullName`]).toBe("El nombre es obligatorio")
      expect(errors[`guarantors.${i}.identification`]).toBe("El DPI debe tener 13 dígitos")
      expect(errors[`guarantors.${i}.phone`]).toBe("El teléfono debe tener 8 dígitos")
      expect(errors[`guarantors.${i}.relationship`]).toBe("Selecciona la relación")
    }
    expect(errors.form).toBeUndefined()
  })

  it("repeated phones/DPIs and the applicant's own are marked on the field", () => {
    const g = validGuarantors()
    g[1].phone = g[0].phone
    g[2].identification = formData.identification
    const errors = validateGuarantors(buildGuarantorRequest(formData, g))
    expect(errors["guarantors.1.phone"]).toBe("Este teléfono ya está en otro aval")
    expect(errors["guarantors.2.identification"]).toBe("El DPI del aval no puede ser el tuyo")
  })

  it("errors outside the guarantors become one form error", () => {
    expect(splitFieldErrors({ "applicant.identification": "x", authorization: "y", "guarantors.0.phone": "z" })).toEqual({
      form: "Faltan datos de tu solicitud. Vuelve al paso anterior e intenta de nuevo.",
      "guarantors.0.phone": "z",
    })
  })

  it("every server error code has a message", () => {
    for (const code of ["validation", "unauthorized", "route_disabled", "unavailable"] as const) {
      expect(submitErrorMessage({ ok: false, code })).toMatch(/\S/)
    }
  })
})

describe("Paso 3b submit", () => {
  it("an invalid form never calls the server", async () => {
    const store = fakeStore()
    const outcome = await requestGuarantors(formData, emptyGuarantors(), store)
    expect(outcome.sent).toBe(false)
    expect(submitGuarantorRequest).not.toHaveBeenCalled()
    expect(store.setAvalStage).not.toHaveBeenCalled()
  })

  it("a saved request moves to en revisión with the amount and expiry", async () => {
    m(submitGuarantorRequest).mockResolvedValue({
      ok: true,
      requestId: "rec1",
      expiresAt: "2026-11-24T12:00:00.000Z",
      reused: false,
    })
    const store = fakeStore()
    const outcome = await requestGuarantors(formData, validGuarantors(), store)
    expect(outcome).toEqual({ sent: true, errors: {}, message: null })
    expect(submitGuarantorRequest).toHaveBeenCalledTimes(1)
    expect(m(submitGuarantorRequest).mock.calls[0][0]).toMatchObject({ authorization: formData.autorizacion })
    expect(store.setGuarantorRequest).toHaveBeenCalledWith({ amount: 2500, expiresAt: "2026-11-24T12:00:00.000Z" })
    expect(store.setAvalStage).toHaveBeenCalledWith("en-revision")
  })

  it("server field errors are shown on their fields", async () => {
    m(submitGuarantorRequest).mockResolvedValue({
      ok: false,
      code: "validation",
      fieldErrors: { "guarantors.2.phone": "Este teléfono ya está en otro aval" },
    })
    const store = fakeStore()
    const outcome = await requestGuarantors(formData, validGuarantors(), store)
    expect(outcome.sent).toBe(false)
    expect(outcome.errors).toEqual({ "guarantors.2.phone": "Este teléfono ya está en otro aval" })
    expect(outcome.message).toBe("Revisa los datos marcados.")
    expect(store.setAvalStage).not.toHaveBeenCalled()
  })

  it("an unavailable server or a network error keeps the form with a retry message", async () => {
    m(submitGuarantorRequest).mockResolvedValueOnce({ ok: false, code: "unavailable" })
    const a = await requestGuarantors(formData, validGuarantors(), fakeStore())
    expect(a.message).toMatch(/Intenta de nuevo/)

    m(submitGuarantorRequest).mockRejectedValueOnce(new Error("network"))
    const b = await requestGuarantors(formData, validGuarantors(), fakeStore())
    expect(b).toMatchObject({ sent: false, message: expect.stringMatching(/conexión/) })
  })
})

describe("en revisión", () => {
  it("shows the reserved amount, 2 of 3 in 48 h, WhatsApp and that it can be closed", () => {
    view.state.guarantorRequest = {
      amount: 2500,
      expiresAt: new Date(Date.now() + 48 * 3_600_000 - 60_000).toISOString(),
    }
    const html = renderToStaticMarkup(createElement(Step3cEnRevision))
    expect(html).toContain("En revisión")
    expect(html).toContain("Q2500.00")
    expect(html).toContain("2 de tus 3 avales")
    expect(html).toContain("48 horas")
    expect(html).toContain("WhatsApp")
    expect(html).toContain("cerrar esta pantalla")
    expect(html).toMatch(/47:5\d h/)
  })

  it("time left is h:mm and never negative", () => {
    const now = Date.parse("2026-11-22T12:00:00Z")
    expect(formatTimeLeft("2026-11-24T11:52:00Z", now)).toBe("47:52 h")
    expect(formatTimeLeft("2026-11-22T11:00:00Z", now)).toBe("0:00 h")
    expect(formatTimeLeft("not a date", now)).toBeNull()
  })
})
