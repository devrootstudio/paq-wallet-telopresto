# Pagaré Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a signed pagaré (promissory note) via PDF Monkey webhook immediately after a successful salary advance disbursement in Step 3.

**Architecture:** A silent `ClientInfoCollector` component mounts at Step 0 and fire-and-forgets three async tasks (FingerprintJS, ipquery.io, screen/language) into Zustand. Step 2's server action captures `otpHash` and `comisionPorcentaje` from the SOAP cupo response and returns them to be stored in the wizard. When Step 3 confirms disbursement, `submitStep3Form` passes all collected data to `generarPagare()`, which assembles the full pagaré payload and POSTs it to the webhook with a 3-second timeout — never blocking nor failing the disbursement result.

**Tech Stack:** Next.js 16 Server Actions, `@fingerprintjs/fingerprintjs` (client), `api.ipquery.io` (client-side REST, no auth), Node.js `crypto` (server), Zustand

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `components/client-info-collector.tsx` | **Create** | Collect fingerprint (FingerprintJS), IP geo (ipquery.io), screen resolution and browser language on page mount — all fire-and-forget |
| `lib/pagare.ts` | **Create** | Assemble full pagaré payload: date utils, number-to-words, UA parser, sha-256 helpers, webhook POST with 3s timeout |
| `lib/store.ts` | Modify | Add 6 fields to `FormData`: `fingerprint`, `screenResolution`, `idiomaBrowser`, `ipInfo`, `otpHash`, `comisionPorcentaje` |
| `lib/step-handlers.ts` | Modify | Strengthen `generateAutorizacion()` to 48-char hex; store `otpHash` + `comisionPorcentaje` from step 2 server response |
| `app/actions.ts` | Modify | `ServerActionResponse` gets `otpHash?` + `comisionPorcentaje?`; `submitStep2Form` computes + returns both; `Step3FormData` extended; `submitStep3Form` calls `generarPagare` after success |
| `components/steps/step-3-approval.tsx` | Modify | Include 7 new fields from store in the `submitStep3Form` call |
| `app/page.tsx` | Modify | Mount `<ClientInfoCollector />` |
| `.env.local` | Modify | Add `PAGARE_WEBHOOK_URL` |
| `.env.dev` | Modify | Add `PAGARE_WEBHOOK_URL` |

---

## Phase 1 — Foundation

### Task 1: Install dependency + env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.local`
- Modify: `.env.dev`

- [ ] **Step 1: Install FingerprintJS**

```bash
npm install @fingerprintjs/fingerprintjs
```

Expected: `added 1 package`, no errors.

- [ ] **Step 2: Add `PAGARE_WEBHOOK_URL` to `.env.local`**

Append at the end of `.env.local`:
```
PAGARE_WEBHOOK_URL=https://hook.us2.make.com/lcxlurh4exdau4t51iyngr6wdwe6r66y
```

- [ ] **Step 3: Add `PAGARE_WEBHOOK_URL` to `.env.dev`**

Append at the end of `.env.dev`:
```
PAGARE_WEBHOOK_URL=https://hook.us2.make.com/lcxlurh4exdau4t51iyngr6wdwe6r66y
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.dev
git commit -m "feat: install @fingerprintjs/fingerprintjs, add PAGARE_WEBHOOK_URL env var"
```

---

### Task 2: Strengthen IDs + extend Zustand store

**Files:**
- Modify: `lib/step-handlers.ts:13-15`
- Modify: `lib/store.ts`

- [ ] **Step 1: Replace `generateAutorizacion` in `lib/step-handlers.ts`**

