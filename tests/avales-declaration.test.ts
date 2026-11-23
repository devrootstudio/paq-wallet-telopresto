import { describe, it, expect } from "vitest"
import { createHash } from "crypto"
import { DECLARATION_SHA256, DECLARATION_TEXT, DECLARATION_VERSION } from "@/lib/avales/declaration"

describe("guarantor declaration", () => {
  it("the stored hash is the SHA-256 of the text (change both, and the version, together)", () => {
    expect(createHash("sha256").update(DECLARATION_TEXT, "utf8").digest("hex")).toBe(DECLARATION_SHA256)
    expect(DECLARATION_VERSION).toMatch(/^\d{4}-\d\d-\d\d\.\d+$/)
  })

  it("is NFC-normalized and has no invisible characters, so client and server hash the same bytes", () => {
    expect(DECLARATION_TEXT).toBe(DECLARATION_TEXT.normalize("NFC"))
    expect(/[\p{Cf}\p{Cc}]/u.test(DECLARATION_TEXT)).toBe(false)
  })
})
