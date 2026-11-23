import { formulaString, isRecordId, type AirtableClient, type AirtableRecord } from "@/lib/airtable"
import type { ParsedGuarantorRequest } from "./schema"
import { generateToken, hashToken, isWellFormedToken } from "./tokens"
import type { GuarantorView, Relationship } from "./types"

/**
 * Storage for the guarantor route on Airtable (contract docs/contracts/avales.md §2–§5).
 * Server-side only.
 *
 * Privacy: never log DPI, phones, names, tokens or record contents from here.
 *
 * Tokens: `submit` creates each guarantor with the hash of a fresh token and discards the clear
 * token; it is never returned to the browser. The invitation step (WhatsApp) must call
 * `issueGuarantorToken(guarantorId)` when it sends the link: it rotates the stored hash and returns
 * the only clear copy of the new token. Any earlier link for that guarantor stops working.
 *
 * Idempotency (Airtable has no unique constraint):
 * - requests are keyed by `authorization` (lookup, then `performUpsert` on it);
 * - guarantors are keyed by `slot` = `<request id>:<position>` (`performUpsert` on it), so any
 *   retry completes the missing positions and never creates a second guarantor for a position.
 */

export const TABLES = { requests: "requests", guarantors: "guarantors", leads: "guarantor-leads" } as const

/** Requests accept answers for 48 h (contract §2). */
export const EXPIRY_MS = 48 * 60 * 60 * 1000

const POSITIONS = [1, 2, 3] as const

export type RequestStatus =
  | "pending_guarantors"
  | "quorum"
  | "releasing"
  | "disbursed"
  | "release_failed"
  | "expired"
  | "rejected"
  | "not_approved"

export type GuarantorStatus =
  | "pending"
  | "invited"
  | "authorized"
  | "rejected"
  | "identity_mismatch"
  | "closed"
  | "expired"

export interface RequestFields {
  [key: string]: unknown
  authorization?: string
  phone?: string
  identification?: string
  "full-name"?: string
  email?: string
  company?: string
  age?: string
  "marital-status"?: string
  address?: string
  "cupo-id"?: string
  "approved-amount"?: number
  "requested-amount"?: number
  commission?: number
  "commission-pct"?: number
  status?: RequestStatus
  "expires-at"?: string
  "release-code"?: string
  "release-claim"?: string
  audit?: string
}

export interface GuarantorFields {
  [key: string]: unknown
  slot?: string
  "full-name"?: string
  request?: string[]
  position?: number
  phone?: string
  identification?: string
  relationship?: Relationship
  "token-hash"?: string
  status?: GuarantorStatus
  "invited-at"?: string
  "answered-at"?: string
  "renap-result"?: string
  "renap-raw"?: string
  evidence?: string
  "guarantor-leads"?: string[]
  /** `<attempt>@<epoch ms>` while an answer is being processed (lib/avales/answer.ts). */
  "answer-claim"?: string
}

export interface SubmitOutcome {
  requestId: string
  expiresAt: string
  requestedAmount: number
  reused: boolean
  open: boolean
}

export interface AvalesRepoDeps {
  airtable: AirtableClient
  now?: () => Date
  newToken?: () => string
}

/** Idempotency key of a guarantor. */
export function slotOf(requestId: string, position: number): string {
  return `${requestId}:${position}`
}

function byCreation(a: AirtableRecord, b: AirtableRecord) {
  return a.createdTime === b.createdTime ? a.id.localeCompare(b.id) : a.createdTime.localeCompare(b.createdTime)
}

function requestFields(input: ParsedGuarantorRequest, expiresAt: string) {
  const a = input.applicant
  return {
    authorization: input.authorization,
    phone: a.phone,
    identification: a.identification,
    "full-name": a.fullName,
    email: a.email,
    company: a.company,
    age: a.age,
    "marital-status": a.maritalStatus,
    address: a.address,
    "cupo-id": input.cupoId,
    "approved-amount": input.approvedAmount,
    "requested-amount": input.requestedAmount,
    commission: input.commission,
    "commission-pct": input.commissionPct,
    status: "pending_guarantors" satisfies RequestStatus,
    "expires-at": expiresAt,
    audit: JSON.stringify(input.audit),
  }
}

/** Applicant's full name, trimmed and with single spaces: what the guarantor sees. */
export function displayName(fullName: string | undefined): string {
  return (fullName ?? "").trim().replace(/\s+/g, " ")
}

/** First word of the applicant's name (kept for `applicantFirstName`). */
export function firstName(fullName: string | undefined): string {
  return displayName(fullName).split(" ")[0] ?? ""
}

/**
 * Which screen /aval/<token> shows (contract §4). Pure, for tests and for later tasks.
 * Order: answered > expired > closed > form. Fails closed: missing or unknown data never shows the form.
 */
