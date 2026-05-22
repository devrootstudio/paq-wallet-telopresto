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
