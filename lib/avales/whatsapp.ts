/**
 * WhatsApp messages of the guarantor route (contract §8). Server-side only.
 *
 * PENDING: the n8n Wa2Desk integration and the Meta-approved templates.
 * - In simulation (test bypass, development/test) every send is simulated and succeeds, so the job
 *   can move statuses and store `invited-at` / `thanked-at` end to end.
 * - Outside simulation nothing can be sent yet: the sender is not ready and every send fails, so
 *   guarantors stay `pending` (no link is issued) and notices are reported as not sent.
 * Replace `notIntegratedSender` with the real n8n call when the templates are approved; the job only
 * depends on the `WhatsAppSender` interface.
 *
 * Privacy: never log the phone in full, the variables (they hold names and the link token) or
 * the provider response.
 */

export type WhatsAppTemplate =
  /** To the guarantor: guarantor name, applicant name, relationship, amount, link. */
  | "guarantor_invitation"
  /** To the applicant: name, amount, contract link. */
  | "contract_approved"
  /** To the applicant: name. */
  | "request_expired"
  /** To the applicant: name. */
  | "request_rejected"
  /** To the applicant: name (cupo below the amount when releasing). */
  | "request_not_approved"
  /** To the guarantor: name. */
  | "guarantor_thanks"

export interface WhatsAppMessage {
  template: WhatsAppTemplate
  /** 8-digit Guatemalan phone. */
  to: string
  variables: Record<string, string>
}

export type WhatsAppResult = { ok: true; simulated: boolean } | { ok: false; reason: string }

export type WhatsAppSender = ((message: WhatsAppMessage) => Promise<WhatsAppResult>) & {
  /** false when no message can be sent at all: the job then issues no invitation links. */
  ready?: boolean
}

export function maskPhone(phone: string): string {
  return phone.length >= 4 ? `****${phone.slice(-4)}` : "****"
}

/** Simulation only: always succeeds without contacting anyone. */
export const simulatedSender: WhatsAppSender = Object.assign(
  async (message: WhatsAppMessage): Promise<WhatsAppResult> => {
    console.info(`[avales] whatsapp simulated: ${message.template} to ${maskPhone(message.to)}`)
    return { ok: true, simulated: true }
  },
  { ready: true },
)

/** Outside simulation until the n8n integration exists: never sends, always reports why. */
export const notIntegratedSender: WhatsAppSender = Object.assign(
  async (message: WhatsAppMessage): Promise<WhatsAppResult> => {
    console.warn(`[avales] whatsapp NOT SENT (${message.template}): n8n Wa2Desk integration pending`)
    return { ok: false, reason: "whatsapp_not_integrated" }
  },
  { ready: false },
)

export function whatsappSender(simulation: boolean): WhatsAppSender {
  return simulation ? simulatedSender : notIntegratedSender
}