Current (lines 13–15):
```typescript
function generateAutorizacion(): string {
  return `AUTH-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
}
```

Replace with:
```typescript
function generateAutorizacion(): string {
  const array = new Uint8Array(24)
  globalThis.crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("")
}
```

Produces a 48-char lowercase hex string using Web Crypto API (available in browser and Node 15+).

- [ ] **Step 2: Extend `FormData` interface in `lib/store.ts`**

Replace the existing `FormData` interface with:

```typescript
interface FormData {
  identification: string
  fullName: string
  phone: string
  email: string
  nit: string
  startDate: string
  salary: string
  paymentFrequency: string
  verificationPhone: string
  requestedAmount: number
  approvedAmount: number
  disbursementAmount: number
  idSolicitud: string
  hasCommissionIssue: boolean
  autorizacion: string
  clientId: string
  nextAction: "create" | "edit" | "continue"
  // Pagaré — device data collected client-side at Step 0
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
  // Pagaré — transaction data captured at Step 2
  otpHash: string
  comisionPorcentaje: number
}
```

- [ ] **Step 3: Add new fields to the initial `formData` value in `lib/store.ts`**

In the `create<WizardState>` call, update the `formData` initial value to add the 6 new fields (after `nextAction: "continue"`):

```typescript
fingerprint: "",
screenResolution: "",
idiomaBrowser: "",
ipInfo: null,
otpHash: "",
comisionPorcentaje: 0,
```

- [ ] **Step 4: Update the `cupo` error branch in `setErrorStep` in `lib/store.ts`**

The cupo branch does a hard reset of `formData`. Device-level fields (`fingerprint`, `screenResolution`, `idiomaBrowser`, `ipInfo`) must survive the reset — the user is on the same device. Transaction fields (`otpHash`, `comisionPorcentaje`) do reset.

Replace the `formData` object inside the `if (errorType === "cupo")` branch with:

```typescript
formData: {
  identification: "",
  fullName: "",
  phone: "",
  email: "",
  nit: "",
  startDate: "",
  salary: "",
  paymentFrequency: "",
  verificationPhone: "",
  requestedAmount: 0,
  approvedAmount: 0,
  disbursementAmount: 0,
  idSolicitud: "",
  hasCommissionIssue: false,
  autorizacion: "",
  clientId: "",
  nextAction: "continue",
  fingerprint: state.formData.fingerprint,
  screenResolution: state.formData.screenResolution,
  idiomaBrowser: state.formData.idiomaBrowser,
  ipInfo: state.formData.ipInfo,
  otpHash: "",
  comisionPorcentaje: 0,
},
```

- [ ] **Step 5: Update `reset()` in `lib/store.ts`**

Add the 6 new fields (all cleared) to the `formData` object inside `reset()`:

```typescript
fingerprint: "",
screenResolution: "",
idiomaBrowser: "",
ipInfo: null,
otpHash: "",
comisionPorcentaje: 0,
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add lib/step-handlers.ts lib/store.ts
git commit -m "feat: strengthen autorizacion to 48-char hex, extend store with pagare fields"
```

---

## Phase 2 — Client Info Collector

### Task 3: Create `ClientInfoCollector` + mount in `page.tsx`

**Files:**
- Create: `components/client-info-collector.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create `components/client-info-collector.tsx`**

```typescript
"use client"

import { useEffect } from "react"
import { useWizardStore } from "@/lib/store"

export function ClientInfoCollector() {
  const { updateFormData } = useWizardStore()

  useEffect(() => {
    // Synchronous — always available immediately
    updateFormData({
      screenResolution: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
      idiomaBrowser: navigator.language || "es-GT",
    })

    // FingerprintJS — async, fire-and-forget
    import("@fingerprintjs/fingerprintjs")
      .then((FingerprintJS) => FingerprintJS.load())
      .then((fp) => fp.get())
      .then((result) => {
        updateFormData({ fingerprint: result.visitorId })
      })
      .catch(() => {
        // silently ignore — pagare proceeds without fingerprint
      })

    // IP geolocation — async, fire-and-forget
    // Calling without an IP parameter: ipquery.io detects the browser's own public IP
    fetch("https://api.ipquery.io/", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        const lat: number | undefined = data.location?.latitude
        const lng: number | undefined = data.location?.longitude
        const geo =
          lat != null && lng != null
            ? `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`
            : ""
        updateFormData({
          ipInfo: {
            ip: data.ip || "",
            isp: data.isp?.isp || "",
            ciudad: data.location?.city || "",
            pais: data.location?.country || "",
            geolocalizacion: geo,
            countryCode: data.location?.country_code || "",
          },
        })
      })
      .catch(() => {
        // silently ignore — pagare proceeds without geo data
      })
  }, []) // runs once on mount

  return null
}
```

