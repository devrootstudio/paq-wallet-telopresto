import { expect, test } from "playwright/test"
import {
  BUSY,
  CHECK_DATA,
  CLOSED,
  EXPIRED,
  REJECTED,
  THANKS,
  accept,
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
 * guarantors answer on /aval/<token> (RENAP simulated) → job resolves the request (disbursement
 * simulated). Runs against `next dev` with ENABLE_TEST_BYPASS=true and real storage; every request
 * is TEST-AVALES-* with fictitious data. See tests/e2e/README.md.
 */

test.describe.configure({ mode: "serial" })

test("feliz: 2 avales aceptan → la rutina desembolsa", async ({ page, request, browser }) => {
  const auth = testAuth("feliz")
  const { requestId, links } = await createAndInvite(page, request, auth, guarantors())

  for (const position of [1, 2] as const) {
    const aval = await openLink(browser, links[position])
    await expect(aval.getByText("está solicitando un adelanto de salario")).toBeVisible()
    await expect(aval.getByText("María Fernanda Solicitante Ejemplo").first()).toBeVisible()
    await accept(aval)
    await expect(aval.getByText(THANKS)).toBeVisible()
    await aval.context().close()
  }
  expect((await state(request, auth)).guarantors?.map((g) => g.status)).toEqual(["authorized", "authorized", "invited"])

  const report = await runJob(request)
  expect(report.httpStatus).toBe(200)
  expect(report.quorum).toContain(requestId)
  expect(report.released).toContainEqual(expect.objectContaining({ requestId, status: "disbursed" }))
  // Nothing about this request needs attention (other requests in the base may have their own).
  expect((report.errors ?? []).filter((e) => e.id === requestId)).toEqual([])
  expect((report.unrecorded ?? []).filter((u) => u.requestId === requestId)).toEqual([])
  expect(report.stuck ?? []).not.toContain(requestId)

  const final = await state(request, auth)
  expect(final.status).toBe("disbursed")
  expect(final.guarantors?.[2].status).toBe("closed")
})

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

test("RENAP no coincide: pide revisar los datos y, corregidos, autoriza", async ({ page, request, browser }) => {
  const auth = testAuth("renap")
  const data = guarantors()
  data[0].identification = `${data[0].identification.slice(0, 9)}0000`
  const { links } = await createAndInvite(page, request, auth, data)

  const aval = await openLink(browser, links[1])
  await accept(aval)
  await expect(aval.getByText(CHECK_DATA)).toBeVisible()
  // Nothing about what the registry returned, and the form is still there.
  await expect(aval.getByText(/no coincid/i)).toHaveCount(0)
  await expect(aval.getByRole("button", { name: "Avalar" })).toBeVisible()
  expect((await state(request, auth)).guarantors?.[0].status).toBe("identity_mismatch")

  // The link stays open: after reopening it, the guarantor corrects the DPI and is authorized.
  await aval.reload()
  await expect(aval.getByText(CHECK_DATA)).toBeVisible()
  await accept(aval, { identification: `${data[0].identification.slice(0, 9)}0404` })
  await expect(aval.getByText(THANKS)).toBeVisible()
  await aval.context().close()
  expect((await state(request, auth)).guarantors?.[0].status).toBe("authorized")
})

test("link cerrado tras el quórum: el tercer aval ya no puede responder", async ({ page, request, browser }) => {
  const auth = testAuth("cerrado")
  const { requestId, links } = await createAndInvite(page, request, auth, guarantors())

  // The third guarantor opens the form before the quorum is reached…
  const late = await openLink(browser, links[3])
  await expect(late.getByRole("button", { name: "Avalar" })).toBeVisible()

  for (const position of [1, 2] as const) {
    const aval = await openLink(browser, links[position])
    await accept(aval)
    await expect(aval.getByText(THANKS)).toBeVisible()
    await aval.context().close()
  }
  const report = await runJob(request)
  expect(report.released).toContainEqual(expect.objectContaining({ requestId, status: "disbursed" }))

  // …and answers after it: the answer is refused and the form is replaced by the closed screen.
  await accept(late)
  await expect(late.getByText(CLOSED)).toBeVisible()
  await expect(late.getByRole("button", { name: "Avalar" })).toHaveCount(0)

  // Reopening the link shows the closed screen; an earlier guarantor sees "ya respondiste".
  await late.reload()
  await expect(late.getByText(CLOSED)).toBeVisible()
  await late.goto(links[1])
  await expect(late.getByText("Ya respondiste esta solicitud")).toBeVisible()
  await late.context().close()
})

test("doble aceptación simultánea: un solo desembolso", async ({ page, request, browser }) => {
  const auth = testAuth("doble")
  const { requestId, links } = await createAndInvite(page, request, auth, guarantors())

  // The same guarantor answers from two tabs at the same time: only one answer is registered (it
  // checks the identity and writes the evidence). The other one sees "busy" (another answer is being
  // recorded) or, if it arrives once the first is registered, "closed". Never two thank-you screens.
  const tabA = await openLink(browser, links[1])
  const tabB = await openLink(browser, links[1])
  for (const tab of [tabA, tabB]) await tab.getByRole("checkbox").check()
  await Promise.all([tabA, tabB].map((tab) => tab.getByRole("button", { name: "Avalar" }).click()))
  const screens = await Promise.all(
    [tabA, tabB].map(async (tab) => {
      await expect(tab.getByText(THANKS).or(tab.getByText(CLOSED)).or(tab.getByText(BUSY))).toBeVisible()
      if ((await tab.getByText(THANKS).count()) > 0) return "thanks"
      return (await tab.getByText(BUSY).count()) > 0 ? "busy" : "closed"
    }),
  )
  expect(screens.filter((s) => s === "thanks")).toHaveLength(1)
  expect(["busy", "closed"]).toContain(screens.find((s) => s !== "thanks"))
  expect((await state(request, auth)).guarantors?.[0].status).toBe("authorized")
  await Promise.all([tabA, tabB].map((tab) => tab.context().close()))

  // Guarantors 2 and 3 accept at the same time: both are registered.
  const [two, three] = await Promise.all([openLink(browser, links[2]), openLink(browser, links[3])])
  for (const tab of [two, three]) await tab.getByRole("checkbox").check()
  await Promise.all([two, three].map((tab) => tab.getByRole("button", { name: "Avalar" }).click()))
  for (const tab of [two, three]) await expect(tab.getByText(THANKS)).toBeVisible()
  await Promise.all([two, three].map((tab) => tab.context().close()))

  // Two job runs at the same time: exactly one disbursement for this request.
  const [first, second] = await Promise.all([
    request.post("/dev/avales/api/rutina", { timeout: 120_000 }),
    request.post("/dev/avales/api/rutina", { timeout: 120_000 }),
  ])
  const bodies = await Promise.all([first.json(), second.json()])
  const disbursed = bodies.flatMap((b) => (b.released ?? []) as { requestId: string; status: string }[])
    .filter((r) => r.requestId === requestId && r.status === "disbursed")
  expect(disbursed).toHaveLength(1)
  // The second run is refused while the first holds the instance (409), or finds nothing left to release.
  for (const status of [first.status(), second.status()]) expect([200, 409]).toContain(status)

  const final = await state(request, auth)
  expect(final.status).toBe("disbursed")
})
