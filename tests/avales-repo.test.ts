import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createAirtableClient, AirtableError, formulaString } from "@/lib/airtable"
import { createAvalesRepo, EXPIRY_MS, resolveView, slotOf } from "@/lib/avales/repo"
import { guarantorRequestSchema } from "@/lib/avales/schema"
import { generateToken, hashToken } from "@/lib/avales/tokens"
import type { GuarantorRequestInput } from "@/lib/avales/types"
import { createFakeAirtable } from "./avales-fake-airtable"

const NOW = new Date("2026-11-22T12:00:00.000Z")
const OPEN = "2026-11-24T12:00:00.000Z"

const PII = {
  applicantPhone: "55559999",
  applicantDpi: "1000000000001",
  phones: ["55550001", "55550002", "55550003"],
  dpis: ["0000000000001", "0000000000002", "0000000000003"],
}

function input(overrides: Partial<GuarantorRequestInput> = {}): GuarantorRequestInput {
  return {
    authorization: "TEST-AVALES-unit-0001",
    applicant: {
      phone: PII.applicantPhone,
      identification: PII.applicantDpi,
      fullName: "Solicitante De Prueba",
      email: "solicitante@example.com",
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
    audit: { fingerprint: "fp", screenResolution: "390x844", idiomaBrowser: "es-GT", ipInfo: null, otpHash: "abc" },
    guarantors: [
      { fullName: "Aval Uno", phone: PII.phones[0], identification: PII.dpis[0], relationship: "hermano/a" },
      { fullName: "Aval Dos", phone: PII.phones[1], identification: PII.dpis[1], relationship: "amigo/a" },
      { fullName: "Aval Tres", phone: PII.phones[2], identification: PII.dpis[2], relationship: "otro" },
    ],
    ...overrides,
  }
}

const parsed = (i = input()) => guarantorRequestSchema.parse(i)

function repoOn(fake: ReturnType<typeof createFakeAirtable>, now: () => Date, issued: string[] = []) {
  return createAvalesRepo({
    airtable: createAirtableClient({ token: "test-airtable-token", baseId: "appTEST0000000000", fetch: fake.fetch }),
    now,
    newToken: () => {
      const t = generateToken()
      issued.push(t)
      return t
    },
  })
}

function setup(now: () => Date = () => NOW) {
  const fake = createFakeAirtable({ now })
  const issued: string[] = []
  return { fake, repo: repoOn(fake, now, issued), issued }
}

describe("submit", () => {
  it("creates the request (pending_guarantors, +48 h) and three pending guarantors", async () => {
    const { fake, repo } = setup()
    const out = await repo.submit(parsed())

    const requests = fake.rows("requests")
    expect(requests).toHaveLength(1)
    expect(out).toEqual({
      requestId: requests[0].id,
      expiresAt: new Date(NOW.getTime() + EXPIRY_MS).toISOString(),
      requestedAmount: 1000,
      reused: false,
      open: true,
    })
    expect(requests[0].fields).toMatchObject({
      authorization: "TEST-AVALES-unit-0001",
      phone: PII.applicantPhone,
      identification: PII.applicantDpi,
      "full-name": "Solicitante De Prueba",
      company: "Empresa Ficticia",
      "marital-status": "Soltero",
      "cupo-id": "CUPO-1",
      "approved-amount": 3500,
      "requested-amount": 1000,
      commission: 75,
      "commission-pct": 7.5,
      status: "pending_guarantors",
      "expires-at": "2026-11-24T12:00:00.000Z",
    })
    expect(JSON.parse(requests[0].fields.audit as string)).toMatchObject({ fingerprint: "fp", otpHash: "abc" })

    const guarantors = fake.rows("guarantors")
    expect(guarantors.map((g) => g.fields.position)).toEqual([1, 2, 3])
    for (const [i, g] of guarantors.entries()) {
      expect(g.fields).toMatchObject({
        request: [requests[0].id],
        status: "pending",
        phone: PII.phones[i],
        identification: PII.dpis[i],
      })
      expect(g.fields["token-hash"]).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(new Set(guarantors.map((g) => g.fields["token-hash"])).size).toBe(3)
  })

  it("double submit: the second call returns the same request and creates nothing", async () => {
    const { fake, repo } = setup()
    const first = await repo.submit(parsed())
    const second = await repo.submit(parsed())

    expect(second).toEqual({ ...first, reused: true })
    expect(fake.rows("requests")).toHaveLength(1)
    expect(fake.rows("guarantors")).toHaveLength(3)
  })

  it("concurrent double submit on two instances (serialized upserts): one request, three guarantors", async () => {
    const fake = createFakeAirtable({ now: () => NOW })
    const [a, b] = await Promise.all([repoOn(fake, () => NOW).submit(parsed()), repoOn(fake, () => NOW).submit(parsed())])

    expect(a.requestId).toBe(b.requestId)
    expect([a.reused, b.reused].sort()).toEqual([false, true])
    expect(fake.rows("requests")).toHaveLength(1)
    expect(fake.rows("guarantors")).toHaveLength(3)
  })

  it("request upserts race (non-atomic): both callers converge on the oldest request, guarantors only there", async () => {
    let tick = 0
    const now = () => new Date(NOW.getTime() + tick++) // distinct createdTime per record
    const fake = createFakeAirtable({ now, nonAtomicUpsertTables: ["requests"] })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const [a, b] = await Promise.all([repoOn(fake, now).submit(parsed()), repoOn(fake, now).submit(parsed())])

    const requests = fake.rows("requests")
    expect(requests).toHaveLength(2) // the race happened
    expect(a.requestId).toBe(requests[0].id)
    expect(b.requestId).toBe(requests[0].id)
    const guarantors = fake.rows("guarantors")
    expect(guarantors.map((g) => g.fields.slot).sort()).toEqual([1, 2, 3].map((p) => slotOf(requests[0].id, p)))
  })

  it("guarantor upserts race too (non-atomic): extra guarantors of a slot are closed, one open per position", async () => {
    let tick = 0
    const now = () => new Date(NOW.getTime() + tick++)
    const fake = createFakeAirtable({ now, nonAtomicUpsertTables: ["requests", "guarantors"] })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await Promise.all([repoOn(fake, now).submit(parsed()), repoOn(fake, now).submit(parsed())])

    const open = fake.rows("guarantors").filter((g) => g.fields.status === "pending")
    expect(open.map((g) => g.fields.position).sort()).toEqual([1, 2, 3])
    const closed = fake.rows("guarantors").filter((g) => g.fields.status === "closed")
    expect(closed.length).toBeGreaterThan(0) // the race really produced duplicates
    for (const g of closed) {
      const keeper = open.find((o) => o.fields.slot === g.fields.slot)!
      expect(keeper.createdTime <= g.createdTime).toBe(true)
    }
  })

  it("a retry right after the guarantor write failed completes the request (no ok with missing guarantors)", async () => {
    const { fake, repo } = setup()
    fake.failOn("PATCH", "guarantors", 429)
    await expect(repo.submit(parsed())).rejects.toThrow(AirtableError)
    expect(fake.rows("requests")).toHaveLength(1)
    expect(fake.rows("guarantors")).toHaveLength(0)

    const retry = await repo.submit(parsed())
    expect(retry).toMatchObject({ requestId: fake.rows("requests")[0].id, reused: true, open: true })
    expect(fake.rows("guarantors").map((g) => g.fields.position).sort()).toEqual([1, 2, 3])
  })

  it("completes only the missing positions of an interrupted request", async () => {
    const { fake, repo } = setup()
    const req = fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN })
    fake.seed("guarantors", { slot: slotOf(req.id, 1), request: [req.id], position: 1, status: "invited", "token-hash": "keep" })

    await repo.submit(parsed())
    const rows = fake.rows("guarantors")
    expect(rows.map((g) => g.fields.position).sort()).toEqual([1, 2, 3])
    expect(rows.find((g) => g.fields.position === 1)?.fields).toMatchObject({ status: "invited", "token-hash": "keep" })
    await repo.submit(parsed())
    expect(fake.rows("guarantors")).toHaveLength(3)
  })

  it("two simultaneous retries on an incomplete request do not duplicate guarantors", async () => {
    const fake = createFakeAirtable({ now: () => NOW })
    fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN })
    await Promise.all([repoOn(fake, () => NOW).submit(parsed()), repoOn(fake, () => NOW).submit(parsed())])
    const rows = fake.rows("guarantors")
    expect(rows).toHaveLength(3)
    expect(rows.every((g) => g.fields.status === "pending" && /^[0-9a-f]{64}$/.test(String(g.fields["token-hash"])))).toBe(true)
  })

  it("a retry never touches the status or link of existing guarantors", async () => {
    const { fake, repo } = setup()
    const req = fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN })
    for (const p of [1, 2, 3]) {
      fake.seed("guarantors", { slot: slotOf(req.id, p), request: [req.id], position: p, status: "invited", "token-hash": `link-${p}` })
    }
    await Promise.all([repo.submit(parsed()), repo.submit(parsed())])
    expect(fake.rows("guarantors").map((g) => [g.fields.status, g.fields["token-hash"]])).toEqual([
      ["invited", "link-1"],
      ["invited", "link-2"],
      ["invited", "link-3"],
    ])
    expect(fake.calls.filter((c) => c.method !== "GET")).toHaveLength(0)
  })

  it("an upsert landing on an existing slot leaves its status and link alone", async () => {
    const { fake } = setup()
    const req = fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN })
    // Simulate the race: the slot appears between our read and our write.
    const realFetch = fake.fetch
    let injected = false
    const racing = createAvalesRepo({
      airtable: createAirtableClient({
        token: "t",
        baseId: "appTEST0000000000",
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          if (!injected && init?.method === "PATCH" && String(url).includes("/guarantors")) {
            injected = true
            fake.seed("guarantors", { slot: slotOf(req.id, 1), request: [req.id], position: 1, status: "invited", "token-hash": "sent-link" })
          }
          return realFetch(url, init)
        }) as typeof fetch,
      }),
      now: () => NOW,
    })
    await racing.submit(parsed())
    const first = fake.rows("guarantors").find((g) => g.fields.slot === slotOf(req.id, 1))
    expect(first?.fields).toMatchObject({ status: "invited", "token-hash": "sent-link" })
    expect(fake.rows("guarantors").filter((g) => g.fields.status === "pending")).toHaveLength(2)
  })

  it("initializes a guarantor left without status by an interrupted call", async () => {
    const { fake, repo } = setup()
    const req = fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN })
    for (const p of [1, 2, 3]) fake.seed("guarantors", { slot: slotOf(req.id, p), request: [req.id], position: p, ...(p === 2 ? {} : { status: "pending", "token-hash": `h${p}` }) })
    await repo.submit(parsed())
    const g2 = fake.rows("guarantors").find((g) => g.fields.position === 2)!
    expect(g2.fields.status).toBe("pending")
    expect(g2.fields["token-hash"]).toMatch(/^[0-9a-f]{64}$/)
    expect(fake.rows("guarantors").find((g) => g.fields.position === 1)!.fields["token-hash"]).toBe("h1")
  })

  it("fails (never reports ok) when the write did not leave three guarantors with a status", async () => {
    const { fake } = setup()
    // Airtable answers 200 to the guarantor upsert but nothing is stored.
    const lossy = createAvalesRepo({
      airtable: createAirtableClient({
        token: "t",
        baseId: "appTEST0000000000",
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          if (init?.method === "PATCH" && String(url).includes("/guarantors") && String(init.body).includes("performUpsert")) {
            return new Response(JSON.stringify({ records: [], createdRecords: [], updatedRecords: [] }), { status: 200 })
          }
          return fake.fetch(url, init)
        }) as typeof fetch,
      }),
      now: () => NOW,
    })
    await expect(lossy.submit(parsed())).rejects.toThrow("Guarantors incomplete after write")
    expect(fake.rows("guarantors")).toHaveLength(0)
  })

  it("does not complete a request whose deadline passed, even if the job has not run", async () => {
    const { fake, repo } = setup()
    fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": "2026-11-22T11:00:00.000Z" })
    expect(await repo.submit(parsed())).toMatchObject({ reused: true, open: false, expiresAt: "2026-11-22T11:00:00.000Z" })
    expect(fake.rows("guarantors")).toHaveLength(0)
  })

  it("returns a resolved request as is, without adding guarantors", async () => {
    const { fake, repo } = setup()
    const req = fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "expired", "expires-at": "2026-11-20T00:00:00.000Z" })
    expect(await repo.submit(parsed())).toEqual({ requestId: req.id, expiresAt: "2026-11-20T00:00:00.000Z", requestedAmount: 1000, reused: true, open: false })
    expect(fake.rows("guarantors")).toHaveLength(0)
  })

  it("uses the oldest request when two share an authorization", async () => {
    const { fake, repo } = setup()
    const older = fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN }, "2026-11-22T11:00:00.000Z")
    fake.seed("requests", { authorization: "TEST-AVALES-unit-0001", status: "pending_guarantors", "expires-at": OPEN }, "2026-11-22T11:00:01.000Z")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect((await repo.submit(parsed())).requestId).toBe(older.id)
    expect(fake.rows("guarantors")).toHaveLength(3)
    expect(fake.rows("guarantors").every((g) => (g.fields.request as string[])[0] === older.id)).toBe(true)
  })

  it("never stores or sends a clear token, only its SHA-256", async () => {
    const { fake, repo, issued } = setup()
    await repo.submit(parsed())

    expect(issued).toHaveLength(3)
    const wire = fake.calls.map((c) => `${c.url} ${c.body ?? ""}`).join("\n")
    const stored = JSON.stringify({ r: fake.rows("requests"), g: fake.rows("guarantors") })
    for (const token of issued) {
      expect(wire).not.toContain(token)
      expect(stored).not.toContain(token)
      expect(stored).toContain(hashToken(token))
    }
  })
})

