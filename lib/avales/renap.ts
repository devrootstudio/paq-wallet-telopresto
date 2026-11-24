/**
 * Identity check of a guarantor against RENAP through the GTS API (contract §6). Server-side only.
 *
 * One request per check: `GET {base}/api/infos/search?q=<DPI>&limit=10&page=1` with
 * `Authorization: Bearer <RENAP_TOKEN>` (no login, no session). The base is always https: the http
 * endpoint answers 301 and fetch drops the Authorization header when following it.
 *
 * A guarantor is authorized only if some candidate has `CUI` equal to the DPI they gave AND an
 * official name equal to the full name they typed, after normalizing both (no accents, upper case,
 * single spaces). Same CUI with another name → `NOMBRE_NO_COINCIDE` (handled as identity mismatch).
 * There is no simulation: without RENAP_TOKEN the check is unavailable, test bypass or not.
 * The raw response is always returned so it can be stored in `renap-raw`.
 *
 * Privacy: never log names, DPI, phones, the token or the response.
 */

import type { Env } from "./runtime"

export type RenapResult = "MATCH_UNICO" | "NOMBRE_NO_COINCIDE" | "HOMONIMOS" | "SIN_RESULTADOS" | "ERROR"

export interface RenapQuery {
  fullName: string
  identification: string
  phone: string
}

export interface RenapOutcome {
  result: RenapResult
  matched: boolean
  /** Official name of the candidate whose CUI matches the DPI, when there is one. */
  officialName?: string
  raw: unknown
}

export type RenapChecker = (query: RenapQuery) => Promise<RenapOutcome>

type Candidate = Record<string, unknown>

/** Origin of the GTS API (scheme + host only; the path is added here). RENAP_BASE_URL overrides it. */
export const DEFAULT_RENAP_BASE_URL = "https://api-info.gts-guatemala.com"

/** Name parts of a RENAP record, in order. TERCER_NOMBRE and others may be null or empty. */
const NAME_PARTS = ["PRIMER_NOMBRE", "SEGUNDO_NOMBRE", "TERCER_NOMBRE", "PRIMER_APELLIDO", "SEGUNDO_APELLIDO"] as const

/** Combining diacritical marks (left over after NFD), dropped when normalizing. */
const COMBINING_FIRST = 0x300
const COMBINING_LAST = 0x36f
/** Zero-width space, non-joiner, joiner and BOM, dropped when normalizing. */
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff])

/**
 * Upper case, no diacritics, no zero-width characters, single spaces, trimmed.
 * Built from code points (no invisible characters or escapes in this source).
 */
export function normalizeName(name: string): string {
  return Array.from(name.normalize("NFD"))
    .filter((ch) => {
      const cp = ch.codePointAt(0)!
      return !(cp >= COMBINING_FIRST && cp <= COMBINING_LAST) && !ZERO_WIDTH.has(cp)
    })
    .join("")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Official name of a record: its name parts in order, skipping null or empty ones. */
export function officialNameOf(c: Candidate): string {
  return NAME_PARTS.map((key) => c[key])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim())
    .join(" ")
    .replace(/\s+/g, " ")
}

/**
 * The candidates of a search response, or null when the body is not a recognizable result list.
 * Only `{ data: [...] }` or a bare array count (`data: []` is a valid empty result).
 */
export function normalizeCandidates(body: unknown): Candidate[] | null {
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? (body as { data?: unknown }).data : undefined
  return Array.isArray(list) ? list.filter((c): c is Candidate => !!c && typeof c === "object") : null
}

const DPI_PATTERN = /^\d{13}$/

/**
 * Classifies a search response for one DPI and the full name the guarantor typed:
 * - `MATCH_UNICO`: a candidate has that CUI and the same normalized full name (non-empty);
 * - `NOMBRE_NO_COINCIDE`: a candidate has that CUI but another name;
 * - `HOMONIMOS`: several candidates, none with that CUI (the search is by DPI, so these are other people);
 * - `SIN_RESULTADOS`: no candidate with that CUI (zero or one candidate);
 * - `ERROR`: the body is not a recognizable result list.
 * A DPI that is not 13 digits never matches.
 */
export function classify(body: unknown, identification: string, fullName: string): RenapOutcome {
  const candidates = normalizeCandidates(body)
  if (!candidates) return { result: "ERROR", matched: false, raw: body }
  const sameCui = DPI_PATTERN.test(identification)
    ? candidates.filter((c) => String(c.CUI ?? c.cui ?? "").replace(/\D/g, "") === identification)
    : []
  if (sameCui.length > 0) {
    const wanted = normalizeName(fullName)
    // An empty name (blank, or only marks / zero-width characters) never matches anything.
    const match = wanted === "" ? undefined : sameCui.find((c) => {
      const official = normalizeName(officialNameOf(c))
      return official !== "" && official === wanted
    })
    if (match) return { result: "MATCH_UNICO", matched: true, officialName: officialNameOf(match), raw: body }
    return { result: "NOMBRE_NO_COINCIDE", matched: false, officialName: officialNameOf(sameCui[0]), raw: body }
  }
  return { result: candidates.length > 1 ? "HOMONIMOS" : "SIN_RESULTADOS", matched: false, raw: body }
}

export interface RenapClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/** https base without trailing slashes (an http base is upgraded: its 301 would drop the header). */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/^http:\/\//i, "https://").replace(/\/+$/, "")
}

/** Real GTS client: one GET per check, Bearer token, 25 s timeout. Never throws. */
export function createRenapClient(options: RenapClientOptions): RenapChecker {
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 25_000
  const base = normalizeBaseUrl(options.baseUrl)

  return async ({ fullName, identification }) => {
    try {
      const res = await doFetch(`${base}/api/infos/search?q=${encodeURIComponent(identification)}&limit=10&page=1`, {
        headers: { Authorization: `Bearer ${options.token}` },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        // Never follow a redirect: it would drop or leak the Authorization header.
        redirect: "error",
      })
      if (!res.ok) return { result: "ERROR", matched: false, raw: { error: `HTTP_${res.status}` } }
      return classify(await res.json(), identification, fullName)
    } catch (error) {
      const type = error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "REQUEST_FAILED"
      return { result: "ERROR", matched: false, raw: { error: type } }
    }
  }
}

/**
 * The real client when RENAP_TOKEN is set (RENAP_BASE_URL optional: the origin only, scheme + host,
 * no path; https by default), whatever
 * the test bypass says; otherwise null, and `accept` answers `unavailable`.
 */
export function renapFromEnv(env: Env = process.env): RenapChecker | null {
  const token = env.RENAP_TOKEN
  if (!token) return null
  return createRenapClient({ baseUrl: env.RENAP_BASE_URL || DEFAULT_RENAP_BASE_URL, token })
}
