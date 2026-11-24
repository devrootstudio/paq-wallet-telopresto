import { describe, it, expect, vi, beforeEach } from "vitest"
import { createAirtableClient } from "@/lib/airtable"
import { APPLICATIONS_TABLE, normalizePaymentFrequency, normalizeStartDate, recordApplication, validIsoDate, type Step1Data } from "@/lib/applications"
import type { QueryClientResponse } from "@/lib/soap-client"
import { createFakeAirtable } from "./avales-fake-airtable"

// Fictitious data only.
const NOW = new Date("2026-11-24T15:00:00.000Z")
const AUTH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"

const step1: Step1Data = {
  identification: "3000000000101",
  fullName: "Cliente Ficticio Prueba",
  phone: "5555 0101",
  email: "cliente@example.com",
  nit: "1234567",
  startDate: "15-03-2024",
  salary: "5,250.50",
  paymentFrequency: "mensual",
  empresa: "Empresa de la Lista",
  edad: "30",
  estadoCivil: "soltero",
  domicilio: "Zona 1, Ciudad",
}

const client: QueryClientResponse = {
  returnCode: 0,
  message: "ok",
  client: {
    id: "C-77",
    status: "ACTIVE",
    identificationNumber: "3000000000101",
    fullName: "Cliente Ficticio Prueba",
    phone: "55550101",
    email: "cliente@example.com",
    nit: "1234567",
    startDate: "15-03-2024",
    monthlySalary: "5250.50",
    paymentFrequency: "mensual",
  },
}

let fake: ReturnType<typeof createFakeAirtable>
const deps = () => ({ airtable: createAirtableClient({ token: "t", baseId: "appTEST0000000000", fetch: fake.fetch }), now: () => NOW })
const rows = () => fake.rows(APPLICATIONS_TABLE)
const upserts = () => fake.calls.filter((c) => c.method === "PATCH" && (c.body ?? "").includes("performUpsert"))

beforeEach(() => {
  fake = createFakeAirtable({ now: () => NOW })
})

describe("recordApplication: one record per authorization (upsert)", () => {
  it("upserts on authorization, without typecast", async () => {
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())
    const body = JSON.parse(upserts()[0].body!)
    expect(body.performUpsert).toEqual({ fieldsToMergeOn: ["authorization"] })
    expect(body.typecast).toBeUndefined()
    expect(upserts()[0].url).toContain(`/${APPLICATIONS_TABLE}`)
  })

  it("retrying Step 1 with the same authorization keeps one record and counts attempts", async () => {
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())
    expect(rows()).toHaveLength(1)
    expect(rows()[0].fields.attempts).toBe(2)
    await recordApplication(AUTH, { step: "otp-enviado" }, deps())
    expect(rows()).toHaveLength(1)
    expect(rows()[0].fields.attempts).toBe(2) // only Step 1 counts attempts
  })
})

