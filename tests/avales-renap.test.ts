import { describe, it, expect, vi } from "vitest"
import {
  classify,
  createRenapClient,
  DEFAULT_RENAP_BASE_URL,
  normalizeBaseUrl,
  normalizeCandidates,
  normalizeName,
  officialNameOf,
  renapFromEnv,
} from "@/lib/avales/renap"

// Fictitious people only.
const DPI = "3000000000123"
const record = (overrides: Record<string, unknown> = {}) => ({
  CUI: DPI,
  PRIMER_NOMBRE: "José",
  SEGUNDO_NOMBRE: "Ángel",
  TERCER_NOMBRE: null,
  PRIMER_APELLIDO: "Pérez",
  SEGUNDO_APELLIDO: "Núñez",
  FECHA_NACIMIENTO: "1990-01-01",
  TELEFONO: "55550001",
  relevance: 10,
  ...overrides,
})
const body = (...data: unknown[]) => ({ data, meta: { pagination: { page: 1, pageSize: 10, total: data.length }, query: DPI } })
const query = { fullName: "José Ángel Pérez Núñez", identification: DPI, phone: "55550001" }

describe("name normalization and official name", () => {
  it("removes accents, upper-cases, collapses spaces and trims", () => {
    expect(normalizeName("  josé   ÁNGEL pérez  núñez ")).toBe("JOSE ANGEL PEREZ NUNEZ")
  })

  it("joins the name parts in order and skips null or empty ones", () => {
    expect(officialNameOf(record())).toBe("José Ángel Pérez Núñez")
    expect(officialNameOf(record({ SEGUNDO_NOMBRE: "", TERCER_NOMBRE: null }))).toBe("José Pérez Núñez")
    expect(officialNameOf(record({ TERCER_NOMBRE: "Luis" }))).toBe("José Ángel Luis Pérez Núñez")
  })

  it("drops zero-width characters (U+200B–U+200D, U+FEFF) and stray combining marks", () => {
    const zw = [0x200b, 0x200c, 0x200d, 0xfeff].map((cp) => String.fromCodePoint(cp))
    const acute = String.fromCodePoint(0x301)
    expect(normalizeName(`Jo${zw[0]}sé ${zw[1]}Ángel${zw[2]} Pérez${zw[3]} Núñez`)).toBe("JOSE ANGEL PEREZ NUNEZ")
    expect(normalizeName(`${acute}${zw.join("")}  `)).toBe("")
  })

  it("only { data: [...] } or a bare array are a result list; anything else is not recognized", () => {
    const c = [record()]
    expect(normalizeCandidates(c)).toEqual(c)
    expect(normalizeCandidates(body(...c))).toEqual(c)
    expect(normalizeCandidates({ data: [] })).toEqual([])
    for (const unknown of [null, "x", { error: "Forbidden" }, { data: null }, { results: c }, { data: { CUI: DPI } }]) {
      expect(normalizeCandidates(unknown)).toBeNull()
    }
  })
})

describe("classify: DPI and exact full name", () => {
  it("matches with accents and case differences and a null third name", () => {
    expect(classify(body(record()), DPI, "jose angel PEREZ nunez")).toMatchObject({
      result: "MATCH_UNICO",
      matched: true,
      officialName: "José Ángel Pérez Núñez",
    })
  })

  it("same CUI with another name → NOMBRE_NO_COINCIDE, not matched", () => {
    expect(classify(body(record()), DPI, "Otra Persona Distinta")).toEqual({
      result: "NOMBRE_NO_COINCIDE",
      matched: false,
      officialName: "José Ángel Pérez Núñez",
      raw: body(record()),
    })
  })

  it("a missing second name does not pass", () => {
    expect(classify(body(record()), DPI, "José Pérez Núñez")).toMatchObject({ result: "NOMBRE_NO_COINCIDE", matched: false })
  })

  it("the right name with another CUI does not pass", () => {
    const other = record({ CUI: "3000000000999" })
    expect(classify(body(other), DPI, query.fullName)).toEqual({ result: "SIN_RESULTADOS", matched: false, raw: body(other) })
    expect(classify(body(other, record({ CUI: "3000000000888" })), DPI, query.fullName)).toMatchObject({ result: "HOMONIMOS", matched: false })
    expect(classify(body(other), DPI, query.fullName).officialName).toBeUndefined()
  })

  it("no candidates (data: []) → SIN_RESULTADOS", () => {
    expect(classify(body(), DPI, query.fullName)).toMatchObject({ result: "SIN_RESULTADOS", matched: false })
  })

  it("an empty name never matches, even against a record without name parts", () => {
    const nameless = record({ PRIMER_NOMBRE: null, SEGUNDO_NOMBRE: "", PRIMER_APELLIDO: null, SEGUNDO_APELLIDO: null })
    const onlyMark = String.fromCodePoint(0x301)
    for (const typed of [onlyMark, "", "   ", String.fromCodePoint(0x200b)]) {
      expect(classify(body(nameless), DPI, typed)).toMatchObject({ result: "NOMBRE_NO_COINCIDE", matched: false })
      expect(classify(body(record()), DPI, typed).matched).toBe(false)
    }
  })

  it("a 200 without a recognizable result list → ERROR (not a mismatch)", () => {
    for (const unknown of [{ error: "Forbidden" }, { data: null }, { results: [record()] }, "<html>"]) {
      expect(classify(unknown, DPI, query.fullName)).toEqual({ result: "ERROR", matched: false, raw: unknown })
    }
  })

  it("a DPI that is not 13 digits never matches", () => {
    for (const dpi of ["300000000012", "30000000001234", "300000000012a", ""]) {
      const r = classify(body(record({ CUI: dpi })), dpi, query.fullName)
      expect(r.matched).toBe(false)
      expect(r.result).not.toBe("MATCH_UNICO")
    }
  })
})

