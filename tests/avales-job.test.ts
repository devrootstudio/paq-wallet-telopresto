import { describe, it, expect, vi, beforeEach } from "vitest"

// External services: never called for real from these tests.
vi.mock("@/lib/pagare", () => ({ generarPagare: vi.fn(async () => "https://pdf.example/pagare-sim.pdf") }))
vi.mock("@/lib/soap-client", () => ({ validateCupo: vi.fn(), executeDisbursement: vi.fn() }))
vi.mock("@/lib/release", async (orig) => ({ ...(await orig<typeof import("@/lib/release")>()), releaseRequest: vi.fn() }))

import { createAirtableClient } from "@/lib/airtable"
import { generarPagare } from "@/lib/pagare"
import { releaseRequest } from "@/lib/release"
import { validateCupo } from "@/lib/soap-client"
import { answerGuarantorWith } from "@/lib/avales/answer"
import { DECLARATION_TEXT } from "@/lib/avales/declaration"
import { defaultCupo, defaultDisburse, runGuarantorJob, type DisburseOutcome, type JobDeps } from "@/lib/avales/job"
import { simulatedRenap } from "@/lib/avales/renap"
import { createAvalesRepo, isTestRequest } from "@/lib/avales/repo"
import { isSimulation, simulatedCupo } from "@/lib/avales/runtime"
import { guarantorRequestSchema } from "@/lib/avales/schema"
import type { WhatsAppMessage, WhatsAppSender } from "@/lib/avales/whatsapp"
import { createFakeAirtable } from "./avales-fake-airtable"

const T0 = new Date("2026-11-23T12:00:00.000Z")
const BASE = "http://localhost:3020"

const request = guarantorRequestSchema.parse({
  authorization: "TEST-AVALES-job-0001",
  applicant: {
    phone: "55559999",
    identification: "1000000000001",
    fullName: "Solicitante Ficticio",
    email: "s@example.com",
    company: "Empresa Ficticia",
    age: "30",
    maritalStatus: "Soltero",
    address: "Ciudad",
  },
  cupoId: "CUPO-1",
  approvedAmount: 3500,
  requestedAmount: 1000,
  commission: 75,
  commissionPct: 7.5,
  audit: { fingerprint: "fp", screenResolution: "390x844", idiomaBrowser: "es-GT", ipInfo: null, otpHash: "h" },
  guarantors: [
    { fullName: "Aval Uno", phone: "55550001", identification: "2000000000001", relationship: "hermano/a" },
    { fullName: "Aval Dos", phone: "55550002", identification: "2000000000002", relationship: "amigo/a" },
    { fullName: "Aval Tres", phone: "55550003", identification: "2000000000003", relationship: "otro" },
  ],
})

/**
 * `test`: a request created in simulation (test flag set), processed by simulation runs.
 * `real`: a real request (no flag, real authorization), processed only outside simulation.
 */
