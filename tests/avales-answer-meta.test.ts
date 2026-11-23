import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// This file needs request headers; the shared setup only mocks cookies.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () =>
    new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Mozilla/5.0 (iPhone) TestPhone/1.0" }),
}))

import { createFakeAirtable } from "./avales-fake-airtable"
import { generateToken, hashToken } from "@/lib/avales/tokens"
import { DECLARATION_TEXT } from "@/lib/avales/declaration"
import { answerGuarantor } from "@/app/avales-actions"

let fake: ReturnType<typeof createFakeAirtable>

beforeEach(() => {
  fake = createFakeAirtable()
  vi.stubGlobal("fetch", fake.fetch)
  vi.stubEnv("AIRTABLE_TOKEN", "test-airtable-token")
  vi.stubEnv("AIRTABLE_BASE_ID", "appTEST0000000000")
  vi.stubEnv("ENABLE_TEST_BYPASS", "true")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("answerGuarantor evidence", () => {
  it("stores the client IP (first X-Forwarded-For hop) and the user agent", async () => {
    const req = fake.seed("requests", { status: "pending_guarantors", "expires-at": "2999-01-01T00:00:00.000Z", phone: "55559999", identification: "1000000000001" })
    const token = generateToken()
    fake.seed("guarantors", { slot: `${req.id}:1`, request: [req.id], position: 1, status: "invited", "token-hash": hashToken(token) })

    const res = await answerGuarantor(token, "accept", { fullName: "Aval Uno", identification: "2000000000001", phone: "55550001", acceptedText: DECLARATION_TEXT })
    expect(res).toEqual({ ok: true, status: "authorized" })
    const evidence = JSON.parse(fake.rows("guarantors")[0].fields.evidence as string)
    expect(evidence).toMatchObject({ ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone) TestPhone/1.0" })
  })
})