describe("createRenapClient (fetch mocked, never the real API)", () => {
  const respond = (status: number, payload: unknown = body(record())) =>
    vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(payload), { status }))

  it("one GET by DPI with the exact URL and Bearer token, no login", async () => {
    const fetchMock = respond(200)
    const check = createRenapClient({ baseUrl: "https://renap.test/", token: "tok-123", fetch: fetchMock as typeof fetch })
    expect(await check(query)).toMatchObject({ result: "MATCH_UNICO", matched: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`https://renap.test/api/infos/search?q=${DPI}&limit=10&page=1`)
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-123")
    expect(init?.method ?? "GET").toBe("GET")
    expect(init?.redirect).toBe("error") // never follow a redirect with the token
  })

  it("an http base is upgraded to https (http answers 301 and fetch drops the header)", async () => {
    expect(normalizeBaseUrl("http://renap.test//")).toBe("https://renap.test")
    const fetchMock = respond(200)
    await createRenapClient({ baseUrl: "http://renap.test", token: "t", fetch: fetchMock as typeof fetch })(query)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/renap\.test\/api\/infos\/search\?/)
  })

  it("401, 403 and any non-2xx → ERROR with the status, no retry", async () => {
    for (const status of [401, 403, 500]) {
      const fetchMock = respond(status, { error: "Forbidden" })
      const check = createRenapClient({ baseUrl: "https://renap.test", token: "t", fetch: fetchMock as typeof fetch })
      expect(await check(query)).toEqual({ result: "ERROR", matched: false, raw: { error: `HTTP_${status}` } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it("a 200 whose body is not a result list → ERROR", async () => {
    const fetchMock = respond(200, { error: "Acceso denegado." })
    const check = createRenapClient({ baseUrl: "https://renap.test", token: "t", fetch: fetchMock as typeof fetch })
    expect(await check(query)).toMatchObject({ result: "ERROR", matched: false })
  })

  it("timeouts and network failures → ERROR, never a throw", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" })
    const t = createRenapClient({ baseUrl: "https://renap.test", token: "t", fetch: (async () => Promise.reject(timeout)) as typeof fetch })
    expect(await t(query)).toEqual({ result: "ERROR", matched: false, raw: { error: "TIMEOUT" } })
    const n = createRenapClient({ baseUrl: "https://renap.test", token: "t", fetch: (async () => Promise.reject(new Error("down"))) as typeof fetch })
    expect(await n(query)).toEqual({ result: "ERROR", matched: false, raw: { error: "REQUEST_FAILED" } })
  })
})

describe("renapFromEnv: no simulation", () => {
  it("with the bypass and without a token → null (accept answers unavailable)", () => {
    expect(renapFromEnv({ ENABLE_TEST_BYPASS: "true", NODE_ENV: "development" })).toBeNull()
    expect(renapFromEnv({ NODE_ENV: "production" })).toBeNull()
  })

  it("with a token → the real client, also with the bypass on; the default base is https", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body(record())), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      const check = renapFromEnv({ ENABLE_TEST_BYPASS: "true", NODE_ENV: "development", RENAP_TOKEN: "tok" })
      expect(check).not.toBeNull()
      expect(await check!(query)).toMatchObject({ result: "MATCH_UNICO" })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(String(url).startsWith(`${DEFAULT_RENAP_BASE_URL}/api/infos/search?q=${DPI}`)).toBe(true)
      expect(DEFAULT_RENAP_BASE_URL.startsWith("https://")).toBe(true)
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok")

      await renapFromEnv({ RENAP_TOKEN: "tok", RENAP_BASE_URL: "http://other.test" })!(query)
      expect(String((fetchMock.mock.calls[1] as unknown as [string])[0])).toMatch(/^https:\/\/other\.test\//)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