- [ ] **Step 2: Mount `<ClientInfoCollector />` in `app/page.tsx`**

Add the import and mount the component. Updated `Home` function:

```typescript
import { ClientInfoCollector } from "@/components/client-info-collector"

export default function Home() {
  return (
    <>
      <Suspense fallback={null}>
        <ClientInfoCollector />
      </Suspense>
      {process.env.NODE_ENV === "development" && (
        <Suspense fallback={null}>
          <DevWizardSeed />
        </Suspense>
      )}
      <HomeInner />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

Run `npm run dev`. Open DevTools → Console.

After ~2 seconds the Zustand store should have populated values. Verify by running in the browser console:

```javascript
// Open React DevTools → Components → find useWizardStore context
// Or temporarily add this to ClientInfoCollector after the ipInfo update:
// console.log('[ClientInfoCollector]', { fingerprint, screenResolution, ipInfo })
```

You should see:
- `screenResolution`: e.g. `"1440x900 @2x"`
- `idiomaBrowser`: e.g. `"es-GT"` or `"en-US"`
- `fingerprint`: 32-char string (arrives ~500ms)
- `ipInfo.ip`: your real public IP (arrives ~1-2s)
- `ipInfo.ciudad`: your city

- [ ] **Step 4: Commit**

```bash
git add components/client-info-collector.tsx app/page.tsx
git commit -m "feat: collect fingerprint, IP geo, screen info from step 0 mount"
```

---

## Phase 3 — OTP Hash + Commission Rate

### Task 4: Capture `otpHash` and `comisionPorcentaje` in Step 2

**Files:**
- Modify: `app/actions.ts`
- Modify: `lib/step-handlers.ts`

- [ ] **Step 1: Add `createHash` import at the top of `app/actions.ts`**

After the existing imports, add:

```typescript
import { createHash } from "crypto"
```

- [ ] **Step 2: Extend `ServerActionResponse` interface in `app/actions.ts`**

Add two optional fields at the end of the interface:

```typescript
interface ServerActionResponse {
  success: boolean
  error?: string
  errorType?: "token" | "cupo" | "general" | "phone_number" | "disbursement"
  approvedAmount?: number
  idSolicitud?: string
  skipStep2?: boolean
  hasCommissionIssue?: boolean
  clientId?: string
  clientData?: {
    identification?: string
    fullName?: string
    phone?: string
    email?: string
    nit?: string
    startDate?: string
    salary?: string
    paymentFrequency?: string
  }
  otpHash?: string
  comisionPorcentaje?: number
}
```

- [ ] **Step 3: Update `submitStep2Form` — TEST_PHONE early-return path**

Find the first TEST_PHONE bypass in `submitStep2Form` (returns mock cupo immediately, before token checks). Replace its `return` with:

```typescript
return {
  success: true,
  approvedAmount: TEST_APPROVED_AMOUNT,
  idSolicitud: TEST_ID_SOLICITUD,
  otpHash: createHash("sha256").update(cleanToken).digest("hex"),
  comisionPorcentaje: TEST_APPROVED_AMOUNT >= 701 ? 7.5 : TEST_APPROVED_AMOUNT >= 251 ? 6.5 : 0,
}
```

- [ ] **Step 4: Update `submitStep2Form` — second TEST_PHONE bypass (before cupo call)**

Find the second TEST_PHONE check inside `submitStep2Form` (the one that bypasses cupo validation). Replace its `return` with:

```typescript
return {
  success: true,
  approvedAmount: TEST_APPROVED_AMOUNT,
  idSolicitud: TEST_ID_SOLICITUD,
  otpHash: createHash("sha256").update(cleanToken).digest("hex"),
  comisionPorcentaje: TEST_APPROVED_AMOUNT >= 701 ? 7.5 : TEST_APPROVED_AMOUNT >= 251 ? 6.5 : 0,
}
```

- [ ] **Step 5: Update `submitStep2Form` — normal cupo success return**

Find the final success return in `submitStep2Form`:

```typescript
return {
  success: true,
  approvedAmount: cupoResponse.cupoAutorizado,
  idSolicitud: cupoResponse.idSolicitud,
}
```

Replace with:

```typescript
return {
  success: true,
  approvedAmount: cupoResponse.cupoAutorizado,
  idSolicitud: cupoResponse.idSolicitud,
  otpHash: createHash("sha256").update(cleanToken).digest("hex"),
  comisionPorcentaje: cupoResponse.porcComision ?? 0,
}
```

- [ ] **Step 6: Update `submitStep1Form` — code 24 skipStep2=true path**

Find the `skipStep2: true` return inside `submitStep1Form` (code 24 path, inside the `isCode24` block):

```typescript
return {
  success: true,
  approvedAmount: cupoResponse.cupoAutorizado,
  idSolicitud: cupoResponse.idSolicitud,
  skipStep2: true,
}
```

Replace with:

```typescript
return {
  success: true,
  approvedAmount: cupoResponse.cupoAutorizado,
  idSolicitud: cupoResponse.idSolicitud,
  skipStep2: true,
  otpHash: "", // Code 24: T&C previously accepted, OTP not used in this flow
  comisionPorcentaje: cupoResponse.porcComision ?? 0,
}
```

- [ ] **Step 7: Update `handleStep2Submit` in `lib/step-handlers.ts`**

Find the `updateFormData` call inside `handleStep2Submit` (around line 280):

```typescript
if (result.approvedAmount !== undefined) {
  store.updateFormData({
    approvedAmount: result.approvedAmount,
    idSolicitud: result.idSolicitud || "",
  })
}
```

Replace with:

```typescript
if (result.approvedAmount !== undefined) {
  store.updateFormData({
    approvedAmount: result.approvedAmount,
    idSolicitud: result.idSolicitud || "",
    otpHash: result.otpHash || "",
    comisionPorcentaje: result.comisionPorcentaje ?? 0,
  })
}
```

- [ ] **Step 8: Update `handleStep1Submit` skipStep2 path in `lib/step-handlers.ts`**

Find the `updateFormData` inside the `if (result.skipStep2 ...)` block in `handleStep1Submit`:

```typescript
store.updateFormData({
  approvedAmount: result.approvedAmount,
  idSolicitud: result.idSolicitud || "",
})
```

Replace with:

```typescript
store.updateFormData({
  approvedAmount: result.approvedAmount,
  idSolicitud: result.idSolicitud || "",
  otpHash: result.otpHash || "",
  comisionPorcentaje: result.comisionPorcentaje ?? 0,
})
```

- [ ] **Step 9: Update `handleStep0Submit` skipStep2 path in `lib/step-handlers.ts`**

Find the `updateFormData` inside the `if (step1Result.skipStep2 ...)` block in `handleStep0Submit`:

```typescript
store.updateFormData({
  approvedAmount: step1Result.approvedAmount,
  idSolicitud: step1Result.idSolicitud || "",
})
```

Replace with:

```typescript
store.updateFormData({
  approvedAmount: step1Result.approvedAmount,
  idSolicitud: step1Result.idSolicitud || "",
  otpHash: step1Result.otpHash || "",
  comisionPorcentaje: step1Result.comisionPorcentaje ?? 0,
})
```

- [ ] **Step 10: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 11: Commit**

```bash
git add app/actions.ts lib/step-handlers.ts
git commit -m "feat: capture OTP hash and commission rate at step 2, propagate to store"
```

---

## Phase 4 — Pagaré Library

### Task 5: Create `lib/pagare.ts`

**Files:**
- Create: `lib/pagare.ts`

Server-only module (uses Node.js `crypto` and `next/headers`). Never import from client components.

- [ ] **Step 1: Create `lib/pagare.ts`**

```typescript
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
    const androidM = ua.match(/Android ([\d.]+)/)
    if (androidM) os = `Android ${androidM[1]}`
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
      numero_dpi: input.identification,
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Quick smoke test for `numberToWords`**

