/**
 * Declaration the guarantor accepts on /aval/<token> before "Avalar". Shared by client and server:
 * the client shows it and sends it back as `acceptedText`; the server checks it is exactly this text
 * and stores `DECLARATION_SHA256` (and the version) as evidence.
 *
 * Draft wording pending legal review. Changing the text requires a new version and hash
 * (tests/avales-declaration.test.ts recomputes the hash).
 */

export const DECLARATION_VERSION = "2026-11-23.1"

export const DECLARATION_TEXT =
  "Declaro que los datos que confirmo son míos y verdaderos. " +
  "Acepto ser aval de esta solicitud: si la persona solicitante no paga, Te lo Presto podrá contactarme para gestionar el pago del monto indicado. " +
  "Autorizo que se valide mi identidad con RENAP y que se guarde la evidencia de esta aceptación (fecha, dirección IP y dispositivo)."

/** SHA-256 (hex) of `DECLARATION_TEXT` in UTF-8. */
export const DECLARATION_SHA256 = "461a29d0888b54fd54dc445202409d5fcfc546b115360b5209c13783f5e04bb2"
