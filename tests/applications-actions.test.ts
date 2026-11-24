import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cookieJar } from "./setup"

// SOAP and PDFMonkey are external; the applications record runs for real against a fake Airtable.
vi.mock("@/lib/soap-client", () => ({
  queryClient: vi.fn(),
  sendTokenTyc: vi.fn(),
  validateTokenTyc: vi.fn(),
  validateCupo: vi.fn(),
  executeDisbursement: vi.fn(),
  registerClient: vi.fn(),
  editClient: vi.fn(),
}))
vi.mock("@/lib/pagare", () => ({ generarPagare: vi.fn(async () => "https://pdf.example/pagare.pdf") }))
// Make used axios: any call would show up here.
vi.mock("axios", () => ({ default: { post: vi.fn(async () => ({})), isAxiosError: () => false } }))

import axios from "axios"
import * as soap from "@/lib/soap-client"
import { clearMemoryReleaseStore } from "@/lib/release"
import { APPLICATIONS_TABLE } from "@/lib/applications"
import { createFakeAirtable } from "./avales-fake-airtable"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// Fictitious data only.
const AUTH = "f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5"
const step1 = {
  identification: "3000000000202",
  fullName: "Cliente Ficticio Dos",
  phone: "55550202",
  email: "dos@example.com",
  nit: "7654321",
  startDate: "01-01-2024",
  salary: "4,000",
  paymentFrequency: "quincenal",
  empresa: "Empresa de la Lista",
  autorizacion: AUTH,
  nextAction: "continue" as const,
}

let fake: ReturnType<typeof createFakeAirtable>

