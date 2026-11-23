import { describe, it, expect, vi } from "vitest"
import { createAirtableClient } from "@/lib/airtable"
import { answerGuarantorWith, type AnswerDeps } from "@/lib/avales/answer"
import { DECLARATION_SHA256, DECLARATION_TEXT, DECLARATION_VERSION } from "@/lib/avales/declaration"
import { simulatedRenap, type RenapChecker } from "@/lib/avales/renap"
import { generateToken, hashToken } from "@/lib/avales/tokens"
import { createFakeAirtable } from "./avales-fake-airtable"

const NOW = new Date("2026-11-23T12:00:00.000Z")
const OPEN = "2026-11-25T12:00:00.000Z"
const META = { ip: "203.0.113.7", userAgent: "TestAgent/1.0" }

function world(opts: { requestStatus?: string; expiresAt?: string; renap?: RenapChecker | null } = {}) {
  const fake = createFakeAirtable({ now: () => NOW })
  const req = fake.seed("requests", {
    authorization: "TEST-AVALES-answer",
    "full-name": "Solicitante Ficticio",
    phone: "55559999",
    identification: "1000000000001",
    "requested-amount": 1000,
    status: opts.requestStatus ?? "pending_guarantors",
    "expires-at": opts.expiresAt ?? OPEN,
  })
  const tokens = [1, 2, 3].map((position) => {
    const token = generateToken()
    fake.seed("guarantors", {
      slot: `${req.id}:${position}`,
      request: [req.id],
      position,
      "full-name": `Aval ${position}`,
      phone: `5555000${position}`,
      identification: `000000000000${position}`,
      relationship: "otro",
      "token-hash": hashToken(token),
      status: "invited",
    })
    return token
  })
  const deps: AnswerDeps = {
    airtable: createAirtableClient({ token: "t", baseId: "appTEST0000000000", fetch: fake.fetch }),
    renap: opts.renap === undefined ? simulatedRenap : opts.renap,
    now: () => NOW,
    claimSettleMs: 10,
    clock: () => 0, // elapsed-time abort is tested on its own
  }
  const g = (position: number) => fake.rows("guarantors").find((r) => r.fields.position === position)!
  return { fake, deps, tokens, g }
}

const accept = (identification = "0000000000001") => ({
  fullName: "Aval Uno Confirmado",
  identification,
  phone: "5555 0101",
  acceptedText: DECLARATION_TEXT,
})
const blank = { fullName: "", identification: "", phone: "" }

describe("answerGuarantor: reject", () => {
  it("records rejected with evidence (date, IP, user agent) and closes the link", async () => {
    const { deps, tokens, g } = world()
    expect(await answerGuarantorWith(deps, tokens[0], "reject", blank, META)).toEqual({ ok: true, status: "rejected" })
    expect(g(1).fields).toMatchObject({ status: "rejected", "answered-at": NOW.toISOString() })
    expect(JSON.parse(g(1).fields.evidence as string)).toEqual({ answer: "reject", at: NOW.toISOString(), ...META })
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)).toEqual({ ok: false, code: "closed" })
  })
})

