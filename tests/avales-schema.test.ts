import { describe, it, expect } from "vitest"
import {
  guarantorRequestSchema,
  guarantorAnswerSchema,
  guarantorSchema,
  makeGuarantorsSchema,
  toFieldErrors,
} from "@/lib/avales/schema"
import { RELATIONSHIPS, type GuarantorRequestInput } from "@/lib/avales/types"

function validRequest(overrides: Partial<GuarantorRequestInput> = {}): GuarantorRequestInput {
  return {
    authorization: "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334455667788",
    applicant: {
      phone: "55001122",
      identification: "1000000000001",
      fullName: "Solicitante De Prueba",
      email: "solicitante@example.com",
      company: "Empresa Ficticia",
      age: "30",
      maritalStatus: "Soltero",
      address: "Ciudad",
    },
    cupoId: "CUPO-1",
    approvedAmount: 3500,
    requestedAmount: 1000,
    commission: 75,
    commissionPct: 7.5,
    audit: {
      fingerprint: "fp",
      screenResolution: "390x844",
      idiomaBrowser: "es-GT",
      ipInfo: null,
      otpHash: "abc",
    },
    guarantors: [
      { fullName: "Aval Uno", phone: "55550001", identification: "0000000000001", relationship: "hermano/a" },
      { fullName: "Aval Dos", phone: "55550002", identification: "0000000000002", relationship: "amigo/a" },
      { fullName: "Aval Tres", phone: "55550003", identification: "0000000000003", relationship: "otro" },
    ],
    ...overrides,
  }
}

function errorsOf(input: unknown) {
  const r = guarantorRequestSchema.safeParse(input)
  return r.success ? {} : toFieldErrors(r.error)
}

describe("guarantorSchema", () => {
  it("accepts a valid guarantor and normalizes phone, DPI and name", () => {
    const r = guarantorSchema.parse({
      fullName: "  Ana   María  López ",
      phone: "5555 0001",
      identification: "0000 00000 0001",
      relationship: "cónyuge",
    })
    expect(r).toEqual({ fullName: "Ana María López", phone: "55550001", identification: "0000000000001", relationship: "cónyuge" })
  })

  it("rejects a phone without 8 digits, in Spanish", () => {
    const r = guarantorSchema.safeParse({ fullName: "A", phone: "5555000", identification: "0000000000001", relationship: "otro" })
    expect(r.success).toBe(false)
    expect(toFieldErrors(r.error!)).toEqual({ phone: "El teléfono debe tener 8 dígitos" })
  })

  it("rejects letters in the phone", () => {
    const r = guarantorSchema.safeParse({ fullName: "A", phone: "5555000a", identification: "0000000000001", relationship: "otro" })
    expect(toFieldErrors(r.error!)).toEqual({ phone: "El teléfono debe tener 8 dígitos" })
  })

  it("rejects a DPI without 13 digits", () => {
    const r = guarantorSchema.safeParse({ fullName: "A", phone: "55550001", identification: "123", relationship: "otro" })
    expect(toFieldErrors(r.error!)).toEqual({ identification: "El DPI debe tener 13 dígitos" })
  })

  it("rejects an empty or blank name", () => {
    const r = guarantorSchema.safeParse({ fullName: "   ", phone: "55550001", identification: "0000000000001", relationship: "otro" })
    expect(toFieldErrors(r.error!)).toEqual({ fullName: "El nombre es obligatorio" })
  })

  it("accepts every relationship of the contract and nothing else", () => {
    for (const relationship of RELATIONSHIPS) {
      expect(guarantorSchema.safeParse({ fullName: "A", phone: "55550001", identification: "0000000000001", relationship }).success).toBe(true)
    }
    const r = guarantorSchema.safeParse({ fullName: "A", phone: "55550001", identification: "0000000000001", relationship: "primo" })
    expect(toFieldErrors(r.error!)).toEqual({ relationship: "Selecciona la relación" })
    expect(RELATIONSHIPS).toEqual([
      "hermano/a",
      "hijo/a",
      "padre/madre",
      "cónyuge",
      "amigo/a",
      "vecino/a",
      "compañero/a de trabajo",
      "otro",
    ])
  })

  it("reports missing fields in Spanish", () => {
    const r = guarantorSchema.safeParse({})
    expect(toFieldErrors(r.error!)).toEqual({
      fullName: "El nombre es obligatorio",
      phone: "El teléfono es obligatorio",
      identification: "El DPI es obligatorio",
      relationship: "Selecciona la relación",
    })
  })
})

