import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createFakeAirtable } from "./avales-fake-airtable"
import { DEV_JOBS_SECRET } from "@/lib/avales/runtime"
import { POST } from "@/app/api/jobs/guarantors/route"

let fake: ReturnType<typeof createFakeAirtable>

beforeEach(() => {
  fake = createFakeAirtable()
  vi.stubGlobal("fetch", fake.fetch)
  vi.stubEnv("AIRTABLE_TOKEN", "test-airtable-token")
  vi.stubEnv("AIRTABLE_BASE_ID", "appTEST0000000000")
  vi.stubEnv("JOBS_SECRET", "")
  vi.stubEnv("ENABLE_TEST_BYPASS", "")
  vi.stubEnv("APP_BASE_URL", "")
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const call = (auth?: string) =>
  POST(new Request("http://localhost:3020/api/jobs/guarantors", { method: "POST", headers: auth ? { Authorization: auth } : {} }))

function seedPendingGuarantor(authorization = "TEST-AVALES-route") {
  const req = fake.seed("requests", { authorization, status: "pending_guarantors", "expires-at": "2999-01-01T00:00:00.000Z", phone: "55559999" })
  fake.seed("guarantors", { slot: `${req.id}:1`, request: [req.id], position: 1, phone: "55550001", status: "pending" })
}

describe("POST /api/jobs/guarantors", () => {
  it("refuses every call when JOBS_SECRET is missing outside simulation", async () => {
    const res = await call(`Bearer ${DEV_JOBS_SECRET}`)
    expect(res.status).toBe(503)
    expect(fake.calls).toHaveLength(0)
  })

  it("outside simulation requires APP_BASE_URL (links never built from the caller's origin)", async () => {
    vi.stubEnv("JOBS_SECRET", "s3cret")
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await call("Bearer s3cret")).status).toBe(503)
  })

  it("requires the exact bearer secret", async () => {
    vi.stubEnv("JOBS_SECRET", "s3cret")
    vi.stubEnv("APP_BASE_URL", "https://app.example")
    expect((await call()).status).toBe(401)
    expect((await call("Bearer wrong")).status).toBe(401)
    expect((await call("s3cret")).status).toBe(401)
    expect(fake.calls).toHaveLength(0)
    const ok = await call("Bearer s3cret")
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, simulation: false })
  })

  it("in simulation accepts the development secret and returns the invitation links built from the request origin", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    seedPendingGuarantor()
    const res = await call(`Bearer ${DEV_JOBS_SECRET}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, simulation: true, invited: 1 })
    expect(body.links[0].url).toMatch(/^http:\/\/localhost:3020\/aval\/[A-Za-z0-9_-]{43}$/)
  })

  it("uses APP_BASE_URL for links when set", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    vi.stubEnv("APP_BASE_URL", "https://app.example/")
    seedPendingGuarantor()
    const body = await (await call(`Bearer ${DEV_JOBS_SECRET}`)).json()
    expect(body.links[0].url).toMatch(/^https:\/\/app\.example\/aval\//)
  })

  it("in production with the bypass on: no development secret, no links, and no invitation while WhatsApp is not integrated", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    vi.stubEnv("NODE_ENV", "production")
    seedPendingGuarantor("REAL-route-0001")
    expect((await call(`Bearer ${DEV_JOBS_SECRET}`)).status).toBe(503)
    vi.stubEnv("JOBS_SECRET", "prod-secret")
    vi.stubEnv("APP_BASE_URL", "https://app.example")
    const body = await (await call("Bearer prod-secret")).json()
    expect(body).toMatchObject({ ok: true, simulation: false, invited: 0 })
    expect(fake.rows("guarantors")[0].fields.status).toBe("pending")
    expect(body.links).toBeUndefined()
  })

  it("answers 409 while a run is in progress on this instance", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    seedPendingGuarantor()
    const [a, b] = await Promise.all([call(`Bearer ${DEV_JOBS_SECRET}`), call(`Bearer ${DEV_JOBS_SECRET}`)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
  })

  it("simulation is refused when NODE_ENV is not development or test", async () => {
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    vi.stubEnv("NODE_ENV", "staging")
    expect((await call(`Bearer ${DEV_JOBS_SECRET}`)).status).toBe(503)
  })

  it("is unavailable without storage configuration", async () => {
    vi.stubEnv("JOBS_SECRET", "s3cret")
    vi.stubEnv("AIRTABLE_TOKEN", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await call("Bearer s3cret")).status).toBe(503)
  })
})
