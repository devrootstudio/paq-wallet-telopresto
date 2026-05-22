import { randomBytes, randomUUID, createHash } from "crypto"
import { headers } from "next/headers"

const PAGARE_WEBHOOK_URL = process.env.PAGARE_WEBHOOK_URL || ""
const PDFMONKEY_API_KEY = process.env.PDFMONKEY_API_KEY || ""
const PDFMONKEY_TEMPLATE_ID = process.env.PDFMONKEY_TEMPLATE_ID || "584A38C9-ECF6-4B21-8B32-894015F081D4"

// ─── Types ───────────────────────────────────────────────────────────────────

interface IpInfo {
  ip: string
  isp: string
  ciudad: string
  pais: string
  geolocalizacion: string
  countryCode: string
}

export interface PagareInput {
  phone: string
  identification: string
  fullName: string
  email: string
  autorizacion: string
  requestedAmount: number
  comisionPorcentaje: number
  fingerprint: string
  screenResolution: string
  idiomaBrowser: string
  ipInfo: IpInfo | null
  otpHash: string
}

// ─── Guatemala timestamp ──────────────────────────────────────────────────────

function getGuatemalaTime() {
  const now = new Date()
  const local = new Date(now.getTime() + -6 * 60 * 60 * 1000) // UTC-6, no DST

  const d = String(local.getUTCDate()).padStart(2, "0")
  const m = String(local.getUTCMonth() + 1).padStart(2, "0")
  const y = local.getUTCFullYear()
  const hh = String(local.getUTCHours()).padStart(2, "0")
  const mm = String(local.getUTCMinutes()).padStart(2, "0")
  const ss = String(local.getUTCSeconds()).padStart(2, "0")
  const ms = String(local.getUTCMilliseconds()).padStart(3, "0")
  const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ]

  return {
    fechaEmision: `${d}/${m}/${y}`,
    fechaActual: `${parseInt(d)} de ${MESES[local.getUTCMonth()]} de ${y}`,
    fechaFirmaIso: `${y}-${m}-${d}T${hh}:${mm}:${ss}.${ms}-06:00`,
    fechaFirmaLegible: `${d}/${m}/${y} ${hh}:${mm}:${ss}.${ms} (GMT-6)`,
    timestampUnixMs: String(now.getTime()),
    year: y,
  }
}

// ─── Number to Spanish words (up to 9,999) ───────────────────────────────────

function numberToWords(n: number): string {
  if (n === 0) return "CERO"
  if (n === 100) return "CIEN"

  const ONES = [
    "", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
    "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
    "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  ]
  const TENS = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"]
  const HUNDREDS = [
    "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
    "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
  ]

  if (n < 20) return ONES[n]

  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    if (tens === 2 && ones > 0) return `VEINTI${ONES[ones]}`
    return ones === 0 ? TENS[tens] : `${TENS[tens]} Y ${ONES[ones]}`
  }

  if (n < 1000) {
    const hundreds = Math.floor(n / 100)
    const rest = n % 100
    return rest === 0 ? HUNDREDS[hundreds] : `${HUNDREDS[hundreds]} ${numberToWords(rest)}`
  }

  if (n < 10000) {
    const thousands = Math.floor(n / 1000)
    const rest = n % 1000
    const prefix = thousands === 1 ? "MIL" : `${numberToWords(thousands)} MIL`
    return rest === 0 ? prefix : `${prefix} ${numberToWords(rest)}`
  }

  return n.toString() // fallback for amounts > 9,999
}

// ─── User-Agent parser ────────────────────────────────────────────────────────