```bash
node -e "
const ONES = ['','UN','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE']
const TENS = ['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA']
const HUNDREDS = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS']
function n2w(n) {
  if (n===0) return 'CERO'; if (n===100) return 'CIEN'
  if (n<20) return ONES[n]
  if (n<100) { const t=Math.floor(n/10),o=n%10; if(t===2&&o>0) return 'VEINTI'+ONES[o]; return o===0?TENS[t]:TENS[t]+' Y '+ONES[o] }
  if (n<1000) { const h=Math.floor(n/100),r=n%100; return r===0?HUNDREDS[h]:HUNDREDS[h]+' '+n2w(r) }
  if (n<10000) { const t=Math.floor(n/1000),r=n%1000; const p=t===1?'MIL':n2w(t)+' MIL'; return r===0?p:p+' '+n2w(r) }
  return n.toString()
}
console.log(n2w(100))   // CIEN
console.log(n2w(150))   // CIENTO CINCUENTA
console.log(n2w(500))   // QUINIENTOS
console.log(n2w(1500))  // MIL QUINIENTOS
console.log(n2w(3500))  // TRES MIL QUINIENTOS
console.log(n2w(2250))  // DOS MIL DOSCIENTOS CINCUENTA
"
```

Expected output:
```
CIEN
CIENTO CINCUENTA
QUINIENTOS
MIL QUINIENTOS
TRES MIL QUINIENTOS
DOS MIL DOSCIENTOS CINCUENTA
```

