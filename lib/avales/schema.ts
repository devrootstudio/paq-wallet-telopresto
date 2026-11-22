import { z } from "zod"
import {
  RELATIONSHIPS,
  type FieldErrors,
  type GuarantorAnswerInput,
  type GuarantorInput,
  type GuarantorRequestInput,
} from "./types"

/**
 * Validation shared by Paso 3b (client) and the server actions. Messages are in Spanish because the
 * client shows them as is. Phones and DPIs accept spaces and dashes and come out as bare digits.
 */

const stripSeparators = (value: string) => value.replace(/[\s-]/g, "")

export const phoneSchema = z
  .string({ required_error: "El teléfono es obligatorio", invalid_type_error: "El teléfono es obligatorio" })
  .transform(stripSeparators)
  .pipe(z.string().regex(/^\d{8}$/, "El teléfono debe tener 8 dígitos"))

export const dpiSchema = z
  .string({ required_error: "El DPI es obligatorio", invalid_type_error: "El DPI es obligatorio" })
  .transform(stripSeparators)
  .pipe(z.string().regex(/^\d{13}$/, "El DPI debe tener 13 dígitos"))

export const fullNameSchema = z
  .string({ required_error: "El nombre es obligatorio", invalid_type_error: "El nombre es obligatorio" })
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "El nombre es obligatorio").max(120, "El nombre es demasiado largo"))

export const relationshipSchema = z.enum(RELATIONSHIPS, {
  errorMap: () => ({ message: "Selecciona la relación" }),
})

export const guarantorSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  identification: dpiSchema,
  relationship: relationshipSchema,
})

const MESSAGES = {
  phoneRepeated: "Este teléfono ya está en otro aval",
  dpiRepeated: "Este DPI ya está en otro aval",
  phoneIsApplicant: "El teléfono del aval no puede ser el tuyo",
  dpiIsApplicant: "El DPI del aval no puede ser el tuyo",
} as const

/**
 * Cross-checks between guarantors: no phone or DPI repeated among them, nor equal to the applicant's.
 * Every offending field gets its own error, so the form can mark each one.
 */
function checkGuarantors(
  guarantors: { phone: string; identification: string }[],
  applicant: { phone: string; identification: string },
  ctx: z.RefinementCtx,
  prefix: (string | number)[],
) {
  const applicantPhone = stripSeparators(applicant.phone)
  const applicantDpi = stripSeparators(applicant.identification)
  guarantors.forEach((g, i) => {
    const others = guarantors.filter((_, j) => j !== i)
    if (g.phone === applicantPhone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...prefix, i, "phone"], message: MESSAGES.phoneIsApplicant })
    } else if (others.some((o) => o.phone === g.phone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...prefix, i, "phone"], message: MESSAGES.phoneRepeated })
    }
    if (g.identification === applicantDpi) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...prefix, i, "identification"], message: MESSAGES.dpiIsApplicant })
    } else if (others.some((o) => o.identification === g.identification)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...prefix, i, "identification"], message: MESSAGES.dpiRepeated })
    }
  })
}

const threeGuarantors = z
  .array(guarantorSchema, { required_error: "Faltan los avales" })
  .length(3, "Se necesitan exactamente 3 avales")

/**
 * Schema for the three guarantors of Paso 3b alone, given the applicant's phone and DPI.
 * Error paths look like `0.phone`; use `toFieldErrors(error, "guarantors")` for `guarantors.0.phone`.
 */
export function makeGuarantorsSchema(applicant: { phone: string; identification: string }) {
  return threeGuarantors.superRefine((guarantors, ctx) => checkGuarantors(guarantors, applicant, ctx, []))
}

const optionalText = (max: number) => z.string().trim().max(max).optional().default("")

export const applicantSchema = z.object({
  phone: phoneSchema,
  identification: dpiSchema,
  fullName: fullNameSchema,
  email: z.string().trim().max(200).default(""),
  company: optionalText(200),
  age: optionalText(10),
  maritalStatus: optionalText(50),
  address: optionalText(300),
})

const auditSchema = z.object({
  fingerprint: optionalText(200),
  screenResolution: optionalText(50),
  idiomaBrowser: optionalText(50),
  ipInfo: z
    .object({
      ip: z.string().max(64),
      isp: z.string().max(200),
      ciudad: z.string().max(200),
      pais: z.string().max(200),
      geolocalizacion: z.string().max(200),
      countryCode: z.string().max(10),
    })
    .nullable()
    .default(null),
  otpHash: optionalText(128),
})

const amount = (message: string) =>
  z.number({ required_error: message, invalid_type_error: message }).finite(message)

/**
 * Authorization numbers are 48 hex chars (Step 0). The pattern also keeps the value safe inside an
 * Airtable formula, where it is used as the idempotency lookup key.
 */
export const authorizationSchema = z
  .string({ required_error: "Falta el número de autorización", invalid_type_error: "Falta el número de autorización" })
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "Número de autorización inválido")

export const guarantorRequestSchema = z
  .object({
    authorization: authorizationSchema,
    applicant: applicantSchema,
    cupoId: z.string({ required_error: "Falta el id del cupo" }).trim().min(1, "Falta el id del cupo").max(100),
    approvedAmount: amount("Monto aprobado inválido").positive("Monto aprobado inválido"),
    requestedAmount: amount("Monto solicitado inválido").positive("Monto solicitado inválido"),
    commission: amount("Comisión inválida").min(0, "Comisión inválida"),
    commissionPct: amount("Porcentaje de comisión inválido").min(0).max(100, "Porcentaje de comisión inválido"),
    audit: auditSchema.default({}),
    guarantors: threeGuarantors,
  })
  .superRefine((data, ctx) => {
    if (data.requestedAmount > data.approvedAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requestedAmount"], message: "El monto supera el aprobado" })
    }
    if (data.commission >= data.requestedAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["commission"], message: "Comisión inválida" })
    }
    checkGuarantors(data.guarantors, data.applicant, ctx, ["guarantors"])
  })

export type ParsedGuarantorRequest = z.output<typeof guarantorRequestSchema>

/** What the guarantor confirms on /aval/<token> before accepting. */
export const guarantorAnswerSchema = z.object({
  fullName: fullNameSchema,
  identification: dpiSchema,
  phone: phoneSchema,
})

/**
 * Flattens a ZodError into `{ "guarantors.0.phone": "…" }`, first message per field.
 * `prefix` is prepended to every path (e.g. "guarantors" for `makeGuarantorsSchema`).
 */
export function toFieldErrors(error: z.ZodError, prefix?: string): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const path = [...(prefix ? [prefix] : []), ...issue.path].join(".") || "_"
    if (!(path in out)) out[path] = issue.message
  }
  return out
}

// Compile-time guards: the schemas accept exactly the shared input types.
type Assert<T extends true> = T
type Accepts<S extends z.ZodTypeAny, T> = T extends z.input<S> ? true : false
export type _GuarantorGuard = Assert<Accepts<typeof guarantorSchema, GuarantorInput>>
export type _RequestGuard = Assert<Accepts<typeof guarantorRequestSchema, GuarantorRequestInput>>
export type _AnswerGuard = Assert<Accepts<typeof guarantorAnswerSchema, GuarantorAnswerInput>>
