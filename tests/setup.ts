import { vi } from "vitest"

// The regression suite exercises the real code paths, never the test bypass.
delete process.env.ENABLE_TEST_BYPASS
process.env.SECURITY_TOKEN_SECRET = "test-secret"

// In-memory cookie jar standing in for next/headers (server actions read the
// security token from an httpOnly cookie).
const jar = new Map<string, string>()

export const cookieJar = {
  clear: () => jar.clear(),
  set: (name: string, value: string) => jar.set(name, value),
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value)
    },
  }),
}))
