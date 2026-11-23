import type { Metadata } from "next"
import { getGuarantorView } from "@/app/avales-actions"
import AvalScreen from "@/components/aval/aval-screen"

// The screen depends on the guarantor's current state: never cache it.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Solicitud de aval",
  robots: { index: false, follow: false },
  // The token is in the URL: do not send it to other sites in the Referer header.
  referrer: "no-referrer",
}

export default async function AvalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await getGuarantorView(token)
  return <AvalScreen view={view} token={token} />
}
