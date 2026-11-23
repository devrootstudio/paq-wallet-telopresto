import { NextResponse } from "next/server"
import { airtableFromEnv, formulaString } from "@/lib/airtable"
import { TABLES, type RequestFields } from "@/lib/avales/repo"
import { devToolsEnabled, isTestAuthorization, noStore, notFound } from "../../_lib/guard"

/**
 * Development only: moves `expires-at` of a TEST-AVALES-* request one minute into the past, so the
 * e2e can check expiry without waiting 48 h. POST /dev/avales/api/vencer?auth=TEST-AVALES-<id>.
 * Only touches requests still in `pending_guarantors`; never deletes anything.
 */
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!devToolsEnabled()) return notFound()
  const auth = new URL(request.url).searchParams.get("auth")
  if (!isTestAuthorization(auth)) {
    return NextResponse.json({ error: "auth must be TEST-AVALES-*" }, { status: 400, headers: noStore })
  }
  const airtable = airtableFromEnv()
  if (!airtable) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: noStore })

  const [req] = await airtable.list<RequestFields>(TABLES.requests, {
    filterByFormula: `{authorization} = ${formulaString(auth)}`,
    maxRecords: 1,
  })
  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore })
  if (req.fields.status !== "pending_guarantors") {
    return NextResponse.json({ error: "not_pending", status: req.fields.status }, { status: 409, headers: noStore })
  }

  const expiresAt = new Date(Date.now() - 60_000).toISOString()
  await airtable.update(TABLES.requests, [{ id: req.id, fields: { "expires-at": expiresAt } }])
  return NextResponse.json({ ok: true, requestId: req.id, expiresAt }, { headers: noStore })
}
