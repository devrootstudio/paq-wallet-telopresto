import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// Step 1 reads the store through this mock: server rendering would otherwise use the initial state.
const view = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock("@/lib/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/store")>()
  return { ...real, useWizardStore: Object.assign(() => view.state, real.useWizardStore) }
})
vi.mock("@/app/actions", () => ({ submitStep1Form: vi.fn(async () => ({ success: false, error: "x" })) }))
vi.mock("@/app/avales-actions", () => ({ submitGuarantorRequest: vi.fn(), getRutaAction: vi.fn() }))

import { submitStep1Form } from "@/app/actions"
import { EMPRESAS_GT, EMPRESA_OTRA, cambioDeEmpresa, normalizarTexto, validarEmpresaOtra } from "@/lib/empresas"
import { useWizardStore } from "@/lib/store"
import { handleStep1Submit } from "@/lib/step-handlers"
import Step1Form from "@/components/steps/step-1-form"
import { buildGuarantorRequest, validateGuarantors, type GuarantorDraft } from "@/components/steps/step-3b-avales"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const real = () => useWizardStore.getState()

const OTRA = {
  empresa: "Comercial Ejemplo, S.A.",
  empresaOtra: true,
  empresaTelefono: "19000002",
  empresaDireccion: "4a. Calle 5-67, Zona 1, Ciudad de Guatemala",
}
const LISTA = { empresa: EMPRESAS_GT[0].label, empresaOtra: false, empresaTelefono: "", empresaDireccion: "" }

const step1 = {
  identification: "9000000000101", fullName: "Solicitante Prueba", phone: "19000001", email: "s@example.com",
  nit: "1234567", startDate: "01-01-2024", salary: "5000.00", paymentFrequency: "mensual",
  edad: "30", estadoCivil: "Soltero/a", domicilio: "Zona 10, Ciudad de Guatemala",
}

beforeEach(() => {
  vi.clearAllMocks()
  real().reset()
  view.state = { ...real(), formData: { ...real().formData, ...step1, ...LISTA } }
})

describe("empresa 'Otra': list and validation", () => {
  it("'Otra' is offered after the listed companies", () => {
    expect(EMPRESAS_GT.some((e) => e.value === EMPRESA_OTRA.value)).toBe(false)
    expect(EMPRESA_OTRA.label).toBe("Otra")
  })

  it("name, phone (8 digits) and address (10+) are required only for 'Otra'", () => {
    expect(validarEmpresaOtra(LISTA)).toEqual({})
    expect(validarEmpresaOtra(OTRA)).toEqual({})
    expect(validarEmpresaOtra({ ...OTRA, empresaTelefono: "1900 0002" })).toEqual({})
    expect(validarEmpresaOtra({ empresaOtra: true, empresa: " ", empresaTelefono: "123", empresaDireccion: "Zona 1" })).toEqual({
      empresa: "Escribe el nombre de la empresa",
      empresaTelefono: "El teléfono de la empresa debe tener 8 dígitos",
      empresaDireccion: "Ingresa la dirección completa de la empresa",
    })
  })
})

describe("empresa 'Otra': same measure as the server", () => {
  it("an address that is short once inner spaces collapse is rejected in Step 1, as the server would", () => {
    // "Zona  1  A" is 10 characters raw but 8 normalized: the server rejects it in Step 3b.
    expect(validarEmpresaOtra({ ...OTRA, empresaDireccion: "Zona  1  A" }).empresaDireccion).toBe(
      "Ingresa la dirección completa de la empresa",
    )
    expect(validarEmpresaOtra({ ...OTRA, empresaDireccion: "  Zona   10, Mixco  " })).toEqual({})
    expect(normalizarTexto("  Zona   10,\tMixco  ")).toBe("Zona 10, Mixco")
  })

  it("what Step 1 accepts, the guarantor request accepts too", () => {
    const address = "  4a.  Calle   5-67  "
    expect(validarEmpresaOtra({ ...OTRA, empresaDireccion: address })).toEqual({})
    const input = buildGuarantorRequest(
      {
        ...real().formData, ...step1, ...OTRA, empresaDireccion: address, autorizacion: "auth-123456",
        idSolicitud: "TEST-001", approvedAmount: 3500, requestedAmount: 2500, disbursementAmount: 2290,
      },
      [
        { fullName: "Aval Uno Prueba", identification: "1000000000101", phone: "10000001", relationship: "hermano/a" },
        { fullName: "Aval Dos Prueba", identification: "1000000000202", phone: "10000002", relationship: "amigo/a" },
        { fullName: "Aval Tres Prueba", identification: "1000000000303", phone: "10000003", relationship: "otro" },
      ],
    )
    expect(input.applicant.companyAddress).toBe("4a. Calle 5-67")
    expect(validateGuarantors(input)).toEqual({})
  })
})