beforeEach(() => {
  cookieJar.clear()
  clearMemoryReleaseStore()
  fake = createFakeAirtable()
  vi.stubGlobal("fetch", fake.fetch)
  vi.stubEnv("AIRTABLE_TOKEN", "test-airtable-token")
  vi.stubEnv("AIRTABLE_BASE_ID", "appTEST0000000000")
  vi.stubEnv("TELOPRESTO_RUTA", "normal")
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const record = () => fake.rows(APPLICATIONS_TABLE)

describe("server actions write one applications record per authorization", () => {
  it("retrying Step 1 with the same authorization updates the same record (attempts 2), never calls Make", async () => {
    const { submitStep1Form } = await import("@/app/actions")
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    expect(await submitStep1Form(step1)).toEqual({ success: true })
    expect(await submitStep1Form(step1)).toEqual({ success: true })
    expect(record()).toHaveLength(1)
    expect(record()[0].fields).toMatchObject({ authorization: AUTH, attempts: 2, step: "otp-enviado", frequency: "Q", "start-date": "2024-01-01" })
    expect(axios.post).not.toHaveBeenCalled()
    expect(fake.calls.every((c) => c.url.startsWith("https://api.airtable.com/"))).toBe(true)
  })

  it("the record advances through the steps: Step 1 → OTP → cupo → disbursed", async () => {
    const { submitStep1Form, submitStep2Form, submitStep3Form } = await import("@/app/actions")
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 0 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 0, cupoAutorizado: 3500, idSolicitud: "SOL-9", porcComision: 7.5 })
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 0, message: "ok" })

    await submitStep1Form(step1)
    expect(record()[0].fields.step).toBe("otp-enviado")
    await submitStep2Form({ phone: step1.phone, token: "ABC123", autorizacion: AUTH })
    expect(record()[0].fields).toMatchObject({ step: "cupo-validado", "approved-amount": 3500, "cupo-id": "SOL-9" })
    expect(record()[0].fields["otp-validated-at"]).toBeTruthy()
    const r = await submitStep3Form({ phone: step1.phone, idSolicitud: "SOL-9", monto: 1000, comision: 84, autorizacion: AUTH })
    expect(r.success).toBe(true)
    expect(record()).toHaveLength(1)
    expect(record()[0].fields).toMatchObject({ step: "desembolsado", "requested-amount": 1000, commission: 84, "disbursement-code": "0" })
  })

  it("a failure records step error with the step and the code", async () => {
    const { submitStep1Form } = await import("@/app/actions")
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 5, message: "Número sin servicio" })
    const r = await submitStep1Form(step1)
    expect(r).toMatchObject({ success: false, errorType: "token" })
    expect(record()[0].fields).toMatchObject({ step: "error", "last-error-step": "otp", "last-error": "Número sin servicio (código 5)" })
  })

  it("code 24 (terms already accepted): cupo-validado from Step 1, without otp-validated-at", async () => {
    const { submitStep1Form } = await import("@/app/actions")
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 24 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 0, cupoAutorizado: 2800, idSolicitud: "SOL-24" })
    expect((await submitStep1Form(step1)).skipStep2).toBe(true)
    expect(record()[0].fields).toMatchObject({ step: "cupo-validado", "approved-amount": 2800, "cupo-id": "SOL-24" })
    expect(record()[0].fields["otp-validated-at"]).toBeUndefined()
  })

  it("Step 2 errors: a wrong OTP is error/otp; a cupo rejection is error/cupo with otp-validated-at", async () => {
    const { submitStep1Form, submitStep2Form } = await import("@/app/actions")
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    await submitStep1Form(step1)
    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 26, message: "Token incorrecto" })
    expect((await submitStep2Form({ phone: step1.phone, token: "ZZZ999", autorizacion: AUTH })).success).toBe(false)
    expect(record()[0].fields).toMatchObject({ step: "error", "last-error-step": "otp", "last-error": "Token incorrecto (código 26)" })

    m(soap.validateTokenTyc).mockResolvedValue({ returnCode: 0 })
    m(soap.validateCupo).mockResolvedValue({ returnCode: 7, message: "Sin cupo disponible" })
    expect((await submitStep2Form({ phone: step1.phone, token: "ABC123", autorizacion: AUTH })).success).toBe(false)
    expect(record()[0].fields).toMatchObject({ step: "error", "last-error-step": "cupo", "last-error": "Sin cupo disponible (código 7)" })
    expect(record()[0].fields["otp-validated-at"]).toBeTruthy()
    expect(record()).toHaveLength(1)
  })

  it("Step 3 failure: error/desembolso with the code, without touching the disbursement fields", async () => {
    const { submitStep3Form } = await import("@/app/actions")
    m(soap.executeDisbursement).mockResolvedValue({ returnCode: 12, message: "Rechazado por el banco" })
    const r = await submitStep3Form({ phone: step1.phone, idSolicitud: "SOL-9", monto: 1000, comision: 84, autorizacion: AUTH })
    expect(r).toMatchObject({ success: false, errorType: "disbursement" })
    expect(record()[0].fields).toMatchObject({ step: "error", "last-error-step": "desembolso", "last-error": "Rechazado por el banco (código 12)" })
    expect(record()[0].fields["disbursement-code"]).toBeUndefined()
  })

  it("an Airtable outage does not change the action's response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { submitStep1Form } = await import("@/app/actions")
    m(soap.sendTokenTyc).mockResolvedValue({ returnCode: 0 })
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ error: { type: "SERVER_ERROR" } }), { status: 503 })) as typeof fetch)
    expect(await submitStep1Form(step1)).toEqual({ success: true })
    expect(soap.sendTokenTyc).toHaveBeenCalled()
  })
})

describe("with the test bypass", () => {
  it("every write is marked test = true", async () => {
    vi.resetModules()
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    const { submitStep1Form, submitStep2Form, submitStep3Form } = await import("@/app/actions")
    expect((await submitStep1Form(step1)).success).toBe(true)
    expect((await submitStep2Form({ phone: step1.phone, token: "222222", autorizacion: AUTH })).success).toBe(true)
    expect(record()).toHaveLength(1)
    expect(record()[0].fields).toMatchObject({ test: true, step: "cupo-validado", "ws-status": "ACTIVE" })
    // Step 3 with the bypass: disbursement simulated, recorded as desembolsado (code 0).
    expect((await submitStep3Form({ phone: step1.phone, idSolicitud: "TEST-001", monto: 1000, comision: 84, autorizacion: AUTH })).success).toBe(true)
    expect(record()[0].fields).toMatchObject({ test: true, step: "desembolsado", "disbursement-code": "0", "requested-amount": 1000, commission: 84 })
    const upserts = fake.calls.filter((c) => c.method === "PATCH")
    expect(upserts.length).toBeGreaterThanOrEqual(2)
    for (const u of upserts) expect(JSON.parse(u.body!).records[0].fields.test).toBe(true)
    vi.resetModules()
  })
})
