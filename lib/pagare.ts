import { randomBytes, randomUUID, createHash } from "crypto"
import { headers } from "next/headers"

const PAGARE_WEBHOOK_URL = process.env.PAGARE_WEBHOOK_URL || ""

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generarPagare(input: PagareInput): Promise<void> {
  if (!PAGARE_WEBHOOK_URL) {
    console.warn("[PAGARE] PAGARE_WEBHOOK_URL not set — skipping")
    return
  }

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
      numero_dpi: input.identification,
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

    const finalPayload = {
      ...payload,
      hash_documento: hashDocumento,
      hash_firma: hashFirma,
      hash_cadena_auditoria: hashCadena,
    }

    console.log("[PAGARE] Sending pagaré to webhook...")

    // POST with 3s timeout — disbursement is already done, this must not hang
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
      if (r.ok) {
        console.log("[PAGARE] ✅ Sent successfully")
      } else {
        console.error(`[PAGARE] ❌ HTTP ${r.status}`)
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId)
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        console.warn("[PAGARE] ⚠️ Webhook timeout after 3s — moving on")
      } else {
        console.error("[PAGARE] ❌ Fetch error:", fetchErr instanceof Error ? fetchErr.message : fetchErr)
      }
    }
  } catch (err) {
    // Outer catch: never rethrow — pagare failure must never affect disbursement result
    console.error("[PAGARE] ❌ Unexpected error in generarPagare:", err)
  }
}
