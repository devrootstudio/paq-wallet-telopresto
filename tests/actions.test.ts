import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cookieJar } from "./setup"

// Paq SOAP services, the Make webhook and PDFMonkey are external: mock them at
// the module boundary so the tests pin the flow logic of app/actions.ts.
vi.mock("@/lib/soap-client", () => ({
  queryClient: vi.fn(),
  sendTokenTyc: vi.fn(),
  validateTokenTyc: vi.fn(),
  validateCupo: vi.fn(),
  executeDisbursement: vi.fn(),
  registerClient: vi.fn(),
  editClient: vi.fn(),
}))
vi.mock("@/lib/make-integration", () => ({ sendToMakeWebhook: vi.fn(async () => undefined) }))
vi.mock("@/lib/pagare", () => ({ generarPagare: vi.fn(async () => "https://pdf.example/pagare.pdf") }))

import * as soap from "@/lib/soap-client"
import { sendToMakeWebhook } from "@/lib/make-integration"
import { generarPagare } from "@/lib/pagare"
import { clearMemoryReleaseStore } from "@/lib/release"
import {
  submitStep0Form,
  submitStep1Form,
  submitStep2Form,
  submitStep3Form,
  resendToken,
} from "@/app/actions"

const m = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

const PHONE = "55123478"

const step1Data = {
  identification: "2456789010101",
  fullName: "Cliente de Prueba",
  phone: PHONE,
  email: "cliente@example.com",
  nit: "1234567",
  startDate: "01-01-2024",
  salary: "5,000",
  paymentFrequency: "mensual",
  empresa: "machete-circo",
  edad: "30",
  estadoCivil: "soltero",
  domicilio: "Ciudad de Guatemala",
  autorizacion: "auth-123",
}

const step3Data = {
  phone: PHONE,
  idSolicitud: "SOL-1",
  monto: 1000,
  comision: 84,
  autorizacion: "auth-123",
  identification: "2456789010101",
  fullName: "Cliente de Prueba",
  comisionPorcentaje: 7.5,
}

beforeEach(() => {
  cookieJar.clear()
  clearMemoryReleaseStore()
  vi.clearAllMocks()
})

describe("security token", () => {
  it("rejects a request whose security cookie has a bad signature", async () => {
    cookieJar.set("app-security-token", "forged.signature")
    const r = await submitStep0Form({ phone: PHONE })
    expect(r).toMatchObject({ success: false, error: "Unauthorized request" })
    expect(soap.queryClient).not.toHaveBeenCalled()
  })
})

describe("step 0 · phone (Consulta_Cliente)", () => {
  it("requires 8 digits", async () => {
    const r = await submitStep0Form({ phone: "1234" })
    expect(r).toMatchObject({ success: false, errorType: "phone_number" })
    expect(soap.queryClient).not.toHaveBeenCalled()
  })

  it("code 0: maps the client profile (date dd-mm-yyyy, frequency, salary)", async () => {
    m(soap.queryClient).mockResolvedValue({
      returnCode: 0,
      client: {
        id: "C-9",
        identificationNumber: "2456789010101",
        fullName: "Cliente de Prueba",
        phone: PHONE,
        email: "cliente@example.com",
        nit: "1234567",
        startDate: "2024-03-15T12:00:00",
        monthlySalary: "5000",
        paymentFrequency: "Q",
      },
    })
    const r = await submitStep0Form({ phone: "5512 3478" })
    expect(soap.queryClient).toHaveBeenCalledWith(PHONE)
    expect(r.success).toBe(true)
    expect(r.clientId).toBe("C-9")
    expect(r.clientData).toMatchObject({
      identification: "2456789010101",
      startDate: "15-03-2024",
      salary: "5000",
      paymentFrequency: "quincenal",
    })
  })

  it("code 5: phone known but profile incomplete → empty form with the client id", async () => {
    m(soap.queryClient).mockResolvedValue({ returnCode: "5", client: { id: "C-5" } })
    const r = await submitStep0Form({ phone: PHONE })
    expect(r).toMatchObject({ success: true, clientId: "C-5" })
    expect(r.clientData).toMatchObject({ phone: PHONE, fullName: "", identification: "" })
  })

  it("any other code is a phone_number error with the service message", async () => {
    m(soap.queryClient).mockResolvedValue({ returnCode: 3, message: "No registrado" })
    const r = await submitStep0Form({ phone: PHONE })
    expect(r).toEqual({ success: false, error: "No registrado", errorType: "phone_number" })
  })

  it("a service exception is a phone_number error", async () => {
    m(soap.queryClient).mockRejectedValue(new Error("timeout"))
    const r = await submitStep0Form({ phone: PHONE })
    expect(r).toMatchObject({ success: false, error: "timeout", errorType: "phone_number" })
  })
})

