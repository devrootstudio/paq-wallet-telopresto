import { NextResponse } from "next/server"
import { airtableFromEnv, formulaString } from "@/lib/airtable"
import { TABLES, slotOf, type GuarantorFields, type RequestFields } from "@/lib/avales/repo"
import { devToolsEnabled, isTestAuthorization, noStore, notFound } from "../../_lib/guard"

/**
 * Development only: status of a TEST-AVALES-* request and of its guarantors, for the e2e tests.
 * GET /dev/avales/api/estado?auth=TEST-AVALES-<id>. Returns statuses only: no names, DPI, phones or
 * tokens.
 */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
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
  if (!req) return NextResponse.json({ found: false }, { headers: noStore })

  const slots = [1, 2, 3].map((p) => `{slot} = ${formulaString(slotOf(req.id, p))}`)
  const guarantors = await airtable.list<GuarantorFields>(TABLES.guarantors, {
    filterByFormula: `OR(${slots.join(", ")})`,
  })

  return NextResponse.json(
    {
      found: true,
      requestId: req.id,
      status: req.fields.status ?? null,
      expiresAt: req.fields["expires-at"] ?? null,
      releaseCode: req.fields["release-code"] ?? null,
      guarantors: guarantors
        .map((g) => ({
          position: g.fields.position ?? null,
          status: g.fields.status ?? null,
          renapResult: g.fields["renap-result"] ?? null,
        }))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    },
    { headers: noStore },
  )
}
