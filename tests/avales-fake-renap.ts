/**
 * Test doubles for RENAP (fictitious data only). The app has no RENAP simulation: these exist only
 * in tests.
 */
import { classify, type RenapChecker } from "@/lib/avales/renap"

/**
 * A RENAP-shaped record for a fictitious full name: 2 words = name + surname; 3 = two names + surname;
 * 4 or more = two names + two surnames (the rest joined to the second surname). No third name.
 */
export function renapRecord(cui: string, fullName: string): Record<string, unknown> {
  const w = fullName.toUpperCase().split(/\s+/).filter(Boolean)
  const [n1, n2, a1, a2] =
    w.length <= 2 ? [w[0], null, w[1] ?? null, null] : w.length === 3 ? [w[0], w[1], w[2], null] : [w[0], w[1], w[2], w.slice(3).join(" ")]
  return { CUI: cui, PRIMER_NOMBRE: n1, SEGUNDO_NOMBRE: n2, TERCER_NOMBRE: null, PRIMER_APELLIDO: a1, SEGUNDO_APELLIDO: a2, relevance: 1 }
}

/**
 * Checker for flow tests: the DPI is found with the typed name, except a DPI ending in 0000 (found
 * with another name → NOMBRE_NO_COINCIDE) or 9999 (the API fails → ERROR).
 */
export const fakeRenap: RenapChecker = async ({ fullName, identification }) => {
  if (identification.endsWith("9999")) return { result: "ERROR", matched: false, raw: { error: "HTTP_500" } }
  const name = identification.endsWith("0000") ? "OTRA PERSONA DISTINTA" : fullName
  return classify({ data: [renapRecord(identification, name)], meta: {} }, identification, fullName)
}

export interface RenapCall {
  url: string
  authorization?: string
}

/**
 * Wraps a fetch (e.g. the fake Airtable) so RENAP search requests are answered like the real API:
 * each DPI in `people` is found with that name; any other DPI gives an empty result.
 */
export function withFakeRenapApi(inner: typeof fetch, people: Record<string, string>, calls: RenapCall[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === "/api/infos/search") {
      calls.push({ url: url.toString(), authorization: (init?.headers as Record<string, string> | undefined)?.Authorization })
      const dpi = url.searchParams.get("q") ?? ""
      const data = people[dpi] ? [renapRecord(dpi, people[dpi])] : []
      return new Response(JSON.stringify({ data, meta: { pagination: { page: 1, pageSize: 10, total: data.length }, query: dpi } }), { status: 200 })
    }
    return inner(input, init)
  }) as typeof fetch
}