describe("view", () => {
  async function seeded(opts: { guarantor?: string; request?: string; expiresAt?: string } = {}) {
    const ctx = setup()
    const req = ctx.fake.seed("requests", {
      authorization: "TEST-AVALES-unit-0001",
      "full-name": "Solicitante De Prueba",
      "requested-amount": 1000,
      status: opts.request ?? "pending_guarantors",
      "expires-at": opts.expiresAt ?? "2026-11-24T12:00:00.000Z",
    })
    const token = generateToken()
    ctx.fake.seed("guarantors", {
      request: [req.id],
      position: 1,
      "full-name": "Aval Uno",
      phone: PII.phones[0],
      identification: PII.dpis[0],
      relationship: "hermano/a",
      "token-hash": hashToken(token),
      status: opts.guarantor ?? "invited",
    })
    ctx.fake.seed("guarantors", { request: [req.id], position: 2, "full-name": "Aval Dos", phone: PII.phones[1], "token-hash": hashToken(generateToken()), status: "pending" })
    return { ...ctx, token }
  }

  const base = { applicantFirstName: "Solicitante", amount: 1000, expiresAt: "2026-11-24T12:00:00.000Z" }

  it("form: open guarantor on an open request, with only its own data", async () => {
    const { repo, token } = await seeded()
    const view = await repo.view(token)
    expect(view).toEqual({
      ...base,
      screen: "form",
      guarantor: { fullName: "Aval Uno", phone: PII.phones[0], identification: PII.dpis[0], relationship: "hermano/a" },
      identityMismatch: false,
    })
    expect(JSON.stringify(view)).not.toContain("Aval Dos")
    expect(JSON.stringify(view)).not.toContain(PII.phones[1])
  })

  it("form with identityMismatch after a RENAP mismatch; pending also shows the form", async () => {
    const m = await seeded({ guarantor: "identity_mismatch" })
    expect(await m.repo.view(m.token)).toMatchObject({ screen: "form", identityMismatch: true })
    const p = await seeded({ guarantor: "pending" })
    expect(await p.repo.view(p.token)).toMatchObject({ screen: "form", identityMismatch: false })
  })

  it("answered: authorized or rejected", async () => {
    const a = await seeded({ guarantor: "authorized" })
    expect(await a.repo.view(a.token)).toEqual({ ...base, screen: "answered", answer: "authorized" })
    const r = await seeded({ guarantor: "rejected", request: "rejected" })
    expect(await r.repo.view(r.token)).toEqual({ ...base, screen: "answered", answer: "rejected" })
  })

  it("closed: guarantor closed, or the request already resolved", async () => {
    const c = await seeded({ guarantor: "closed", request: "quorum" })
    expect(await c.repo.view(c.token)).toEqual({ ...base, screen: "closed" })
    for (const request of ["quorum", "releasing", "disbursed", "release_failed", "rejected", "not_approved"]) {
      const s = await seeded({ request })
      expect((await s.repo.view(s.token)).screen).toBe("closed")
    }
  })

  it("expired: by status, or by expires-at even before the job runs", async () => {
    const g = await seeded({ guarantor: "expired", request: "expired" })
    expect(await g.repo.view(g.token)).toEqual({ ...base, screen: "expired" })
    const late = await seeded({ expiresAt: "2026-11-22T11:59:59.000Z" })
    expect(await late.repo.view(late.token)).toEqual({ ...base, expiresAt: "2026-11-22T11:59:59.000Z", screen: "expired" })
    const missing = await seeded({ expiresAt: "" })
    expect((await missing.repo.view(missing.token)).screen).toBe("expired")
  })

  it("invalid: unknown token, malformed token (no storage call) or missing request", async () => {
    const { repo, fake } = await seeded()
    expect(await repo.view(generateToken())).toEqual({ screen: "invalid" })
    const before = fake.calls.length
    expect(await repo.view("not-a-token")).toEqual({ screen: "invalid" })
    expect(await repo.view("' OR 1=1 OR '")).toEqual({ screen: "invalid" })
    expect(fake.calls.length).toBe(before)

    const orphanToken = generateToken()
    fake.seed("guarantors", { request: ["rec99999999999999"], "token-hash": hashToken(orphanToken), status: "pending" })
    expect(await repo.view(orphanToken)).toEqual({ screen: "invalid" })
  })

  it("issueGuarantorToken rotates the link: the old token stops working", async () => {
    const { repo, fake, token } = await seeded()
    const id = fake.rows("guarantors")[0].id
    const fresh = await repo.issueGuarantorToken(id)
    expect(fake.rows("guarantors")[0].fields["token-hash"]).toBe(hashToken(fresh))
    expect(await repo.view(token)).toEqual({ screen: "invalid" })
    expect((await repo.view(fresh)).screen).toBe("form")
    await expect(repo.issueGuarantorToken("bad")).rejects.toThrow("Invalid guarantor id")
  })

  it("issueGuarantorToken refuses a guarantor that already answered", async () => {
    const { repo, fake, token } = await seeded({ guarantor: "authorized" })
    await expect(repo.issueGuarantorToken(fake.rows("guarantors")[0].id)).rejects.toThrow("Guarantor cannot receive a link")
    expect((await repo.view(token)).screen).toBe("answered")
  })
})

