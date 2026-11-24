import { expect, test } from "playwright/test"
import {
  BUSY,
  CLOSED,
  EXPIRED,
  REJECTED,
  createAndInvite,
  guarantors,
  openLink,
  reject,
  runJob,
  state,
  testAuth,
} from "./avales-helpers"

/**
 * Guarantor route end to end, without WhatsApp: Step 3b → job invites (links in the job report) →
 * guarantors answer on /aval/<token> → job resolves the request. Runs against `next dev` with
 * ENABLE_TEST_BYPASS=true and real storage; every request is TEST-AVALES-* with fictitious data.
 *
 * Accepting checks the guarantor against RENAP for real (DPI and exact full name), so it needs a
 * real person: the accept cases (2 accept → disbursed, identity mismatch, simultaneous accepts) are
 * a manual test, described in tests/e2e/README.md. These cases never call RENAP.
 */

test.describe.configure({ mode: "serial" })

test("2 rechazos → solicitud rechazada", async ({ page, request, browser }) => {
  const auth = testAuth("rechazo")
  const { requestId, links } = await createAndInvite(page, request, auth, guarantors())

  for (const position of [1, 2] as const) {
    const aval = await openLink(browser, links[position])
    await reject(aval)
    await expect(aval.getByText(REJECTED)).toBeVisible()
    await aval.context().close()
  }

  const report = await runJob(request)
  expect(report.rejected).toContain(requestId)
  expect(report.released?.some((r) => r.requestId === requestId)).toBeFalsy()

  const final = await state(request, auth)
  expect(final.status).toBe("rejected")
  expect(final.guarantors?.map((g) => g.status)).toEqual(["rejected", "rejected", "closed"])

  const third = await openLink(browser, links[3])
  await expect(third.getByText(CLOSED)).toBeVisible()
  await expect(third.getByRole("button", { name: "Avalar" })).toHaveCount(0)
  await third.context().close()
})

test("vencida: el link muestra vencido y la rutina la cierra", async ({ page, request, browser }) => {
  const auth = testAuth("vencida")
  const { requestId, links } = await createAndInvite(page, request, auth, guarantors())

  const moved = await request.post(`/dev/avales/api/vencer?auth=${encodeURIComponent(auth)}`)
  expect(moved.ok()).toBeTruthy()

  // Past expires-at the link is expired even before the job runs.
  const aval = await openLink(browser, links[1])
  await expect(aval.getByText(EXPIRED)).toBeVisible()
  await expect(aval.getByRole("button", { name: "Avalar" })).toHaveCount(0)
  await aval.context().close()

  const report = await runJob(request)
  expect(report.expired).toContain(requestId)
  const final = await state(request, auth)
  expect(final.status).toBe("expired")
  expect(final.guarantors?.map((g) => g.status)).toEqual(["expired", "expired", "expired"])
})

test("link cerrado: tras rechazar la solicitud, el tercer aval ya no puede responder", async ({ page, request, browser }) => {
  const auth = testAuth("cerrado")
  const { requestId, links } = await createAndInvite(page, request, auth, guarantors())

  // The third guarantor opens the form while the request is still open…
  const late = await openLink(browser, links[3])
  await expect(late.getByRole("button", { name: "Rechazar" })).toBeVisible()

  for (const position of [1, 2] as const) {
    const aval = await openLink(browser, links[position])
    await reject(aval)
    await expect(aval.getByText(REJECTED)).toBeVisible()
    await aval.context().close()
  }
  const report = await runJob(request)
  expect(report.rejected).toContain(requestId)

  // …and answers after it was resolved: the answer is refused and the form is replaced by the closed screen.
  await reject(late)
  await expect(late.getByText(CLOSED)).toBeVisible()
  await expect(late.getByRole("button", { name: "Rechazar" })).toHaveCount(0)

  // Reopening the link shows the closed screen; an earlier guarantor sees "ya respondiste".
  await late.reload()
  await expect(late.getByText(CLOSED)).toBeVisible()
  await late.goto(links[1])
  await expect(late.getByText("Ya respondiste esta solicitud")).toBeVisible()
  await late.context().close()

  const final = await state(request, auth)
  expect(final.guarantors?.map((g) => g.status)).toEqual(["rejected", "rejected", "closed"])
})

test("doble rechazo simultáneo del mismo aval: una sola respuesta registrada", async ({ page, request, browser }) => {
  const auth = testAuth("doble")
  const { links } = await createAndInvite(page, request, auth, guarantors())

  // The same guarantor answers from two tabs at the same time. Only one answer is registered; the
  // other one sees "busy" (another answer is being recorded) or, if it arrives once the first is
  // registered, "closed". Never two confirmations.
  const tabA = await openLink(browser, links[1])
  const tabB = await openLink(browser, links[1])
  for (const tab of [tabA, tabB]) {
    await tab.getByRole("button", { name: "Rechazar" }).click()
    await expect(tab.getByRole("alertdialog")).toBeVisible()
  }
  await Promise.all([tabA, tabB].map((tab) => tab.getByRole("button", { name: "Sí, rechazar" }).click()))
  const screens = await Promise.all(
    [tabA, tabB].map(async (tab) => {
      await expect(tab.getByText(REJECTED).or(tab.getByText(CLOSED)).or(tab.getByText(BUSY))).toBeVisible()
      if ((await tab.getByText(REJECTED).count()) > 0) return "registered"
      return (await tab.getByText(BUSY).count()) > 0 ? "busy" : "closed"
    }),
  )
  console.log(`[e2e] same-guarantor tabs: ${screens.join(" + ")}`)
  expect(screens.filter((s) => s === "registered")).toHaveLength(1)
  expect(["busy", "closed"]).toContain(screens.find((s) => s !== "registered"))
  await Promise.all([tabA, tabB].map((tab) => tab.context().close()))

  const final = await state(request, auth)
  expect(final.status).toBe("pending_guarantors")
  expect(final.guarantors?.map((g) => g.status)).toEqual(["rejected", "invited", "invited"])
})
