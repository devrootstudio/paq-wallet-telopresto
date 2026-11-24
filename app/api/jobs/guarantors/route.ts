import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { airtableFromEnv } from "@/lib/airtable"
import { runGuarantorJob, type JobReport } from "@/lib/avales/job"
import { isSimulation, jobsSecret } from "@/lib/avales/runtime"
import { whatsappSender } from "@/lib/avales/whatsapp"

/**
 * Guarantor job (contract §7). Called every 5 minutes by a scheduled workflow with
 * `Authorization: Bearer <JOBS_SECRET>`. In simulation (test bypass outside production) a missing
 * JOBS_SECRET falls back to a public development value and the response lists the guarantor links.
 */

export const dynamic = "force-dynamic"
// The release claim waits a few seconds; give the job room on serverless platforms.
export const maxDuration = 300

const noStore = { "Cache-Control": "no-store" }

/** One run at a time per server instance. */
let running: Promise<JobReport> | null = null

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header ?? "")
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function POST(request: Request) {
  const secret = jobsSecret()
  if (!secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers: noStore })
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStore })
  }

  const airtable = airtableFromEnv()
  if (!airtable) {
    console.error("[avales] job: storage not configured")
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers: noStore })
  }
  if (running) return NextResponse.json({ ok: false, error: "busy" }, { status: 409, headers: noStore })

  const simulation = isSimulation()
  // Outside simulation the link origin must be configured, never taken from the caller.
  const baseUrl = process.env.APP_BASE_URL || (simulation ? new URL(request.url).origin : "")
  if (!baseUrl) {
    console.error("[avales] job: APP_BASE_URL missing")
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers: noStore })
  }

  running = runGuarantorJob({
    airtable,
    // Simulated in simulation; outside it nothing is sent until the n8n Wa2Desk integration exists.
    whatsapp: whatsappSender(simulation),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    simulation,
  })
  try {
    const report = await running
    // Links exist only in simulation; never send them back otherwise.
    const body = simulation ? report : { ...report, links: undefined }
    // `ok` is false when something needs attention, so the scheduler can alert on it.
    const ok = report.errors.length === 0 && report.unrecorded.length === 0 && report.stuck.length === 0
    return NextResponse.json({ ...body, ok }, { headers: noStore })
  } catch (error) {
    console.error(`[avales] job failed: ${error instanceof Error ? error.name : "unknown"}`)
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500, headers: noStore })
  } finally {
    running = null
  }
}