describe("recordApplication: what each step writes", () => {
  it("Step 1: form data in the Make formats, company fields and the client response (ws-*)", async () => {
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())
    expect(rows()[0].fields).toMatchObject({
      authorization: AUTH,
      step: "paso1",
      attempts: 1,
      name: "Cliente Ficticio Prueba",
      identification: "3000000000101",
      phone: "55550101",
      email: "cliente@example.com",
      nit: "1234567",
      "start-date": "2024-03-15",
      salary: 5250.5,
      frequency: "M",
      company: "Empresa de la Lista",
      "company-other": false,
      "company-phone": "",
      "company-address": "",
      age: "30",
      "marital-status": "soltero",
      address: "Zona 1, Ciudad",
      "ws-code": "0",
      "ws-message": "ok",
      "ws-id": "C-77",
      "ws-status": "ACTIVE",
      "ws-name": "Cliente Ficticio Prueba",
      "ws-identification": "3000000000101",
      "ws-phone": "55550101",
      "ws-email": "cliente@example.com",
      "ws-start-date": "2024-03-15",
      "ws-salary": 5250.5,
      "ws-frequency": "mensual",
      "updated-at": NOW.toISOString(),
    })
    expect(rows()[0].fields.test).toBeUndefined()
  })

  it('Step 1 with an "Otra" company stores its typed name, phone and address', async () => {
    const otra = { ...step1, empresa: "Comercial Ejemplo, S.A.", empresaOtra: true, empresaTelefono: "19000002", empresaDireccion: "4a. Calle 5-67, Zona 1" }
    await recordApplication(AUTH, { step: "paso1", data: otra, client }, deps())
    expect(rows()[0].fields).toMatchObject({
      company: "Comercial Ejemplo, S.A.",
      "company-other": true,
      "company-phone": "19000002",
      "company-address": "4a. Calle 5-67, Zona 1",
    })
  })

  it("a listed company stores no phone or address, even if the form left some behind", async () => {
    const listed = { ...step1, empresaOtra: false, empresaTelefono: "leftover", empresaDireccion: "leftover" }
    await recordApplication(AUTH, { step: "paso1", data: listed, client }, deps())
    expect(rows()[0].fields).toMatchObject({ company: "Empresa de la Lista", "company-other": false, "company-phone": "", "company-address": "" })
  })

  it("Step 1 failure (client create/edit): step error with last-error-step paso1 and the code", async () => {
    await recordApplication(AUTH, { step: "paso1", data: step1, client: null, error: { message: "DPI inválido", code: 9 } }, deps())
    expect(rows()[0].fields).toMatchObject({ step: "error", "last-error-step": "paso1", "last-error": "DPI inválido (código 9)", attempts: 1 })
    expect(rows()[0].fields["ws-code"]).toBeUndefined()
  })

  it("OTP sent, cupo validated (with and without the OTP validated), disbursed", async () => {
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())
    await recordApplication(AUTH, { step: "otp-enviado" }, deps())
    expect(rows()[0].fields.step).toBe("otp-enviado")

    await recordApplication(AUTH, { step: "cupo-validado", otpValidated: true, approvedAmount: 3500, cupoId: "SOL-1" }, deps())
    expect(rows()[0].fields).toMatchObject({
      step: "cupo-validado",
      "approved-amount": 3500,
      "cupo-id": "SOL-1",
      "cupo-validated-at": NOW.toISOString(),
      "otp-validated-at": NOW.toISOString(),
    })

    await recordApplication(AUTH, { step: "desembolsado", requestedAmount: 1000, commission: 84, code: "0", message: "Disbursed" }, deps())
    expect(rows()[0].fields).toMatchObject({
      step: "desembolsado",
      "disbursed-at": NOW.toISOString(),
      "requested-amount": 1000,
      commission: 84,
      "disbursement-code": "0",
      "disbursement-message": "Disbursed",
    })
    // Earlier data is kept: absent values never overwrite.
    expect(rows()[0].fields).toMatchObject({ name: "Cliente Ficticio Prueba", "approved-amount": 3500 })
  })

  it("cupo via code 24 (no OTP): no otp-validated-at", async () => {
    await recordApplication(AUTH, { step: "cupo-validado", approvedAmount: 3500, cupoId: "SOL-24" }, deps())
    expect(rows()[0].fields["otp-validated-at"]).toBeUndefined()
  })

  it("errors: step error with last-error-step and message (code when known)", async () => {
    await recordApplication(AUTH, { step: "error", errorStep: "otp", error: { message: "Token incorrecto", code: 26 } }, deps())
    expect(rows()[0].fields).toMatchObject({ step: "error", "last-error-step": "otp", "last-error": "Token incorrecto (código 26)" })

    await recordApplication(AUTH, { step: "error", errorStep: "cupo", otpValidated: true, error: { message: "Sin cupo" } }, deps())
    expect(rows()[0].fields).toMatchObject({ "last-error-step": "cupo", "last-error": "Sin cupo", "otp-validated-at": NOW.toISOString() })

    await recordApplication(AUTH, { step: "error", errorStep: "desembolso", error: { message: "Rechazado", code: "12" } }, deps())
    expect(rows()[0].fields).toMatchObject({ step: "error", "last-error-step": "desembolso", "last-error": "Rechazado (código 12)" })
    expect(rows()[0].fields["disbursement-code"]).toBeUndefined()
  })

  it("an error never overwrites data of an earlier success (e.g. the disbursement code)", async () => {
    await recordApplication(AUTH, { step: "desembolsado", requestedAmount: 1000, commission: 84, code: "0", message: "Disbursed" }, deps())
    await recordApplication(AUTH, { step: "error", errorStep: "desembolso", error: { message: "Timeout", code: "99" } }, deps())
    const errorWrite = JSON.parse(upserts()[1].body!).records[0].fields
    expect(Object.keys(errorWrite).sort()).toEqual(["authorization", "last-error", "last-error-step", "step", "updated-at"])
    expect(rows()[0].fields).toMatchObject({
      "disbursement-code": "0",
      "disbursement-message": "Disbursed",
      "requested-amount": 1000,
      commission: 84,
      "last-error": "Timeout (código 99)",
    })
  })

  it("returns true when written", async () => {
    expect(await recordApplication(AUTH, { step: "otp-enviado" }, deps())).toBe(true)
  })

  it("with the test bypass every write carries test = true", async () => {
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, { ...deps(), test: true })
    await recordApplication(AUTH, { step: "otp-enviado" }, { ...deps(), test: true })
    for (const call of upserts()) expect(JSON.parse(call.body!).records[0].fields.test).toBe(true)
    expect(rows()[0].fields.test).toBe(true)
  })
})

