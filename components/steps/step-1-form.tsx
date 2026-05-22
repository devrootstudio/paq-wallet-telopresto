"use client"

import type React from "react"
import { useWizardStore } from "@/lib/store"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { handleStep1Submit } from "@/lib/step-handlers"
import { EMPRESAS_GT, SECTORES } from "@/lib/empresas"

// Helper component for tooltips
export const ErrorTooltip = ({ message }: { message: string }) => {
  if (!message) return null
  return (
    <div className="absolute right-0 -top-8 bg-red-500 text-white text-xs px-2 py-1 rounded shadow-lg z-10 animate-in fade-in zoom-in-95 duration-200">
      {message}
      <div className="absolute bottom-[-4px] right-4 w-2 h-2 bg-red-500 rotate-45 transform" />
    </div>
  )
}

export default function Step1Form() {
  const { formData, updateFormData, isLoading, setLoading, setErrorStep, nextStepAsync, goToStepAsync } = useWizardStore()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const validateField = (name: string, value: string) => {
    let error = ""

    switch (name) {
      case "identification": {
        const dpiClean = value.replace(/\s/g, "")
        if (dpiClean.length !== 13) {
          error = "El DPI debe tener 13 dígitos"
        }
        break
      }
      case "fullName": {
        const nameRegex = /^.{3,}\s+.{3,}$/
        if (!nameRegex.test(value.trim())) {
          error = "Mínimo un nombre y apellido (3 letras c/u)"
        }
        break
      }
      case "phone": {
        const phoneClean = value.replace(/\s/g, "")
        if (phoneClean.length !== 8) {
          error = "El teléfono debe tener 8 dígitos"
        }
        break
      }
      case "email": {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(value)) {
          error = "Correo inválido"
        }
        break
      }
      case "nit": {
        const nitRegex = /^\d{6,8}-?[0-9K]$/i
        if (!nitRegex.test(value)) {
          error = "NIT inválido"
        }
        break
      }
      case "startDate": {
        if (!value) {
          error = "Fecha requerida"
        } else if (value.length !== 10) {
          error = "Formato dd-mm-yyyy"
        } else {
          const [day, month, year] = value.split("-").map(Number)
          const date = new Date(year, month - 1, day)
          const today = new Date()
          const threeMonthsAgo = new Date()
          threeMonthsAgo.setMonth(today.getMonth() - 3)

          // Check for invalid date (e.g., 31-02-2024)
          if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            error = "Fecha inválida"
          } else if (date > threeMonthsAgo) {
            error = "Debe ser mayor a 3 meses de antigüedad"
          }
        }
        break
      }
      case "salary": {
        const raw = typeof value === "string" ? value : String(value ?? "")
        const salaryNum = Number.parseFloat(raw.replace(/,/g, "")) || 0
        if (salaryNum < 1000) {
          error = "Mínimo Q1,000.00"
        }
        break
      }
      case "paymentFrequency": {
        if (!value) {
          error = "Selecciona una frecuencia"
        }
        break
      }
      case "empresa": {
        if (!value) {
          error = "Selecciona tu empresa"
        }
        break
      }
      case "edad": {
        const n = Number.parseInt(value, 10)
        if (!value || isNaN(n) || n < 18 || n > 99) {
          error = "Ingresa una edad válida (18–99)"
        }
        break
      }
      case "estadoCivil": {
        if (!value) {
          error = "Selecciona tu estado civil"
        }
        break
      }
      case "domicilio": {
        if (!value || value.trim().length < 10) {
          error = "Ingresa tu dirección completa"
        }
        break
      }
    }

    return error
  }

  // Update error state for a field if it was already touched or has an error
  const checkError = (name: string, value: string) => {
    // Only re-validate if there's an existing error or we want strict mode
    // The user requested "revalide al editarse cada campo"
    // So we check immediately
    const error = validateField(name, value)

    setErrors((prev) => {
      const newErrors = { ...prev }
      if (error) {
        newErrors[name] = error
      } else {
        delete newErrors[name]
      }
      return newErrors
    })
  }

  const validateAll = () => {
    const newErrors: Record<string, string> = {}

    // Check all fields
    const fields = [
      { name: "identification", value: formData.identification },
      { name: "fullName", value: formData.fullName },
      { name: "phone", value: formData.phone },
      { name: "email", value: formData.email },
      { name: "nit", value: formData.nit },
      { name: "startDate", value: formData.startDate },
      { name: "salary", value: formData.salary },
      { name: "paymentFrequency", value: formData.paymentFrequency },
      { name: "empresa", value: formData.empresa },
      { name: "edad", value: formData.edad },
      { name: "estadoCivil", value: formData.estadoCivil },
      { name: "domicilio", value: formData.domicilio },
    ]

    fields.forEach((field) => {
      const error = validateField(field.name, field.value)
      if (error) newErrors[field.name] = error
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validar campos del cliente primero
    if (!validateAll()) {
      return
    }

    // Use centralized handler
    await handleStep1Submit(
      {
        identification: formData.identification,
        fullName: formData.fullName,
        phone: formData.phone,
        email: formData.email,
        nit: formData.nit,
        startDate: formData.startDate,
        salary: formData.salary,
        paymentFrequency: formData.paymentFrequency,
        empresa: formData.empresa,
        edad: formData.edad,
        estadoCivil: formData.estadoCivil,
        domicilio: formData.domicilio,
      },
      {
        nextStepAsync,
        setLoading,
        setErrorStep,
        updateFormData,
        goToStepAsync,
        formData,
      },
    )
  }

  const handleChange = (name: string, value: string) => {
    updateFormData({ [name]: value })
    // If we have an error on this field, re-validate immediately
    if (errors[name] || touched[name]) {
      checkError(name, value)
    }
  }

  const handleBlur = (name: string, value: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }))
    checkError(name, value)
  }

  // Specific formatters
  const handleDPIChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "")
    if (value.length > 13) value = value.slice(0, 13)
    handleChange("identification", value)
  }

  const formatDPI = (value: string) => {
    if (!value) return ""
    const part1 = value.slice(0, 4)
    const part2 = value.slice(4, 9)
    const part3 = value.slice(9, 13)
    let formatted = part1
    if (part2) formatted += " " + part2
    if (part3) formatted += " " + part3
    return formatted
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "")
    if (value.length > 8) value = value.slice(0, 8)
    handleChange("phone", value)
  }

  const formatPhone = (value: string) => {
    if (!value) return ""
    const part1 = value.slice(0, 4)
    const part2 = value.slice(4, 8)
    let formatted = part1
    if (part2) formatted += " " + part2
    return formatted
  }

  const handleSalaryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "")
    if (!val) {
      handleChange("salary", "")
      return
    }
    const num = Number.parseInt(val, 10) / 100
    const formatted = num.toFixed(2)
    handleChange("salary", formatted)
  }

  const formatSalaryDisplay = (value: string) => {
    if (!value) return "Q 0.00"
    const num = Number.parseFloat(value)
    if (isNaN(num)) return "Q 0.00"
    return new Intl.NumberFormat("es-GT", {
      style: "currency",
      currency: "GTQ",
      minimumFractionDigits: 2,
    }).format(num)
  }

  // Handler for manual date input formatting (dd-mm-yyyy)
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "")

    // Validate Day (01-31)
    if (value.length >= 2) {
      const day = Number.parseInt(value.substring(0, 2))
      if (day > 31) value = value.substring(0, 1) // If day > 31, keep only first digit? Or better, just don't update if invalid sequence
      // Actually, simpler to just block the update if the new char makes it invalid, but here we are processing the whole string.
      // Let's just truncate or fix.
      if (day === 0) return // Don't allow 00 as day start if typing fast, though 0 is valid as first char.
      if (day > 31) return // Stop input
    }

    // Validate Month (01-12)
    if (value.length >= 4) {
      const month = Number.parseInt(value.substring(2, 4))
      if (month === 0) return // Don't allow 00 month
      if (month > 12) return // Stop input
    }

    // Validate Year
    if (value.length >= 8) {
      const year = Number.parseInt(value.substring(4, 8))
      const currentYear = new Date().getFullYear()
      if (year < 1900) return // Too old
      if (year > currentYear) return // Future date not allowed
    }

    if (value.length > 8) value = value.slice(0, 8)

    let formatted = ""
    if (value.length > 4) {
      formatted = `${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4)}`
    } else if (value.length > 2) {
      formatted = `${value.slice(0, 2)}-${value.slice(2)}`
    } else {
      formatted = value
    }

    handleChange("startDate", formatted)
  }

  const selectClass = (hasError: boolean) =>
    cn(
      "flex h-11 w-full appearance-none rounded-lg border border-input bg-white px-3 py-2 text-sm text-black ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      hasError && "border-red-500 focus-visible:ring-red-500",
    )

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-xl font-bold text-white mb-4 text-center">
        Completa el formulario para aplicar a tu adelanto de salario
      </h1>

      <form onSubmit={handleSubmit} className="space-y-3">

        {/* Fila 1: DPI — ancho completo */}
        <div className="relative space-y-1">
          <label className="text-white text-xs font-medium ml-1">DPI</label>
          <div className="relative">
            <Input
              placeholder="2131 41001 0101"
              value={formatDPI(formData.identification)}
              onChange={handleDPIChange}
              onBlur={(e) => handleBlur("identification", formData.identification)}
              className={cn("h-11", errors.identification && "border-red-500 focus-visible:ring-red-500")}
              maxLength={15}
            />
            {errors.identification && <ErrorTooltip message={errors.identification} />}
          </div>
        </div>

        {/* Fila 2: Nombre — ancho completo */}
        <div className="relative space-y-1">
          <label className="text-white text-xs font-medium ml-1">Nombre completo</label>
          <div className="relative">
            <Input
              placeholder="Luis Enrique Rios Sierra"
              value={formData.fullName}
              onChange={(e) => handleChange("fullName", e.target.value)}
              onBlur={(e) => handleBlur("fullName", e.target.value)}
              className={cn("h-11", errors.fullName && "border-red-500 focus-visible:ring-red-500")}
            />
            {errors.fullName && <ErrorTooltip message={errors.fullName} />}
          </div>
        </div>

        {/* Fila 3: Edad | Estado civil | NIT — 3 columnas */}
        <div className="grid grid-cols-3 gap-3">
          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Edad</label>
            <div className="relative">
              <Input
                placeholder="32"
                inputMode="numeric"
                value={formData.edad}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 2)
                  handleChange("edad", val)
                }}
                onBlur={() => handleBlur("edad", formData.edad)}
                className={cn("h-11", errors.edad && "border-red-500 focus-visible:ring-red-500")}
              />
              {errors.edad && <ErrorTooltip message={errors.edad} />}
            </div>
          </div>

          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Estado civil</label>
            <div className="relative">
              <select
                className={selectClass(!!errors.estadoCivil)}
                value={formData.estadoCivil}
                onChange={(e) => { handleChange("estadoCivil", e.target.value); handleBlur("estadoCivil", e.target.value) }}
              >
                <option value="" disabled hidden>Selecciona</option>
                <option value="Soltero/a">Soltero/a</option>
                <option value="Casado/a">Casado/a</option>
                <option value="Unión de hecho">Unión de hecho</option>
                <option value="Divorciado/a">Divorciado/a</option>
                <option value="Viudo/a">Viudo/a</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
              {errors.estadoCivil && <ErrorTooltip message={errors.estadoCivil} />}
            </div>
          </div>

          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">NIT</label>
            <div className="relative">
              <Input
                placeholder="123456-K"
                value={formData.nit}
                onChange={(e) => handleChange("nit", e.target.value.toUpperCase())}
                onBlur={(e) => handleBlur("nit", formData.nit)}
                className={cn("h-11", errors.nit && "border-red-500 focus-visible:ring-red-500")}
                maxLength={10}
              />
              {errors.nit && <ErrorTooltip message={errors.nit} />}
            </div>
          </div>
        </div>

        {/* Fila 4: Teléfono | Email — 2 columnas */}
        <div className="grid grid-cols-2 gap-3">
          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Teléfono PAQ Wallet</label>
            <div className="relative">
              <Input
                placeholder="5201 8854"
                type="tel"
                value={formatPhone(formData.phone)}
                onChange={handlePhoneChange}
                onBlur={(e) => handleBlur("phone", formData.phone)}
                className={cn("h-11", errors.phone && "border-red-500 focus-visible:ring-red-500")}
                maxLength={9}
              />
              {errors.phone && <ErrorTooltip message={errors.phone} />}
            </div>
          </div>

          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Correo</label>
            <div className="relative">
              <Input
                placeholder="correo@ejemplo.com"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
                onBlur={(e) => handleBlur("email", e.target.value)}
                className={cn("h-11", errors.email && "border-red-500 focus-visible:ring-red-500")}
              />
              {errors.email && <ErrorTooltip message={errors.email} />}
            </div>
          </div>
        </div>

        {/* Fila 5: Domicilio — ancho completo */}
        <div className="relative space-y-1">
          <label className="text-white text-xs font-medium ml-1">Domicilio (dirección de residencia)</label>
          <div className="relative">
            <Input
              placeholder="5a. Av. 12-34, Zona 10, Ciudad de Guatemala"
              value={formData.domicilio}
              onChange={(e) => handleChange("domicilio", e.target.value)}
              onBlur={(e) => handleBlur("domicilio", e.target.value)}
              className={cn("h-11", errors.domicilio && "border-red-500 focus-visible:ring-red-500")}
            />
            {errors.domicilio && <ErrorTooltip message={errors.domicilio} />}
          </div>
        </div>

        {/* Fila 6: Empresa — ancho completo */}
        <div className="relative space-y-1">
          <label className="text-white text-xs font-medium ml-1">Empresa</label>
          <div className="relative">
            <select
              className={selectClass(!!errors.empresa)}
              value={formData.empresa}
              onChange={(e) => { handleChange("empresa", e.target.value); handleBlur("empresa", e.target.value) }}
            >
              <option value="" disabled hidden>Selecciona tu empresa</option>
              {SECTORES.map((sector) => (
                <optgroup key={sector} label={sector}>
                  {EMPRESAS_GT.filter((e) => e.sector === sector).map((empresa) => (
                    <option key={empresa.value} value={empresa.label}>{empresa.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
            {errors.empresa && <ErrorTooltip message={errors.empresa} />}
          </div>
        </div>

        {/* Fila 7: Fecha de alta | Salario | Frecuencia — 3 columnas */}
        <div className="grid grid-cols-3 gap-3">
          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Fecha de alta</label>
            <div className="relative">
              <Input
                placeholder="DD-MM-YYYY"
                value={formData.startDate}
                onChange={handleDateChange}
                onBlur={(e) => handleBlur("startDate", formData.startDate)}
                className={cn("h-11", errors.startDate && "border-red-500 focus-visible:ring-red-500")}
                maxLength={10}
              />
              {errors.startDate && <ErrorTooltip message={errors.startDate} />}
            </div>
          </div>

          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Salario mensual</label>
            <div className="relative">
              <Input
                placeholder="Q 3,500.00"
                type="text"
                inputMode="numeric"
                value={formatSalaryDisplay(formData.salary)}
                onChange={handleSalaryChange}
                onBlur={(e) => handleBlur("salary", formData.salary)}
                className={cn("h-11", errors.salary && "border-red-500 focus-visible:ring-red-500")}
              />
              {errors.salary && <ErrorTooltip message={errors.salary} />}
            </div>
          </div>

          <div className="relative space-y-1">
            <label className="text-white text-xs font-medium ml-1">Frecuencia</label>
            <div className="relative">
              <select
                className={selectClass(!!errors.paymentFrequency)}
                value={formData.paymentFrequency}
                onChange={(e) => { handleChange("paymentFrequency", e.target.value); handleBlur("paymentFrequency", e.target.value) }}
              >
                <option value="" disabled hidden>Selecciona</option>
                <option value="mensual">Mensual</option>
                <option value="quincenal">Quincenal</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
              {errors.paymentFrequency && <ErrorTooltip message={errors.paymentFrequency} />}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 mt-4">
          <input
            type="checkbox"
            id="terms"
            className="h-4 w-4 rounded border-gray-300 text-paq-light-green focus:ring-paq-light-green"
            required
          />
          <label
            htmlFor="terms"
            className="text-sm text-white leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Acepto los{" "}
            <a
              href="/contrato-adelanto-salario.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-paq-yellow hover:text-paq-light-green underline font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              términos y condiciones
            </a>
          </label>
        </div>

        <div className="flex justify-end mt-6">
          <Button type="submit" variant="paqPrimary" className="w-32" disabled={isLoading}>
            {isLoading ? "ENVIANDO..." : "ENVIAR"}
          </Button>
        </div>
      </form>
    </div>
  )
}
