/**
 * Shared types for the guarantor ("aval") route. Imported by the client (Paso 3b, /aval/<token>)
 * and the server (app/avales-actions.ts, lib/avales/repo.ts). Contract: docs/contracts/avales.md.
 */

/** Which Step 3 the applicant sees. `TELOPRESTO_RUTA`, `aval` by default (contract §1). */
export type Ruta = "aval" | "normal"

/** Relationship options, exactly as stored in the `guarantors.relationship` select (contract §2). */
export const RELATIONSHIPS = [
  "hermano/a",
  "hijo/a",
  "padre/madre",
  "cónyuge",
  "amigo/a",
  "vecino/a",
  "compañero/a de trabajo",
  "otro",
] as const

export type Relationship = (typeof RELATIONSHIPS)[number]

/** One guarantor as the applicant enters it in Paso 3b. Phone: 8 digits; DPI: 13 digits (spaces and dashes are ignored). */
export interface GuarantorInput {
  fullName: string
  phone: string
  identification: string
  relationship: Relationship
}

/** Applicant data from Steps 0–1 (the contract needs company, age, marital status and address). */
export interface ApplicantInput {
  phone: string
  identification: string
  fullName: string
  email: string
  company: string
  age: string
  maritalStatus: string
  address: string
}

/** Device and OTP evidence collected client-side (same data the pagaré uses today). */
export interface GuarantorRequestAudit {
  fingerprint: string
  screenResolution: string
  idiomaBrowser: string
  ipInfo: {
    ip: string
    isp: string
    ciudad: string
    pais: string
    geolocalizacion: string
    countryCode: string
  } | null
  otpHash: string
}

/** What Paso 3b sends to `submitGuarantorRequest`. */
export interface GuarantorRequestInput {
  /** Authorization number generated at Step 0 (`formData.autorizacion`). Idempotency key. */
  authorization: string
  applicant: ApplicantInput
  /** `idSolicitud` returned by valida_cupo (`formData.idSolicitud`). */
  cupoId: string
  approvedAmount: number
  requestedAmount: number
  /** requestedAmount − disbursementAmount, as Step 3 computes it today. */
  commission: number
  commissionPct: number
  audit: GuarantorRequestAudit
  /** Exactly three guarantors, in the order the applicant entered them (position 1–3). */
  guarantors: [GuarantorInput, GuarantorInput, GuarantorInput]
}

/** `fieldErrors` keys are dotted paths of the input, e.g. `guarantors.0.phone` or `applicant.identification`. */
export type FieldErrors = Record<string, string>

export type SubmitErrorCode =
  /** The input failed validation; see `fieldErrors`. */
  | "validation"
  /** Missing or invalid security token (same check as the other server actions). */
  | "unauthorized"
  /** `TELOPRESTO_RUTA` is `normal`: the guarantor route is off. */
  | "route_disabled"
  /** Storage is not configured or did not answer. Safe to retry: the call is idempotent. */
  | "unavailable"

export type SubmitResult =
  | {
      ok: true
      /** Opaque id of the request (Airtable record id). */
      requestId: string
      /** ISO 8601. Creation + 48 h. */
      expiresAt: string
      /** Requested amount as stored (the original one when `reused`). */
      requestedAmount: number
      /**
       * true while the request still accepts answers (`pending_guarantors` and not past `expiresAt`).
       * false only on a retry over a request that expired or was already resolved: do not show "En revisión".
       */
      open: boolean
      /** true when a request with the same `authorization` already existed and was returned as is. */
      reused: boolean
    }
  | { ok: false; code: SubmitErrorCode; fieldErrors?: FieldErrors }

/** Fields shown on every /aval/<token> screen except `invalid`. Never data from the other guarantors. */
export interface GuarantorViewBase {
  /**
   * Full name of the applicant, trimmed, so the guarantor knows exactly who is asking for support.
   * The only applicant data a guarantor sees besides the amount.
   */
  applicantName: string
  /** First name of the applicant. Kept for compatibility; prefer `applicantName`. */
  applicantFirstName: string
  /** Requested amount in quetzales. */
  amount: number
  /** ISO 8601. When the request stops accepting answers. */
  expiresAt: string
}

/**
 * What /aval/<token> renders (contract §4), discriminated by `screen`:
 * - `form`: guarantor `pending`, `invited` or `identity_mismatch`, and the request still `pending_guarantors` and not past `expiresAt`.
 * - `answered`: the guarantor already authorized or rejected.
 * - `closed`: the request was resolved (quorum, rejected, released…) or the guarantor was closed.
 * - `expired`: the guarantor or the request expired, or `expiresAt` passed even if the job has not run yet.
 * - `invalid`: unknown or malformed token.
 */
export type GuarantorView =
  | (GuarantorViewBase & {
      screen: "form"
      /** The guarantor's own data as the applicant entered it, to confirm or correct. */
      guarantor: Pick<GuarantorInput, "fullName" | "phone" | "identification" | "relationship">
      /** true when RENAP did not match the data given before (`identity_mismatch`): show a "check your data" notice. */
      identityMismatch: boolean
    })
  | (GuarantorViewBase & { screen: "answered"; answer: "authorized" | "rejected" })
  | (GuarantorViewBase & { screen: "closed" })
  | (GuarantorViewBase & { screen: "expired" })
  | { screen: "invalid" }

export type GuarantorAnswer = "accept" | "reject"

/** What the guarantor confirms on the form. Name, DPI and phone are required for `accept`; ignored for `reject`. */
export interface GuarantorAnswerInput {
  fullName: string
  identification: string
  phone: string
  /**
   * For `accept`: the declaration text the guarantor accepted, exactly `DECLARATION_TEXT`
   * (lib/avales/declaration.ts). The server checks it and stores its hash as evidence.
   */
  acceptedText?: string
}

export type AnswerErrorCode =
  /** The link no longer takes answers: already answered, request resolved, or guarantor closed. */
  | "closed"
  /** The request or the guarantor expired (also when `expiresAt` passed before the job ran). */
  | "expired"
  /** Unknown or malformed token. */
  | "invalid"
  /** Storage or identity check unavailable. Safe to retry. */
  | "unavailable"
  /** The confirmed data or the accepted text failed validation; see `fieldErrors`. */
  | "validation"
  /** @deprecated Former stub answer; no longer returned. */
  | "not_available"

/**
 * Result of `answerGuarantor`. Seven outcomes:
 * - ok: `authorized` (accepted and RENAP matches), `rejected` (declined), `identity_mismatch`
 *   (RENAP does not match: the link stays open so the guarantor can correct the data);
 * - error: `closed`, `expired`, `invalid`, `unavailable` (plus `validation` for bad input).
 */
export type AnswerResult =
  | { ok: true; status: "authorized" | "rejected" | "identity_mismatch" }
  | { ok: false; code: AnswerErrorCode; fieldErrors?: FieldErrors }