function parseUA(ua: string): { device: string; os: string; browser: string } {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  let device = isMobile ? "Mobile" : "Desktop"

  if (/iPhone/.test(ua)) device = "Mobile · Apple iPhone"
  else if (/iPad/.test(ua)) device = "Tablet · Apple iPad"
  else {
    const androidM = ua.match(/Android[^;]*;\s*([^)]+)/)
    if (androidM) device = `Mobile · ${androidM[1].trim()}`
  }

  let os = ""
  const iosM = ua.match(/iPhone OS ([\d_]+)/)
  if (iosM) {
    os = `iOS ${iosM[1].replace(/_/g, ".")}`
  } else {
    const androidOsM = ua.match(/Android ([\d.]+)/)
    if (androidOsM) os = `Android ${androidOsM[1]}`
    else if (/Windows NT/.test(ua)) os = "Windows"
    else {
      const macM = ua.match(/Mac OS X ([\d_]+)/)
      if (macM) os = `macOS ${macM[1].replace(/_/g, ".")}`
    }
  }

  const edgeM = ua.match(/Edg\/([\d.]+)/)
  if (edgeM) return { device, os, browser: `Edge ${edgeM[1]}` }

  const chromeM = ua.match(/Chrome\/([\d.]+)/)
  if (chromeM && !/Chromium/.test(ua)) return { device, os, browser: `Chrome ${chromeM[1]}` }

  const safariM = ua.match(/Version\/([\d.]+).*Safari/)
  if (safariM) return { device, os, browser: `Safari ${safariM[1]}` }

  const firefoxM = ua.match(/Firefox\/([\d.]+)/)
  if (firefoxM) return { device, os, browser: `Firefox ${firefoxM[1]}` }

  return { device, os, browser: "Unknown" }
}

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

// ─── PDF Monkey ───────────────────────────────────────────────────────────────