describe("answerGuarantor: accept", () => {
  it("RENAP match → authorized; stores the confirmed data, RENAP result, raw and the declaration hash", async () => {
    const { deps, tokens, g } = world()
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)).toEqual({ ok: true, status: "authorized" })
    const f = g(1).fields
    expect(f).toMatchObject({
      status: "authorized",
      "answered-at": NOW.toISOString(),
      "full-name": "Aval Uno Confirmado",
      phone: "55550101",
      identification: "0000000000001",
      "renap-result": "MATCH_UNICO",
    })
    expect(JSON.parse(f["renap-raw"] as string)).toMatchObject({ simulated: true })
    expect(JSON.parse(f.evidence as string)).toMatchObject({
      answer: "accept",
      ...META,
      declarationVersion: DECLARATION_VERSION,
      declarationSha256: DECLARATION_SHA256,
      officialName: "AVAL UNO CONFIRMADO",
    })
    // The link stops taking answers.
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)).toEqual({ ok: false, code: "closed" })
  })

  it("RENAP no match (DPI ending in 0000) → identity_mismatch; the link stays open and a corrected DPI authorizes", async () => {
    const { deps, tokens, g } = world()
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept("1234567890000"), META)).toEqual({ ok: true, status: "identity_mismatch" })
    expect(g(1).fields).toMatchObject({ status: "identity_mismatch", "renap-result": "SIN_RESULTADOS", identification: "0000000000001" })
    expect(g(1).fields["answered-at"]).toBeUndefined()
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept("1234567890001"), META)).toEqual({ ok: true, status: "authorized" })
  })

  it("RENAP error (DPI ending in 9999) → unavailable, status unchanged, attempt recorded", async () => {
    const { deps, tokens, g } = world()
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept("1234567899999"), META)).toEqual({ ok: false, code: "unavailable" })
    expect(g(1).fields).toMatchObject({ status: "invited", "renap-result": "ERROR" })
  })

  it("RENAP not configured → unavailable", async () => {
    const { deps, tokens, g } = world({ renap: null })
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)).toEqual({ ok: false, code: "unavailable" })
    expect(g(1).fields.status).toBe("invited")
  })

  it("requires the exact declaration and valid data, before any storage call", async () => {
    const { deps, tokens, fake } = world()
    const before = fake.calls.length
    expect(await answerGuarantorWith(deps, tokens[0], "accept", { ...accept(), acceptedText: "otro texto" }, META)).toEqual({
      ok: false,
      code: "validation",
      fieldErrors: { acceptedText: "Debes aceptar la declaración para avalar" },
    })
    const bad = await answerGuarantorWith(deps, tokens[0], "accept", { ...accept("12"), phone: "1" }, META)
    expect(bad).toMatchObject({ ok: false, code: "validation" })
    expect(Object.keys((bad as { fieldErrors: object }).fieldErrors).sort()).toEqual(["identification", "phone"])
    expect(fake.calls.length).toBe(before)
  })

  it("two guarantors accepting at the same time are both authorized", async () => {
    const { deps, tokens, g } = world()
    const [a, b] = await Promise.all([
      answerGuarantorWith(deps, tokens[0], "accept", accept("0000000000001"), META),
      answerGuarantorWith(deps, tokens[1], "accept", { ...accept("0000000000002"), phone: "55550202" }, META),
    ])
    expect([a, b]).toEqual([
      { ok: true, status: "authorized" },
      { ok: true, status: "authorized" },
    ])
    expect([g(1).fields.status, g(2).fields.status]).toEqual(["authorized", "authorized"])
  })
})