describe("resolveView", () => {
  it("prefers answered over expired, and fails closed on unknown statuses", () => {
    const g = (status: string) => ({ id: "recG", createdTime: "", fields: { status } }) as never
    const r = (status: string, exp = "2026-11-20T00:00:00.000Z") =>
      ({ id: "recR", createdTime: "", fields: { status, "expires-at": exp, "full-name": "Ana", "requested-amount": 5 } }) as never
    expect(resolveView(g("authorized"), r("expired"), NOW).screen).toBe("answered")
    expect(resolveView(g("weird"), r("pending_guarantors", "2026-12-01T00:00:00.000Z"), NOW).screen).toBe("closed")
  })
})

describe("lib/airtable errors", () => {
  let fake: ReturnType<typeof createFakeAirtable>
  beforeEach(() => {
    fake = createFakeAirtable()
  })
  afterEach(() => vi.restoreAllMocks())

  it("carry status and type only, never the response body", async () => {
    const client = createAirtableClient({ token: "t", baseId: "appTEST0000000000", fetch: fake.fetch })
    fake.failNext(422, JSON.stringify({ error: { type: "INVALID_VALUE_FOR_COLUMN", message: `bad ${PII.dpis[0]}` } }))
    const error = await client.list("guarantors").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AirtableError)
    expect((error as AirtableError).message).toBe("Airtable GET guarantors failed: 422 INVALID_VALUE_FOR_COLUMN")
    expect((error as AirtableError).message).not.toContain(PII.dpis[0])
  })

  it("a 404 on a list is an error (wrong base or table), not an empty result", async () => {
    const client = createAirtableClient({ token: "t", baseId: "appTEST0000000000", fetch: fake.fetch })
    fake.failOn("GET", "guarantors", 404)
    await expect(client.list("guarantors")).rejects.toThrow("Airtable GET guarantors failed: 404 INJECTED_FAILURE")
  })

  it("formulaString escapes quotes and backslashes", () => {
    expect(formulaString("abc")).toBe("'abc'")
    expect(formulaString("a'b")).toBe("'a\\'b'")
    expect(formulaString("a\\'); OR(1")).toBe("'a\\\\\\'); OR(1'")
  })

  it("sends the token only in the Authorization header", async () => {
    const spy = vi.fn(fake.fetch)
    const client = createAirtableClient({ token: "secret-token", baseId: "appTEST0000000000", fetch: spy as typeof fetch })
    await client.list("requests")
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).not.toContain("secret-token")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token")
  })
})