async function world(mode: "test" | "real" = "test") {
  let now = T0
  const fake = createFakeAirtable({ now: () => now })
  const airtable = createAirtableClient({ token: "t", baseId: "appTEST0000000000", fetch: fake.fetch })
  const repo = createAvalesRepo({ airtable, now: () => now })
  const { requestId } =
    mode === "test"
      ? await repo.submit({ ...request, authorization: "SIM-job-0001" }, { test: true })
      : await repo.submit({ ...request, authorization: "REAL-job-0001" })
  const sent: WhatsAppMessage[] = []
  const whatsapp: WhatsAppSender = async (m) => {
    sent.push(m)
    return { ok: true, simulated: true }
  }
  const disburse = vi.fn(async (): Promise<DisburseOutcome> => ({ success: true, returnCode: "0", message: "ok", contractUrl: "https://pdf.example/c.pdf" }))
  const deps = (extra: Partial<JobDeps> = {}): JobDeps => ({
    airtable,
    whatsapp,
    baseUrl: BASE,
    simulation: true,
    now: () => now,
    claimSettleMs: 15,
    disburse,
    ...extra,
  })
  const run = (extra: Partial<JobDeps> = {}) => runGuarantorJob(deps(extra))
  const answer = (token: string, a: "accept" | "reject", position: number) =>
    answerGuarantorWith(
      { airtable, renap: simulatedRenap, now: () => now, claimSettleMs: 10, clock: () => 0 },
      token,
      a,
      a === "accept"
        ? { fullName: `Aval ${position}`, identification: `200000000000${position}`, phone: `5555000${position}`, acceptedText: DECLARATION_TEXT }
        : { fullName: "", identification: "", phone: "" },
      { ip: "", userAgent: "" },
    )
  const reqRow = () => fake.rows("requests").find((r) => r.id === requestId)!
  const g = (position: number) => fake.rows("guarantors").find((r) => r.fields.position === position)!
  const tokenOf = (links: { position: number; url: string }[], position: number) => links.find((l) => l.position === position)!.url.split("/aval/")[1]
  /**
   * A client for one "instance" whose matching calls are delayed or failed, to reproduce slow or
   * failing Airtable requests in a single run.
   */
  const slowClient = (rule: (method: string, url: string, body: string) => { delayMs?: number; fail?: boolean } | undefined) =>
    createAirtableClient({
      token: "t",
      baseId: "appTEST0000000000",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const r = rule(init?.method ?? "GET", decodeURIComponent(String(url)), String(init?.body ?? ""))
        if (r?.delayMs) await new Promise((resolve) => setTimeout(resolve, r.delayMs))
        if (r?.fail) return new Response(JSON.stringify({ error: { type: "INJECTED" } }), { status: 503 })
        return fake.fetch(url, init)
      }) as typeof fetch,
    })
  return { fake, airtable, repo, requestId, sent, disburse, run, answer, reqRow, g, tokenOf, slowClient, setNow: (d: Date) => (now = d) }
}

beforeEach(() => {
  vi.mocked(generarPagare).mockClear()
  vi.mocked(releaseRequest).mockReset()
  vi.mocked(validateCupo).mockReset()
})

describe("step 1: invite", () => {
  it("rotates each pending guarantor's link, sends the invitation and marks invited; links only in simulation", async () => {
    const w = await world()
    const report = await w.run()
    expect(report.invited).toBe(3)
    expect([1, 2, 3].map((p) => w.g(p).fields.status)).toEqual(["invited", "invited", "invited"])
    expect(w.g(1).fields["invited-at"]).toBe(T0.toISOString())
    expect(report.links!.map((l) => l.position).sort()).toEqual([1, 2, 3])
    for (const l of report.links!) expect(l.url).toMatch(new RegExp(`^${BASE}/aval/[A-Za-z0-9_-]{43}$`))
    expect(await w.repo.view(w.tokenOf(report.links!, 1))).toMatchObject({ screen: "form", applicantName: "Solicitante Ficticio" })
    expect(w.sent.filter((m) => m.template === "guarantor_invitation").map((m) => m.to).sort()).toEqual(["55550001", "55550002", "55550003"])
    // Nothing left to invite on the next run.
    expect((await w.run()).invited).toBe(0)
  })

  it("never returns links outside simulation", async () => {
    const w = await world("real")
    const report = await w.run({ simulation: false })
    expect(report.invited).toBe(3)
    expect(report.links).toBeUndefined()
  })

  it("without a working WhatsApp no link is issued: guarantors stay pending with their hash", async () => {
    const w = await world("real")
    const hashes = [1, 2, 3].map((p) => w.g(p).fields["token-hash"])
    const notReady = Object.assign(async () => ({ ok: false as const, reason: "whatsapp_not_integrated" }), { ready: false })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const report = await w.run({ simulation: false, whatsapp: notReady })
    expect(report.invited).toBe(0)
    expect([1, 2, 3].map((p) => w.g(p).fields.status)).toEqual(["pending", "pending", "pending"])
    expect([1, 2, 3].map((p) => w.g(p).fields["token-hash"])).toEqual(hashes)
  })
})

