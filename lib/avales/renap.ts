import { isSimulation, type Env } from "./runtime"

/**
 * Identity check of a guarantor against RENAP through the GTS API (contract §6). Server-side only:
 * the endpoint is plain HTTP and must never be called from the browser.
 *
 * A guarantor is authorized only if some candidate's `CUI` equals the DPI they gave. Several
 * candidates with that CUI are not ambiguous. Homonyms without a matching CUI never authorize.
 * The raw response is always returned so it can be stored in `renap-raw`.
 *
 * Privacy: never log names, DPI, phones, the JWT or the response.
 */

export type RenapResult = "MATCH_UNICO" | "HOMONIMOS" | "SIN_RESULTADOS" | "ERROR"

export interface RenapQuery {
  fullName: string
  identification: string
  phone: string
}

export interface RenapOutcome {
  result: RenapResult
  matched: boolean
  /** Official name of the matching candidate, when there is one. */
  officialName?: string
  raw: unknown
}

export type RenapChecker = (query: RenapQuery) => Promise<RenapOutcome>

type Candidate = Record<string, unknown>

const NAME_FIELDS = ["NOMBRE_COMPLETO", "NOMBRE", "nombre_completo", "nombre", "name", "fullName"]

function candidateName(c: Candidate): string | undefined {
  for (const key of NAME_FIELDS) {
    const value = c[key]
    if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ")
  }
  return undefined
}

/** Accepts an array, `{ data: [...] }` or `{ results: [...] }`. */
export function normalizeCandidates(body: unknown): Candidate[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { data?: unknown }).data ?? (body as { results?: unknown }).results)
      : undefined
  return Array.isArray(list) ? list.filter((c): c is Candidate => !!c && typeof c === "object") : []
}

/** Classifies a search response for one DPI. */
export function classify(body: unknown, identification: string): RenapOutcome {
  const candidates = normalizeCandidates(body)
  const matches = candidates.filter((c) => String(c.CUI ?? c.cui ?? "").replace(/\D/g, "") === identification)
  if (matches.length > 0) return { result: "MATCH_UNICO", matched: true, officialName: candidateName(matches[0]), raw: body }
  return { result: candidates.length > 1 ? "HOMONIMOS" : "SIN_RESULTADOS", matched: false, raw: body }
}

/**
 * Simulation (test bypass only): matches, except a DPI ending in 0000 (no match) or 9999 (error).
 */
export const simulatedRenap: RenapChecker = async ({ fullName, identification, phone }) => {
  if (identification.endsWith("9999")) return { result: "ERROR", matched: false, raw: { simulated: true, error: "SIMULATED_ERROR" } }
  if (identification.endsWith("0000")) return classify({ simulated: true, results: [] }, identification)
  return classify(
    { simulated: true, results: [{ CUI: identification, NOMBRE_COMPLETO: fullName.toUpperCase(), TELEFONO: phone }] },
    identification,
  )
}

export interface RenapClientOptions {
  baseUrl: string
  identifier: string
  password: string
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

const JWT_TTL_MS = 50 * 60 * 1000

/** Real GTS client: JWT kept in memory for 50 min, one retry after a 401, 25 s timeout. */
export function createRenapClient(options: RenapClientOptions): RenapChecker {
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 25_000
  const base = options.baseUrl.replace(/\/+$/, "")
  let jwt: { value: string; expiresAt: number } | null = null

  async function authenticate(): Promise<string> {
    const res = await doFetch(`${base}/api/auth/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: options.identifier, password: options.password }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`RENAP auth failed: ${res.status}`)
    const body = (await res.json()) as { jwt?: unknown }
    if (typeof body.jwt !== "string" || !body.jwt) throw new Error("RENAP auth returned no token")
    jwt = { value: body.jwt, expiresAt: now() + JWT_TTL_MS }
    return body.jwt
  }

  async function search(name: string, token: string) {
    return doFetch(`${base}/api/infos/search?q=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  return async ({ fullName, identification }) => {
    try {
      let token = jwt && jwt.expiresAt > now() ? jwt.value : await authenticate()
      let res = await search(fullName, token)
      if (res.status === 401) {
        jwt = null
        token = await authenticate()
        res = await search(fullName, token)
      }
      if (!res.ok) return { result: "ERROR", matched: false, raw: { error: `HTTP_${res.status}` } }
      return classify(await res.json(), identification)
    } catch (error) {
      const type = error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "REQUEST_FAILED"
      return { result: "ERROR", matched: false, raw: { error: type } }
    }
  }
}

let cachedClient: { key: string; checker: RenapChecker } | null = null

/**
 * Simulated with the test bypass; real with RENAP_* credentials; otherwise null (→ unavailable).
 * The real client is reused across calls so its JWT stays cached for 50 min.
 */
export function renapFromEnv(env: Env = process.env): RenapChecker | null {
  if (isSimulation(env)) return simulatedRenap
  const { RENAP_BASE_URL, RENAP_IDENTIFIER, RENAP_PASSWORD } = env
  if (!RENAP_BASE_URL || !RENAP_IDENTIFIER || !RENAP_PASSWORD) return null
  const key = `${RENAP_BASE_URL}|${RENAP_IDENTIFIER}`
  if (cachedClient?.key !== key) {
    cachedClient = { key, checker: createRenapClient({ baseUrl: RENAP_BASE_URL, identifier: RENAP_IDENTIFIER, password: RENAP_PASSWORD }) }
  }
  return cachedClient.checker
}
