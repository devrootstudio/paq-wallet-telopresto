/**
 * Runtime switches for the guarantor route. Server-side only.
 *
 * Simulation reuses the existing test bypass (`ENABLE_TEST_BYPASS`, "do not use in production"),
 * the same flag app/actions.ts reads, and additionally requires NODE_ENV `development` or `test`.
 * With simulation on: RENAP is simulated, valida_cupo and the disbursement return the same fake
 * values the bypass uses in Step 3 (TEST_APPROVED_AMOUNT, TEST_ID_SOLICITUD, code 0), and the job
 * response includes the guarantor links. WhatsApp is always simulated for now (see whatsapp.ts).
 */

/** Environment variables as read here (process.env by default). */
export type Env = Record<string, string | undefined>

/** Fails closed: only `development` (next dev) and `test` (vitest) may simulate; never production, staging or unset. */
export function isSimulation(env: Env = process.env): boolean {
  const bypass = env.ENABLE_TEST_BYPASS === "true" || env.ENABLE_TEST_BYPASS === "1"
  return bypass && (env.NODE_ENV === "development" || env.NODE_ENV === "test")
}

/** Same fallbacks as app/actions.ts. */
export function simulatedCupo(env: Env = process.env) {
  const approved = Number.parseInt(env.TEST_APPROVED_AMOUNT || "3500", 10)
  return {
    cupoAutorizado: approved,
    idSolicitud: env.TEST_ID_SOLICITUD || "TEST-001",
    porcComision: approved >= 701 ? 7.5 : approved >= 251 ? 6.5 : 0,
  }
}

/** Development-only default for JOBS_SECRET, accepted only in simulation. Public on purpose. */
export const DEV_JOBS_SECRET = "dev-jobs-secret"

/** The secret the job endpoint expects, or null when the endpoint must refuse every call. */
export function jobsSecret(env: Env = process.env): string | null {
  if (env.JOBS_SECRET) return env.JOBS_SECRET
  return isSimulation(env) ? DEV_JOBS_SECRET : null
}
