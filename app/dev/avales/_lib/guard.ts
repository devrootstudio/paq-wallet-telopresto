import { isSimulation } from "@/lib/avales/runtime"

/**
 * Development tools for the guarantor route (/dev/avales/*). They exist only while running
 * `next dev` with the test bypass (simulation): anywhere else every page and endpoint is a 404.
 */
export function devToolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development" && isSimulation(env)
}

/** Test requests are always marked: authorization `TEST-AVALES-<id>` (letters, digits, `-`, `_`). */
export const TEST_AUTHORIZATION = /^TEST-AVALES-[A-Za-z0-9_-]{1,48}$/

export function isTestAuthorization(value: unknown): value is string {
  return typeof value === "string" && TEST_AUTHORIZATION.test(value)
}

export const notFound = () => new Response("Not found", { status: 404 })

export const noStore = { "Cache-Control": "no-store" }
