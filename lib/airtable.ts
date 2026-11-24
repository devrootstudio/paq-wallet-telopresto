/**
 * Minimal Airtable REST client (fetch only, no dependencies). Server-side only.
 *
 * Privacy: records hold PII (DPI, phones). This module never logs, and its errors carry only the
 * HTTP method, table, status and Airtable's error type: never request or response bodies.
 */

const API_URL = "https://api.airtable.com/v0"
/** Airtable accepts at most 10 records per write request. */
const WRITE_BATCH = 10
/** Default per-request timeout. The guarantor job's release claim waits longer than this. */
export const AIRTABLE_TIMEOUT_MS = 10_000

export type Fields = Record<string, unknown>

export interface AirtableRecord<F extends Fields = Fields> {
  id: string
  createdTime: string
  fields: F
}

export interface ListOptions {
  filterByFormula?: string
  maxRecords?: number
  fields?: string[]
}

export interface UpsertResult<F extends Fields = Fields> {
  records: AirtableRecord<F>[]
  createdRecords: string[]
  updatedRecords: string[]
}

export interface UpdateOptions {
  /** Overrides the client default for this call (0 = do not retry a 429). */
  rateLimitRetries?: number
  /** Let Airtable coerce values, e.g. create a missing select option. */
  typecast?: boolean
}

export interface AirtableClient {
  /** All records matching the options (follows pagination up to `maxRecords`). */
  list<F extends Fields = Fields>(table: string, options?: ListOptions): Promise<AirtableRecord<F>[]>
  /** One record by id, or null when it does not exist. */
  get<F extends Fields = Fields>(table: string, id: string): Promise<AirtableRecord<F> | null>
  create<F extends Fields = Fields>(table: string, records: Fields[]): Promise<AirtableRecord<F>[]>
  /** `rateLimitRetries` overrides the client default for this call (0 = do not retry a 429). */
  update<F extends Fields = Fields>(table: string, records: { id: string; fields: Fields }[], opts?: UpdateOptions): Promise<AirtableRecord<F>[]>
  /** Create-or-update matching on `mergeOn` (Airtable `performUpsert`). */
  upsert<F extends Fields = Fields>(table: string, records: Fields[], mergeOn: string[]): Promise<UpsertResult<F>>
}

export class AirtableError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    method: string,
    table: string,
  ) {
    super(`Airtable ${method} ${table} failed: ${status} ${type}`)
    this.name = "AirtableError"
  }
}

export interface AirtableClientOptions {
  token: string
  baseId: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Retries after a 429, waiting 1 s, 2 s… Default 2. */
  rateLimitRetries?: number
  sleep?: (ms: number) => Promise<void>
  /** Aborts every request of this client (e.g. an overall time budget), on top of the per-request timeout. */
  signal?: AbortSignal
}

/** Quotes a value for use inside an Airtable formula string literal. */
export function formulaString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID.test(value)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function errorType(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string | { type?: string } }
    if (typeof body.error === "string") return body.error
    if (body.error && typeof body.error.type === "string") return body.error.type
  } catch {
    // Body is not JSON: fall through. Never surface it.
  }
  return "UNKNOWN"
}

export function createAirtableClient(options: AirtableClientOptions): AirtableClient {
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? AIRTABLE_TIMEOUT_MS
  const tableUrl = (table: string) => `${API_URL}/${options.baseId}/${encodeURIComponent(table)}`

  const retries = options.rateLimitRetries ?? 2
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  async function request<T>(
    method: string,
    table: string,
    url: string,
    body?: unknown,
    notFoundIsNull = false,
    maxRetries = retries,
  ): Promise<T | null> {
    let response: Response
    for (let attempt = 0; ; attempt++) {
      try {
        response = await doFetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${options.token}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: options.signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), options.signal]) : AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        })
      } catch (error) {
        const type = error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK"
        throw new AirtableError(0, type, method, table)
      }
      // 429 = rate limited (5 requests/s per base): the request was not applied, so retrying is safe.
      if (response.status !== 429 || attempt >= maxRetries) break
      await sleep(1000 * 2 ** attempt)
    }
    // Only a single-record read maps 404 to null: on a list, 404 means a wrong base or table.
    if (notFoundIsNull && response.status === 404) return null
    if (!response.ok) throw new AirtableError(response.status, await errorType(response), method, table)
    return (await response.json()) as T
  }

  return {
    async list<F extends Fields>(table: string, opts: ListOptions = {}) {
      const records: AirtableRecord<F>[] = []
      let offset: string | undefined
      do {
        const params = new URLSearchParams()
        if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula)
        if (opts.maxRecords) params.set("maxRecords", String(opts.maxRecords))
        for (const field of opts.fields ?? []) params.append("fields[]", field)
        if (offset) params.set("offset", offset)
        const page = await request<{ records: AirtableRecord<F>[]; offset?: string }>(
          "GET",
          table,
          `${tableUrl(table)}?${params.toString()}`,
        )
        records.push(...(page?.records ?? []))
        offset = page?.offset
      } while (offset && (!opts.maxRecords || records.length < opts.maxRecords))
      return records
    },

    async get<F extends Fields>(table: string, id: string) {
      if (!isRecordId(id)) return null
      return request<AirtableRecord<F>>("GET", table, `${tableUrl(table)}/${id}`, undefined, true)
    },

    async create<F extends Fields>(table: string, records: Fields[]) {
      const out: AirtableRecord<F>[] = []
      for (const batch of chunk(records, WRITE_BATCH)) {
        const res = await request<{ records: AirtableRecord<F>[] }>("POST", table, tableUrl(table), {
          records: batch.map((fields) => ({ fields })),
        })
        out.push(...(res?.records ?? []))
      }
      return out
    },

    async update<F extends Fields>(table: string, records: { id: string; fields: Fields }[], opts?: UpdateOptions) {
      const out: AirtableRecord<F>[] = []
      for (const batch of chunk(records, WRITE_BATCH)) {
        const res = await request<{ records: AirtableRecord<F>[] }>("PATCH", table, tableUrl(table), { records: batch, ...(opts?.typecast ? { typecast: true } : {}) }, false, opts?.rateLimitRetries ?? retries)
        out.push(...(res?.records ?? []))
      }
      return out
    },

    async upsert<F extends Fields>(table: string, records: Fields[], mergeOn: string[]) {
      const out: UpsertResult<F> = { records: [], createdRecords: [], updatedRecords: [] }
      for (const batch of chunk(records, WRITE_BATCH)) {
        const res = await request<UpsertResult<F>>("PATCH", table, tableUrl(table), {
          performUpsert: { fieldsToMergeOn: mergeOn },
          records: batch.map((fields) => ({ fields })),
        })
        out.records.push(...(res?.records ?? []))
        out.createdRecords.push(...(res?.createdRecords ?? []))
        out.updatedRecords.push(...(res?.updatedRecords ?? []))
      }
      return out
    },
  }
}

/** Client from `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID`, or null when either is missing. */
export function airtableFromEnv(options: Omit<AirtableClientOptions, "token" | "baseId"> = {}): AirtableClient | null {
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  if (!token || !baseId) return null
  return createAirtableClient({ ...options, token, baseId })
}
