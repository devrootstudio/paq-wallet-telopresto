import { describe, it, expect, vi } from "vitest"
import { classify, createRenapClient, normalizeCandidates, renapFromEnv, simulatedRenap } from "@/lib/avales/renap"

const DPI = "0000000000123"
const query = { fullName: "Persona Ficticia", identification: DPI, phone: "55550001" }

describe("classify", () => {
  it("normalizes an array, { data } or { results }", () => {
    const c = [{ CUI: DPI }]
    expect(normalizeCandidates(c)).toEqual(c)
    expect(normalizeCandidates({ data: c })).toEqual(c)
    expect(normalizeCandidates({ results: c })).toEqual(c)
    expect(normalizeCandidates(null)).toEqual([])
    expect(normalizeCandidates({ other: 1 })).toEqual([])
  })

  it("authorizes only when some candidate's CUI equals the DPI", () => {
    expect(classify([{ CUI: "0000000000999" }, { CUI: DPI, NOMBRE_COMPLETO: "PERSONA  FICTICIA" }], DPI)).toMatchObject({
      result: "MATCH_UNICO",
      matched: true,
      officialName: "PERSONA FICTICIA",
    })
    expect(classify([{ CUI: DPI }, { CUI: DPI }], DPI)).toMatchObject({ result: "MATCH_UNICO", matched: true })
    expect(classify([{ CUI: "1" }, { CUI: "2" }], DPI)).toMatchObject({ result: "HOMONIMOS", matched: false })
    expect(classify([{ CUI: "1" }], DPI)).toMatchObject({ result: "SIN_RESULTADOS", matched: false })
    expect(classify([], DPI)).toMatchObject({ result: "SIN_RESULTADOS", matched: false })
  })

  it("always keeps the raw response", () => {
    const body = { results: [{ CUI: DPI }] }
    expect(classify(body, DPI).raw).toBe(body)
  })
})

describe("simulatedRenap", () => {
  it("matches, except DPI ending in 0000 (no match) or 9999 (error)", async () => {
    expect(await simulatedRenap(query)).toMatchObject({ result: "MATCH_UNICO", matched: true })
    expect(await simulatedRenap({ ...query, identification: "1234567890000" })).toMatchObject({ result: "SIN_RESULTADOS", matched: false })
    expect(await simulatedRenap({ ...query, identification: "1234567899999" })).toMatchObject({ result: "ERROR", matched: false })
  })
})

describe("createRenapClient (real GTS API, fetch mocked)", () => {
  function server(opts: { searchStatuses?: number[]; body?: unknown } = {}) {
    const statuses = [...(opts.searchStatuses ?? [200])]
    const calls: { url: string; auth?: string; body?: string }[] = []
    let issued = 0
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body as string | undefined })
      if (u.endsWith("/api/auth/local")) return new Response(JSON.stringify({ jwt: `jwt-${++issued}` }), { status: 200 })
      const status = statuses.shift() ?? 200
      return new Response(JSON.stringify(opts.body ?? { data: [{ CUI: DPI, NOMBRE: "PERSONA FICTICIA" }] }), { status })
    })
    return { fetchMock, calls }
  }

  it("authenticates, searches by full name and classifies", async () => {
    const { fetchMock, calls } = server()
    const check = createRenapClient({ baseUrl: "http://renap.test/", identifier: "id", password: "pw", fetch: fetchMock as typeof fetch })
    expect(await check(query)).toMatchObject({ result: "MATCH_UNICO", matched: true, officialName: "PERSONA FICTICIA" })
    expect(calls[0]).toMatchObject({ url: "http://renap.test/api/auth/local", body: JSON.stringify({ identifier: "id", password: "pw" }) })
    expect(calls[1]).toMatchObject({ url: "http://renap.test/api/infos/search?q=Persona%20Ficticia", auth: "Bearer jwt-1" })
  })

  it("keeps the JWT for 50 minutes", async () => {
    let t = 0
    const { fetchMock, calls } = server()
    const check = createRenapClient({ baseUrl: "http://renap.test", identifier: "i", password: "p", fetch: fetchMock as typeof fetch, now: () => t })
    await check(query)
    t = 49 * 60 * 1000
    await check(query)
    expect(calls.filter((c) => c.url.endsWith("/auth/local"))).toHaveLength(1)
    t = 51 * 60 * 1000
    await check(query)
    expect(calls.filter((c) => c.url.endsWith("/auth/local"))).toHaveLength(2)
  })

  it("re-authenticates once after a 401, and reports ERROR if it fails again", async () => {
    const retried = server({ searchStatuses: [401, 200] })
    const ok = createRenapClient({ baseUrl: "http://renap.test", identifier: "i", password: "p", fetch: retried.fetchMock as typeof fetch })
    expect(await ok(query)).toMatchObject({ matched: true })
    expect(retried.calls.map((c) => c.auth).filter(Boolean)).toEqual(["Bearer jwt-1", "Bearer jwt-2"])

    const twice = server({ searchStatuses: [401, 401] })
    const bad = createRenapClient({ baseUrl: "http://renap.test", identifier: "i", password: "p", fetch: twice.fetchMock as typeof fetch })
    expect(await bad(query)).toEqual({ result: "ERROR", matched: false, raw: { error: "HTTP_401" } })
    expect(twice.calls.filter((c) => c.url.includes("/search"))).toHaveLength(2)
  })

  it("network failures and timeouts become ERROR, never a throw", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" })
    const check = createRenapClient({ baseUrl: "http://renap.test", identifier: "i", password: "p", fetch: (async () => Promise.reject(timeout)) as typeof fetch })
    expect(await check(query)).toEqual({ result: "ERROR", matched: false, raw: { error: "TIMEOUT" } })
  })
})

describe("renapFromEnv", () => {
  it("simulated only with the bypass outside production; real with credentials; otherwise null", () => {
    expect(renapFromEnv({ ENABLE_TEST_BYPASS: "true", NODE_ENV: "development" })).toBe(simulatedRenap)
    expect(renapFromEnv({ ENABLE_TEST_BYPASS: "true", NODE_ENV: "production" })).toBeNull()
    expect(renapFromEnv({ NODE_ENV: "development" })).toBeNull()
    const real = renapFromEnv({ NODE_ENV: "production", RENAP_BASE_URL: "http://r", RENAP_IDENTIFIER: "i", RENAP_PASSWORD: "p" })
    expect(real).not.toBeNull()
    expect(real).not.toBe(simulatedRenap)
  })
})
