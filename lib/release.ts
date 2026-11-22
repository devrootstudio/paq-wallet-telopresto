import { executeDisbursement } from "@/lib/soap-client"
import { generarPagare, type PagareInput } from "@/lib/pagare"

/**
 * Release service: executes the disbursement (Ejecuta_Desembolso) and generates the pagaré.
 *
 * Shared by both routes:
 * - "normal": called by the step 3 server action when the user confirms.
 * - "aval": called by the guarantor job once a request reaches quorum.
 *
 * Idempotent by `autorizacion`: a key that already released returns the stored result
 * without calling Ejecuta_Desembolso again. The default store lives in memory (one server
 * instance); the guarantor route passes a durable store backed by the request's status.
 */

export interface ReleaseInput {
  phone: string
  idSolicitud: string
  monto: number
  comision: number
  autorizacion: string
  pagare: Omit<PagareInput, "phone" | "autorizacion" | "requestedAmount">
}

export type ReleaseResult =
  | { success: true; hasCommissionIssue: boolean; pagareUrl: string; returnCode: string }
  | { success: false; error: string; returnCode?: string }

export interface ReleaseStore {
  get(key: string): Promise<ReleaseResult | undefined>
  set(key: string, result: ReleaseResult): Promise<void>
}

const memory = new Map<string, ReleaseResult>()

/** Test helper: forget every release kept by the in-memory store. */
export function clearMemoryReleaseStore() {
  memory.clear()
}

export const memoryReleaseStore: ReleaseStore = {
  async get(key) {
    return memory.get(key)
  },
  async set(key, result) {
    memory.set(key, result)
  },
}

/** Return codes Paq treats as a completed disbursement: 0, and 34 (disbursed, commission not collected). */
export function isDisbursed(returnCode: unknown): boolean {
  return returnCode === 0 || returnCode === "0" || returnCode === 34 || returnCode === "34"
}

export async function releaseRequest(
  input: ReleaseInput,
  store: ReleaseStore = memoryReleaseStore,
): Promise<ReleaseResult> {
  const previous = await store.get(input.autorizacion)
  if (previous?.success) return previous

  let response
  try {
    response = await executeDisbursement(input.phone, input.idSolicitud, input.monto, input.comision, input.autorizacion)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error executing disbursement. Please try again later.",
    }
  }

  const returnCode = String(response.returnCode ?? "")
  if (!isDisbursed(response.returnCode)) {
    return { success: false, error: response.message || "Error executing disbursement", returnCode }
  }

  const pagareUrl = await generarPagare({
    ...input.pagare,
    phone: input.phone,
    autorizacion: input.autorizacion,
    requestedAmount: input.monto,
  })

  const result: ReleaseResult = {
    success: true,
    hasCommissionIssue: returnCode === "34",
    pagareUrl: pagareUrl || "",
    returnCode,
  }
  await store.set(input.autorizacion, result)
  return result
}
