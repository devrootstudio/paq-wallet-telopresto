"use client"

import { useEffect } from "react"
import { useWizardStore } from "@/lib/store"

export function ClientInfoCollector() {
  const { updateFormData } = useWizardStore()

  useEffect(() => {
    // Synchronous — always available immediately
    const screenRes = `${screen.width}x${screen.height} @${window.devicePixelRatio}x`
    const idioma = navigator.language || "es-GT"
    updateFormData({ screenResolution: screenRes, idiomaBrowser: idioma })
    console.log("[ClientInfo] screen:", screenRes, "| idioma:", idioma)

    // FingerprintJS — async, fire-and-forget
    import("@fingerprintjs/fingerprintjs")
      .then((FingerprintJS) => FingerprintJS.load())
      .then((fp) => fp.get())
      .then((result) => {
        updateFormData({ fingerprint: result.visitorId })
        console.log("[ClientInfo] fingerprint:", result.visitorId)
      })
      .catch((err) => {
        console.warn("[ClientInfo] FingerprintJS failed:", err)
      })

    // IP geolocation — async, fire-and-forget
    // Step 1: GET / returns the client's public IP as plain text
    // Step 2: GET /{ip} returns full JSON with location + ISP data
    fetch("https://api.ipquery.io/")
      .then((r) => (r.ok ? r.text() : null))
      .then((ip) => {
        if (!ip) return null
        const cleanIp = ip.trim()
        return fetch(`https://api.ipquery.io/${cleanIp}`, { headers: { Accept: "application/json" } })
          .then((r) => (r.ok ? r.json() : null))
      })
      .then((data) => {
        if (!data) return
        const lat: number | undefined = data.location?.latitude
        const lng: number | undefined = data.location?.longitude
        const geo =
          lat != null && lng != null
            ? `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`
            : ""
        const ipInfo = {
          ip: data.ip || "",
          isp: data.isp?.isp || "",
          ciudad: data.location?.city || "",
          pais: data.location?.country || "",
          geolocalizacion: geo,
          countryCode: data.location?.country_code || "",
        }
        updateFormData({ ipInfo })
        console.log("[ClientInfo] ipInfo:", ipInfo)
      })
      .catch((err) => {
        console.warn("[ClientInfo] ipquery.io failed:", err)
      })
  }, []) // runs once on mount

  return null
}
