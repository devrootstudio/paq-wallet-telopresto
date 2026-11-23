import { Suspense } from "react"
import { notFound } from "next/navigation"
import { devToolsEnabled } from "../_lib/guard"
import DevSolicitud from "./dev-solicitud"

/**
 * Development only: Step 3b (the real component) with fictitious applicant data and an
 * authorization `TEST-AVALES-*`, so the e2e and manual tests create marked requests in storage.
 * /dev/avales/solicitud?auth=TEST-AVALES-<id>&monto=2500 (both optional).
 */
export const dynamic = "force-dynamic"
export const metadata = { robots: { index: false, follow: false } }

export default function DevSolicitudPage() {
  if (!devToolsEnabled()) notFound()
  return (
    <Suspense fallback={null}>
      <DevSolicitud />
    </Suspense>
  )
}
