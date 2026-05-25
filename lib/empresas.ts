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