describe("recordApplication: values a field cannot hold are left out", () => {
  it("unknown select options, malformed dates and emails are not written (the rest is)", async () => {
    const odd = { ...step1, paymentFrequency: "semanal", startDate: "2024/13", email: "no-es-correo" }
    const oddClient: QueryClientResponse = { ...client, client: { ...(client.client as object), status: "X", paymentFrequency: "semanal", email: "x" } }
    await recordApplication(AUTH, { step: "paso1", data: odd, client: oddClient }, deps())
    const f = rows()[0].fields
    for (const key of ["frequency", "start-date", "email", "ws-status", "ws-frequency", "ws-email"]) expect(f[key]).toBeUndefined()
    expect(f).toMatchObject({ step: "paso1", name: "Cliente Ficticio Prueba" })
  })

  it("impossible dates are left out (31-02), real ones kept", async () => {
    await recordApplication(AUTH, { step: "paso1", data: { ...step1, startDate: "31-02-2024" }, client }, deps())
    expect(rows()[0].fields["start-date"]).toBeUndefined()
    expect(validIsoDate("29-02-2024")).toBe("2024-02-29")
    expect(validIsoDate("29-02-2023")).toBeUndefined()
    expect(validIsoDate("2024-04-31")).toBeUndefined()
  })

  it("format helpers match the old Make mapping", () => {
    expect(normalizeStartDate("01-02-2024")).toBe("2024-02-01")
    expect(normalizeStartDate("2024-02-01")).toBe("2024-02-01")
    expect(["mensual", "quincenal", "semanal", "M"].map(normalizePaymentFrequency)).toEqual(["M", "Q", "S", "M"])
  })
})

describe("old duplicates sharing the authorization", () => {
  const seedDuplicates = () => {
    const older = fake.seed(APPLICATIONS_TABLE, { authorization: AUTH, attempts: 1 }, "2026-11-01T10:00:00.000Z")
    const newer = fake.seed(APPLICATIONS_TABLE, { authorization: AUTH, attempts: 3 }, "2026-11-01T10:00:55.000Z")
    return { older, newer }
  }

  it("a later step updates the newest record by id (the upsert's multiple-match error is handled)", async () => {
    const warns: string[] = []
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warns.push(a.join(" ")))
    const { older, newer } = seedDuplicates()
    expect(await recordApplication(AUTH, { step: "otp-enviado" }, deps())).toBe(true)
    expect(newer.fields.step).toBe("otp-enviado")
    expect(older.fields.step).toBeUndefined()
    expect(rows()).toHaveLength(2) // nothing created, nothing deleted
    expect(warns.join("\n")).toContain(`[applications] otp-enviado ${AUTH.slice(0, 6)}…: 2 records share this authorization`)
    expect(warns.join("\n")).not.toContain(AUTH)
  })

  it("Step 1 counts attempts from the newest record and updates it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { newer } = seedDuplicates()
    await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())
    expect(newer.fields).toMatchObject({ attempts: 4, step: "paso1", name: "Cliente Ficticio Prueba" })
    expect(upserts()).toHaveLength(0)
  })
})

describe("recordApplication never throws, never retries, and reports failure", () => {
  it("a failed write is not retried: returns false; logs carry no personal data", async () => {
    const logs: string[] = []
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
    fake.failOn("PATCH", APPLICATIONS_TABLE, 500)
    expect(await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())).toBe(false)
    expect(upserts()).toHaveLength(1)
    expect(rows()).toHaveLength(0)
    const all = logs.join("\n")
    expect(all).toContain(`[applications] paso1 ${AUTH.slice(0, 6)}… write failed: 500`)
    for (const pii of ["3000000000101", "55550101", "Cliente Ficticio", "cliente@example.com", AUTH]) expect(all).not.toContain(pii)
  })

  it("if reading attempts fails, Step 1 is still written (without attempts)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    fake.failOn("GET", APPLICATIONS_TABLE, 503)
    expect(await recordApplication(AUTH, { step: "paso1", data: step1, client }, deps())).toBe(true)
    expect(rows()[0].fields).toMatchObject({ step: "paso1", name: "Cliente Ficticio Prueba" })
    expect(rows()[0].fields.attempts).toBeUndefined()
  })

  it("the default client is time-boxed: a hanging Airtable ends in about the budget, with false", async () => {
    vi.stubEnv("AIRTABLE_TOKEN", "test-airtable-token")
    vi.stubEnv("AIRTABLE_BASE_ID", "appTEST0000000000")
    vi.spyOn(console, "error").mockImplementation(() => {})
    // Never answers; like the real fetch, rejects when the signal aborts (or already has).
    vi.stubGlobal("fetch", ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) return reject(init.signal.reason)
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
      })) as typeof fetch)
    try {
      const started = Date.now()
      expect(await recordApplication(AUTH, { step: "paso1", data: step1, client }, { budgetMs: 150 })).toBe(false)
      expect(Date.now() - started).toBeLessThan(1500)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it("missing or malformed authorization, or no storage configured: nothing is written, false", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await recordApplication(undefined, { step: "otp-enviado" }, deps())).toBe(false)
    expect(await recordApplication("x' OR 1=1", { step: "otp-enviado" }, deps())).toBe(false)
    expect(fake.calls).toHaveLength(0)
    expect(await recordApplication(AUTH, { step: "otp-enviado" }, { airtable: null })).toBe(false)
  })
})
