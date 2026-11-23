import { NextResponse } from "next/server"
import { jobsSecret } from "@/lib/avales/runtime"
import { devToolsEnabled, noStore, notFound } from "../../_lib/guard"

/**
 * Development only: runs the guarantor job (POST /api/jobs/guarantors) from the server, so the
 * secret never reaches the browser. Returns the job's status code and report as is.
 */
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!devToolsEnabled()) return notFound()
  const secret = jobsSecret()
  if (!secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers: noStore })

  // Always this same local server: never an origin taken from the Host header.
  const port = new URL(request.url).port || "3000"
  const response = await fetch(`http://localhost:${port}/api/jobs/guarantors`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" }))
  return NextResponse.json({ httpStatus: response.status, ...body }, { status: response.status, headers: noStore })
}
