import axios from "axios"
import { parseString } from "xml2js"

// SOAP Web Service configuration
const SOAP_URL = process.env.SOAP_URL || "https://www.paq.com.gt/paqadelaws_desa/PAQAdelantos.asmx"
const USERNAME = process.env.SOAP_USERNAME
const PASSWORD = decodeURIComponent(process.env.SOAP_PASSWORD_URL_ENCODE || "")

// Type interfaces
export interface ClientData {
  id?: string
  status?: string
  identificationNumber?: string
  fullName?: string
  phone?: string
  email?: string
  nit?: string
  startDate?: string
  monthlySalary?: string
  paymentFrequency?: string
  numberOfDispersions?: string
  averageDispersionAmount?: string
  acceptsTerms?: string
  endDate?: string
}

export interface QueryClientResponse {
  returnCode: string | number
  message: string
  client: ClientData | string | null
}

export interface SendTokenResponse {
  returnCode: string | number
  message: string
}

export interface ValidateTokenResponse {
  returnCode: string | number
  message: string
}

export interface ValidateCupoResponse {
  returnCode: string | number
  message: string
  idSolicitud?: string
  celular?: string
  cupoAutorizado?: number
  comisionSobreCupo?: number
  porcComision?: number
  limMaxComBanda1?: number
  comMinBanda1?: number
  limMaxComBanda2?: number
  comMinBanda2?: number
}

// Raw SOAP response interface (Spanish format from API)
interface RawSoapResponse {
  codret: string | number
  mensaje: string
  cliente: any
}

// Function to map raw SOAP response to English camelCase format
function mapRawResponseToClientData(rawClient: any): ClientData | null {
  if (!rawClient) return null

  // If it's a string, try to parse it as JSON
  let clientObj: any = rawClient
  if (typeof rawClient === "string") {
    try {
      clientObj = JSON.parse(rawClient)
    } catch (e) {
      return null
    }
  }

  // Map Spanish field names to English camelCase
  return {
    id: clientObj.ID,
    status: clientObj.STATUS,
    identificationNumber: clientObj.NUMERO_IDENTIFICACION,
    fullName: clientObj.NOMBRE_COMPLETO,
    phone: clientObj.CELULAR,
    email: clientObj.EMAIL,
    nit: clientObj.NIT,
    startDate: clientObj.FECHA_ALTA,
    monthlySalary: clientObj.SALARIO_MENSUAL,
    paymentFrequency: clientObj.FRECUENCIA_PAGO,
    numberOfDispersions: clientObj.NUMERO_DISPERSIONES,
    averageDispersionAmount: clientObj.MONTO_PROMEDIO_DISPERSION,
    acceptsTerms: clientObj.ACEPTA_TERMINOS,
    endDate: clientObj.FECHA_BAJA,
  }
}

// Function to map raw SOAP response to QueryClientResponse
function mapRawResponse(rawResponse: RawSoapResponse): QueryClientResponse {
  return {
    returnCode: rawResponse.codret,
    message: rawResponse.mensaje,
    client: mapRawResponseToClientData(rawResponse.cliente),
  }
}

// Function to escape XML characters
function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case "&":
        return "&amp;"
      case "'":
        return "&apos;"
      case '"':
        return "&quot;"
      default:
        return c
    }
  })
}

// Function to build SOAP XML envelope for Consulta_Cliente
function buildSoapEnvelope(username: string, password: string, phone: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Consulta_Cliente xmlns="http://www.paq.com.gt/">
      <USERNAME>${escapeXml(username)}</USERNAME>
      <PASSWORD>${escapeXml(password)}</PASSWORD>
      <CELULAR>${escapeXml(phone)}</CELULAR>
    </Consulta_Cliente>
  </soap:Body>
</soap:Envelope>`
}

// Function to build SOAP XML envelope for Envia_Token_TyC
function buildTokenSoapEnvelope(username: string, password: string, phone: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Envia_Token_TyC xmlns="http://www.paq.com.gt/">
      <USERNAME>${escapeXml(username)}</USERNAME>
      <PASSWORD>${escapeXml(password)}</PASSWORD>
      <CELULAR>${escapeXml(phone)}</CELULAR>
    </Envia_Token_TyC>
  </soap:Body>
</soap:Envelope>`
}