describe("one shared base: simulation runs touch only test requests, real runs only real ones", () => {
  it("a simulation run leaves a real request alone, and a real run leaves a test request alone", async () => {
    const real = await world("real")
    expect((await real.run({ simulation: true })).invited).toBe(0)
    expect(real.g(1).fields.status).toBe("pending")

    const test = await world("test")
    expect((await test.run({ simulation: false })).invited).toBe(0)
    expect(test.g(1).fields.status).toBe("pending")
    await test.airtable.update("requests", [{ id: test.requestId, fields: { status: "quorum" } }])
    expect((await test.run({ simulation: false })).released).toEqual([])
    expect(test.disburse).not.toHaveBeenCalled()
  })

  it("requests older than the test flag: TEST-AVALES-* and AUTH-DOC-2025-EXAMPLE count as test data", () => {
    expect(isTestRequest({ test: true })).toBe(true)
    expect(isTestRequest({ authorization: "TEST-AVALES-1700000000000" })).toBe(true)
    expect(isTestRequest({ authorization: "AUTH-DOC-2025-EXAMPLE" })).toBe(true)
    expect(isTestRequest({ authorization: "a1b2c3d4e5f60718293a4b5c6d7e8f90011223344556677" })).toBe(false)
  })

  it("does not invite guarantors of a request past its deadline", async () => {
    const w = await world()
    w.setNow(new Date(T0.getTime() + 49 * 3600_000))
    const report = await w.run()
    expect(report.invited).toBe(0)
    expect(report.expired).toEqual([w.requestId])
  })
})

