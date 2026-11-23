import { defineConfig, devices } from "playwright/test"

/**
 * End-to-end tests of the guarantor route (tests/e2e/*.e2e.ts), run against a `next dev` server
 * started separately with the test bypass (ENABLE_TEST_BYPASS=true) and storage credentials.
 * They create requests marked `TEST-AVALES-*` with fictitious data. See tests/e2e/README.md.
 *
 *   E2E_BASE_URL=http://localhost:3020 npx playwright test
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  // A job run that releases waits ~12-15 s for its claim; a full case runs two or three of them.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // One at a time: the job processes every pending request and answers 409 while another run is going.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Traces and failure screenshots stay out of the repo (the folder is already ignored by git).
  outputDir: process.env.E2E_OUTPUT_DIR ?? "node_modules/.cache/e2e-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3020",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