describe("company select", () => {
  it("'Otra' starts with an empty name; going back to a listed company clears the 'Otra' fields", () => {
    expect(cambioDeEmpresa(EMPRESA_OTRA.value)).toEqual({ empresaOtra: true, empresa: "" })
    real().updateFormData(OTRA)
    real().updateFormData(cambioDeEmpresa(EMPRESAS_GT[1].label))
    expect(real().formData).toMatchObject({
      empresa: EMPRESAS_GT[1].label, empresaOtra: false, empresaTelefono: "", empresaDireccion: "",
    })
  })
})

describe("Step 1 form", () => {
  it("listed company: 'Otra' is an option and the extra fields are hidden", () => {
    const html = renderToStaticMarkup(createElement(Step1Form))
    expect(html).toContain(`<option value="${EMPRESA_OTRA.value}">Otra</option>`)
    // "Otra" comes after every listed company
    expect(html.lastIndexOf(EMPRESAS_GT[EMPRESAS_GT.length - 1].label)).toBeLessThan(html.indexOf(">Otra</option>"))
    expect(html).not.toContain("Nombre de la empresa")
    expect(html).not.toContain("Teléfono de la empresa")
  })

  it("'Otra': name, phone (0000 0000) and address of the company appear, and the form is enabled", () => {
    view.state = { ...view.state, formData: { ...(view.state.formData as object), ...OTRA } }
    const html = renderToStaticMarkup(createElement(Step1Form))
    expect(html).toContain("Nombre de la empresa")
    expect(html).toContain('value="Comercial Ejemplo, S.A."')
    expect(html).toContain("Teléfono de la empresa")
    expect(html).toContain('value="1900 0002"')
    expect(html).toContain("Dirección de la empresa")
    expect(html).not.toContain("Selecciona tu empresa para habilitar")
    expect(html).toContain('<option value="otra" selected="">Otra</option>')
  })
})

describe("Step 1 submit", () => {
  const store = () => ({
    nextStepAsync: vi.fn(), setLoading: vi.fn(), setErrorStep: vi.fn(), updateFormData: vi.fn(), goToStepAsync: vi.fn(),
    formData: real().formData,
  })

  it("'Otra' sends the typed name, phone and address to the server", async () => {
    await handleStep1Submit({ ...step1, ...OTRA, empresaTelefono: "1900 0002" }, store())
    expect(m(submitStep1Form).mock.calls[0][0]).toMatchObject({
      empresa: "Comercial Ejemplo, S.A.",
      empresaOtra: true,
      empresaTelefono: "19000002",
      empresaDireccion: "4a. Calle 5-67, Zona 1, Ciudad de Guatemala",
    })
  })

  it("a listed company sends no phone or address", async () => {
    await handleStep1Submit({ ...step1, ...LISTA, empresaTelefono: "leftover", empresaDireccion: "leftover" }, store())
    expect(m(submitStep1Form).mock.calls[0][0]).toMatchObject({
      empresa: EMPRESAS_GT[0].label, empresaOtra: false, empresaTelefono: "", empresaDireccion: "",
    })
  })
})

describe("Step 3b request", () => {
  const guarantors: GuarantorDraft[] = [
    { fullName: "Aval Uno Prueba", identification: "1000000000101", phone: "10000001", relationship: "hermano/a" },
    { fullName: "Aval Dos Prueba", identification: "1000000000202", phone: "10000002", relationship: "amigo/a" },
    { fullName: "Aval Tres Prueba", identification: "1000000000303", phone: "10000003", relationship: "otro" },
  ]
  const formData = (extra: object) => ({
    ...real().formData, ...step1, autorizacion: "auth-123456", idSolicitud: "TEST-001",
    approvedAmount: 3500, requestedAmount: 2500, disbursementAmount: 2290, comisionPorcentaje: 7.5, ...extra,
  })

  it("'Otra' sends companyOther with the typed name, phone and address", () => {
    const input = buildGuarantorRequest(formData(OTRA), guarantors)
    expect(input.applicant).toMatchObject({
      company: "Comercial Ejemplo, S.A.", companyOther: true, companyPhone: "19000002",
      companyAddress: "4a. Calle 5-67, Zona 1, Ciudad de Guatemala",
    })
    expect(validateGuarantors(input)).toEqual({})
  })

  it("a listed company sends companyOther false and no phone or address", () => {
    const input = buildGuarantorRequest(formData(LISTA), guarantors)
    expect(input.applicant).toMatchObject({ company: EMPRESAS_GT[0].label, companyOther: false, companyPhone: "", companyAddress: "" })
    expect(validateGuarantors(input)).toEqual({})
  })

  it("an incomplete 'Otra' company is a form error (it comes from Step 1), not a guarantor field", () => {
    const errors = validateGuarantors(buildGuarantorRequest(formData({ ...OTRA, empresaTelefono: "" }), guarantors))
    expect(errors.form).toMatch(/Recarga la página/)
    expect(Object.keys(errors)).toEqual(["form"])
  })
})

describe("store", () => {
  it("starts and resets without 'Otra'", () => {
    real().updateFormData(OTRA)
    expect(real().formData).toMatchObject(OTRA)
    real().reset()
    expect(real().formData).toMatchObject({ empresa: "", empresaOtra: false, empresaTelefono: "", empresaDireccion: "" })
  })
})