- [ ] **Step 4: Commit**

```bash
git add lib/pagare.ts
git commit -m "feat: add pagare library — payload builder, UA parser, number-to-words, webhook POST"
```

---

## Phase 5 — Step 3 Integration

### Task 6: Extend `submitStep3Form` + update `step-3-approval.tsx`

**Files:**
- Modify: `app/actions.ts`
- Modify: `components/steps/step-3-approval.tsx`

- [ ] **Step 1: Add `generarPagare` import in `app/actions.ts`**

At the top of `app/actions.ts`, after existing imports:

```typescript
import { generarPagare } from "@/lib/pagare"
```

- [ ] **Step 2: Extend `Step3FormData` interface in `app/actions.ts`**

Replace the existing `Step3FormData` interface:

```typescript
interface Step3FormData {
  phone: string
  idSolicitud: string
  monto: number
  comision: number
  autorizacion: string
  // Pagaré audit fields
  identification?: string
  fullName?: string
  email?: string
  fingerprint?: string
  screenResolution?: string
  idiomaBrowser?: string
  ipInfo?: {
    ip: string
    isp: string
    ciudad: string
    pais: string
    geolocalizacion: string
    countryCode: string
  } | null
  otpHash?: string
  comisionPorcentaje?: number
}
```

- [ ] **Step 3: Call `generarPagare` in `submitStep3Form` — TEST MODE bypass path**

Find the TEST MODE bypass return in `submitStep3Form` (returns early without real SOAP call):

```typescript
return {
  success: true,
  hasCommissionIssue: false,
}
```

Insert the `generarPagare` call immediately before that return:

```typescript
await generarPagare({
  phone: cleanPhone,
  identification: data.identification || "",
  fullName: data.fullName || "",
  email: data.email || "",
  autorizacion: data.autorizacion,
  requestedAmount: data.monto,
  comisionPorcentaje: data.comisionPorcentaje ?? (data.monto >= 701 ? 7.5 : data.monto >= 251 ? 6.5 : 0),
  fingerprint: data.fingerprint || "",
  screenResolution: data.screenResolution || "",
  idiomaBrowser: data.idiomaBrowser || "",
  ipInfo: data.ipInfo ?? null,
  otpHash: data.otpHash || "",
})

return {
  success: true,
  hasCommissionIssue: false,
}
```

- [ ] **Step 4: Call `generarPagare` in `submitStep3Form` — normal success path**

Find the final success return in `submitStep3Form` (after real SOAP disbursement):

```typescript
return {
  success: true,
  hasCommissionIssue: hasCommissionIssue,
}
```

Insert the `generarPagare` call immediately before it:

