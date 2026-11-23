import { expect, type APIRequestContext, type Browser, type Page } from "playwright/test"

/**
 * Helpers for the guarantor e2e. They only use the development tools under /dev/avales (404 outside
 * `next dev` with the test bypass) and the public pages. Every request they create is marked
 * `TEST-AVALES-*` and carries fictitious data.
 */

export interface GuarantorData {
  fullName: string
  identification: string
  phone: string
  relationship: string
}

export interface JobReport {
  httpStatus: number
  ok?: boolean
  error?: string
  links?: { requestId: string; position: number; url: string }[]
  rejected?: string[]
  quorum?: string[]
  expired?: string[]
  released?: { requestId: string; status: string; returnCode?: string }[]
  unrecorded?: { requestId: string; returnCode: string }[]
  stuck?: string[]
  errors?: { step: string; id?: string; error: string }[]
}

export interface RequestState {
  found: boolean
  requestId?: string
  status?: string | null
  guarantors?: { position: number | null; status: string | null; renapResult: string | null }[]
}

const random = (digits: number) =>
  Array.from({ length: digits }, () => Math.floor(Math.random() * 10)).join("")

/** Unique marked authorization for one test. */
export const testAuth = (label: string) => `TEST-AVALES-e2e-${label}-${Date.now().toString(36)}${random(3)}`

/**
 * Three fictitious guarantors with distinct DPI and phones (never the applicant's, 9000000000101 /
 * 19000001). Test phones use the fixed prefixes 100/101/102: numbers starting with 1 are not assigned
 * in Guatemala, so no real person is ever "invited". DPIs end in 0101/0202/0303, so RENAP simulation
 * authorizes them unless a test overrides one with a 0000 ending (identity mismatch).
 */
export function guarantors(): [GuarantorData, GuarantorData, GuarantorData] {
  const base = random(5)
  return [
    { fullName: "Aval Uno Prueba", identification: `1${base}${random(3)}0101`, phone: `100${random(5)}`, relationship: "hermano/a" },
    { fullName: "Aval Dos Prueba", identification: `2${base}${random(3)}0202`, phone: `101${random(5)}`, relationship: "amigo/a" },
    { fullName: "Aval Tres Prueba", identification: `3${base}${random(3)}0303`, phone: `102${random(5)}`, relationship: "vecino/a" },
  ]
}

/** Step 3b (the real component) on the dev page: fills the 3 guarantors and submits. */
export async function createRequest(page: Page, auth: string, data: GuarantorData[]): Promise<void> {
  const token = page.waitForResponse((r) => r.url().includes("/api/security-token") && r.ok())
  await page.goto(`/dev/avales/solicitud?auth=${encodeURIComponent(auth)}`)
  await token
  await expect(page.getByTestId("auth")).toHaveText(auth)
  for (const [i, g] of data.entries()) {
    await page.locator(`#aval-${i}-fullName`).fill(g.fullName)
    await page.locator(`#aval-${i}-identification`).fill(g.identification)
    await page.locator(`#aval-${i}-phone`).fill(g.phone)
    await page.locator(`#aval-${i}-relationship`).selectOption(g.relationship)
  }
  await page.getByRole("button", { name: "Solicitar avales" }).click()
  await expect(page.getByText("En revisión")).toBeVisible()
}

/** Runs the guarantor job; waits and retries while another run is in progress (409 busy). */
export async function runJob(request: APIRequestContext): Promise<JobReport> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request.post("/dev/avales/api/rutina", { timeout: 120_000 })
    const body = (await response.json()) as JobReport
    if (response.status() !== 409) return body
    await new Promise((r) => setTimeout(r, 3_000))
  }
  throw new Error("job stayed busy")
}

export async function state(request: APIRequestContext, auth: string): Promise<RequestState> {
  const response = await request.get(`/dev/avales/api/estado?auth=${encodeURIComponent(auth)}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as RequestState
}

/** The three links of one request from a job report (simulation only). */
export function linksFor(report: JobReport, requestId: string): Record<1 | 2 | 3, string> {
  const own = (report.links ?? []).filter((l) => l.requestId === requestId)
  expect(own.map((l) => l.position).sort()).toEqual([1, 2, 3])
  const byPos = Object.fromEntries(own.map((l) => [l.position, l.url])) as Record<1 | 2 | 3, string>
  return byPos
}

/** Creates the request and invites its guarantors: returns its id and the three links. */
export async function createAndInvite(page: Page, request: APIRequestContext, auth: string, data: GuarantorData[]) {
  // Printed so every marked record can be listed for cleanup.
  console.log(`[e2e] created ${auth}`)
  await createRequest(page, auth, data)
  const created = await state(request, auth)
  expect(created).toMatchObject({ found: true, status: "pending_guarantors" })
  const report = await runJob(request)
  expect(report.httpStatus).toBe(200)
  const links = linksFor(report, created.requestId!)
  const invited = await state(request, auth)
  expect(invited.guarantors?.map((g) => g.status)).toEqual(["invited", "invited", "invited"])
  return { requestId: created.requestId!, links }
}

/** Opens a guarantor link in a fresh page (its own browser context). */
export async function openLink(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(url)
  return page
}

/** Accepts on an open form, optionally correcting the DPI first. */
export async function accept(page: Page, opts: { identification?: string } = {}) {
  if (opts.identification) await page.locator("#aval-identification").fill(opts.identification)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "Avalar" }).click()
}

/** Rejects on an open form, going through the warning. */
export async function reject(page: Page) {
  await page.getByRole("button", { name: "Rechazar" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page.getByRole("button", { name: "Sí, rechazar" }).click()
}

export const THANKS = "¡Gracias por tu apoyo!"
export const REJECTED = "Registramos que no avalas la solicitud"
export const CLOSED = "Esta solicitud ya se resolvió"
export const EXPIRED = "Esta solicitud venció"
export const CHECK_DATA = "No pudimos confirmar tus datos"
export const BUSY = "Estamos registrando otra respuesta"
