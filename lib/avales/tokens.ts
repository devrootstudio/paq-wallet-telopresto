import { createHash, randomBytes } from "crypto"

/**
 * Guarantor link tokens (contract §4): 32 random bytes in base64url (43 chars).
 * Only `hashToken(token)` is stored; the clear token exists only in memory when it is issued.
 * Server-side only. Never log a token.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

/** SHA-256 of the token, hex. This is what goes into `guarantors.token-hash`. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token)
}
