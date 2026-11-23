import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/app/avales-actions", () => ({
  getGuarantorView: vi.fn(),
  answerGuarantor: vi.fn(async () => ({ ok: false, code: "not_available" })),
}))

import { answerGuarantor, getGuarantorView } from "@/app/avales-actions"
import AvalScreen, { applicantInitials } from "@/components/aval/aval-screen"
import AvalError from "@/components/aval/aval-error"
import AvalForm from "@/components/aval/aval-form"
import { CHECK_DATA_MESSAGE, NOT_AVAILABLE_MESSAGE, RETRY_MESSAGE, submitAnswer } from "@/components/aval/answer"
import { formatTimeLeft } from "@/components/aval/format"
import AvalPage, { dynamic as avalDynamic, metadata as avalMetadata } from "@/app/aval/[token]/page"
import AvalPreviewPage from "@/app/dev/aval/[estado]/page"
import { PREVIEW_STATES, previewView } from "@/app/dev/aval/[estado]/fixtures"
import type { GuarantorView } from "@/lib/avales/types"

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const NOW = Date.parse("2026-11-22T12:00:00Z")
const FULL_NAME = "María Fernanda Solicitante Ejemplo"
const base = { applicantFirstName: "María", applicantName: FULL_NAME, amount: 3500, expiresAt: "2026-11-24T11:52:00Z" }
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
    expect(html).toContain(`${FULL_NAME} está solicitando un adelanto de salario`)
    expect(html).toContain(">MS<")
    expect(html).toContain("Q3500.00")
    expect(html).toContain("47:52 h")
    expect(html).toContain('value="Carlos Ejemplo Prueba"')
    expect(html).toContain('value="1000 00000 0101"')
    expect(html).toContain('value="1000 0001"')
    expect(html).toContain(`Conozco a ${FULL_NAME} y acepto avalar`)
    expect(html).toContain(`Si no reconoces a ${FULL_NAME}`)
    expect(html).toContain(">Avalar<")
    expect(html).toContain(">Rechazar<")
    expect(html).not.toContain("No pudimos confirmar tus datos")
  })

  it("closed and expired name the applicant in full", () => {
    expect(render({ ...base, screen: "closed" })).toContain(`Solicitud de adelanto de ${FULL_NAME}`)
    expect(render({ ...base, screen: "expired" })).toContain(`Solicitud de adelanto de ${FULL_NAME}`)
  })

  it("without a full name it falls back to the first name", () => {
    const { applicantName: _omit, ...withoutFull } = base
    void _omit
    const html = render({ ...withoutFull, screen: "closed" } as unknown as GuarantorView)
    expect(html).toContain("Solicitud de adelanto de María<")
  })

  it("avatar initials: first name + first surname", () => {
    expect(applicantInitials("María Elena Vásquez Morales")).toBe("MV")
    expect(applicantInitials("María Vásquez")).toBe("MV")
    expect(applicantInitials("María")).toBe("M")
    expect(applicantInitials("")).toBe("?")
  })

  it("form with identity mismatch asks to check the data", () => {
    const html = render({ ...base, screen: "form", guarantor, identityMismatch: true })
    expect(html).toContain("No pudimos confirmar tus datos")
    // Never what the official registry returned
    expect(html).not.toContain("RENAP")
    expect(html).not.toContain("registro oficial")
  })

  it("answered: authorized and rejected", () => {
    const yes = render({ ...base, screen: "answered", answer: "authorized" })
    expect(yes).toContain("Ya respondiste esta solicitud")
    expect(yes).toContain(`Registramos tu aval para ${FULL_NAME}`)
    expect(yes).not.toContain(">Avalar<")
    const no = render({ ...base, screen: "answered", answer: "rejected" })
    expect(no).toContain(`Registramos que no avalas la solicitud de ${FULL_NAME}`)
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
    expect(html).not.toContain("Q3500")
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

  it("after answering, the countdown and the 'si no reconoces' footer disappear", () => {
    const footer = createElement("p", null, "FOOTER-MARK")
    for (const initialOutcome of [
      { kind: "done", status: "authorized" },
      { kind: "done", status: "rejected" },
      { kind: "ended", screen: "expired" },
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(AvalForm, { token: "tok", applicantName: FULL_NAME, guarantor, footer, initialOutcome }),
      )
      expect(html).not.toContain("FOOTER-MARK")
      expect(html).not.toContain(">Avalar<")
    }
    const open = renderToStaticMarkup(createElement(AvalForm, { token: "tok", applicantName: FULL_NAME, guarantor, footer }))
    expect(open).toContain("FOOTER-MARK")
  })

  it("the rejection step warns what rejecting implies", () => {
    const html = renderToStaticMarkup(
      createElement(AvalForm, { token: "tok", applicantName: FULL_NAME, guarantor, initialMode: "confirm-reject" }),
    )
    expect(html).toContain("¿Seguro que quieres rechazar?")
    expect(html).toContain(`${FULL_NAME} no contará con tu aval`)
    expect(html).toContain("Si 2 de sus 3 referencias rechazan, su solicitud se cancela")
    expect(html).toContain("Ya no podrás cambiar tu respuesta")
    expect(html).toContain("Sí, rechazar")
  })

  it("a pasted +502 phone keeps the 8 local digits", async () => {
    const { phoneDigits, withoutCountryCode } = await import("@/components/aval/format")
    expect(phoneDigits("+502 1000 0001")).toBe("10000001")
    expect(phoneDigits("1000-0001")).toBe("10000001")
    expect(phoneDigits("00502 1000 0001")).toBe("10000001")
    expect(phoneDigits("5021 23456")).toBe("50212345")
    expect(withoutCountryCode("+502 1000 0001")).toBe("10000001")
    expect(withoutCountryCode("1000 00011")).toBe("100000011")
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
      expect(outcome).toEqual({ kind: "form", fieldErrors: {}, message: NOT_AVAILABLE_MESSAGE })
    }
    expect(answerGuarantor).toHaveBeenCalledWith("tok", "accept", data)
    expect(answerGuarantor).toHaveBeenCalledWith("tok", "reject", data)
  })

  it("accept with invalid data does not call the server and marks the fields", async () => {
    const outcome = await submitAnswer("tok", "accept", { fullName: " ", identification: "123", phone: "55" })
    expect(answerGuarantor).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: "form" })
    expect(outcome.kind === "form" && outcome.fieldErrors).toMatchObject({
      fullName: "El nombre es obligatorio",
      identification: "El DPI debe tener 13 dígitos",
      phone: "El teléfono debe tener 8 dígitos",
    })
  })

  it("reject does not require valid data", async () => {
    await submitAnswer("tok", "reject", { fullName: "", identification: "", phone: "" })
    expect(answerGuarantor).toHaveBeenCalledTimes(1)
  })

  it("authorized and rejected replace the form with a confirmation", async () => {
    const send = vi.fn()
    send.mockResolvedValueOnce({ ok: true, status: "authorized" })
    expect(await submitAnswer("tok", "accept", data, send)).toEqual({ kind: "done", status: "authorized" })
    send.mockResolvedValueOnce({ ok: true, status: "rejected" })
    expect(await submitAnswer("tok", "reject", data, send)).toEqual({ kind: "done", status: "rejected" })
  })

  it("identity mismatch keeps the form and asks to check the data, without registry details", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, status: "identity_mismatch" })
    expect(await submitAnswer("tok", "accept", data, send)).toEqual({
      kind: "form",
      fieldErrors: {},
      message: CHECK_DATA_MESSAGE,
    })
    expect(CHECK_DATA_MESSAGE).not.toMatch(/RENAP|registro/i)
  })

  it("closed, expired and invalid end the form with their screen", async () => {
    for (const code of ["closed", "expired", "invalid"] as const) {
      const send = vi.fn().mockResolvedValueOnce({ ok: false, code })
      expect(await submitAnswer("tok", "accept", data, send)).toEqual({ kind: "ended", screen: code })
    }
  })

  it("unavailable and network errors keep the form with a retry", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: false, code: "unavailable" })
    expect(await submitAnswer("tok", "reject", data, send)).toEqual({
      kind: "form",
      fieldErrors: {},
      message: RETRY_MESSAGE,
      retry: true,
    })
    send.mockRejectedValueOnce(new Error("network"))
    expect(await submitAnswer("tok", "accept", data, send)).toMatchObject({ kind: "form", retry: true, message: expect.stringMatching(/conexión/) })
  })

  it("server validation errors are shown on their fields", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: false, code: "validation", fieldErrors: { phone: "El teléfono debe tener 8 dígitos" } })
    expect(await submitAnswer("tok", "accept", data, send)).toEqual({
      kind: "form",
      fieldErrors: { phone: "El teléfono debe tener 8 dígitos" },
      message: "Revisa los datos marcados.",
    })
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

  it("the token page is never cached, indexed or leaked in the Referer", () => {
    expect(avalDynamic).toBe("force-dynamic")
    expect(avalMetadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" })
  })

  it("only the 3 confirmable fields of the guarantor reach the client form", () => {
    const view = {
      ...base,
      screen: "form",
      identityMismatch: false,
      guarantor: { ...guarantor, recordId: "rec-secret", tokenHash: "hash-secret" },
    } as unknown as GuarantorView
    const findForm = (node: unknown): ReactElement | null => {
      if (!node || typeof node !== "object") return null
      const el = node as ReactElement<{ children?: unknown }>
      if (el.type === AvalForm) return el
      const kids = el.props?.children
      for (const kid of Array.isArray(kids) ? kids : [kids]) {
        const found = findForm(kid)
        if (found) return found
      }
      return null
    }
    const tree = AvalScreen({ view, token: "tok", now: NOW })
    const form = findForm(tree) as ReactElement<{ guarantor: object }>
    expect(form.props.guarantor).toEqual({
      fullName: guarantor.fullName,
      identification: guarantor.identification,
      phone: guarantor.phone,
    })
  })

  it("Avalar stays disabled until the guarantor accepts the statement", () => {
    const html = render({ ...base, screen: "form", guarantor, identityMismatch: false })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Avalar<\/button>/)
  })

  it("the dev preview renders every fixture state with its own text", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const expected: Record<string, string> = {
      formulario: "¡Hola, Carlos!",
      "formulario-rechazo": "¿Seguro que quieres rechazar?",
      "formulario-revisar-datos": "No pudimos confirmar tus datos",
      respondido: `Registramos tu aval para ${FULL_NAME}`,
      "respondido-rechazo": "Registramos que no avalas",
      cerrado: "Esta solicitud ya se resolvió",
      vencido: "Esta solicitud venció",
      invalido: "Este link no es válido",
      "tras-avalar": "¡Gracias por tu apoyo!",
      "tras-rechazar": "Registramos que no avalas la solicitud",
      "tras-revisar-datos": "No pudimos confirmar tus datos",
      "tras-cerrado": "Esta solicitud ya se resolvió",
      "tras-error": "Intentar de nuevo",
    }
    for (const estado of PREVIEW_STATES) {
      const el = (await AvalPreviewPage({ params: Promise.resolve({ estado }) })) as ReactElement
      expect(renderToStaticMarkup(el)).toContain(expected[estado])
      expect(previewView(estado, NOW).screen).toBeTruthy()
    }
  })

  it("a failed load shows a friendly retry screen without the error details", () => {
    // error.tsx renders this component with a retry and never passes the error on.
    const html = renderToStaticMarkup(createElement(AvalError, { reset: () => {} }))
    expect(html).toContain("No pudimos cargar tu solicitud")
    expect(html).toContain("Intentar de nuevo")
    expect(html).not.toContain("Guarantor view unavailable")
  })

  it("the dev preview can reproduce the load failure", async () => {
    vi.stubEnv("NODE_ENV", "development")
    await expect(AvalPreviewPage({ params: Promise.resolve({ estado: "error" }) })).rejects.toThrow("Guarantor view unavailable")
  })

  it("the dev preview is a 404 outside development and for unknown states", async () => {
    const notFound = /NEXT_HTTP_ERROR_FALLBACK;404/
    vi.stubEnv("NODE_ENV", "development")
    await expect(AvalPreviewPage({ params: Promise.resolve({ estado: "nope" }) })).rejects.toThrow(notFound)
    for (const env of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", env)
      await expect(AvalPreviewPage({ params: Promise.resolve({ estado: "formulario" }) })).rejects.toThrow(notFound)
      await expect(AvalPreviewPage({ params: Promise.resolve({ estado: "error" }) })).rejects.toThrow(notFound)
    }
  })
})
