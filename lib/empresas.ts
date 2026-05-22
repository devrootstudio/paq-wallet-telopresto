export interface EmpresaOption {
  value: string
  label: string
  sector: string
}

export const EMPRESAS_GT: EmpresaOption[] = [
  // Alimentación y bebidas
  { value: "bimbo-gt", label: "Bimbo Guatemala", sector: "Alimentación y bebidas" },
  { value: "cerveceria-centroamericana", label: "Cervecería Centroamericana (Gallo)", sector: "Alimentación y bebidas" },
  { value: "cmi-alimentos", label: "CMI Alimentos / Pollo Campero", sector: "Alimentación y bebidas" },
  { value: "cocacola-femsa", label: "Coca-Cola FEMSA Guatemala", sector: "Alimentación y bebidas" },
  { value: "lala-gt", label: "Grupo Lala Guatemala", sector: "Alimentación y bebidas" },
  { value: "pepsi-gt", label: "Pepsi-Cola Guatemala", sector: "Alimentación y bebidas" },

  // Banca y finanzas
  { value: "agromercantil", label: "Agromercantil (Agrobanco)", sector: "Banca y finanzas" },
  { value: "bac-credomatic", label: "BAC Credomatic Guatemala", sector: "Banca y finanzas" },
  { value: "banco-azteca", label: "Banco Azteca Guatemala", sector: "Banca y finanzas" },
  { value: "banrural", label: "Banco de Desarrollo Rural (Banrural)", sector: "Banca y finanzas" },
  { value: "gt-continental", label: "Banco G&T Continental", sector: "Banca y finanzas" },
  { value: "banco-industrial", label: "Banco Industrial", sector: "Banca y finanzas" },
  { value: "promerica-gt", label: "Banco Promerica Guatemala", sector: "Banca y finanzas" },

  // Construcción e inmobiliaria
  { value: "cementos-progreso", label: "Cementos Progreso", sector: "Construcción e inmobiliaria" },
  { value: "grupo-cayala", label: "Grupo Cayalá", sector: "Construcción e inmobiliaria" },
  { value: "intergres", label: "Intergres", sector: "Construcción e inmobiliaria" },

  // Educación
  { value: "url", label: "Universidad Rafael Landívar (URL)", sector: "Educación" },
  { value: "usac", label: "Universidad de San Carlos (USAC)", sector: "Educación" },
  { value: "ufm", label: "Universidad Francisco Marroquín (UFM)", sector: "Educación" },
  { value: "galileo", label: "Universidad Galileo", sector: "Educación" },
  { value: "umg", label: "Universidad Mariano Gálvez (UMG)", sector: "Educación" },
  { value: "uvg", label: "Universidad del Valle de Guatemala (UVG)", sector: "Educación" },

  // Energía
  { value: "eegsa", label: "EEGSA – Empresa Eléctrica de Guatemala", sector: "Energía" },
  { value: "energuate", label: "Energuate", sector: "Energía" },

  // Gobierno y sector público
  { value: "banguat", label: "Banco de Guatemala (Banguat)", sector: "Gobierno y sector público" },
  { value: "igss", label: "Instituto Guatemalteco de Seguridad Social (IGSS)", sector: "Gobierno y sector público" },
  { value: "minfin", label: "Ministerio de Finanzas Públicas", sector: "Gobierno y sector público" },
  { value: "mspas", label: "Ministerio de Salud Pública y Asistencia Social", sector: "Gobierno y sector público" },
  { value: "muniguate", label: "Municipalidad de Guatemala", sector: "Gobierno y sector público" },

  // Industria y manufactura
  { value: "durman", label: "Durman Guatemala", sector: "Industria y manufactura" },
  { value: "iusa-gt", label: "Industrias Licoreras de Guatemala (IUSA)", sector: "Industria y manufactura" },
  { value: "ingenio-concepcion", label: "Ingenio Concepción", sector: "Industria y manufactura" },
  { value: "ingenio-pantaleon", label: "Ingenio Pantaleón", sector: "Industria y manufactura" },
  { value: "ingenio-santa-ana", label: "Ingenio Santa Ana", sector: "Industria y manufactura" },

  // Logística y transporte
  { value: "dhl-gt", label: "DHL Guatemala", sector: "Logística y transporte" },
  { value: "fedex-gt", label: "FedEx Guatemala", sector: "Logística y transporte" },
  { value: "king-quality", label: "King Quality / Cargo Expreso", sector: "Logística y transporte" },

  // Retail y supermercados
  { value: "almacenes-prado", label: "Almacenes Prado", sector: "Retail y supermercados" },
  { value: "tropigas", label: "Almacenes Tropigas", sector: "Retail y supermercados" },
  { value: "la-colonia", label: "Supermercados La Colonia", sector: "Retail y supermercados" },
  { value: "walmart-gt", label: "Walmart Guatemala (Paiz / La Torre / Maxi Bodega)", sector: "Retail y supermercados" },

  // Salud
  { value: "herrera-llerandi", label: "Hospital Herrera Llerandi", sector: "Salud" },
  { value: "hospital-la-paz", label: "Hospital La Paz", sector: "Salud" },
  { value: "hospital-roosevelt", label: "Hospital Roosevelt", sector: "Salud" },
  { value: "san-juan-de-dios", label: "Hospital General San Juan de Dios", sector: "Salud" },

  // Seguros
  { value: "aseguradora-general", label: "Aseguradora General", sector: "Seguros" },
  { value: "seguros-banrural", label: "Seguros Banrural", sector: "Seguros" },
  { value: "seguros-universales", label: "Seguros Universales", sector: "Seguros" },

  // Servicios y BPO
  { value: "concentrix-gt", label: "Concentrix Guatemala", sector: "Servicios y BPO" },
  { value: "telus-gt", label: "Telus International Guatemala", sector: "Servicios y BPO" },
  { value: "transcom-gt", label: "Transcom Guatemala", sector: "Servicios y BPO" },

  // Telecomunicaciones
  { value: "claro-gt", label: "Claro Guatemala", sector: "Telecomunicaciones" },
  { value: "tigo-gt", label: "Tigo Guatemala (Millicom)", sector: "Telecomunicaciones" },
]

export const SECTORES = [...new Set(EMPRESAS_GT.map((e) => e.sector))]