describe("steps 2–5: quorum and release", () => {
  it("two authorizations → quorum → simulated release → disbursed; third guarantor closed; applicant notified; leads", async () => {
    const w = await world()
    const { links } = await w.run()
    expect(await w.answer(w.tokenOf(links!, 1), "accept", 1)).toEqual({ ok: true, status: "authorized" })
    expect(await w.answer(w.tokenOf(links!, 2), "accept", 2)).toEqual({ ok: true, status: "authorized" })

    const report = await w.run({ disburse: undefined }) // default simulated disbursement
    expect(report.quorum).toEqual([w.requestId])
    expect(report.released).toEqual([{ requestId: w.requestId, status: "disbursed", returnCode: "0" }])
    expect(w.reqRow().fields).toMatchObject({
      status: "disbursed",
      "release-code": "0",
      "contract-url": "https://pdf.example/pagare-sim.pdf",
      "quorum-at": T0.toISOString(),
      "released-at": T0.toISOString(),
    })
    expect(w.g(3).fields.status).toBe("closed")
    expect(vi.mocked(generarPagare)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generarPagare).mock.calls[0][0]).toMatchObject({ autorizacion: "SIM-job-0001", requestedAmount: 1000, fullName: "Solicitante Ficticio" })
    expect(vi.mocked(releaseRequest)).not.toHaveBeenCalled()
    expect(vi.mocked(validateCupo)).not.toHaveBeenCalled()
    expect(w.sent.find((m) => m.template === "contract_approved")).toMatchObject({ to: "55559999" })

    // Step 6 ran in the same pass: one lead per authorized guarantor, thanked once.
    expect(report.leads).toBe(2)
    expect(report.thanked).toBe(2)
    const leads = w.fake.rows("guarantor-leads")
    expect(leads.map((l) => l.fields["official-name"]).sort()).toEqual(["AVAL 1", "AVAL 2"])
    expect(leads.every((l) => l.fields["thanked-at"] === T0.toISOString())).toBe(true)
    const again = await w.run()
    expect([again.leads, again.thanked, w.fake.rows("guarantor-leads").length]).toEqual([0, 0, 2])
    expect(again.released).toEqual([])
  })

  it("race: two runs at once on a quorum request disburse exactly once", async () => {
    const w = await world()
    const { links } = await w.run()
    await w.answer(w.tokenOf(links!, 1), "accept", 1)
    await w.answer(w.tokenOf(links!, 2), "accept", 2)
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])

    const [a, b] = await Promise.all([w.run({ runId: "run-a" }), w.run({ runId: "run-b" })])
    expect(w.disburse).toHaveBeenCalledTimes(1)
    const statuses = [...a.released, ...b.released].map((r) => r.status).sort()
    expect(statuses).toEqual(["disbursed", "skipped"])
    expect(w.reqRow().fields.status).toBe("disbursed")
  })

  it("race: two acceptances at once, then two runs at once → one quorum, one disbursement", async () => {
    const w = await world()
    const { links } = await w.run()
    await Promise.all([w.answer(w.tokenOf(links!, 1), "accept", 1), w.answer(w.tokenOf(links!, 2), "accept", 2)])
    await Promise.all([w.run({ runId: "run-a" }), w.run({ runId: "run-b" })])
    expect(w.disburse).toHaveBeenCalledTimes(1)
    expect(w.reqRow().fields.status).toBe("disbursed")
    expect(w.sent.filter((m) => m.template === "contract_approved")).toHaveLength(1)
  })

  it("race with a stale run: a run that listed the request before another released it never re-opens or re-releases it", async () => {
    const w = await world()
    const { links } = await w.run()
    await w.answer(w.tokenOf(links!, 1), "accept", 1)
    await w.answer(w.tokenOf(links!, 2), "accept", 2)
    // Run B lists the request as pending_guarantors, then stalls before deciding; run A meanwhile
    // takes it to quorum and disburses it.
    const stale = w.slowClient((method, url) => (method === "GET" && url.includes("{slot}") ? { delayMs: 250 } : undefined))
    const [a, b] = await Promise.all([w.run({ runId: "run-a" }), w.run({ runId: "run-b", airtable: stale })])
    expect(w.disburse).toHaveBeenCalledTimes(1)
    expect(w.reqRow().fields.status).toBe("disbursed")
    expect([...a.quorum, ...b.quorum]).toEqual([w.requestId])
  })

  it("race with a slow claim write: the claim that lands last wins, one disbursement", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    // Both runs read `quorum`; run B's claim write is slow (but shorter than the settle pause).
    const slowClaim = w.slowClient((method, _url, body) => (method === "PATCH" && body.includes("release-claim") ? { delayMs: 120 } : undefined))
    const [a, b] = await Promise.all([
      w.run({ runId: "run-a", claimSettleMs: 300 }),
      w.run({ runId: "run-b", claimSettleMs: 300, airtable: slowClaim }),
    ])
    expect(w.disburse).toHaveBeenCalledTimes(1)
    expect([...a.released, ...b.released].map((r) => r.status).sort()).toEqual(["disbursed", "skipped"])
    expect(w.reqRow().fields).toMatchObject({ status: "disbursed", "release-claim": "run-b" })
  })

  it("a run whose claim write fails does not disburse", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    const broken = w.slowClient((method, _url, body) => (method === "PATCH" && body.includes("release-claim") ? { fail: true } : undefined))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const report = await w.run({ airtable: broken })
    expect(w.disburse).not.toHaveBeenCalled()
    expect(report.errors.map((e) => e.step)).toContain("release")
  })

  it("a request is claimed at most once: quorum with a previous claim or release code is never released again, and is reported stuck", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum", "release-claim": "old-run" } }])
    const first = await w.run()
    expect([first.released, first.stuck]).toEqual([[], [w.requestId]])
    await w.airtable.update("requests", [{ id: w.requestId, fields: { "release-claim": "", "release-code": "0" } }])
    const second = await w.run()
    expect([second.released, second.stuck]).toEqual([[], [w.requestId]])
    expect(w.disburse).not.toHaveBeenCalled()
  })

  it("a claim confirmed too long after the read aborts the release (no money moves, reported stuck)", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    // Clock reads: release step start, budget check, read before claiming, after the claim write.
    // Read → confirmed claim takes 100 units against a pause of 12: more than half → abort.
    const reads = [0, 0, 0, 100]
    const clock = () => reads.shift() ?? 100
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const report = await w.run({ clock, claimSettleMs: 12 })
    expect(w.disburse).not.toHaveBeenCalled()
    expect(report.released).toEqual([{ requestId: w.requestId, status: "skipped" }])
    expect(report.stuck).toEqual([w.requestId])
    expect(w.reqRow().fields.status).toBe("releasing")
  })

  it("stops starting releases when the time budget is spent; the rest wait for the next run", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    let t = 0
    const report = await w.run({ clock: () => (t += 1000), releaseBudgetMs: 500 })
    expect(report.deferred).toEqual([w.requestId])
    expect(w.disburse).not.toHaveBeenCalled()
    expect(w.reqRow().fields.status).toBe("quorum")
  })

  it("two authorizations with the same DPI are one person: no quorum", async () => {
    const w = await world()
    const { links } = await w.run()
    // Both links confirmed with the same DPI at the same moment (bypassing the per-answer check).
    for (const p of [1, 2]) {
      const g = w.g(p)
      await w.airtable.update("guarantors", [{ id: g.id, fields: { status: "authorized", identification: "4000000000001" } }])
    }
    void links
    const report = await w.run()
    expect(report.quorum).toEqual([])
    expect(w.reqRow().fields.status).toBe("pending_guarantors")
    expect(w.disburse).not.toHaveBeenCalled()
  })

  it("disbursed but the outcome cannot be written: retried, then reported as unrecorded and stuck, no notice", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    const noRecord = w.slowClient((method, _url, body) => (method === "PATCH" && body.includes('"disbursed"') ? { fail: true } : undefined))
    const errors: string[] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")))
    const sleep = vi.fn(async () => {})
    const report = await w.run({ airtable: noRecord, sleep, recordAttempts: 3 })
    expect(w.disburse).toHaveBeenCalledTimes(1)
    expect(report.unrecorded).toEqual([{ requestId: w.requestId, returnCode: "0" }])
    expect(report.stuck).toEqual([w.requestId])
    expect(report.errors.filter((e) => e.step === "record")).toHaveLength(3)
    expect(w.reqRow().fields.status).toBe("releasing")
    expect(errors.join("\n")).toContain(`RELEASED BUT NOT RECORDED: request ${w.requestId}, return code 0`)
    expect(w.sent.find((m) => m.template === "contract_approved")).toBeUndefined()
    // Next run: never released again.
    expect((await w.run()).released).toEqual([])
    expect(w.disburse).toHaveBeenCalledTimes(1)
  })

  it("an error while disbursing → release_failed with the message", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    w.disburse.mockRejectedValueOnce(new Error("socket hang up"))
    expect((await w.run()).released).toEqual([{ requestId: w.requestId, status: "release_failed" }])
    expect(w.reqRow().fields).toMatchObject({ status: "release_failed", "release-message": "release error: Error: socket hang up" })
  })

  it("a request already releasing (another run owns it) is skipped", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "releasing", "release-claim": "other" } }])
    const report = await w.run()
    expect(report.released).toEqual([])
    expect(w.disburse).not.toHaveBeenCalled()
  })

  it("cupo below the amount → not_approved with notice", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    const report = await w.run({ cupo: async () => ({ ok: true, cupoAutorizado: 500, idSolicitud: "X", message: "" }) })
    expect(report.released).toEqual([{ requestId: w.requestId, status: "not_approved" }])
    expect(w.disburse).not.toHaveBeenCalled()
    expect(w.sent.find((m) => m.template === "request_not_approved")).toMatchObject({ to: "55559999" })
  })

  it("failed disbursement or valida_cupo error → release_failed, never retried by the job", async () => {
    const w = await world()
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    w.disburse.mockResolvedValueOnce({ success: false, returnCode: "12", message: "Rejected" })
    expect((await w.run()).released).toEqual([{ requestId: w.requestId, status: "release_failed", returnCode: "12" }])
    expect(w.reqRow().fields).toMatchObject({ status: "release_failed", "release-code": "12", "release-message": "Rejected" })
    expect((await w.run()).released).toEqual([])

    const w2 = await world()
    await w2.airtable.update("requests", [{ id: w2.requestId, fields: { status: "quorum" } }])
    const report = await w2.run({ cupo: async () => Promise.reject(new Error("SOAP down")) })
    expect(report.released).toEqual([{ requestId: w2.requestId, status: "release_failed" }])
    expect(w2.disburse).not.toHaveBeenCalled()
  })
})

