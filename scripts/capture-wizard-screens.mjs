/**
 * Captures screenshots of wizard steps 0–5 using ?devStep= (development only).
 * Run: NEXT dev server on port 3000, then: node scripts/capture-wizard-screens.mjs
 */
import { chromium } from "playwright"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const outDir = path.join(root, "docs", "adelanto-flujo-screens")

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000"

const steps = [
  { n: 0, file: "paso-0-telefono.png", title: "Paso 0 — Teléfono" },
  { n: 1, file: "paso-1-formulario.png", title: "Paso 1 — Formulario" },
  { n: 2, file: "paso-2-codigo-sms.png", title: "Paso 2 — Código SMS" },
  { n: 3, file: "paso-3-aprobacion-monto.png", title: "Paso 3 — Aprobación / monto" },
  { n: 4, file: "paso-4-exito.png", title: "Paso 4 — Éxito" },
  { n: 5, file: "paso-5-error.png", title: "Paso 5 — Error" },
]

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

  for (const { n, file, title } of steps) {
    const url = `${BASE}/?devStep=${n}`
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.waitForTimeout(1200)
    if (n === 1) {
      await page.locator("#terms").check().catch(() => {})
    }
    const target = path.join(outDir, file)
    await page.screenshot({ path: target, fullPage: true })
    console.log("OK", title, "→", target)
  }

  const md = [
    "# Flujo Adelanto de Salario — capturas (dev)",
    "",
    "Generadas con `?devStep=0..5` en modo desarrollo.",
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
