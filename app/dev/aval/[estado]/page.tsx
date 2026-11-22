import { notFound } from "next/navigation"
import AvalScreen from "@/components/aval/aval-screen"
import { PREVIEW_STATES, previewView, type PreviewState } from "./fixtures"

/**
 * Development-only preview of the /aval/<token> screens with fictitious data, for screenshots and QA:
 * /dev/aval/formulario, formulario-rechazo, formulario-revisar-datos, respondido, respondido-rechazo,
 * cerrado, vencido, invalido. Answers go to the real `answerGuarantor` with a fake token.
 * Returns 404 in production builds.
 */
export const dynamic = "force-dynamic"

export const metadata = { robots: { index: false, follow: false } }

export default async function AvalPreviewPage({ params }: { params: Promise<{ estado: string }> }) {
  if (process.env.NODE_ENV === "production") notFound()
  const { estado } = await params
  if (!(PREVIEW_STATES as readonly string[]).includes(estado)) notFound()
  const state = estado as PreviewState
  const now = Date.now()
  return (
    <AvalScreen
      view={previewView(state, now)}
      token="dev-preview"
      now={now}
      initialMode={state === "formulario-rechazo" ? "confirm-reject" : "form"}
    />
  )
}
