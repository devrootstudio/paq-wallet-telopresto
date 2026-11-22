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

/**
 * Phone digits as typed or pasted. A Guatemala code is dropped only when it is clearly a prefix:
 * "+502 …", "00502 …" or 11 digits starting with 502 ("+502 5512 3478" → "55123478").
 */
export const phoneDigits = (value: string) => withoutCountryCode(value).slice(0, 8)

/** Same as `phoneDigits` but never truncates: extra digits stay so validation can report them. */
export const withoutCountryCode = (value: string) => {
  const trimmed = value.trim()
  const d = digits(value)
  if (trimmed.startsWith("+502")) return d.slice(3)
  if (d.startsWith("00502")) return d.slice(5)
  if (d.length === 11 && d.startsWith("502")) return d.slice(3)
  return d
}
