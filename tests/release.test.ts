import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/soap-client", () => ({ executeDisbursement: vi.fn() }))
vi.mock("@/lib/pagare", () => ({ generarPagare: vi.fn(async () => "https://pdf.example/c.pdf") }))

import { executeDisbursement } from "@/lib/soap-client"
import { generarPagare } from "@/lib/pagare"
import { releaseRequest, isDisbursed, clearMemoryReleaseStore, type ReleaseStore, type ReleaseResult } from "@/lib/release"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const input = {
  phone: "55123478",
  idSolicitud: "SOL-1",
  monto: 1500,
  comision: 126,
  autorizacion: "auth-xyz",
  pagare: {
    identification: "2456789010101", fullName: "Cliente", email: "c@example.com", empresa: "Empresa",
    edad: "30", estadoCivil: "soltero", domicilio: "GT", comisionPorcentaje: 7.5,
    fingerprint: "", screenResolution: "", idiomaBrowser: "", ipInfo: null, otpHash: "",
  },
}

function durableStore(): ReleaseStore & { data: Map<string, ReleaseResult> } {
  const data = new Map<string, ReleaseResult>()
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) }
}

beforeEach(() => {
  clearMemoryReleaseStore()
  vi.clearAllMocks()
})

describe("isDisbursed", () => {
  it("accepts 0 and 34, as numbers or strings", () => {
    for (const c of [0, "0", 34, "34"]) expect(isDisbursed(c)).toBe(true)
    for (const c of [1, "7", undefined, null, ""]) expect(isDisbursed(c)).toBe(false)
  })
})

describe("releaseRequest", () => {
  it("disburses with the request data and passes the pagaré the amount and authorization", async () => {
    m(executeDisbursement).mockResolvedValue({ returnCode: 0 })
    const r = await releaseRequest(input)
    expect(executeDisbursement).toHaveBeenCalledWith("55123478", "SOL-1", 1500, 126, "auth-xyz")
    expect(generarPagare).toHaveBeenCalledWith(expect.objectContaining({ phone: "55123478", autorizacion: "auth-xyz", requestedAmount: 1500, empresa: "Empresa" }))
    expect(r).toEqual({ success: true, hasCommissionIssue: false, pagareUrl: "https://pdf.example/c.pdf", returnCode: "0" })
  })

  it("uses the store passed in: a released key is never disbursed twice", async () => {
    const store = durableStore()
    m(executeDisbursement).mockResolvedValue({ returnCode: 34 })
    const a = await releaseRequest(input, store)
    const b = await releaseRequest(input, store)
    expect(executeDisbursement).toHaveBeenCalledTimes(1)
    expect(b).toEqual(a)
    expect(store.data.get("auth-xyz")).toMatchObject({ success: true, hasCommissionIssue: true })
  })

  it("does not store failures, so a retry calls the service again", async () => {
    const store = durableStore()
    m(executeDisbursement).mockResolvedValueOnce({ returnCode: 9, message: "Rechazado" })
    const r = await releaseRequest(input, store)
    expect(r).toEqual({ success: false, error: "Rechazado", returnCode: "9" })
    expect(store.data.size).toBe(0)
    expect(generarPagare).not.toHaveBeenCalled()
  })

  it("turns a service exception into a failure", async () => {
    m(executeDisbursement).mockRejectedValue(new Error("SOAP caído"))
    expect(await releaseRequest(input)).toEqual({ success: false, error: "SOAP caído" })
  })
})
