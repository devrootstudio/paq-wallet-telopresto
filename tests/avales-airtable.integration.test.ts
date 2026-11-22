import { describe, it, expect } from "vitest"
import { airtableFromEnv } from "@/lib/airtable"
import { createAvalesRepo, slotOf, TABLES, type GuarantorFields } from "@/lib/avales/repo"
import { guarantorRequestSchema } from "@/lib/avales/schema"

/**
 * Writes to a real Airtable base, so it only runs when explicitly enabled:
 *   AVALES_INTEGRATION=1 AIRTABLE_TOKEN=… AIRTABLE_BASE_ID=… npx vitest run tests/avales-airtable.integration.test.ts
 * Creates one request `TEST-AVALES-<timestamp>` with fictitious data and three guarantors.
 * It deletes nothing: remove the TEST-AVALES-* records by hand afterwards.
 */
const enabled = process.env.AVALES_INTEGRATION === "1" && Boolean(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID)

describe.skipIf(!enabled)("avales on real Airtable", () => {
  it("creates a request with three guarantors and a resubmit does not duplicate it", async () => {
    const airtable = airtableFromEnv()!
    const repo = createAvalesRepo({ airtable })
    const authorization = `TEST-AVALES-${Date.now()}`
    const input = guarantorRequestSchema.parse({
      authorization,
      applicant: {
        phone: "55550000",
        identification: "0000000000009",
        fullName: "Prueba Solicitante Ficticio",
        email: "prueba@example.com",
        company: "Empresa Ficticia",
        age: "30",
        maritalStatus: "Soltero",
        address: "Dirección ficticia",
      },
      cupoId: "TEST-CUPO",
      approvedAmount: 3500,
      requestedAmount: 1000,
      commission: 75,
      commissionPct: 7.5,
      audit: { fingerprint: "test", screenResolution: "390x844", idiomaBrowser: "es-GT", ipInfo: null, otpHash: "test" },
      guarantors: [
        { fullName: "Prueba Aval Uno", phone: "55550001", identification: "0000000000001", relationship: "hermano/a" },
        { fullName: "Prueba Aval Dos", phone: "55550002", identification: "0000000000002", relationship: "amigo/a" },
        { fullName: "Prueba Aval Tres", phone: "55550003", identification: "0000000000003", relationship: "otro" },
      ],
    })

    const first = await repo.submit(input)
    const second = await repo.submit(input)
    expect(first.reused).toBe(false)
    expect(second).toEqual({ ...first, reused: true })

    const request = await airtable.get<{ status?: string }>(TABLES.requests, first.requestId)
    expect(request?.fields.status).toBe("pending_guarantors")

    const guarantors = await airtable.list<GuarantorFields>(TABLES.guarantors, {
      filterByFormula: `OR(${[1, 2, 3].map((p) => `{slot} = '${slotOf(first.requestId, p)}'`).join(", ")})`,
    })
    expect(guarantors.map((g) => g.fields.position).sort()).toEqual([1, 2, 3])
    expect(guarantors.every((g) => g.fields.request?.[0] === first.requestId)).toBe(true)
    expect(guarantors.every((g) => g.fields.status === "pending" && /^[0-9a-f]{64}$/.test(g.fields["token-hash"] ?? ""))).toBe(true)

    const found = await airtable.list(TABLES.requests, { filterByFormula: `{authorization} = '${authorization}'` })
    expect(found).toHaveLength(1)
  }, 30_000)
})
