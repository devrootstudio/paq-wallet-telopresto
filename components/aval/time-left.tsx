"use client"

import { useEffect, useState } from "react"
import { formatTimeLeft } from "./format"

/**
 * Time left until `expiresAt`, updated every minute. Starts from the server's `now` so the first
 * client render matches the server markup.
 */
export default function TimeLeft({ expiresAt, now }: { expiresAt: string; now: number }) {
  const [current, setCurrent] = useState(now)
  useEffect(() => {
    setCurrent(Date.now())
    const id = setInterval(() => setCurrent(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return <>{formatTimeLeft(expiresAt, current)}</>
}
