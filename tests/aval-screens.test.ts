import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/app/avales-actions", () => ({
  getGuarantorView: vi.fn(),
  answerGuarantor: vi.fn(async () => ({ ok: false, code: "not_available" })),
}))

import { answerGuarantor, getGuarantorView } from "@/app/avales-actions"
import AvalScreen from "@/components/aval/aval-screen"
import AvalForm, { NOT_AVAILABLE_MESSAGE, submitAnswer } from "@/components/aval/aval-form"
import { formatTimeLeft } from "@/components/aval/format"
import AvalPage from "@/app/aval/[token]/page"
import AvalPreviewPage from "@/app/dev/aval/[estado]/page"
import { PREVIEW_STATES, previewView } from "@/app/dev/aval/[estado]/fixtures"
import type { GuarantorView } from "@/lib/avales/types"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const NOW = Date.parse("2026-11-22T12:00:00Z")
const base = { applicantFirstName: "María", amount: 3500, expiresAt: "2026-11-24T11:52:00Z" }
const guarantor = {
  fullName: "Carlos Ejemplo Prueba",
  phone: "10000001",
  identification: "1000000000101",
  relationship: "hermano/a" as const,
}

const render = (view: GuarantorView) => renderToStaticMarkup(createElement(AvalScreen, { view, token: "tok", now: NOW }))

beforeEach(() => vi.clearAllMocks())

describe("/aval/<token> screens", () => {
  it("form: greets the guarantor, shows first name, amount, time left, own data, Avalar and Rechazar", () => {
    const html = render({ ...base, screen: "form", guarantor, identityMismatch: false })
    expect(html).toContain("¡Hola, Carlos!")
    expect(html).toContain("María está solicitando un adelanto de salario")
    expect(html).toContain("Q3500.00")
    expect(html).toContain("47:52 h")
    expect(html).toContain('value="Carlos Ejemplo Prueba"')
    expect(html).toContain('value="1000 00000 0101"')
    expect(html).toContain('value="1000 0001"')
    expect(html).toContain("Conozco a María y acepto avalar")
    expect(html).toContain(">Avalar<")
    expect(html).toContain(">Rechazar<")
    expect(html).not.toContain("registro oficial")
  })

  it("form with identity mismatch asks to check the data", () => {
    const html = render({ ...base, screen: "form", guarantor, identityMismatch: true })
    expect(html).toContain("Tus datos no coincidieron con el registro oficial")
  })

  it("answered: authorized and rejected", () => {
    const yes = render({ ...base, screen: "answered", answer: "authorized" })
    expect(yes).toContain("Ya respondiste esta solicitud")
    expect(yes).toContain("Registramos tu aval para María")
    expect(yes).not.toContain(">Avalar<")
    const no = render({ ...base, screen: "answered", answer: "rejected" })
    expect(no).toContain("Registramos que no avalas la solicitud de María")
  })

  it("closed: the request was resolved, no actions", () => {
    const html = render({ ...base, screen: "closed" })
    expect(html).toContain("Esta solicitud ya se resolvió")
    expect(html).toContain("Q3500.00")
    expect(html).not.toContain(">Avalar<")
  })

  it("expired: no actions", () => {
    const html = render({ ...base, screen: "expired" })
    expect(html).toContain("Esta solicitud venció")
    expect(html).not.toContain(">Rechazar<")
  })

  it("invalid: no request data at all", () => {
    const html = render({ screen: "invalid" })
    expect(html).toContain("Este link no es válido")
    expect(html).not.toContain("Q")
    expect(html).not.toContain("María")
  })

  it("never shows data that the view does not carry (no other guarantors, no applicant last name)", () => {
    // Extra keys smuggled into the view must not reach the markup.
    const view = {
      ...base,
      screen: "form",
      guarantor,
      identityMismatch: false,
      applicantFullName: "María Apellidoprivado",
      otherGuarantors: [{ fullName: "Otraaval Persona", phone: "20000002", identification: "2000000000202" }],
    } as unknown as GuarantorView
    const html = render(view)
    expect(html).not.toContain("Apellidoprivado")
    expect(html).not.toContain("Otraaval")
    expect(html).not.toContain("2000 0002")
    expect(html).not.toContain("20000002")
    expect(html).not.toContain("2000000000202")
  })

  it("the rejection step warns what rejecting implies", () => {
    const html = renderToStaticMarkup(
      createElement(AvalForm, { token: "tok", applicantFirstName: "María", guarantor, initialMode: "confirm-reject" }),
    )
    expect(html).toContain("¿Seguro que quieres rechazar?")
    expect(html).toContain("María no contará con tu aval")
    expect(html).toContain("Si 2 de sus 3 referencias rechazan, su solicitud se cancela")
    expect(html).toContain("Ya no podrás cambiar tu respuesta")
    expect(html).toContain("Sí, rechazar")
  })

  it("a pasted +502 phone keeps the 8 local digits", async () => {
    const { phoneDigits } = await import("@/components/aval/format")
    expect(phoneDigits("+502 1000 0001")).toBe("10000001")
    expect(phoneDigits("1000-0001")).toBe("10000001")
  })

  it("time left is h:mm and never negative", () => {
    expect(formatTimeLeft("2026-11-24T11:52:00Z", NOW)).toBe("47:52 h")
    expect(formatTimeLeft("2026-11-21T00:00:00Z", NOW)).toBe("0:00 h")
    expect(formatTimeLeft("x", NOW)).toBeNull()
  })
})