describe("answerGuarantor: one answer at a time per guarantor (answer-claim)", () => {
  const evidenceWrites = (fake: ReturnType<typeof createFakeAirtable>) =>
    fake.calls.filter((c) => c.method === "PATCH" && (c.body ?? "").includes('"evidence"')).length

  it("two simultaneous accepts from two tabs: one RENAP call, one evidence, the other gets closed", async () => {
    const renap = vi.fn(simulatedRenap)
    const { deps, tokens, g, fake } = world({ renap })
    const results = await Promise.all([
      answerGuarantorWith(deps, tokens[0], "accept", accept(), META),
      answerGuarantorWith(deps, tokens[0], "accept", accept(), { ...META, userAgent: "OtherTab/2.0" }),
    ])
    expect(results).toContainEqual({ ok: true, status: "authorized" })
    expect(results).toContainEqual({ ok: false, code: "closed" })
    expect(renap).toHaveBeenCalledTimes(1)
    expect(evidenceWrites(fake)).toBe(1)
    expect(g(1).fields.status).toBe("authorized")
  })

  it("accept and reject at the same moment: exactly one is recorded", async () => {
    const { deps, tokens, g, fake } = world()
    const results = await Promise.all([
      answerGuarantorWith(deps, tokens[0], "accept", accept(), META),
      answerGuarantorWith(deps, tokens[0], "reject", blank, META),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "closed" }])
    expect(evidenceWrites(fake)).toBe(1)
    expect(["authorized", "rejected"]).toContain(g(1).fields.status)
  })

  it("a RENAP error frees the claim so the guarantor can retry right away", async () => {
    const warns: string[] = []
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warns.push(a.join(" ")))
    const { deps, tokens, g } = world()
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept("1234567899999"), META)).toEqual({ ok: false, code: "unavailable" })
    expect(g(1).fields["answer-claim"]).toBe("")
    expect(warns.join("\n")).toMatch(/answer unavailable for rec\w+: identity check failed; retry/)
    expect(await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)).toEqual({ ok: true, status: "authorized" })
  })

  it("an identity mismatch frees the claim; an authorized answer keeps it", async () => {
    const { deps, tokens, g } = world()
    await answerGuarantorWith(deps, tokens[0], "accept", accept("1234567890000"), META)
    expect(g(1).fields["answer-claim"]).toBe("")
    await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)
    expect(g(1).fields["answer-claim"]).toMatch(/@\d+$/)
  })

  it("an answer in progress blocks another; a claim past its lease can be taken over", async () => {
    const { deps, tokens, g } = world()
    g(1).fields["answer-claim"] = `other@${NOW.getTime() - 1000}`
    expect(await answerGuarantorWith(deps, tokens[0], "reject", blank, META)).toEqual({ ok: false, code: "closed" })
    g(1).fields["answer-claim"] = `dead@${NOW.getTime() - 121_000}`
    expect(await answerGuarantorWith(deps, tokens[0], "reject", blank, META)).toEqual({ ok: true, status: "rejected" })
  })

  it("a claim confirmed later than the pause after the read steps back: unavailable, claim freed, retry works", async () => {
    const renap = vi.fn(simulatedRenap)
    const w = world({ renap })
    const reads = [0, 100]
    const deps = { ...w.deps, clock: () => reads.shift() ?? 100, claimSettleMs: 12 }
    expect(await answerGuarantorWith(deps, w.tokens[0], "accept", accept(), META)).toEqual({ ok: false, code: "unavailable" })
    expect(renap).not.toHaveBeenCalled()
    expect(w.g(1).fields["answer-claim"]).toBe("")
    expect(await answerGuarantorWith(w.deps, w.tokens[0], "accept", accept(), META)).toEqual({ ok: true, status: "authorized" })
  })

  // Regression for the live-base failure: against real Airtable every call takes hundreds of ms.
  // With the real clock and the default pause, two simultaneous answers must register exactly one
  // (the other gets `closed`), and nothing may be left without an answer.
  describe.each([300, 900])("with %i ms per Airtable call and the real clock", (latencyMs) => {
    function slowWorld() {
      const renap = vi.fn(simulatedRenap)
      const w = world({ renap })
      const slow = createAirtableClient({
        token: "t",
        baseId: "appTEST0000000000",
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          await new Promise((resolve) => setTimeout(resolve, latencyMs))
          return w.fake.fetch(url, init)
        }) as typeof fetch,
      })
      const deps: AnswerDeps = { ...w.deps, airtable: slow, clock: Date.now, claimSettleMs: undefined }
      return { ...w, renap, deps }
    }

    it("two simultaneous accepts: exactly one authorized, the other closed", async () => {
      const w = slowWorld()
      const results = await Promise.all([
        answerGuarantorWith(w.deps, w.tokens[0], "accept", accept(), META),
        answerGuarantorWith(w.deps, w.tokens[0], "accept", accept(), META),
      ])
      expect(results).toContainEqual({ ok: true, status: "authorized" })
      expect(results).toContainEqual({ ok: false, code: "closed" })
      expect(w.renap).toHaveBeenCalledTimes(1)
      expect(w.g(1).fields.status).toBe("authorized")
    }, 40_000)

    it("accept and reject at once: exactly one recorded, the other closed", async () => {
      const w = slowWorld()
      const results = await Promise.all([
        answerGuarantorWith(w.deps, w.tokens[0], "accept", accept(), META),
        answerGuarantorWith(w.deps, w.tokens[0], "reject", blank, META),
      ])
      const recorded = results.filter((r) => r.ok)
      expect(recorded).toHaveLength(1)
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "closed" }])
      expect(w.g(1).fields.status).toBe((recorded[0] as { status: string }).status)
    }, 40_000)
  })

  it("an unexpected failure after claiming frees the claim", async () => {
    const renap = vi.fn(async () => Promise.reject(new Error("boom")))
    const { deps, tokens, g } = world({ renap })
    await expect(answerGuarantorWith(deps, tokens[0], "accept", accept(), META)).rejects.toThrow("boom")
    expect(g(1).fields["answer-claim"]).toBe("")
  })
})

