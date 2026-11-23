"use client"

import { startTransition } from "react"
import { useRouter } from "next/navigation"
import AvalError from "@/components/aval/aval-error"

// The error itself is never shown: it may carry internal details.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  // reset() alone re-renders with the same failed server data: refresh to ask the server again.
  const retry = () =>
    startTransition(() => {
      router.refresh()
      reset()
    })
  return <AvalError reset={retry} />
}