describe("steps 2 and 4: rejection and expiry", () => {
  it("two rejections → rejected, the open guarantor closed, applicant notified", async () => {
    const w = await world()
    const { links } = await w.run()
    await w.answer(w.tokenOf(links!, 1), "reject", 1)
    await w.answer(w.tokenOf(links!, 3), "reject", 3)
    const report = await w.run()
    expect(report.rejected).toEqual([w.requestId])
    expect(w.reqRow().fields.status).toBe("rejected")
    expect(w.g(2).fields.status).toBe("closed")
    expect(w.sent.find((m) => m.template === "request_rejected")).toMatchObject({ to: "55559999" })
    expect(w.disburse).not.toHaveBeenCalled()
  })

  it("one rejection and one authorization keep waiting", async () => {
    const w = await world()
    const { links } = await w.run()
    await w.answer(w.tokenOf(links!, 1), "reject", 1)
    await w.answer(w.tokenOf(links!, 2), "accept", 2)
    const report = await w.run()
    expect([report.rejected, report.quorum, report.expired]).toEqual([[], [], []])
    expect(w.reqRow().fields.status).toBe("pending_guarantors")
  })

  it("past expires-at without quorum → expired, open guarantors expired, applicant notified", async () => {
    const w = await world()
    const { links } = await w.run()
    await w.answer(w.tokenOf(links!, 1), "accept", 1)
    w.setNow(new Date(T0.getTime() + 48 * 3600_000))
    const report = await w.run()
    expect(report.expired).toEqual([w.requestId])
    expect(w.reqRow().fields.status).toBe("expired")
    expect([w.g(1).fields.status, w.g(2).fields.status, w.g(3).fields.status]).toEqual(["authorized", "expired", "expired"])
    expect(w.sent.find((m) => m.template === "request_expired")).toMatchObject({ to: "55559999" })
    // The authorized guarantor still becomes a lead.
    expect(report.leads).toBe(1)
  })
})