describe("makeGuarantorsSchema (Paso 3b)", () => {
  const applicant = { phone: "5500 1122", identification: "1000000000001" }
  const g = validRequest().guarantors

  it("accepts three distinct guarantors", () => {
    expect(makeGuarantorsSchema(applicant).safeParse(g).success).toBe(true)
  })

  it("requires exactly three", () => {
    const r = makeGuarantorsSchema(applicant).safeParse(g.slice(0, 2))
    expect(toFieldErrors(r.error!, "guarantors")).toEqual({ guarantors: "Se necesitan exactamente 3 avales" })
  })

  it("marks every repeated phone and DPI among guarantors", () => {
    const r = makeGuarantorsSchema(applicant).safeParse([
      g[0],
      { ...g[1], phone: "5555-0001" },
      { ...g[2], identification: g[0].identification },
    ])
    expect(toFieldErrors(r.error!, "guarantors")).toEqual({
      "guarantors.0.phone": "Este teléfono ya está en otro aval",
      "guarantors.1.phone": "Este teléfono ya está en otro aval",
      "guarantors.0.identification": "Este DPI ya está en otro aval",
      "guarantors.2.identification": "Este DPI ya está en otro aval",
    })
  })

  it("rejects the applicant's own phone or DPI (with separators)", () => {
    const r = makeGuarantorsSchema(applicant).safeParse([
      { ...g[0], phone: "55001122" },
      { ...g[1], identification: "1000 00000 0001" },
      g[2],
    ])
    expect(toFieldErrors(r.error!, "guarantors")).toEqual({
      "guarantors.0.phone": "El teléfono del aval no puede ser el tuyo",
      "guarantors.1.identification": "El DPI del aval no puede ser el tuyo",
    })
  })
})

describe("guarantorRequestSchema (server revalidation)", () => {
  it("accepts a valid request", () => {
    expect(guarantorRequestSchema.safeParse(validRequest()).success).toBe(true)
  })

  it("applies the cross-checks with full paths", () => {
    const base = validRequest()
    const errors = errorsOf({
      ...base,
      guarantors: [{ ...base.guarantors[0], phone: base.applicant.phone }, base.guarantors[1], base.guarantors[2]],
    })
    expect(errors).toEqual({ "guarantors.0.phone": "El teléfono del aval no puede ser el tuyo" })
  })

  it("rejects a malformed authorization (it is used inside a storage formula)", () => {
    expect(errorsOf(validRequest({ authorization: "x' OR 1=1" }))).toEqual({ authorization: "Número de autorización inválido" })
    expect(errorsOf(validRequest({ authorization: "" }))).toEqual({ authorization: "Número de autorización inválido" })
  })

  it("rejects amounts that do not add up", () => {
    expect(errorsOf(validRequest({ requestedAmount: 4000 }))).toEqual({ requestedAmount: "El monto supera el aprobado" })
    expect(errorsOf(validRequest({ commission: 1000 }))).toEqual({ commission: "Comisión inválida" })
    expect(errorsOf(validRequest({ requestedAmount: 0 }))).toHaveProperty("requestedAmount")
    expect(errorsOf(validRequest({ approvedAmount: Number.NaN }))).toHaveProperty("approvedAmount")
  })

  it("rejects an invalid applicant", () => {
    const base = validRequest()
    expect(errorsOf({ ...base, applicant: { ...base.applicant, identification: "12" } })).toEqual({
      "applicant.identification": "El DPI debe tener 13 dígitos",
    })
  })

  it("rejects missing guarantors", () => {
    const { guarantors: _omit, ...rest } = validRequest()
    void _omit
    expect(errorsOf(rest)).toEqual({ guarantors: "Faltan los avales" })
  })
})

describe("guarantorAnswerSchema", () => {
  it("validates what the guarantor confirms", () => {
    expect(guarantorAnswerSchema.safeParse({ fullName: "Aval Uno", identification: "0000000000001", phone: "55550001" }).success).toBe(true)
    const r = guarantorAnswerSchema.safeParse({ fullName: "", identification: "1", phone: "1" })
    expect(Object.keys(toFieldErrors(r.error!)).sort()).toEqual(["fullName", "identification", "phone"])
  })
})
