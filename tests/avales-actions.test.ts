import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cookieJar } from "./setup"
import { createFakeAirtable } from "./avales-fake-airtable"
import { generateToken, hashToken } from "@/lib/avales/tokens"
import { DECLARATION_TEXT } from "@/lib/avales/declaration"
import type { GuarantorRequestInput } from "@/lib/avales/types"
import { answerGuarantor, getGuarantorView, getRutaAction, submitGuarantorRequest } from "@/app/avales-actions"

const PII = [
  "55559999",
  "1000000000001",
  "55550001",
  "55550002",
  "55550003",
  "0000000000001",
  "0000000000002",
  "0000000000003",
  "Solicitante De Prueba",
  "Aval Uno",
  "test-airtable-token",
]

function input(authorization = "TEST-AVALES-actions-0001"): GuarantorRequestInput {
  return {
    authorization,
    applicant: {
      phone: "55559999",
      identification: "1000000000001",
      fullName: "Solicitante De Prueba",
      email: "solicitante@example.com",
      company: "Empresa Ficticia",
      age: "30",
      maritalStatus: "Soltero",
      address: "Ciudad",
    },
    cupoId: "CUPO-1",
    approvedAmount: 3500,
    requestedAmount: 1000,
    commission: 75,
    commissionPct: 7.5,
    audit: { fingerprint: "fp", screenResolution: "390x844", idiomaBrowser: "es-GT", ipInfo: null, otpHash: "abc" },
    guarantors: [
      { fullName: "Aval Uno", phone: "55550001", identification: "0000000000001", relationship: "hermano/a" },
      { fullName: "Aval Dos", phone: "55550002", identification: "0000000000002", relationship: "amigo/a" },
      { fullName: "Aval Tres", phone: "55550003", identification: "0000000000003", relationship: "otro" },
    ],
  }
}

let fake: ReturnType<typeof createFakeAirtable>
let logs: string[]

