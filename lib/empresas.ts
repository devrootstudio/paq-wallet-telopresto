export interface EmpresaOption {
  value: string
  label: string
  sector: string
}

export const EMPRESAS_GT: EmpresaOption[] = [
  { value: "machete-circo", label: "Machete (CIRCO, S.A.)", sector: "Empresas" },
  { value: "buta-ramen", label: "Buta Ramen (ALIMENTOS A Y L SOCIEDAD ANONIMA)", sector: "Empresas" },
  { value: "smp-industrial", label: "SMP industrial", sector: "Empresas" },
]

export const SECTORES = [...new Set(EMPRESAS_GT.map((e) => e.sector))]

/**
 * "Otra": the company is not in the list. The applicant types its name, phone and address; the name
 * goes to the contract like any other company. Shown last, outside the sector groups.
 */
export const EMPRESA_OTRA: EmpresaOption = { value: "otra", label: "Otra", sector: "" }

/** Fields required when the applicant picks "Otra" (shown in Step 1). */
export const EMPRESA_OTRA_MENSAJES = {
  nombre: "Escribe el nombre de la empresa",
  telefono: "El teléfono de la empresa debe tener 8 dígitos",
  direccion: "Ingresa la dirección completa de la empresa",
} as const

/** Trims and collapses inner whitespace, as the guarantor request does before the server checks lengths. */
export const normalizarTexto = (value: string) => value.trim().replace(/\s+/g, " ")

/**
 * Store update when the company select changes: "Otra" starts with an empty name to type; a listed
 * company clears the "Otra" fields.
 */
export function cambioDeEmpresa(value: string) {
  return value === EMPRESA_OTRA.value
    ? { empresaOtra: true, empresa: "" }
    : { empresaOtra: false, empresa: value, empresaTelefono: "", empresaDireccion: "" }
}

/**
 * Validation of the "Otra" company fields; empty object when valid or when "Otra" is not picked.
 * Lengths are measured on the normalized text, exactly as Step 3b sends it and the server checks it.
 */
export function validarEmpresaOtra(data: {
  empresaOtra: boolean
  empresa: string
  empresaTelefono: string
  empresaDireccion: string
}): Partial<Record<"empresa" | "empresaTelefono" | "empresaDireccion", string>> {
  if (!data.empresaOtra) return {}
  const errors: Partial<Record<"empresa" | "empresaTelefono" | "empresaDireccion", string>> = {}
  const nombre = normalizarTexto(data.empresa)
  if (nombre.length < 1 || nombre.length > 200) errors.empresa = EMPRESA_OTRA_MENSAJES.nombre
  if (!/^\d{8}$/.test(data.empresaTelefono.replace(/[\s-]/g, ""))) errors.empresaTelefono = EMPRESA_OTRA_MENSAJES.telefono
  const direccion = normalizarTexto(data.empresaDireccion)
  if (direccion.length < 10 || direccion.length > 300) errors.empresaDireccion = EMPRESA_OTRA_MENSAJES.direccion
  return errors
}
