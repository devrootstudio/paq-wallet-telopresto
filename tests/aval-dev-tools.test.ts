import { describe, it, expect, vi, afterEach } from "vitest"
import { devToolsEnabled, isTestAuthorization } from "@/app/dev/avales/_lib/guard"
import { POST as rutina } from "@/app/dev/avales/api/rutina/route"
import { GET as estado } from "@/app/dev/avales/api/estado/route"
import { POST as vencer } from "@/app/dev/avales/api/vencer/route"

afterEach(() => vi.unstubAllEnvs())

describe("development tools for the guarantor route", () => {
  it("are enabled only in next dev with the test bypass", () => {
    expect(devToolsEnabled({ NODE_ENV: "development", ENABLE_TEST_BYPASS: "true" })).toBe(true)
    expect(devToolsEnabled({ NODE_ENV: "development" })).toBe(false)
    expect(devToolsEnabled({ NODE_ENV: "production", ENABLE_TEST_BYPASS: "true" })).toBe(false)
    expect(devToolsEnabled({ NODE_ENV: "test", ENABLE_TEST_BYPASS: "true" })).toBe(false)
  })

  it("only accept TEST-AVALES-* authorizations", () => {
    expect(isTestAuthorization("TEST-AVALES-e2e-feliz-abc123")).toBe(true)
    for (const bad of ["a1b2c3d4e5f6", "TEST-AVALES-", "TEST-AVALES-x'y", "test-avales-x", null, 42]) {
      expect(isTestAuthorization(bad)).toBe(false)
    }
  })

  it("every endpoint is a 404 outside next dev with the bypass", async () => {
    for (const env of [
      { NODE_ENV: "production", ENABLE_TEST_BYPASS: "true" },
      { NODE_ENV: "development", ENABLE_TEST_BYPASS: "" },
    ]) {
      vi.stubEnv("NODE_ENV", env.NODE_ENV)
      vi.stubEnv("ENABLE_TEST_BYPASS", env.ENABLE_TEST_BYPASS)
      const url = "http://localhost/dev/avales/api/x?auth=TEST-AVALES-1"
      expect((await rutina(new Request(url, { method: "POST" }))).status).toBe(404)
      expect((await estado(new Request(url))).status).toBe(404)
      expect((await vencer(new Request(url, { method: "POST" }))).status).toBe(404)
    }
  })

  it("estado and vencer refuse authorizations that are not TEST-AVALES-*", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("ENABLE_TEST_BYPASS", "true")
    const url = "http://localhost/dev/avales/api/x?auth=a1b2c3d4e5f6a1b2"
    expect((await estado(new Request(url))).status).toBe(400)
    expect((await vencer(new Request(url, { method: "POST" }))).status).toBe(400)
  })
})