describe("answerGuarantor: no self-guarantee", () => {
  const generic = {
    ok: false,
    code: "validation",
    fieldErrors: {
      identification: "Estos datos no pueden usarse para avalar esta solicitud",
      phone: "Estos datos no pueden usarse para avalar esta solicitud",
    },
  }

  it("rejects the applicant's DPI or phone, or another guarantor's, before RENAP, with one generic message", async () => {
    const renap = vi.fn(simulatedRenap)
    const { deps, tokens, g } = world({ renap })
    // Same answer whichever field matched and whoever it belongs to: nothing is revealed.
    expect(await answerGuarantorWith(deps, tokens[0], "accept", { ...accept("1000000000001") }, META)).toEqual(generic)
    expect(await answerGuarantorWith(deps, tokens[0], "accept", { ...accept(), phone: "55559999" }, META)).toEqual(generic)
    expect(await answerGuarantorWith(deps, tokens[0], "accept", { ...accept("0000000000002") }, META)).toEqual(generic)
    expect(await answerGuarantorWith(deps, tokens[0], "accept", { ...accept(), phone: "55550003" }, META)).toEqual(generic)
    expect(renap).not.toHaveBeenCalled()
    expect(g(1).fields.status).toBe("invited")
  })

  it("checks again after RENAP: another guarantor confirming the same DPI meanwhile blocks the second", async () => {
    const holder: { fake?: ReturnType<typeof createFakeAirtable> } = {}
    const renap = vi.fn(async (q: Parameters<typeof simulatedRenap>[0]) => {
      // While RENAP answers for guarantor 1, guarantor 2 gets authorized with the same DPI.
      const g2 = holder.fake!.rows("guarantors").find((r) => r.fields.position === 2)!
      Object.assign(g2.fields, { status: "authorized", identification: q.identification })
      return simulatedRenap(q)
    })
    const w = world({ renap })
    holder.fake = w.fake
    expect(await answerGuarantorWith(w.deps, w.tokens[0], "accept", accept("3000000000001"), META)).toEqual(generic)
    expect(w.g(1).fields.status).toBe("invited")
  })
})

describe("answerGuarantor: state changes while RENAP answers", () => {
  it("the request reaching quorum meanwhile → closed, nothing written", async () => {
    const holder: { fake?: ReturnType<typeof createFakeAirtable> } = {}
    const renap = vi.fn(async (q: Parameters<typeof simulatedRenap>[0]) => {
      holder.fake!.rows("requests")[0].fields.status = "quorum"
      return simulatedRenap(q)
    })
    const w = world({ renap })
    holder.fake = w.fake
    expect(await answerGuarantorWith(w.deps, w.tokens[0], "accept", accept(), META)).toEqual({ ok: false, code: "closed" })
    expect(w.g(1).fields).toMatchObject({ status: "invited", identification: "0000000000001" })
    expect(w.g(1).fields["renap-result"]).toBeUndefined()
    expect(w.g(1).fields["answer-claim"]).toBe("") // non-final exit frees the claim
  })

  it("the deadline passing meanwhile → expired", async () => {
    let now = NOW
    const w = world()
    const renap = vi.fn(async (q: Parameters<typeof simulatedRenap>[0]) => {
      now = new Date(Date.parse(OPEN) + 1000)
      return simulatedRenap(q)
    })
    const deps = { ...w.deps, renap, now: () => now }
    expect(await answerGuarantorWith(deps, w.tokens[0], "accept", accept(), META)).toEqual({ ok: false, code: "expired" })
    expect(w.g(1).fields.status).toBe("invited")
  })
})

describe("answerGuarantor: link state", () => {
  it("expired by expires-at (job not run yet) → expired", async () => {
    const { deps, tokens } = world({ expiresAt: "2026-11-23T11:00:00.000Z" })
    expect(await answerGuarantorWith(deps, tokens[0], "reject", blank, META)).toEqual({ ok: false, code: "expired" })
  })

  it("request already resolved → closed; unknown token → invalid", async () => {
    const { deps, tokens } = world({ requestStatus: "quorum" })
    expect(await answerGuarantorWith(deps, tokens[0], "reject", blank, META)).toEqual({ ok: false, code: "closed" })
    expect(await answerGuarantorWith(deps, generateToken(), "reject", blank, META)).toEqual({ ok: false, code: "invalid" })
    expect(await answerGuarantorWith(deps, "bad", "reject", blank, META)).toEqual({ ok: false, code: "invalid" })
  })

  it("rejects an unknown answer value", async () => {
    const { deps, tokens } = world()
    expect(await answerGuarantorWith(deps, tokens[0], "maybe" as never, blank, META)).toMatchObject({ ok: false, code: "validation" })
  })

  it("never logs the token or the confirmed data", async () => {
    const logs: string[] = []
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")))
    }
    const { deps, tokens } = world()
    await answerGuarantorWith(deps, tokens[0], "accept", accept(), META)
    const all = logs.join("\n")
    for (const value of [tokens[0], "0000000000001", "55550101", "Aval Uno Confirmado"]) expect(all).not.toContain(value)
  })
})
