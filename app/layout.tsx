import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono, Montserrat } from "next/font/google"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })
const montserrat = Montserrat({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Adelanto de Salario",
  description: "Solicita tu adelanto de salario en pasos sencillos",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={montserrat.className}>{children}</body>
    </html>
  )
}