describe("answers", () => {
  const data = { fullName: guarantor.fullName, identification: guarantor.identification, phone: guarantor.phone }

  it("accept and reject reach answerGuarantor; the stub shows the friendly not-available message", async () => {
    for (const answer of ["accept", "reject"] as const) {
      const outcome = await submitAnswer("tok", answer, data)
      expect(outcome).toEqual({ fieldErrors: {}, message: NOT_AVAILABLE_MESSAGE })
    }
    expect(answerGuarantor).toHaveBeenCalledWith("tok", "accept", data)
    expect(answerGuarantor).toHaveBeenCalledWith("tok", "reject", data)
  })

  it("accept with invalid data does not call the server and marks the fields", async () => {
    const outcome = await submitAnswer("tok", "accept", { fullName: " ", identification: "123", phone: "55" })
    expect(answerGuarantor).not.toHaveBeenCalled()
    expect(outcome.fieldErrors).toMatchObject({
      fullName: "El nombre es obligatorio",
      identification: "El DPI debe tener 13 dígitos",
      phone: "El teléfono debe tener 8 dígitos",
    })
  })

  it("reject does not require valid data", async () => {
    await submitAnswer("tok", "reject", { fullName: "", identification: "", phone: "" })
    expect(answerGuarantor).toHaveBeenCalledTimes(1)
  })

  it("a final status ends the form; identity mismatch and errors keep it with a message", async () => {
    const send = vi.fn()
    send.mockResolvedValueOnce({ ok: true, status: "authorized" })
    expect(await submitAnswer("tok", "accept", data, send)).toMatchObject({ done: "authorized" })
    send.mockResolvedValueOnce({ ok: true, status: "rejected" })
    expect(await submitAnswer("tok", "reject", data, send)).toMatchObject({ done: "rejected" })
    send.mockResolvedValueOnce({ ok: true, status: "identity_mismatch" })
    const mismatch = await submitAnswer("tok", "accept", data, send)
    expect(mismatch.done).toBeUndefined()
    expect(mismatch.message).toMatch(/no coinciden/)
    send.mockResolvedValueOnce({ ok: false, code: "expired" })
    expect((await submitAnswer("tok", "accept", data, send)).message).toMatch(/venció/)
    send.mockRejectedValueOnce(new Error("network"))
    expect((await submitAnswer("tok", "accept", data, send)).message).toMatch(/conexión/)
  })
})

describe("pages", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("/aval/<token> asks the server for that token's view and renders it", async () => {
    m(getGuarantorView).mockResolvedValue({ ...base, screen: "closed" })
    const el = (await AvalPage({ params: Promise.resolve({ token: "abc123" }) })) as ReactElement
    expect(getGuarantorView).toHaveBeenCalledWith("abc123")
    expect(renderToStaticMarkup(el)).toContain("Esta solicitud ya se resolvió")
  })

  it("the dev preview renders every fixture state", async () => {
    for (const estado of PREVIEW_STATES) {
      const el = (await AvalPreviewPage({ params: Promise.resolve({ estado }) })) as ReactElement
      expect(renderToStaticMarkup(el).length).toBeGreaterThan(0)
      expect(previewView(estado, NOW).screen).toBeTruthy()
    }
  })

  it("the dev preview is a 404 in production and for unknown states", async () => {
    await expect(AvalPreviewPage({ params: Promise.resolve({ estado: "nope" }) })).rejects.toThrow()
    vi.stubEnv("NODE_ENV", "production")
    await expect(AvalPreviewPage({ params: Promise.resolve({ estado: "formulario" }) })).rejects.toThrow()
  })
})