export function resolveView(
  guarantor: AirtableRecord<GuarantorFields>,
  request: AirtableRecord<RequestFields>,
  now: Date,
): GuarantorView {
  const g = guarantor.fields
  const r = request.fields
  const expiresAt = r["expires-at"] ?? ""
  const base = {
    applicantName: displayName(r["full-name"]),
    applicantFirstName: firstName(r["full-name"]),
    amount: r["requested-amount"] ?? 0,
    expiresAt,
  }
  const expiresMs = Date.parse(expiresAt)
  const pastDeadline = Number.isNaN(expiresMs) || now.getTime() >= expiresMs

  if (g.status === "authorized" || g.status === "rejected") return { ...base, screen: "answered", answer: g.status }
  if (g.status === "expired" || r.status === "expired" || (r.status === "pending_guarantors" && pastDeadline)) {
    return { ...base, screen: "expired" }
  }
  if (g.status === "closed" || r.status !== "pending_guarantors") return { ...base, screen: "closed" }
  if (g.status === "pending" || g.status === "invited" || g.status === "identity_mismatch") {
    return {
      ...base,
      screen: "form",
      guarantor: {
        fullName: g["full-name"] ?? "",
        phone: g.phone ?? "",
        identification: g.identification ?? "",
        relationship: (g.relationship ?? "otro") as Relationship,
      },
      identityMismatch: g.status === "identity_mismatch",
    }
  }
  return { ...base, screen: "closed" }
}