// Function to build SOAP XML envelope for Valida_Token_TyC
function buildValidateTokenSoapEnvelope(username: string, password: string, phone: string, token: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Valida_Token_TyC xmlns="http://www.paq.com.gt/">
      <USERNAME>${escapeXml(username)}</USERNAME>
      <PASSWORD>${escapeXml(password)}</PASSWORD>
      <CELULAR>${escapeXml(phone)}</CELULAR>
      <TOKEN>${escapeXml(token)}</TOKEN>
    </Valida_Token_TyC>
  </soap:Body>
</soap:Envelope>`
}

// Function to build SOAP XML envelope for Valida_Cupo
function buildValidateCupoSoapEnvelope(username: string, password: string, phone: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <valida_cupo xmlns="http://www.paq.com.gt/">
      <USERNAME>${escapeXml(username)}</USERNAME>
      <PASSWORD>${escapeXml(password)}</PASSWORD>
      <CELULAR>${escapeXml(phone)}</CELULAR>
    </valida_cupo>
  </soap:Body>
</soap:Envelope>`
}

// Function to parse XML response
function parseXmlResponse(xmlString: string): Promise<any> {
  return new Promise((resolve, reject) => {
    parseString(
      xmlString,
      {
        explicitArray: false,
        mergeAttrs: true,
        trim: true,
        normalize: true,
        normalizeTags: false,
        explicitCharkey: false,
        explicitRoot: true,
        ignoreAttrs: false,
        charkey: "_",
        async: false,
        attrkey: "@",
      },
      (err, result) => {
        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      },
    )
  })
}

// Helper function to extract value from XML node
function extractValue(node: any): any {
  if (!node) return null
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (node._) return node._
  if (Array.isArray(node) && node.length > 0) {
    return extractValue(node[0])
  }
  return node
}

