/** Display helpers for /aval/<token>. Pure: safe on the server and in tests. */

/** 3500 → "Q3500.00" (same style as the wizard). */
export const formatAmount = (amount: number) => `Q${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`

/**
 * Time left until `expiresAt` as "47:52 h". `null` when the date is not valid.
 * Never negative: a request past its time shows "0:00 h" (the server shows `expired` anyway).
 */
export function formatTimeLeft(expiresAt: string, now: number): string | null {
  const end = Date.parse(expiresAt)
  if (Number.isNaN(end)) return null
  const minutes = Math.max(0, Math.floor((end - now) / 60_000))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`
}

/** "Carlos Andrés Pérez" → "Carlos". */
export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? ""

const digits = (value: string) => value.replace(/\D/g, "")

/** "2456789010101" → "2456 78901 0101" */
export const formatDPI = (value: string) => {
  const d = digits(value).slice(0, 13)
  return [d.slice(0, 4), d.slice(4, 9), d.slice(9)].filter(Boolean).join(" ")
}

/** "55123478" → "5512 3478" */
export const formatPhone = (value: string) => {
  const d = digits(value).slice(0, 8)
  return [d.slice(0, 4), d.slice(4)].filter(Boolean).join(" ")
}

export const onlyDigits = digits

/** Phone digits as typed or pasted: drops a leading Guatemala code ("+502 5512 3478" → "55123478"). */
export const phoneDigits = (value: string) => {
  const d = digits(value)
  return (d.length > 8 && d.startsWith("502") ? d.slice(3) : d).slice(0, 8)
}