beforeEach(() => {
  cookieJar.clear()
  fake = createFakeAirtable()
  vi.stubGlobal("fetch", fake.fetch)
  vi.stubEnv("AIRTABLE_TOKEN", "test-airtable-token")
  vi.stubEnv("AIRTABLE_BASE_ID", "appTEST0000000000")
  vi.stubEnv("TELOPRESTO_RUTA", "")
  logs = []
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function expectNoPiiInLogs(extra: string[] = []) {
  const all = logs.join("\n")
  for (const value of [...PII, ...extra]) expect(all).not.toContain(value)
}

describe("getRutaAction", () => {
  it("is aval by default and normal only when set to normal", async () => {
    expect(await getRutaAction()).toBe("aval")
    vi.stubEnv("TELOPRESTO_RUTA", "normal")
    expect(await getRutaAction()).toBe("normal")
    vi.stubEnv("TELOPRESTO_RUTA", "otra-cosa")
    expect(await getRutaAction()).toBe("aval")
  })
})

describe("submitGuarantorRequest", () => {
  it("stores the request and is safe to resubmit", async () => {
    const first = await submitGuarantorRequest(input())
    const requestId = fake.rows("requests")[0].id
    expect(fake.rows("requests")[0].fields.test).toBeUndefined() // not in simulation → real request
    expect(first).toEqual({ ok: true, requestId, expiresAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), requestedAmount: 1000, reused: false, open: true })
    const second = await submitGuarantorRequest(input())
    expect(second).toEqual({ ...first, reused: true })
    expect(fake.rows("requests")).toHaveLength(1)
    expect(fake.rows("guarantors")).toHaveLength(3)
    expectNoPiiInLogs()
  })

  it("rejects a request without a valid security token", async () => {
    cookieJar.set("app-security-token", "forged.signature")
    expect(await submitGuarantorRequest(input())).toEqual({ ok: false, code: "unauthorized" })
    expect(fake.calls).toHaveLength(0)
  })

  it("double click on the same instance shares one call", async () => {
    const [a, b] = await Promise.all([submitGuarantorRequest(input()), submitGuarantorRequest(input())])
    expect(a.ok && b.ok && a.requestId === b.requestId).toBe(true)
    expect(fake.rows("requests")).toHaveLength(1)
    expect(fake.rows("guarantors")).toHaveLength(3)
    expect(fake.calls.filter((c) => c.method !== "GET")).toHaveLength(3) // request upsert + guarantor upsert + guarantor init, once
  })

  it("returns field errors in Spanish and writes nothing", async () => {
    const bad = input()
    bad.guarantors[1].phone = bad.guarantors[0].phone
    const res = await submitGuarantorRequest(bad)
    expect(res).toEqual({
      ok: false,
      code: "validation",
      fieldErrors: {
        "guarantors.0.phone": "Este teléfono ya está en otro aval",
        "guarantors.1.phone": "Este teléfono ya está en otro aval",
      },
    })
    expect(fake.calls).toHaveLength(0)
  })

  it("refuses when the route is normal", async () => {
    vi.stubEnv("TELOPRESTO_RUTA", "normal")
    expect(await submitGuarantorRequest(input())).toEqual({ ok: false, code: "route_disabled" })
    expect(fake.calls).toHaveLength(0)
  })

  it("is unavailable without storage configuration", async () => {
    vi.stubEnv("AIRTABLE_TOKEN", "")
    expect(await submitGuarantorRequest(input())).toEqual({ ok: false, code: "unavailable" })
    expect(fake.calls).toHaveLength(0)
  })

  it("on a storage error answers unavailable and logs no PII nor response body", async () => {
    fake.failNext(500, JSON.stringify({ error: { type: "SERVER_ERROR", message: "echo 0000000000001 55550001 Aval Uno" } }))
    expect(await submitGuarantorRequest(input())).toEqual({ ok: false, code: "unavailable" })
    expect(logs.join("\n")).toContain("[avales] submit failed: 500 SERVER_ERROR")
    expectNoPiiInLogs()
  })

  it("a partial failure answers unavailable and the retry completes it", async () => {
    fake.failOn("PATCH", "guarantors", 503)
    expect(await submitGuarantorRequest(input())).toEqual({ ok: false, code: "unavailable" })
    const retry = await submitGuarantorRequest(input())
    expect(retry).toMatchObject({ ok: true, reused: true, open: true })
    expect(fake.rows("guarantors").filter((g) => g.fields.status === "pending")).toHaveLength(3)
  })
})

describe("getGuarantorView", () => {
  it("answers invalid for a malformed token without storage, even when it is not configured", async () => {
    vi.stubEnv("AIRTABLE_TOKEN", "")
    vi.stubEnv("AIRTABLE_BASE_ID", "")
    for (const token of ["not-a-token", "", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`]) {
      expect(await getGuarantorView(token)).toEqual({ screen: "invalid" })
    }
    expect(fake.calls).toHaveLength(0)
    expect(logs).toEqual([])
  })

  it("resolves a token and never logs it", async () => {
    await submitGuarantorRequest(input())
    const token = generateToken()
    const g = fake.rows("guarantors")[0]
    g.fields["token-hash"] = hashToken(token)
    expect(await getGuarantorView(token)).toMatchObject({ screen: "form", applicantName: "Solicitante De Prueba", applicantFirstName: "Solicitante", amount: 1000 })
    expect(await getGuarantorView(generateToken())).toEqual({ screen: "invalid" })
    expectNoPiiInLogs([token])
  })

  it("throws a generic error when storage fails, without the token", async () => {
    const token = generateToken()
    fake.failNext(503, "upstream said 55550001")
    await expect(getGuarantorView(token)).rejects.toThrow(/^Guarantor view unavailable$/)
    expectNoPiiInLogs([token])
  })
})

describe("answerGuarantor", () => {
  async function linkForFirstGuarantor() {
    await submitGuarantorRequest(input())
    const token = generateToken()
    fake.rows("guarantors")[0].fields["token-hash"] = hashToken(token)
    return token
  }
  const confirm = { fullName: "Aval Uno", identification: "0000000000001", phone: "55550001", acceptedText: DECLARATION_TEXT }

  it("with the test bypass, accepts through simulated RENAP and logs no PII nor token", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    const token = await linkForFirstGuarantor()
    expect(await answerGuarantor(token, "accept", confirm)).toEqual({ ok: true, status: "authorized" })
    expect(fake.rows("guarantors")[0].fields.status).toBe("authorized")
    expect(fake.rows("requests")[0].fields.test).toBe(true) // created in simulation → test data
    expect(await answerGuarantor(token, "reject", { fullName: "", identification: "", phone: "" })).toEqual({ ok: false, code: "closed" })
    expectNoPiiInLogs([token])
  })

  it("never simulates in production: without RENAP credentials, accept is unavailable", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    vi.stubEnv("NODE_ENV", "production")
    const token = await linkForFirstGuarantor()
    expect(await answerGuarantor(token, "accept", confirm)).toEqual({ ok: false, code: "unavailable" })
    expect(fake.rows("guarantors")[0].fields.status).toBe("pending")
  })

  it("answers invalid for a malformed token without storage", async () => {
    vi.stubEnv("AIRTABLE_TOKEN", "")
    expect(await answerGuarantor("nope", "reject", { fullName: "", identification: "", phone: "" })).toEqual({ ok: false, code: "invalid" })
    expect(fake.calls).toHaveLength(0)
  })
})