async function generarPdf(payload: Record<string, unknown>): Promise<{ id: string; url: string | null }> {
  if (!PDFMONKEY_API_KEY) {
    console.warn("[PDFMONKEY] PDFMONKEY_API_KEY not set — skipping PDF generation")
    return { id: "", url: null }
  }

  // Create document
  let documentId: string
  try {
    const createRes = await fetch("https://api.pdfmonkey.io/api/v1/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PDFMONKEY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document: {
          document_template_id: PDFMONKEY_TEMPLATE_ID,
          payload,
          status: "pending",
        },
      }),
    })

    if (!createRes.ok) {
      console.error(`[PDFMONKEY] ❌ Create failed: HTTP ${createRes.status}`)
      return { id: "", url: null }
    }

    const createData = await createRes.json()
    documentId = createData.document?.id

    if (!documentId) {
      console.error("[PDFMONKEY] ❌ No document ID in response")
      return { id: "", url: null }
    }

    console.log(`[PDFMONKEY] Document created: ${documentId}`)
  } catch (err) {
    console.error("[PDFMONKEY] ❌ Error creating document:", err)
    return { id: "", url: null }
  }

  // Poll for completion — max 5 attempts × 500ms = 2.5s
  for (let attempt = 1; attempt <= 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))

    try {
      const pollRes = await fetch(`https://api.pdfmonkey.io/api/v1/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${PDFMONKEY_API_KEY}` },
      })

      if (!pollRes.ok) continue

      const pollData = await pollRes.json()
      const status: string = pollData.document?.status
      const url: string | null = pollData.document?.download_url || pollData.document?.permanent_download_url || null

      console.log(`[PDFMONKEY] Poll ${attempt}/5: status=${status}`)

      if (status === "success" && url) {
        console.log(`[PDFMONKEY] ✅ PDF ready: ${url}`)
        return { id: documentId, url }
      }

      if (status === "failure") {
        console.error("[PDFMONKEY] ❌ Generation failed")
        return { id: documentId, url: null }
      }
    } catch (err) {
      console.warn(`[PDFMONKEY] Poll ${attempt} error:`, err)
    }
  }

  // URL not ready within 2.5s — return ID so it can be retrieved later
  console.warn("[PDFMONKEY] ⚠️ PDF not ready after 5 polls — document ID included for later retrieval")
  return { id: documentId, url: null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generarPagare(input: PagareInput): Promise<string | null> {
  try {
    const headerStore = await headers()
    const ua = headerStore.get("user-agent") || ""
    const referer = headerStore.get("referer") || ""
    const acceptLang = headerStore.get("accept-language") || ""

    const { device, os, browser } = parseUA(ua)
    const dates = getGuatemalaTime()

    const numeroContrato = `PAQW-ADS-${dates.year}-${randomBytes(3).toString("hex").toUpperCase()}`
    const idDocumento = `DOC-${randomUUID().toUpperCase()}`

    const phone502 = `+502 ${input.phone.slice(0, 4)}-${input.phone.slice(4)}`
    const montoFormateado = new Intl.NumberFormat("es-GT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(input.requestedAmount)

    const payload = {
      numero_contrato: numeroContrato,
      id_documento: idDocumento,
      fecha_emision: dates.fechaEmision,
      fecha_actual: dates.fechaActual,

      nombre_completo: input.fullName.toUpperCase(),
      edad: "PENDIENTE",
      estado_civil: "PENDIENTE",
      numero_dpi: input.identification.replace(/(\d{4})(\d{5})(\d{4})/, "$1 $2 $3"),
      direccion_completa: "PENDIENTE",
      nombre_empresa: "PENDIENTE",

      monto_en_numeros: montoFormateado,
      monto_en_letras: numberToWords(Math.floor(input.requestedAmount)),
      tasa: String(input.comisionPorcentaje || 0),

      metodo_aceptacion: "Click-wrap + OTP SMS",
      fecha_firma_iso: dates.fechaFirmaIso,
      fecha_firma_legible: dates.fechaFirmaLegible,
      timestamp_unix_ms: dates.timestampUnixMs,
      zona_horaria: "America/Guatemala (GMT-6)",

      email_firmante: input.email,
      telefono_verificado: phone502,
      otp_codigo_hash: input.otpHash || "",
      id_sesion: input.autorizacion,

      ip_firmante: input.ipInfo?.ip || "",
      pais: input.ipInfo?.pais || "Guatemala",
      ciudad: input.ipInfo?.ciudad || "",
      geolocalizacion: input.ipInfo?.geolocalizacion || "",
      isp: input.ipInfo?.isp || "",

      dispositivo: device,
      sistema_operativo: os,
      navegador: browser,
      idioma_navegador: input.idiomaBrowser || acceptLang.split(",")[0] || "es-GT",
      resolucion_pantalla: input.screenResolution || "",
      user_agent: ua,
      referrer: referer,
      fingerprint_navegador: input.fingerprint || "",

      hash_documento: "",
      hash_firma: "",
      hash_cadena_auditoria: "",
    }

    // Hash content fields (excluding the hash fields themselves)
    const contentForHash = { ...payload }
    delete (contentForHash as Record<string, unknown>).hash_documento
    delete (contentForHash as Record<string, unknown>).hash_firma
    delete (contentForHash as Record<string, unknown>).hash_cadena_auditoria
    const hashDocumento = sha256(JSON.stringify(contentForHash))

    // Signature hash: key identity + verification fields
    const hashFirma = sha256(
      [input.autorizacion, input.otpHash, input.phone, input.email, dates.timestampUnixMs].join("|")
    )

    // Audit chain: combines both + timestamp
    const hashCadena = sha256(`${hashDocumento}|${hashFirma}|${dates.timestampUnixMs}`)

    // Generate PDF via PDF Monkey
    const { id: pagareDocumentoId, url: pagareUrl } = await generarPdf({
      ...contentForHash,
      hash_documento: hashDocumento,
      hash_firma: hashFirma,
      hash_cadena_auditoria: hashCadena,
    })

    const finalPayload = {
      ...payload,
      hash_documento: hashDocumento,
      hash_firma: hashFirma,
      hash_cadena_auditoria: hashCadena,
      pagare_documento_id: pagareDocumentoId || "",
      pagare_url: pagareUrl || "",
    }

    // Send webhook if configured
    if (PAGARE_WEBHOOK_URL) {
      console.log("[PAGARE] Sending pagaré to webhook...")
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      try {
        const r = await fetch(PAGARE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalPayload),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (r.ok) console.log("[PAGARE] ✅ Webhook sent successfully")
        else console.error(`[PAGARE] ❌ Webhook HTTP ${r.status}`)
      } catch (fetchErr) {
        clearTimeout(timeoutId)
        if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
          console.warn("[PAGARE] ⚠️ Webhook timeout after 3s — moving on")
        } else {
          console.error("[PAGARE] ❌ Webhook error:", fetchErr instanceof Error ? fetchErr.message : fetchErr)
        }
      }
    } else {
      console.warn("[PAGARE] PAGARE_WEBHOOK_URL not set — skipping webhook")
    }

    return pagareUrl
  } catch (err) {
    // Outer catch: never rethrow — pagare failure must never affect disbursement result
    console.error("[PAGARE] ❌ Unexpected error in generarPagare:", err)
    return null
  }
}