describe("step 1 · form (Registra/Edita_Cliente + Envia_Token_TyC)", () => {
  it("rejects missing required fields without calling any service", async () => {
    const r = await submitStep1Form({ ...step1Data, nit: "" })
    expect(r).toMatchObject({ success: false, errorType: "general" })
    expect(soap.sendTokenTyc).not.toHaveBeenCalled()
  })

  it("create: registers the client (salary without commas), notifies Make and sends the SMS", async () => {
    m(soap.registerClient).mockResolvedValue({ returnCode: 0, message: "ok", idCliente: 77 })
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    const r = await submitStep1Form({ ...step1Data, nextAction: "create" })
    expect(soap.registerClient).toHaveBeenCalledWith(
      "2456789010101", "Cliente de Prueba", PHONE, "cliente@example.com", "1234567", 5000, "mensual",
    )
    expect(soap.editClient).not.toHaveBeenCalled()
    expect(sendToMakeWebhook).toHaveBeenCalledWith(1, expect.anything(), expect.objectContaining({ returnCode: 0 }), true, "auth-123")
    expect(soap.sendTokenTyc).toHaveBeenCalledWith(PHONE)
    expect(r).toEqual({ success: true })
  })

  it("edit: edits the client with status A", async () => {
    m(soap.editClient).mockResolvedValue({ returnCode: "0", message: "ok" })
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    const r = await submitStep1Form({ ...step1Data, nextAction: "edit", clientId: "C-9" })
    expect(soap.editClient).toHaveBeenCalledWith(
      "2456789010101", "Cliente de Prueba", PHONE, "cliente@example.com", "1234567", 5000, "mensual", "A",
    )
    expect(r.success).toBe(true)
  })

  it("continue: skips create/edit but still notifies Make and sends the SMS", async () => {
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    const r = await submitStep1Form({ ...step1Data, nextAction: "continue" })
    expect(soap.registerClient).not.toHaveBeenCalled()
    expect(soap.editClient).not.toHaveBeenCalled()
    expect(sendToMakeWebhook).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ success: true })
  })

  it("create rejected by the service: general error and Make notified as failed", async () => {
    m(soap.registerClient).mockResolvedValue({ returnCode: 9, message: "DPI inválido" })
    const r = await submitStep1Form({ ...step1Data, nextAction: "create" })
    expect(r).toEqual({ success: false, error: "DPI inválido", errorType: "general" })
    expect(sendToMakeWebhook).toHaveBeenCalledWith(1, expect.anything(), null, false, "auth-123")
    expect(soap.sendTokenTyc).not.toHaveBeenCalled()
  })

  it("code 24 (terms already accepted): validates cupo and skips step 2", async () => {
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 24 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 0, cupoAutorizado: 3500, idSolicitud: "SOL-24", porcComision: 7.5 })
    const r = await submitStep1Form({ ...step1Data, nextAction: "continue" })
    expect(soap.validateCupo).toHaveBeenCalledWith(PHONE)
    expect(r).toEqual({
      success: true,
      approvedAmount: 3500,
      idSolicitud: "SOL-24",
      skipStep2: true,
      otpHash: "",
      comisionPorcentaje: 7.5,
    })
  })

  it("code 24 with cupo rejected: cupo error", async () => {
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: "24" })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 2, message: "Sin cupo" })
    const r = await submitStep1Form({ ...step1Data, nextAction: "continue" })
    expect(r).toEqual({ success: false, error: "Sin cupo", errorType: "cupo" })
  })

  it("SMS rejected: token error with the code in the message", async () => {
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 12, message: "Error al enviar" })
    const r = await submitStep1Form({ ...step1Data, nextAction: "continue" })
    expect(r).toEqual({ success: false, error: "Error al enviar (Código 12)", errorType: "token" })
  })
})

describe("resend token", () => {
  it("code 0 succeeds", async () => {
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    expect(await resendToken("5512 3478")).toEqual({ success: true })
    expect(soap.sendTokenTyc).toHaveBeenCalledWith(PHONE)
  })

  it("code 24 is NOT a success on resend (only on step 1)", async () => {
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 24, message: "TyC ya aceptados" })
    expect(await resendToken(PHONE)).toEqual({ success: false, error: "TyC ya aceptados", errorType: "token" })
  })

  it("rejects a phone without 8 digits", async () => {
    expect(await resendToken("123")).toMatchObject({ success: false, errorType: "general" })
  })
})

