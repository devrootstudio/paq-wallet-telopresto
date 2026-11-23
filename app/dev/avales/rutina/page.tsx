import { Suspense } from "react"
import { notFound } from "next/navigation"
import { devToolsEnabled } from "../_lib/guard"
import DevRutina from "./dev-rutina"

/**
 * Development only: runs the guarantor job and shows its report and the simulated WhatsApp links.
 * /dev/avales/rutina
 */
export const dynamic = "force-dynamic"
export const metadata = { robots: { index: false, follow: false } }

export default function DevRutinaPage() {
  if (!devToolsEnabled()) notFound()
  return (
    <Suspense fallback={null}>
      <DevRutina />
    </Suspense>
  )
}
