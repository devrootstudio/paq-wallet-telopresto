/**
 * In-memory stand-in for the Airtable REST API, served through a fake `fetch`.
 * Supports exactly what lib/airtable.ts sends: list (with the formulas lib/avales/repo.ts builds),
 * get, create, update and performUpsert (atomic by default, or not, per table, to simulate races).
 * Also keeps the requests.guarantors inverse link like Airtable (the code does not rely on it).
 */

type Fields = Record<string, unknown>
interface Rec {
  id: string
  createdTime: string
  fields: Fields
}

export interface FakeCall {
  method: string
  url: string
  body?: string
}

export function createFakeAirtable(options: { now?: () => Date; nonAtomicUpsertTables?: string[] } = {}) {
  const tables = new Map<string, Rec[]>()
  const calls: FakeCall[] = []
  let seq = 0
  let failNext: { status: number; body: string } | null = null
  const failRules: { method: string; table: string; status: number }[] = []
  /** On these tables an upsert decides on a snapshot and writes later, so two concurrent upserts can both create. */
  const nonAtomic = new Set(options.nonAtomicUpsertTables ?? [])
  const now = options.now ?? (() => new Date())

  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }
  const newId = () => `rec${String(++seq).padStart(14, "0")}`
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  function link(rec: Rec) {
    const requestIds = rec.fields.request as string[] | undefined
    for (const rid of requestIds ?? []) {
      const parent = table("requests").find((r) => r.id === rid)
      if (parent) parent.fields.guarantors = [...((parent.fields.guarantors as string[]) ?? []), rec.id]
    }
  }

  function insert(name: string, fields: Fields): Rec {
    const rec: Rec = { id: newId(), createdTime: now().toISOString(), fields: { ...fields } }
    table(name).push(rec)
    if (name === "guarantors") link(rec)
    return rec
  }

  /** Supports `{field} = '…'`, `RECORD_ID() = '…'` and `OR(<those>, …)`. */
  function matcher(formula: string | null): (r: Rec) => boolean {
    if (!formula) return () => true
    const unquote = (s: string) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\")
    const clause = /(\{[^}]+\}|RECORD_ID\(\)) = ('(?:[^'\\]|\\.)*')/g
    const inner = formula.match(/^OR\((.*)\)$/)?.[1] ?? formula
    const clauses = [...inner.matchAll(clause)].map((m) => ({ left: m[1], value: unquote(m[2]) }))
    const rebuilt = [...inner.matchAll(clause)].map((m) => m[0]).join(", ")
    if (clauses.length === 0 || rebuilt !== inner) throw new Error(`fake airtable: unsupported formula ${formula}`)
    return (r) =>
      clauses.some(({ left, value }) => (left === "RECORD_ID()" ? r.id === value : r.fields[left.slice(1, -1)] === value))
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? init.body : undefined
    calls.push({ method, url: url.toString(), body })
    // Let concurrent callers interleave, as real network calls would.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (failNext) {
      const f = failNext
      failNext = null
      return new Response(f.body, { status: f.status })
    }
    const [, , , rawTable, id] = url.pathname.split("/")
    const name = decodeURIComponent(rawTable)
    const rows = table(name)
    const rule = failRules.findIndex((r) => r.method === method && r.table === name)
    if (rule >= 0) {
      const [r] = failRules.splice(rule, 1)
      return json(r.status, { error: { type: "INJECTED_FAILURE" } })
    }

    if (method === "GET" && id) {
      const rec = rows.find((r) => r.id === id)
      return rec ? json(200, rec) : json(404, { error: "NOT_FOUND" })
    }
    if (method === "GET") {
      let found = rows.filter(matcher(url.searchParams.get("filterByFormula")))
      const max = Number(url.searchParams.get("maxRecords") || 0)
      if (max) found = found.slice(0, max)
      return json(200, { records: found })
    }
    const payload = JSON.parse(body ?? "{}") as {
      records: { id?: string; fields: Fields }[]
      performUpsert?: { fieldsToMergeOn: string[] }
    }
    if (method === "POST") {
      return json(200, { records: payload.records.map((r) => insert(name, r.fields)) })
    }
    if (method === "PATCH" && payload.performUpsert) {
      const keys = payload.performUpsert.fieldsToMergeOn
      const out = { records: [] as Rec[], createdRecords: [] as string[], updatedRecords: [] as string[] }
      for (const r of payload.records) {
        let match = rows.filter((row) => keys.every((k) => row.fields[k] === r.fields[k]))
        if (nonAtomic.has(name)) {
          // Decide on the snapshot, then yield so a concurrent upsert decides on the same snapshot.
          match = match.slice()
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
        }
        if (match.length > 1) return json(422, { error: { type: "INVALID_MULTIPLE_MATCHES" } })
        if (match.length === 1) {
          Object.assign(match[0].fields, r.fields)
          out.records.push(match[0])
          out.updatedRecords.push(match[0].id)
        } else {
          const rec = insert(name, r.fields)
          out.records.push(rec)
          out.createdRecords.push(rec.id)
        }
      }
      return json(200, out)
    }
    if (method === "PATCH") {
      const updated = payload.records.map((r) => {
        const rec = rows.find((row) => row.id === r.id)
        if (!rec) throw new Error("fake airtable: update of unknown record")
        Object.assign(rec.fields, r.fields)
        return rec
      })
      return json(200, { records: updated })
    }
    return json(405, { error: "METHOD_NOT_ALLOWED" })
  }

  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    rows: (name: string) => table(name),
    /** Seeds a record directly (bypasses the API). */
    seed: (name: string, fields: Fields, createdTime?: string) => {
      const rec = insert(name, fields)
      if (createdTime) rec.createdTime = createdTime
      return rec
    },
    failNext: (status: number, body: string) => {
      failNext = { status, body }
    },
    /** Fails the next request with this method on this table. */
    failOn: (method: string, tableName: string, status = 500) => {
      failRules.push({ method, table: tableName, status })
    },
  }
}