export function createAvalesRepo(deps: AvalesRepoDeps) {
  const { airtable } = deps
  const now = deps.now ?? (() => new Date())
  const newToken = deps.newToken ?? generateToken

  async function findRequests(authorization: string) {
    const found = await airtable.list<RequestFields>(TABLES.requests, {
      filterByFormula: `{authorization} = ${formulaString(authorization)}`,
    })
    return found.sort(byCreation)
  }

  async function guarantorsOf(requestId: string) {
    const slots = POSITIONS.map((p) => `{slot} = ${formulaString(slotOf(requestId, p))}`)
    return airtable.list<GuarantorFields>(TABLES.guarantors, { filterByFormula: `OR(${slots.join(", ")})` })
  }

  /**
   * Makes sure the request has its three guarantors, in two steps:
   * 1. missing positions are written through an upsert on `slot` carrying only the applicant's data,
   *    so a concurrent upsert that lands on an existing guarantor never touches its `status` or
   *    `token-hash` (an invited guarantor keeps its link);
   * 2. guarantors without a status (just created, or left half-written) get `pending` and a hash.
   * The job only acts on guarantors with a status, so step 1 alone never triggers anything.
   */
  async function ensureGuarantors(requestId: string, input: ParsedGuarantorRequest) {
    let rows = await guarantorsOf(requestId)
    const present = new Set(rows.map((g) => g.fields.slot))
    const missing = POSITIONS.filter((p) => !present.has(slotOf(requestId, p)))
    if (missing.length > 0) {
      await writeGuarantors(requestId, input, missing)
      rows = await guarantorsOf(requestId)
    }
    const uninitialized = rows.filter((row) => !row.fields.status)
    if (uninitialized.length > 0) {
      await airtable.update(
        TABLES.guarantors,
        uninitialized.map((row) => ({
          id: row.id,
          // The clear token is discarded on purpose: see issueGuarantorToken.
          fields: { "token-hash": hashToken(newToken()), status: "pending" satisfies GuarantorStatus },
        })),
      )
      for (const row of uninitialized) row.fields.status = "pending"
    }
    await closeDuplicateSlots(rows)

    // Never report success without one guarantor with a status per position (→ `unavailable`, retry).
    const ready = new Set(rows.filter((row) => row.fields.status).map((row) => row.fields.slot))
    if (!POSITIONS.every((p) => ready.has(slotOf(requestId, p)))) throw new Error("Guarantors incomplete after write")
  }

  /**
   * Safety net in case Airtable ever let two upserts create the same slot: the oldest guarantor of
   * each slot stays, the extra `pending` ones become `closed` so they are never invited or counted.
   * Deterministic, so concurrent callers close the same records.
   */
  async function closeDuplicateSlots(rows: AirtableRecord<GuarantorFields>[]) {
    const bySlot = new Map<string, AirtableRecord<GuarantorFields>[]>()
    for (const row of rows) {
      const slot = row.fields.slot ?? ""
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), row])
    }
    const extras = [...bySlot.values()]
      .filter((group) => group.length > 1)
      .flatMap((group) => group.sort(byCreation).slice(1))
      .filter((row) => row.fields.status === "pending")
    if (extras.length === 0) return
    console.warn(`[avales] closing ${extras.length} duplicate guarantor record(s)`)
    await airtable.update(
      TABLES.guarantors,
      extras.map((row) => ({ id: row.id, fields: { status: "closed" satisfies GuarantorStatus } })),
    )
  }

  async function writeGuarantors(requestId: string, input: ParsedGuarantorRequest, missing: number[]) {
    await airtable.upsert(
      TABLES.guarantors,
      missing.map((position) => {
        const g = input.guarantors[position - 1]
        return {
          slot: slotOf(requestId, position),
          "full-name": g.fullName,
          request: [requestId],
          position,
          phone: g.phone,
          identification: g.identification,
          relationship: g.relationship,
        }
      }),
      ["slot"],
    )
  }

  /** The oldest request with this authorization; warns (ids only) when there is more than one. */
  function canonicalOf(found: AirtableRecord<RequestFields>[]) {
    if (found.length > 1) console.warn(`[avales] ${found.length} requests share one authorization; using ${found[0].id}`)
    return found[0]
  }

  /**
   * Stores the request and its three guarantors. Idempotent by `authorization`; a retry returns the
   * existing request (`reused: true`) and completes any guarantor an interrupted call left missing.
   *
   * `open` is true while the request still accepts answers (`pending_guarantors`, deadline ahead).
   * Only an open request is completed; a resolved or past-deadline one is returned as is.
   *
   * Limitations (Airtable has no unique constraint nor conditional writes):
   * - if Airtable ever processed two upserts on the same `authorization` at the very same moment, two
   *   requests would exist. The post-write check makes every caller converge on the oldest one and
   *   only that one gets guarantors; the newer stays as an empty `pending_guarantors` record (no
   *   guarantors) that the job must ignore;
   * - a retry never compares its data with what is stored: the existing request wins. But when two
   *   instances submit the same `authorization` with different data at the same moment (both miss
   *   the lookup), the second upsert overwrites the request fields written by the first; guarantors
   *   keep the data of whichever call created each position.
   */
  async function submit(input: ParsedGuarantorRequest): Promise<SubmitOutcome> {
    const existing = await findRequests(input.authorization)
    if (existing.length > 0) {
      const canonical = canonicalOf(existing)
      const open = isOpen(canonical)
      if (open) await ensureGuarantors(canonical.id, input)
      return {
        requestId: canonical.id,
        expiresAt: canonical.fields["expires-at"] ?? "",
        requestedAmount: canonical.fields["requested-amount"] ?? input.requestedAmount,
        reused: true,
        open,
      }
    }

    const expiresAt = new Date(now().getTime() + EXPIRY_MS).toISOString()
    const upserted = await airtable.upsert<RequestFields>(TABLES.requests, [requestFields(input, expiresAt)], ["authorization"])
    const own = upserted.records[0]
    if (!own) throw new Error("Airtable upsert returned no record")

    const after = await findRequests(input.authorization)
    const canonical = after.length > 0 ? canonicalOf(after) : own
    const open = isOpen(canonical)
    if (open) await ensureGuarantors(canonical.id, input)
    const created = canonical.id === own.id && upserted.createdRecords.includes(own.id)
    return {
      requestId: canonical.id,
      expiresAt: canonical.fields["expires-at"] ?? expiresAt,
      requestedAmount: canonical.fields["requested-amount"] ?? input.requestedAmount,
      reused: !created,
      open,
    }
  }

  function isOpen(request: AirtableRecord<RequestFields>): boolean {
    const deadline = Date.parse(request.fields["expires-at"] ?? "")
    return request.fields.status === "pending_guarantors" && now().getTime() < deadline
  }

  /** Resolves /aval/<token>. Unknown or malformed tokens give `invalid` without touching storage. */
  async function view(token: string): Promise<GuarantorView> {
    const found = await findByToken(token)
    if (!found) return { screen: "invalid" }
    return resolveView(found.guarantor, found.request, now())
  }

  /** The guarantor a link token belongs to and its request, or null for an unknown/malformed token. */
  async function findByToken(token: string) {
    const guarantor = await findGuarantorByToken(token)
    const requestId = guarantor?.fields.request?.[0]
    if (!guarantor || !requestId) return null
    const request = await airtable.get<RequestFields>(TABLES.requests, requestId)
    if (!request) return null
    return { guarantor, request }
  }

  /** Only the guarantor a link token belongs to (one Airtable call), or null. */
  async function findGuarantorByToken(token: string) {
    if (!isWellFormedToken(token)) return null
    const matches = await airtable.list<GuarantorFields>(TABLES.guarantors, {
      filterByFormula: `{token-hash} = ${formulaString(hashToken(token))}`,
      maxRecords: 1,
    })
    return matches[0] ?? null
  }

  /**
   * For the invitation step: issues a new link token for one guarantor that can still answer
   * (`pending`, `invited`, `identity_mismatch`), stores only its hash and returns the clear token
   * (the only copy). Call it right before sending the link. Never expose it as a server action.
   */
  async function issueGuarantorToken(guarantorId: string): Promise<string> {
    if (!isRecordId(guarantorId)) throw new Error("Invalid guarantor id")
    const current = await airtable.get<GuarantorFields>(TABLES.guarantors, guarantorId)
    const status = current?.fields.status
    if (status !== "pending" && status !== "invited" && status !== "identity_mismatch") {
      throw new Error("Guarantor cannot receive a link")
    }
    const token = newToken()
    await airtable.update(TABLES.guarantors, [{ id: guarantorId, fields: { "token-hash": hashToken(token) } }])
    return token
  }

  return { submit, view, findByToken, findGuarantorByToken, issueGuarantorToken, guarantorsOf, isOpen }
}

export type AvalesRepo = ReturnType<typeof createAvalesRepo>