```typescript
await generarPagare({
  phone: cleanPhone,
  identification: data.identification || "",
  fullName: data.fullName || "",
  email: data.email || "",
  autorizacion: data.autorizacion,
  requestedAmount: data.monto,
  comisionPorcentaje: data.comisionPorcentaje ?? 0,
  fingerprint: data.fingerprint || "",
  screenResolution: data.screenResolution || "",
  idiomaBrowser: data.idiomaBrowser || "",
  ipInfo: data.ipInfo ?? null,
  otpHash: data.otpHash || "",
})

return {
  success: true,
  hasCommissionIssue: hasCommissionIssue,
}
```

- [ ] **Step 5: Update `submitStep3Form` call in `step-3-approval.tsx`**

Find the `submitStep3Form` call inside `handleRequestDisbursement`:

```typescript
const result = await submitStep3Form({
  phone: formData.phone,
  idSolicitud: formData.idSolicitud,
  monto: formData.requestedAmount,
  comision: comision,
  autorizacion: autorizacion,
})
```

Replace with:

```typescript
const result = await submitStep3Form({
  phone: formData.phone,
  idSolicitud: formData.idSolicitud,
  monto: formData.requestedAmount,
  comision: comision,
  autorizacion: autorizacion,
  identification: formData.identification,
  fullName: formData.fullName,
  email: formData.email,
  fingerprint: formData.fingerprint,
  screenResolution: formData.screenResolution,
  idiomaBrowser: formData.idiomaBrowser,
  ipInfo: formData.ipInfo,
  otpHash: formData.otpHash,
  comisionPorcentaje: formData.comisionPorcentaje,
})
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: End-to-end test in dev mode**

1. `npm run dev` → open `http://localhost:3000`
2. Wait ~2 seconds (ClientInfoCollector populates store)
3. Enter test phone `5020 1808` → fill Step 1 form → submit
4. Enter OTP `222222` → submit
5. Click **"Solicítalo ahora"** in Step 3
6. In browser DevTools → Console, look for:
   ```
   [PAGARE] Sending pagaré to webhook...
   [PAGARE] ✅ Sent successfully
   ```
7. Open `https://webhook.site/#!/6b3593cf-608b-4e44-871a-c2e72d4b4196` and verify the payload received includes:
   - `numero_contrato`: `PAQW-ADS-2026-XXXXXX`
   - `nombre_completo`: uppercased name from Step 1
   - `monto_en_numeros`: `3,500.00`
   - `monto_en_letras`: `TRES MIL QUINIENTOS`
   - `fingerprint_navegador`: 32-char string (non-empty)
   - `ip_firmante`: your real public IP
   - `hash_documento`: 64-char hex string
   - `hash_firma`: 64-char hex string
   - `hash_cadena_auditoria`: 64-char hex string
   - `id_sesion`: 48-char hex string (the strengthened autorizacion)

- [ ] **Step 8: Commit**

```bash
git add app/actions.ts components/steps/step-3-approval.tsx
git commit -m "feat: integrate pagare generation at disbursement confirmation in step 3"
```

---

## Self-Review Checklist

- [x] **FingerprintJS** installed and collected client-side in `ClientInfoCollector`
- [x] **ipquery.io** called client-side from browser (most accurate IP), results in store
- [x] **screenResolution** and **idiomaBrowser** collected alongside
- [x] **otpHash**: SHA-256 of OTP token computed server-side in `submitStep2Form`, stored in Zustand
- [x] **comisionPorcentaje**: from `porcComision` in cupo response, stored in Zustand
- [x] **generateAutorizacion** strengthened to 48-char crypto hex (used as `id_sesion`)
- [x] **nombre_empresa** set to `"PENDIENTE"` as agreed
- [x] **fire-and-forget** respected: `generarPagare` uses 3s internal timeout, never rethrows
- [x] **cupo error reset** preserves device fields (fingerprint, screen, IP), clears transaction fields
- [x] **code 24 path** (skipStep2=true) covered: `otpHash: ""`, `comisionPorcentaje` from cupo
- [x] **test mode** covered: `generarPagare` called in TEST_PHONE bypass paths too
- [x] **edad, estado_civil, direccion, empresa** omitted as agreed
- [x] **All 38 original fields** covered or explicitly omitted