// Function to extract data from SOAP response
function extractResponseData(parsedXml: any): QueryClientResponse {
  try {
    // Try different possible structures
    const envelope = parsedXml["soap:Envelope"] || parsedXml["soapenv:Envelope"] || parsedXml.Envelope
    const body = envelope?.["soap:Body"] || envelope?.["soapenv:Body"] || envelope?.Body
    const response = body?.Consulta_ClienteResponse || body?.["Consulta_ClienteResponse"]
    const queryResultRaw = response?.Consulta_ClienteResult || response?.["Consulta_ClienteResult"]

    if (!queryResultRaw) {
      // Alternative search in the entire structure
      const searchInObject = (obj: any, key: string): any => {
        if (!obj || typeof obj !== "object") return null
        if (obj[key]) return obj[key]
        for (const objKey in obj) {
          const result = searchInObject(obj[objKey], key)
          if (result) return result
        }
        return null
      }

      const altResult = searchInObject(parsedXml, "Consulta_ClienteResult")
      if (altResult) {
        // If it's a JSON string, parse it
        if (typeof altResult === "string") {
          try {
            const jsonParsed = JSON.parse(altResult)
            return mapRawResponse({
              codret: jsonParsed.codret || "0",
              mensaje: jsonParsed.mensaje || altResult,
              cliente: jsonParsed.cliente || null,
            })
          } catch (e) {
            return mapRawResponse({
              codret: "0",
              mensaje: altResult,
              cliente: null,
            })
          }
        }
        // If it's an object, extract values and map
        return mapRawResponse({
          codret: extractValue(altResult.codret) || "0",
          mensaje: extractValue(altResult.mensaje) || "",
          cliente: extractValue(altResult.cliente),
        })
      }

      throw new Error("Unrecognized response structure")
    }

    // Extract the value (can be JSON string or object)
    const queryResultValue = extractValue(queryResultRaw)

    // If it's a JSON string, parse it
    if (typeof queryResultValue === "string") {
      try {
        const jsonParsed = JSON.parse(queryResultValue)
        return mapRawResponse({
          codret: jsonParsed.codret || "0",
          mensaje: jsonParsed.mensaje || queryResultValue,
          cliente: jsonParsed.cliente || null,
        })
      } catch (e) {
        return mapRawResponse({
          codret: "0",
          mensaje: queryResultValue,
          cliente: null,
        })
      }
    }

    // If it's already an object, map it
    return mapRawResponse({
      codret: queryResultValue.codret || "0",
      mensaje: queryResultValue.mensaje || "",
      cliente: queryResultValue.cliente || null,
    })
  } catch (error) {
    throw new Error(`Error parsing response: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}

/**
 * Queries a client in the PAQ system by phone number
 * @param phone - Client phone number (8 digits)
 * @returns Response with client data or error
 */
export async function queryClient(phone: string): Promise<QueryClientResponse> {
  // Validate credentials
  if (!USERNAME || !PASSWORD) {
    throw new Error("SOAP credentials not configured. Check SOAP_USERNAME and SOAP_PASSWORD_URL_ENCODE environment variables")
  }

  // Validate phone
  const cleanPhone = phone.replace(/\s/g, "")
  if (!cleanPhone || cleanPhone.length !== 8) {
    throw new Error("Phone number must have 8 digits")
  }

  try {
    // Build SOAP XML
    const soapBody = buildSoapEnvelope(USERNAME, PASSWORD, cleanPhone)

    // Configure headers to ensure UTF-8
    const headers = {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://www.paq.com.gt/Consulta_Cliente",
      Accept: "text/xml; charset=utf-8",
      "Accept-Charset": "utf-8, *;q=0.8",
      "Accept-Language": "es, es-ES;q=0.9, *;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
    }

    // Make SOAP request with axios
    const response = await axios.post(SOAP_URL, soapBody, {
      headers,
      responseType: "text",
      responseEncoding: "utf8",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      transformResponse: [
        (data) => {
          // If it comes as Buffer, convert to UTF-8 string
          if (Buffer.isBuffer(data)) {
            return data.toString("utf8")
          }
          return data
        },
      ],
    })

    // Parse XML response
    const parsedXml = await parseXmlResponse(response.data)
    const responseData = extractResponseData(parsedXml)

    return responseData
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`SOAP service connection error: ${error.message}`)
    }
    throw error
  }
}

/**
 * Sends OTP token to client's phone for terms and conditions acceptance
 * @param phone - Client phone number (8 digits)
 * @returns Response with return code and message
 */
export async function sendTokenTyc(phone: string): Promise<SendTokenResponse> {
  // Validate credentials
  if (!USERNAME || !PASSWORD) {
    throw new Error("SOAP credentials not configured. Check SOAP_USERNAME and SOAP_PASSWORD_URL_ENCODE environment variables")
  }

  // Validate phone
  const cleanPhone = phone.replace(/\s/g, "")
  if (!cleanPhone || cleanPhone.length !== 8) {
    throw new Error("Phone number must have 8 digits")
  }

  try {
    // Build SOAP XML
    const soapBody = buildTokenSoapEnvelope(USERNAME, PASSWORD, cleanPhone)

    // Configure headers to ensure UTF-8
    const headers = {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://www.paq.com.gt/Envia_Token_TyC",
      Accept: "text/xml; charset=utf-8",
      "Accept-Charset": "utf-8, *;q=0.8",
      "Accept-Language": "es, es-ES;q=0.9, *;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
    }

    // Make SOAP request with axios
    const response = await axios.post(SOAP_URL, soapBody, {
      headers,
      responseType: "text",
      responseEncoding: "utf8",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      transformResponse: [
        (data) => {
          // If it comes as Buffer, convert to UTF-8 string
          if (Buffer.isBuffer(data)) {
            return data.toString("utf8")
          }
          return data
        },
      ],
    })

    // Parse XML response
    const parsedXml = await parseXmlResponse(response.data)

    // Extract response data
    const envelope = parsedXml["soap:Envelope"] || parsedXml["soapenv:Envelope"] || parsedXml.Envelope
    const body = envelope?.["soap:Body"] || envelope?.["soapenv:Body"] || envelope?.Body
    const responseNode = body?.Envia_Token_TyCResponse || body?.["Envia_Token_TyCResponse"]
    const resultRaw = responseNode?.Envia_Token_TyCResult || responseNode?.["Envia_Token_TyCResult"]

    if (!resultRaw) {
      throw new Error("Unrecognized response structure for token sending")
    }

    // Extract the value (can be JSON string or object)
    const resultValue = extractValue(resultRaw)

    // If it's a JSON string, parse it
    if (typeof resultValue === "string") {
      try {
        const jsonParsed = JSON.parse(resultValue)
        return {
          returnCode: jsonParsed.codret || "0",
          message: jsonParsed.mensaje || resultValue,
        }
      } catch (e) {
        return {
          returnCode: "0",
          message: resultValue,
        }
      }
    }

    // If it's already an object, map it
    return {
      returnCode: resultValue.codret || "0",
      message: resultValue.mensaje || "",
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`SOAP service connection error: ${error.message}`)
    }
    throw error
  }
}

/**
 * Validates OTP token sent to client's phone for terms and conditions acceptance
 * @param phone - Client phone number (8 digits)
 * @param token - OTP token received by the client
 * @returns Response with return code and message
 */
export async function validateTokenTyc(phone: string, token: string): Promise<ValidateTokenResponse> {
  // Validate credentials
  if (!USERNAME || !PASSWORD) {
    throw new Error("SOAP credentials not configured. Check SOAP_USERNAME and SOAP_PASSWORD_URL_ENCODE environment variables")
  }

  // Validate phone
  const cleanPhone = phone.replace(/\s/g, "")
  if (!cleanPhone || cleanPhone.length !== 8) {
    throw new Error("Phone number must have 8 digits")
  }

  // Validate token
  const cleanToken = token.replace(/\s/g, "")
  if (!cleanToken || cleanToken.length !== 6) {
    throw new Error("Token must have 6 digits")
  }

  try {
    // Build SOAP XML
    const soapBody = buildValidateTokenSoapEnvelope(USERNAME, PASSWORD, cleanPhone, cleanToken)

    // Configure headers to ensure UTF-8
    const headers = {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://www.paq.com.gt/Valida_Token_TyC",
      Accept: "text/xml; charset=utf-8",
      "Accept-Charset": "utf-8, *;q=0.8",
      "Accept-Language": "es, es-ES;q=0.9, *;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
    }

    // Make SOAP request with axios
    const response = await axios.post(SOAP_URL, soapBody, {
      headers,
      responseType: "text",
      responseEncoding: "utf8",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      transformResponse: [
        (data) => {
          // If it comes as Buffer, convert to UTF-8 string
          if (Buffer.isBuffer(data)) {
            return data.toString("utf8")
          }
          return data
        },
      ],
    })

    // Parse XML response
    const parsedXml = await parseXmlResponse(response.data)

    // Extract response data
    const envelope = parsedXml["soap:Envelope"] || parsedXml["soapenv:Envelope"] || parsedXml.Envelope
    const body = envelope?.["soap:Body"] || envelope?.["soapenv:Body"] || envelope?.Body
    const responseNode = body?.Valida_Token_TyCResponse || body?.["Valida_Token_TyCResponse"]
    const resultRaw = responseNode?.Valida_Token_TyCResult || responseNode?.["Valida_Token_TyCResult"]

    if (!resultRaw) {
      throw new Error("Unrecognized response structure for token validation")
    }

    // Extract the value (can be JSON string or object)
    const resultValue = extractValue(resultRaw)

    // If it's a JSON string, parse it
    if (typeof resultValue === "string") {
      try {
        const jsonParsed = JSON.parse(resultValue)
        return {
          returnCode: jsonParsed.codret || "0",
          message: jsonParsed.mensaje || resultValue,
        }
      } catch (e) {
        return {
          returnCode: "0",
          message: resultValue,
        }
      }
    }

    // If it's already an object, map it
    return {
      returnCode: resultValue.codret || "0",
      message: resultValue.mensaje || "",
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`SOAP service connection error: ${error.message}`)
    }
    throw error
  }
}

/**
 * Validates credit limit (cupo) for salary advance authorization
 * @param phone - Client phone number (8 digits)
 * @returns Response with authorized amount and commission details
 */
export async function validateCupo(phone: string): Promise<ValidateCupoResponse> {
  // Validate credentials
  if (!USERNAME || !PASSWORD) {
    throw new Error("SOAP credentials not configured. Check SOAP_USERNAME and SOAP_PASSWORD_URL_ENCODE environment variables")
  }

  // Validate phone
  const cleanPhone = phone.replace(/\s/g, "")
  if (!cleanPhone || cleanPhone.length !== 8) {
    throw new Error("Phone number must have 8 digits")
  }

  try {
    // Build SOAP XML
    const soapBody = buildValidateCupoSoapEnvelope(USERNAME, PASSWORD, cleanPhone)

    // Configure headers to ensure UTF-8
    const headers = {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://www.paq.com.gt/valida_cupo",
      Accept: "text/xml; charset=utf-8",
      "Accept-Charset": "utf-8, *;q=0.8",
      "Accept-Language": "es, es-ES;q=0.9, *;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
    }

    // Make SOAP request with axios
    const response = await axios.post(SOAP_URL, soapBody, {
      headers,
      responseType: "text",
      responseEncoding: "utf8",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      transformResponse: [
        (data) => {
          // If it comes as Buffer, convert to UTF-8 string
          if (Buffer.isBuffer(data)) {
            return data.toString("utf8")
          }
          return data
        },
      ],
    })

    // Parse XML response
    const parsedXml = await parseXmlResponse(response.data)

    // Extract response data
    const envelope = parsedXml["soap:Envelope"] || parsedXml["soapenv:Envelope"] || parsedXml.Envelope
    const body = envelope?.["soap:Body"] || envelope?.["soapenv:Body"] || envelope?.Body
    const responseNode = body?.valida_cupoResponse || body?.["valida_cupoResponse"]
    const resultRaw = responseNode?.valida_cupoResult || responseNode?.["valida_cupoResult"]

    if (!resultRaw) {
      throw new Error("Unrecognized response structure for cupo validation")
    }

    // Extract the value (can be JSON string or object)
    const resultValue = extractValue(resultRaw)

    // If it's a JSON string, parse it
    if (typeof resultValue === "string") {
      try {
        const jsonParsed = JSON.parse(resultValue)
        return {
          returnCode: jsonParsed.codret || "0",
          message: jsonParsed.mensaje || resultValue,
          idSolicitud: jsonParsed.id_solicitud,
          celular: jsonParsed.celular,
          cupoAutorizado: jsonParsed.cupo_autorizado ? Number.parseFloat(jsonParsed.cupo_autorizado) : undefined,
          comisionSobreCupo: jsonParsed.comision_sobre_cupo ? Number.parseFloat(jsonParsed.comision_sobre_cupo) : undefined,
          porcComision: jsonParsed.porc_comision ? Number.parseFloat(jsonParsed.porc_comision) : undefined,
          limMaxComBanda1: jsonParsed.limMaxComBanda1 ? Number.parseFloat(jsonParsed.limMaxComBanda1) : undefined,
          comMinBanda1: jsonParsed.comMinBanda1 ? Number.parseFloat(jsonParsed.comMinBanda1) : undefined,
          limMaxComBanda2: jsonParsed.limMaxComBanda2 ? Number.parseFloat(jsonParsed.limMaxComBanda2) : undefined,
          comMinBanda2: jsonParsed.comMinBanda2 ? Number.parseFloat(jsonParsed.comMinBanda2) : undefined,
        }
      } catch (e) {
        return {
          returnCode: "0",
          message: resultValue,
        }
      }
    }

    // If it's already an object, map it
    return {
      returnCode: resultValue.codret || "0",
      message: resultValue.mensaje || "",
      idSolicitud: resultValue.id_solicitud,
      celular: resultValue.celular,
      cupoAutorizado: resultValue.cupo_autorizado ? Number.parseFloat(resultValue.cupo_autorizado) : undefined,
      comisionSobreCupo: resultValue.comision_sobre_cupo ? Number.parseFloat(resultValue.comision_sobre_cupo) : undefined,
      porcComision: resultValue.porc_comision ? Number.parseFloat(resultValue.porc_comision) : undefined,
      limMaxComBanda1: resultValue.limMaxComBanda1 ? Number.parseFloat(resultValue.limMaxComBanda1) : undefined,
      comMinBanda1: resultValue.comMinBanda1 ? Number.parseFloat(resultValue.comMinBanda1) : undefined,
      limMaxComBanda2: resultValue.limMaxComBanda2 ? Number.parseFloat(resultValue.limMaxComBanda2) : undefined,
      comMinBanda2: resultValue.comMinBanda2 ? Number.parseFloat(resultValue.comMinBanda2) : undefined,
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`SOAP service connection error: ${error.message}`)
    }
    throw error
  }
}