describe("simulation boundaries", () => {
  it("isSimulation is false in production even with the bypass on", () => {
    expect(isSimulation({ ENABLE_TEST_BYPASS: "true", NODE_ENV: "development" })).toBe(true)
    expect(isSimulation({ ENABLE_TEST_BYPASS: "1", NODE_ENV: "test" })).toBe(true)
    expect(isSimulation({ ENABLE_TEST_BYPASS: "true", NODE_ENV: "production" })).toBe(false)
    expect(isSimulation({ NODE_ENV: "development" })).toBe(false)
  })

  it("simulated cupo mirrors the Step 3 bypass values", () => {
    expect(simulatedCupo({})).toEqual({ cupoAutorizado: 3500, idSolicitud: "TEST-001", porcComision: 7.5 })
    expect(simulatedCupo({ TEST_APPROVED_AMOUNT: "500", TEST_ID_SOLICITUD: "X-9" })).toEqual({ cupoAutorizado: 500, idSolicitud: "X-9", porcComision: 6.5 })
  })

  it("outside simulation the job uses the real valida_cupo and releaseRequest (mocked here)", async () => {
    const w = await world("real")
    await w.airtable.update("requests", [{ id: w.requestId, fields: { status: "quorum" } }])
    vi.mocked(validateCupo).mockResolvedValue({ returnCode: 0, message: "ok", cupoAutorizado: 3500, idSolicitud: "NEW-ID" })
    vi.mocked(releaseRequest).mockResolvedValue({ success: true, hasCommissionIssue: false, pagareUrl: "https://pdf.example/real.pdf", returnCode: "0" })
    const report = await w.run({ simulation: false, cupo: defaultCupo(false), disburse: defaultDisburse(false, w.airtable) })
    expect(report.released).toEqual([{ requestId: w.requestId, status: "disbursed", returnCode: "0" }])
    expect(vi.mocked(validateCupo)).toHaveBeenCalledWith("55559999")
    expect(vi.mocked(releaseRequest).mock.calls[0][0]).toMatchObject({
      phone: "55559999",
      idSolicitud: "NEW-ID",
      monto: 1000,
      comision: 75,
      autorizacion: "REAL-job-0001",
    })
    expect(vi.mocked(generarPagare)).not.toHaveBeenCalled()
    expect(report.links).toBeUndefined()
  })

  it("logs carry no names, DPI, phones or tokens", async () => {
    const logs: string[] = []
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")))
    }
    const w = await world()
    const { links } = await w.run()
    await w.answer(w.tokenOf(links!, 1), "accept", 1)
    await w.answer(w.tokenOf(links!, 2), "accept", 2)
    await w.run({ disburse: async () => Promise.reject(new Error("boom")) })
    const all = logs.join("\n")
    for (const v of ["55559999", "55550001", "2000000000001", "Solicitante Ficticio", "Aval 1", ...links!.map((l) => l.url.split("/aval/")[1])]) {
      expect(all).not.toContain(v)
    }
  })
})