describe("step 2 · SMS token (Valida_Token_TyC + valida_cupo)", () => {
  it("requires 6 characters", async () => {
    const r = await submitStep2Form({ phone: PHONE, token: "123" })
    expect(r).toMatchObject({ success: false, errorType: "token" })
    expect(soap.validateTokenTyc).not.toHaveBeenCalled()
  })

  it("valid token: uppercases it, validates cupo and returns the amount and the otp hash", async () => {
    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 0 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 0, cupoAutorizado: 2000, idSolicitud: "SOL-2", porcComision: 6.5 })
    const r = await submitStep2Form({ phone: PHONE, token: "ab 12cd" })
    expect(soap.validateTokenTyc).toHaveBeenCalledWith(PHONE, "AB12CD")
    expect(r).toMatchObject({ success: true, approvedAmount: 2000, idSolicitud: "SOL-2", comisionPorcentaje: 6.5 })
    expect(r.otpHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("missing porcComision defaults to 0", async () => {
    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 0 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 0, cupoAutorizado: 200, idSolicitud: "SOL-3" })
    const r = await submitStep2Form({ phone: PHONE, token: "123456" })
    expect(r.comisionPorcentaje).toBe(0)
  })

  it("invalid token: token error, cupo not queried", async () => {
    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 1, message: "Token inválido" })
    const r = await submitStep2Form({ phone: PHONE, token: "123456" })
    expect(r).toEqual({ success: false, error: "Token inválido", errorType: "token" })
    expect(soap.validateCupo).not.toHaveBeenCalled()
  })

  it("cupo rejected after a valid token: cupo error", async () => {
    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 0 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 4, message: "Cupo agotado" })
    const r = await submitStep2Form({ phone: PHONE, token: "123456" })
    expect(r).toEqual({ success: false, error: "Cupo agotado", errorType: "cupo" })
  })
})

describe("step 3 · disbursement (Ejecuta_Desembolso + pagaré)", () => {
  // The convenio flow is the `normal` route; `aval` (the default) never disburses in Step 3.
  beforeEach(() => vi.stubEnv("TELOPRESTO_RUTA", "normal"))
  afterEach(() => vi.unstubAllEnvs())

  it("rejects incomplete data without disbursing", async () => {
    const r = await submitStep3Form({ ...step3Data, idSolicitud: "" })
    expect(r).toMatchObject({ success: false, errorType: "disbursement" })
    expect(soap.executeDisbursement).not.toHaveBeenCalled()
  })

  it("code 0: disburses once and generates the pagaré", async () => {
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 0 })
    const r = await submitStep3Form(step3Data)
    expect(soap.executeDisbursement).toHaveBeenCalledTimes(1)
    expect(soap.executeDisbursement).toHaveBeenCalledWith(PHONE, "SOL-1", 1000, 84, "auth-123")
    expect(generarPagare).toHaveBeenCalledWith(expect.objectContaining({ requestedAmount: 1000, comisionPorcentaje: 7.5, autorizacion: "auth-123" }))
    expect(r).toEqual({ success: true, hasCommissionIssue: false, pagareUrl: "https://pdf.example/pagare.pdf" })
  })

  it("code 34: disbursed with a commission issue, still a success with pagaré", async () => {
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: "34" })
    const r = await submitStep3Form(step3Data)
    expect(r).toEqual({ success: true, hasCommissionIssue: true, pagareUrl: "https://pdf.example/pagare.pdf" })
  })

  it("any other code: disbursement error and no pagaré", async () => {
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 7, message: "Fondos insuficientes" })
    const r = await submitStep3Form(step3Data)
    expect(r).toEqual({ success: false, error: "Fondos insuficientes", errorType: "disbursement" })
    expect(generarPagare).not.toHaveBeenCalled()
  })

  it("a service exception: disbursement error and no pagaré", async () => {
    m(soap.executeDisbursement).mockRejectedValue(new Error("SOAP caído"))
    const r = await submitStep3Form(step3Data)
    expect(r).toMatchObject({ success: false, error: "SOAP caído", errorType: "disbursement" })
    expect(generarPagare).not.toHaveBeenCalled()
  })

  it("a second confirmation with the same authorization does not disburse again", async () => {
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 0 })
    const first = await submitStep3Form(step3Data)
    const second = await submitStep3Form(step3Data)
    expect(soap.executeDisbursement).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it("a failed disbursement can be retried with the same authorization", async () => {
    m(soap.executeDisbursement).mockResolvedValueOnce({ returnCode: 7, message: "Fondos insuficientes" })
    m(soap.executeDisbursement).mockResolvedValueOnce({ returnCode: 0 })
    expect((await submitStep3Form(step3Data)).success).toBe(false)
    expect((await submitStep3Form(step3Data)).success).toBe(true)
    expect(soap.executeDisbursement).toHaveBeenCalledTimes(2)
  })

  it("aval route (explicit or by default): rejects without disbursing or generating a pagaré", async () => {
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 0 })
    for (const ruta of ["aval", undefined]) {
      vi.stubEnv("TELOPRESTO_RUTA", ruta)
      const r = await submitStep3Form(step3Data)
      expect(r).toMatchObject({ success: false, errorType: "disbursement" })
    }
    expect(soap.executeDisbursement).not.toHaveBeenCalled()
    expect(generarPagare).not.toHaveBeenCalled()
  })

  it("a pagaré that could not be generated leaves pagareUrl empty but the disbursement stands", async () => {
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 0 })
    m(generarPagare).mockResolvedValueOnce(null)
    const r = await submitStep3Form(step3Data)
    expect(r).toEqual({ success: true, hasCommissionIssue: false, pagareUrl: "" })
  })
})
