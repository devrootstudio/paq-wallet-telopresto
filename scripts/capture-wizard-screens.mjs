/**
 * Captures screenshots of wizard steps 0–5 and the aval route using ?devStep= (development only).
 * Run: NEXT dev server on port 3000, then: node scripts/capture-wizard-screens.mjs
 *
 * Env:
 * - BASE_URL: dev server (default http://127.0.0.1:3000)
 * - OUT_DIR: where to write the PNGs and README (default docs/adelanto-flujo-screens)
 * - ONLY: "convenio" (steps 0–5, normal route) or "avales" (aval route screens); default both
 */
import { chromium } from "playwright"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const outDir = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(root, "docs", "adelanto-flujo-screens")

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000"

/** Step 3b with the validation errors: one repeated phone and the rest empty, then submit. */
async function showGuarantorErrors(page) {
  await page.locator("#aval-0-fullName").fill("Carlos Andrés Pérez López")
  await page.locator("#aval-0-identification").fill("2456789010101")
  await page.locator("#aval-0-phone").fill("55123478")
  await page.locator("#aval-0-relationship").selectOption("hermano/a")
  await page.locator("#aval-1-fullName").fill("Ana Lucía Gómez Herrera")
  await page.locator("#aval-1-identification").fill("30124567")
  await page.locator("#aval-1-phone").fill("55123478")
  await page.getByRole("button", { name: "Solicitar avales" }).click()
  await page.waitForTimeout(400)
}

const convenio = [
  { query: "devStep=0", file: "paso-0-telefono.png", title: "Paso 0 — Teléfono" },
  { query: "devStep=1", file: "paso-1-formulario.png", title: "Paso 1 — Formulario", before: (page) => page.locator("#terms").check().catch(() => {}) },
  { query: "devStep=2", file: "paso-2-codigo-sms.png", title: "Paso 2 — Código SMS" },
  { query: "devStep=3&ruta=normal", file: "paso-3-aprobacion-monto.png", title: "Paso 3 — Aprobación / monto (ruta normal)" },
  { query: "devStep=4", file: "paso-4-exito.png", title: "Paso 4 — Éxito" },
  { query: "devStep=5", file: "paso-5-error.png", title: "Paso 5 — Error" },
]

const avales = [
  { query: "devStep=3&ruta=aval", file: "paso-3-ruta-aval.png", title: "Paso 3 — Ruta aval (Solicitar aval)" },
  { query: "devStep=3b", file: "paso-3b-avales.png", title: "Paso 3b — Avales" },
  { query: "devStep=3b", file: "paso-3b-avales-errores.png", title: "Paso 3b — Errores de validación", before: showGuarantorErrors },
  { query: "devStep=3c", file: "paso-3c-en-revision.png", title: "Paso 3c — En revisión" },
]

const only = process.env.ONLY
const steps = only === "convenio" ? convenio : only === "avales" ? avales : [...convenio, ...avales]

async function main() {
  fs.mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 480, height: 900 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  const page = await context.newPage()

  for (const { query, file, title, before } of steps) {
    const url = `${BASE}/?${query}`
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.waitForTimeout(1200)
    if (before) await before(page)
    // Hide the Next.js dev indicator so it does not cover the screen.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {})
    const target = path.join(outDir, file)
    await page.screenshot({ path: target, fullPage: true })
    console.log("OK", title, "→", target)
  }

  const md = [
    "# Flujo Adelanto de Salario — capturas (dev)",
    "",
    "Generadas con `?devStep=` (0..5, 3b, 3c) en modo desarrollo.",
    "",
    ...steps.map((s) => `## ${s.title}\n\n![](${s.file})\n`),
  ].join("\n")

  fs.writeFileSync(path.join(outDir, "README.md"), md, "utf8")
  console.log("\nResumen Markdown:", path.join(outDir, "README.md"))

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
