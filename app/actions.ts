"use server"

import { headers } from "next/headers"
import {
  queryClient,
  sendTokenTyc,
  validateTokenTyc,
  validateCupo,
  executeDisbursement,
  type QueryClientResponse,
} from "@/lib/soap-client"
import { sendToMakeWebhook } from "@/lib/make-integration"

// Test mode configuration from environment variables
const ENABLE_TEST_BYPASS = process.env.ENABLE_TEST_BYPASS === "true" || process.env.ENABLE_TEST_BYPASS === "1"
const TEST_PHONE = process.env.TEST_PHONE || "50502180"
const TEST_APPROVED_AMOUNT = Number.parseInt(process.env.TEST_APPROVED_AMOUNT || "3500", 10)
const TEST_ID_SOLICITUD = process.env.TEST_ID_SOLICITUD || "TEST-001"
const TEST_TOKEN = process.env.TEST_TOKEN || "222222"

// Allowed domain for Server Actions (security)
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "https://paq-wallet-telopresto.vercel.app"
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(",").map((d) => d.trim())
  : [ALLOWED_DOMAIN]

// Allow localhost in development
const isDevelopment = process.env.NODE_ENV === "development"
const LOCALHOST_DOMAINS = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost", "http://127.0.0.1"]

/**
 * Validates that the request originates from an allowed domain
 * This prevents external requests from calling Server Actions directly
 * @returns true if request is allowed, false otherwise
 */
async function validateRequestOrigin(): Promise<boolean> {
  try {
    const headersList = await headers()
    const origin = headersList.get("origin")
    const referer = headersList.get("referer")
    const host = headersList.get("host")

    // Get the protocol (http/https) from origin or referer, default to https
    const protocol = origin?.startsWith("https") || referer?.startsWith("https") ? "https" : "http"
    
    // Build the request origin URL
    let requestOrigin = origin
    if (!requestOrigin && referer) {
      try {
        requestOrigin = new URL(referer).origin
      } catch {
        // If referer is not a valid URL, try to extract origin manually
        const refererMatch = referer.match(/^(https?:\/\/[^\/]+)/)
        if (refererMatch) {
          requestOrigin = refererMatch[1]
        }
      }
    }
    if (!requestOrigin && host) {
      requestOrigin = `${protocol}://${host}`
    }

    if (!requestOrigin) {
      console.warn("⚠️ Security: No origin/referer header found")
      return false
    }

    // In development, allow localhost
    if (isDevelopment) {
      const isLocalhost = LOCALHOST_DOMAINS.some((localhostDomain) => {
        return requestOrigin === localhostDomain || requestOrigin.startsWith(localhostDomain)
      })
      if (isLocalhost) {
        console.log("✅ Security: Localhost request allowed (development mode)")
        return true
      }
    }

    // Check if request origin matches any allowed domain
    const isAllowed = ALLOWED_DOMAINS.some((allowedDomain) => {
      const normalizedAllowed = allowedDomain.replace(/\/$/, "") // Remove trailing slash
      const normalizedOrigin = requestOrigin!.replace(/\/$/, "") // Remove trailing slash
      return normalizedOrigin === normalizedAllowed || normalizedOrigin.startsWith(normalizedAllowed)
    })

    if (!isAllowed) {
      console.error("🚫 Security: Request blocked - Invalid origin")
      console.error(`   Request Origin: ${requestOrigin}`)
      console.error(`   Allowed Domains: ${ALLOWED_DOMAINS.join(", ")}`)
      if (isDevelopment) {
        console.error(`   Localhost allowed: ${LOCALHOST_DOMAINS.join(", ")}`)
      }
      return false
    }

    console.log("✅ Security: Request origin validated")
    console.log(`   Origin: ${requestOrigin}`)
    return true
  } catch (error) {
    console.error("❌ Security: Error validating request origin:", error)
    return false
  }
}

interface Step0FormData {
  phone: string
  autorizacion?: string // Authorization number for end-to-end tracking
}

interface Step1FormData {
  identification: string
  fullName: string
  phone: string
  email: string
  nit: string
  startDate: string
  salary: string
  paymentFrequency: string
  autorizacion?: string // Authorization number for end-to-end tracking
}

interface ServerActionResponse {
  success: boolean
  error?: string
  errorType?: "token" | "cupo" | "general" | "phone_number" | "disbursement" // Distinguish error types for step2
  approvedAmount?: number
  idSolicitud?: string
  skipStep2?: boolean // Indicates that step 2 (OTP) should be skipped
  hasCommissionIssue?: boolean // Indicates code 34: disbursement successful but commission collection had issues
  clientData?: {
    identification?: string
    fullName?: string
    phone?: string
    email?: string
    nit?: string
    startDate?: string
    salary?: string
    paymentFrequency?: string
  }
}

/**
 * Server action for step 0: Validate phone number
 * @param data - Phone number to validate
 * @returns Response indicating if phone is registered
 */
export async function submitStep0Form(data: Step0FormData): Promise<ServerActionResponse> {
  // Validate request origin
  const isValidOrigin = await validateRequestOrigin()
  if (!isValidOrigin) {
    return {
      success: false,
      error: "Unauthorized request origin",
      errorType: "general",
    }
  }

  console.log("=== STEP 0 PHONE VALIDATION ===")
  console.log("Timestamp:", new Date().toISOString())
  console.log("Phone:", data.phone)
  console.log("===============================")

  try {
    // Validate input
    if (!data.phone) {
      return {
        success: false,
        error: "Phone number is required",
        errorType: "phone_number",
      }
    }

    const cleanPhone = data.phone.replace(/\s/g, "")
    if (cleanPhone.length !== 8) {
      return {
        success: false,
        error: "Phone number must have 8 digits",
        errorType: "phone_number",
      }
    }

    // TEST MODE: Bypass for test phone number
    if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
      console.log("🧪 TEST MODE: Bypass activated for test phone number")
      console.log(`   Phone: ${cleanPhone}`)
      console.log("   Returning mock client data to allow progression to step 1")

      // Return mock client data that will allow progression to step 1
      // Client data is incomplete so user must fill form manually
      const mockClientData = {
        identification: "",
        fullName: "",
        phone: cleanPhone,
        email: "",
        nit: "",
        startDate: "",
        salary: "",
        paymentFrequency: "",
      }

      return {
        success: true,
        clientData: mockClientData,
      }
    }

    // Query if client is registered by phone number
    console.log("🔍 Querying client in system...")
    console.log(`   Phone: ${cleanPhone}`)

    let clientResponse: QueryClientResponse | null = null

    try {
      clientResponse = await queryClient(cleanPhone)
    } catch (error) {
      console.error("❌ Error querying client:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error querying service. Please try again later.",
        errorType: "phone_number",
      }
    }

    // Check if query was successful
    const returnCode = clientResponse.returnCode
    const isSuccessful = returnCode === 0 || returnCode === "0"

    if (!isSuccessful) {
      // Client not registered or error in query
      const errorMessage = clientResponse.message || "Phone number is not registered in the system"
      console.error("❌ Client not found or query error:")
      console.error(`   Code: ${returnCode}`)
      console.error(`   Message: ${errorMessage}`)

      return {
        success: false,
        error: errorMessage,
        errorType: "phone_number",
      }
    }

    // Client found - phone is valid
    console.log("✅ Client found in system")
    console.log(`   Code: ${returnCode}`)
    console.log(`   Message: ${clientResponse.message}`)

    // Extract client data to pre-fill form
    const clientData = clientResponse.client
    let mappedClientData: ServerActionResponse["clientData"] | undefined = undefined

    if (clientData && typeof clientData === "object") {
      console.log("📋 Client Data:")
      console.log(`   ID: ${clientData.id || "N/A"}`)
      console.log(`   Status: ${clientData.status || "N/A"}`)
      console.log(`   Name: ${clientData.fullName || "N/A"}`)
      console.log(`   Phone: ${clientData.phone || "N/A"}`)
      console.log(`   Email: ${clientData.email || "N/A"}`)
      console.log(`   NIT: ${clientData.nit || "N/A"}`)
      console.log(`   Start Date: ${clientData.startDate || "N/A"}`)
      console.log(`   Salary: ${clientData.monthlySalary || "N/A"}`)
      console.log(`   Payment Frequency: ${clientData.paymentFrequency || "N/A"}`)

      // Helper function to convert date from ISO format to dd-mm-yyyy
      const formatDateToDDMMYYYY = (dateString: string | undefined): string => {
        if (!dateString) return ""
        try {
          // Handle ISO format: "2025-11-05T13:25:41.307" or "2025-11-05"
          const date = new Date(dateString)
          if (isNaN(date.getTime())) return ""

          const day = String(date.getDate()).padStart(2, "0")
          const month = String(date.getMonth() + 1).padStart(2, "0")
          const year = date.getFullYear()

          return `${day}-${month}-${year}`
        } catch (error) {
          console.error("Error formatting date:", error)
          return ""
        }
      }

      // Helper function to convert payment frequency code to form value
      const normalizePaymentFrequency = (frequency: string | undefined): string => {
        if (!frequency) return ""
        const normalized = frequency.toUpperCase()
        if (normalized === "M") return "mensual"
        if (normalized === "Q") return "quincenal"
        if (normalized === "S") return "semanal"
        return frequency.toLowerCase() // Return as-is if not recognized
      }

      // Map client data to form format
      mappedClientData = {
        identification: clientData.identificationNumber || "",
        fullName: clientData.fullName || "",
        phone: clientData.phone || cleanPhone,
        email: clientData.email || "",
        nit: clientData.nit || "",
        startDate: formatDateToDDMMYYYY(clientData.startDate),
        salary: clientData.monthlySalary || "",
        paymentFrequency: normalizePaymentFrequency(clientData.paymentFrequency),
      }
    }

    return {
      success: true,
      clientData: mappedClientData,
    }
  } catch (error) {
    console.error("❌ Error in submitStep0Form:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error processing phone validation",
      errorType: "general",
    }
  }
}

export async function submitStep1Form(data: Step1FormData): Promise<ServerActionResponse> {
  // Validate request origin
  const isValidOrigin = await validateRequestOrigin()
  if (!isValidOrigin) {
    return {
      success: false,
      error: "Unauthorized request origin",
      errorType: "general",
    }
  }

  // Server log with all received fields
  console.log("=== STEP 1 FORM SUBMISSION ===")
  console.log("Timestamp:", new Date().toISOString())
  console.log("Form Data:", JSON.stringify(data, null, 2))
  console.log("===============================")

  try {
    // Additional server-side validation
    if (!data.identification || !data.fullName || !data.phone || !data.email || !data.nit || !data.startDate || !data.salary || !data.paymentFrequency) {
      return {
        success: false,
        error: "All fields are required",
        errorType: "general", // Step1 errors stay in step1
      }
    }

    const cleanPhone = data.phone.replace(/\s/g, "")

    // TEST MODE: Bypass for test phone number
    if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
      console.log("🧪 TEST MODE: Bypass activated for test phone number")
      console.log(`   Phone: ${cleanPhone}`)
      console.log("   Skipping client validation and OTP sending")
      console.log("   Sending mock data to webhook")

      // Send mock data to webhook
      const mockClientResponse: QueryClientResponse = {
        returnCode: 0,
        message: "TEST MODE: Mock client validation",
        client: {
          id: "TEST-001",
          status: "ACTIVE",
          identificationNumber: data.identification,
          fullName: data.fullName,
          phone: cleanPhone,
          email: data.email,
          nit: data.nit,
          startDate: data.startDate,
          monthlySalary: data.salary,
          paymentFrequency: data.paymentFrequency,
        },
      }

      await sendToMakeWebhook(1, data, mockClientResponse, true, data.autorizacion)

      // Return success to proceed to step 2 (OTP)
      console.log("✅ TEST MODE: Step 1 completed, proceeding to step 2")
      return {
        success: true,
        skipStep2: false, // Go to step 2 for OTP
      }
    }

    // STEP 1: Query if client is registered by phone number
    console.log("🔍 Querying client in system...")
    console.log(`   Phone: ${cleanPhone}`)

    let clientResponse: QueryClientResponse | null = null
    let clientExists = false

    try {
      clientResponse = await queryClient(cleanPhone)
    } catch (error) {
      console.error("❌ Error querying client:", error)
      // Send to webhook even if query fails
      await sendToMakeWebhook(1, data, null, false, data.autorizacion)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error querying service. Please try again later.",
        errorType: "general", // Step1 errors stay in step1
      }
    }

    // Check if query was successful
    const returnCode = clientResponse.returnCode
    const isSuccessful = returnCode === 0 || returnCode === "0"
    clientExists = isSuccessful

    if (!isSuccessful) {
      // Client not registered or error in query
      const errorMessage = clientResponse.message || "Phone number is not registered in the system"
      console.error("❌ Client not found or query error:")
      console.error(`   Code: ${returnCode}`)
      console.error(`   Message: ${errorMessage}`)

      // Send to webhook with client not found
      await sendToMakeWebhook(1, data, clientResponse, false, data.autorizacion)

      return {
        success: false,
        error: errorMessage,
        errorType: "general", // Step1 errors stay in step1
      }
    }

    // Client found - process client data
    console.log("✅ Client found in system")
    console.log(`   Code: ${returnCode}`)
    console.log(`   Message: ${clientResponse.message}`)

    // Client data is already mapped to English camelCase format
    const clientData = clientResponse.client

    if (clientData && typeof clientData === "object") {
      console.log("📋 Client Data:")
      console.log(`   ID: ${clientData.id || "N/A"}`)
      console.log(`   Status: ${clientData.status || "N/A"}`)
      console.log(`   Name: ${clientData.fullName || "N/A"}`)
      console.log(`   Phone: ${clientData.phone || "N/A"}`)
      console.log(`   Email: ${clientData.email || "N/A"}`)
    }

    // Here you can add additional validations comparing form data
    // with client data obtained from the system
    // For example:
    // - Verify that name matches
    // - Verify that email matches
    // - Verify that NIT matches
    // - etc.

    // Send to webhook with successful client query
    await sendToMakeWebhook(1, data, clientResponse, true, data.autorizacion)

    // Send OTP token to client's phone for step 2 validation
    console.log("📱 Sending OTP token to client's phone...")
    try {
      // TEST MODE: Bypass token sending for test phone number
      if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
        console.log("🧪 TEST MODE: Bypass token sending for test phone number")
        console.log(`   Phone: ${cleanPhone}`)
        console.log(`   Test Token: ${TEST_TOKEN}`)
        console.log("   ✅ TEST MODE: Token sending bypassed, proceed to step 2")
        // Continue to step 2 without sending actual token
        // Return success to proceed to step 2 (OTP input)
        return {
          success: true,
        }
      }

      // Normal flow: Send token via SOAP service
      const tokenResponse = await sendTokenTyc(data.phone)
      const tokenReturnCode = tokenResponse.returnCode
      const tokenSuccess = tokenReturnCode === 0 ||
        tokenReturnCode === "0" ||
        tokenReturnCode === 24 ||
        tokenReturnCode === "24"

      if (!tokenSuccess) {
        // OTP sending failed - go to fallback
        const errorMessage = tokenResponse.message || "Error sending OTP token"
        console.error("❌ Error sending OTP token:")
        console.error(`   Code: ${tokenReturnCode}`)
        console.error(`   Message: ${errorMessage}`)
        return {
          success: false,
          error: errorMessage,
        }
      }

      // Check if code is 24 (client already accepted terms and conditions)
      const isCode24 = tokenReturnCode === 24 || tokenReturnCode === "24"
      
      if (isCode24) {
        console.log("✅ Client already accepted terms and conditions (Code 24)")
        console.log(`   Message: ${tokenResponse.message}`)
        console.log("⏭️ Skipping OTP validation, proceeding directly to cupo validation...")

        // Validate cupo (credit limit) directly
        console.log("💰 Validating credit limit (cupo)...")
        console.log(`   Phone: ${data.phone}`)

        let cupoResponse
        try {
          cupoResponse = await validateCupo(data.phone)
        } catch (error) {
          console.error("❌ Error validating cupo:", error)
          return {
            success: false,
            error: error instanceof Error ? error.message : "Error validating credit limit. Please try again later.",
            errorType: "cupo",
          }
        }

        // Check if cupo validation was successful
        const cupoReturnCode = cupoResponse.returnCode
        const cupoIsSuccessful = cupoReturnCode === 0 || cupoReturnCode === "0"

        if (!cupoIsSuccessful) {
          // Cupo validation failed
          const errorMessage = cupoResponse.message || "Error validating credit limit"
          console.error("❌ Cupo validation failed:")
          console.error(`   Code: ${cupoReturnCode}`)
          console.error(`   Message: ${errorMessage}`)

          return {
            success: false,
            error: errorMessage,
            errorType: "cupo",
          }
        }

        // Cupo validated successfully
        console.log("✅ Credit limit validated successfully")
        console.log(`   Code: ${cupoReturnCode}`)
        console.log(`   Message: ${cupoResponse.message}`)
        console.log(`   Approved Amount: Q${cupoResponse.cupoAutorizado || "N/A"}`)
        console.log(`   Request ID: ${cupoResponse.idSolicitud || "N/A"}`)

        // Return success with approved amount and skipStep2 flag
        return {
          success: true,
          approvedAmount: cupoResponse.cupoAutorizado,
          idSolicitud: cupoResponse.idSolicitud,
          skipStep2: true, // Skip OTP step and go directly to step 3
        }
      }

      // Code 0: OTP token sent successfully, proceed to step 2
      console.log("✅ OTP token sent successfully")
      console.log(`   Message: ${tokenResponse.message}`)
    } catch (error) {
      // OTP sending failed - go to fallback
      console.error("❌ Error sending OTP token:", error)
      const errorMessage = error instanceof Error ? error.message : "Error sending OTP token. Please try again later."
      return {
        success: false,
        error: errorMessage,
      }
    }

    // If everything is ok, return success (normal flow: go to step 2)
    console.log("✅ Form processed successfully")
    return {
      success: true,
    }
  } catch (error) {
    console.error("❌ Error in submitStep1Form:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error processing form",
      errorType: "general", // Step1 errors stay in step1
    }
  }
}

interface Step2FormData {
  phone: string
  token: string
  autorizacion?: string // Authorization number for end-to-end tracking
}

/**
 * Server action to resend OTP token via SMS
 * @param phone - Client phone number (8 digits)
 * @returns Response indicating success or failure
 */
export async function resendToken(phone: string): Promise<ServerActionResponse> {
  // Validate request origin
  const isValidOrigin = await validateRequestOrigin()
  if (!isValidOrigin) {
    return {
      success: false,
      error: "Unauthorized request origin",
      errorType: "general",
    }
  }

  console.log("=== RESEND TOKEN ===")
  console.log("Timestamp:", new Date().toISOString())
  console.log("Phone:", phone)
  console.log("===============================")

  try {
    // Validate phone
    const cleanPhone = phone.replace(/\s/g, "")
    if (!cleanPhone || cleanPhone.length !== 8) {
      return {
        success: false,
        error: "Phone number must have 8 digits",
        errorType: "general",
      }
    }

    // TEST MODE: Bypass for test phone number
    if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
      console.log("🧪 TEST MODE: Bypass OTP resend for test phone number")
      console.log(`   Phone: ${cleanPhone}`)
      console.log("   ✅ TEST MODE: OTP resend bypassed successfully")
      return {
        success: true,
      }
    }

    // Send OTP token to client's phone
    console.log("📱 Resending OTP token to client's phone...")
    console.log(`   Phone: ${cleanPhone}`)

    try {
      const tokenResponse = await sendTokenTyc(cleanPhone)
      const tokenReturnCode = tokenResponse.returnCode
      const tokenSuccess = tokenReturnCode === 0 || tokenReturnCode === "0"

      if (tokenSuccess) {
        console.log("✅ OTP token resent successfully")
        console.log(`   Message: ${tokenResponse.message}`)
        return {
          success: true,
        }
      } else {
        console.error("❌ Error resending OTP token:")
        console.error(`   Code: ${tokenReturnCode}`)
        console.error(`   Message: ${tokenResponse.message}`)
        return {
          success: false,
          error: tokenResponse.message || "Failed to resend OTP token.",
          errorType: "token", // Resend errors go to fallback
        }
      }
    } catch (error) {
      console.error("❌ Error resending OTP token:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error resending OTP token",
        errorType: "token", // Resend errors go to fallback
      }
    }
  } catch (error) {
    console.error("❌ Error in resendToken:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error processing token resend",
      errorType: "cupo", // Resend errors go to fallback
    }
  }
}

export async function submitStep2Form(data: Step2FormData): Promise<ServerActionResponse> {
  // Validate request origin
  const isValidOrigin = await validateRequestOrigin()
  if (!isValidOrigin) {
    return {
      success: false,
      error: "Unauthorized request origin",
      errorType: "general",
    }
  }

  // Server log with received data
  console.log("=== STEP 2 FORM SUBMISSION ===")
  console.log("Timestamp:", new Date().toISOString())
  console.log("Phone:", data.phone)
  console.log("Token:", data.token)
  console.log("===============================")

  try {
    // Validate input
    if (!data.phone || !data.token) {
      return {
        success: false,
        error: "Phone and token are required",
        errorType: "token", // Token validation errors stay in step2
      }
    }

    // Validate token format
    const cleanToken = data.token.replace(/\s/g, "").toUpperCase()
    if (cleanToken.length !== 6) {
      return {
        success: false,
        error: "Token must have 6 characters",
        errorType: "token", // Token validation errors stay in step2
      }
    }

    const cleanPhone = data.phone.replace(/\s/g, "")

    // TEST MODE: Bypass for test phone number
    if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
      console.log("🧪 TEST MODE: Bypass activated for test phone number")
      console.log(`   Phone: ${cleanPhone}`)
      console.log(`   Token: ${cleanToken} (bypass - test mode)`)
      console.log("   Skipping token validation and cupo validation")
      console.log("   Returning mock approved amount:", TEST_APPROVED_AMOUNT)

      // Return mock cupo data
      return {
        success: true,
        approvedAmount: TEST_APPROVED_AMOUNT,
        idSolicitud: TEST_ID_SOLICITUD,
      }
    }

    // Bypass token: if token is TEST_TOKEN, skip SOAP validation and proceed to cupo validation
    // Only works if TEST_BYPASS is enabled
    const isBypassToken = ENABLE_TEST_BYPASS && cleanToken === TEST_TOKEN

    if (isBypassToken) {
      console.log("🔓 Bypass token detected - skipping token validation")
      console.log(`   Phone: ${data.phone}`)
      console.log(`   Token: ${cleanToken} (bypass)`)
    } else {
      // Validate token with SOAP service
      console.log("🔍 Validating OTP token...")
      console.log(`   Phone: ${data.phone}`)
      console.log(`   Token: ${cleanToken}`)

      let tokenResponse
      try {
        tokenResponse = await validateTokenTyc(data.phone, cleanToken)
      } catch (error) {
        console.error("❌ Error validating token:", error)
        return {
          success: false,
          error: error instanceof Error ? error.message : "Error validating token. Please try again later.",
          errorType: "token", // Token validation errors stay in step2
        }
      }

      // Check if validation was successful
      // Code: 0 -> Token validated successfully
      // Code: 24 -> El cliente ya aceptó los términos y condiciones (also valid)
      // Code: 26 -> El token ingresado no es correcto.
      const returnCode = tokenResponse.returnCode
      const isSuccessful = returnCode === 0 || returnCode === "0"

      if (!isSuccessful) {
        // Token validation failed
        const errorMessage = tokenResponse.message || "Invalid token. Please try again."
        console.error("❌ Token validation failed:")
        console.error(`   Code: ${returnCode}`)
        console.error(`   Message: ${errorMessage}`)

        return {
          success: false,
          error: errorMessage,
          errorType: "token", // Token validation errors stay in step2
        }
      }

      // Token validated successfully
      console.log("✅ Token validated successfully")
      console.log(`   Code: ${returnCode}`)
      console.log(`   Message: ${tokenResponse.message}`)
    }

    // Validate cupo (credit limit) to get approved amount
    console.log("💰 Validating credit limit (cupo)...")
    console.log(`   Phone: ${data.phone}`)

    // TEST MODE: Bypass cupo validation for test phone number
    if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
      console.log("🧪 TEST MODE: Bypass cupo validation")
      console.log(`   Returning mock approved amount: Q${TEST_APPROVED_AMOUNT}`)
      console.log(`   Mock ID Solicitud: ${TEST_ID_SOLICITUD}`)

      return {
        success: true,
        approvedAmount: TEST_APPROVED_AMOUNT,
        idSolicitud: TEST_ID_SOLICITUD,
      }
    }

    let cupoResponse
    try {
      cupoResponse = await validateCupo(data.phone)
    } catch (error) {
      console.error("❌ Error validating cupo:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error validating credit limit. Please try again later.",
        errorType: "cupo", // Cupo errors go to fallback and reset
      }
    }

    // Check if cupo validation was successful
    const cupoReturnCode = cupoResponse.returnCode
    const cupoIsSuccessful = cupoReturnCode === 0 || cupoReturnCode === "0"

    if (!cupoIsSuccessful) {
      // Cupo validation failed
      const errorMessage = cupoResponse.message || "Error validating credit limit"
      console.error("❌ Cupo validation failed:")
      console.error(`   Code: ${cupoReturnCode}`)
      console.error(`   Message: ${errorMessage}`)

      return {
        success: false,
        error: errorMessage,
        errorType: "cupo", // Cupo errors go to fallback and reset
      }
    }

    // Cupo validated successfully
    console.log("✅ Credit limit validated successfully")
    console.log(`   Code: ${cupoReturnCode}`)
    console.log(`   Message: ${cupoResponse.message}`)
    console.log(`   Approved Amount: Q${cupoResponse.cupoAutorizado || "N/A"}`)
    console.log(`   Request ID: ${cupoResponse.idSolicitud || "N/A"}`)

    // Return success with approved amount
    return {
      success: true,
      approvedAmount: cupoResponse.cupoAutorizado,
      idSolicitud: cupoResponse.idSolicitud,
    }
  } catch (error) {
    console.error("❌ Error in submitStep2Form:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error processing token validation",
      errorType: "general", // Unknown errors default to general
    }
  }
}

interface Step3FormData {
  phone: string
  idSolicitud: string
  monto: number
  comision: number
  autorizacion: string
}

/**
 * Server action for step 3: Execute disbursement
 * @param data - Disbursement data (phone, idSolicitud, monto, comision, autorizacion)
 * @returns Response indicating success or failure
 */
export async function submitStep3Form(data: Step3FormData): Promise<ServerActionResponse> {
  // Validate request origin
  const isValidOrigin = await validateRequestOrigin()
  if (!isValidOrigin) {
    return {
      success: false,
      error: "Unauthorized request origin",
      errorType: "disbursement",
    }
  }

  console.log("=== STEP 3 DISBURSEMENT EXECUTION ===")
  console.log("Timestamp:", new Date().toISOString())
  console.log("Phone:", data.phone)
  console.log("ID Solicitud:", data.idSolicitud)
  console.log("Monto:", data.monto)
  console.log("Comision:", data.comision)
  console.log("Autorizacion:", data.autorizacion)
  console.log("===============================")

  try {
    // Validate input
    if (!data.phone || !data.idSolicitud || !data.monto || data.comision < 0 || !data.autorizacion) {
      return {
        success: false,
        error: "All fields are required and valid",
        errorType: "disbursement",
      }
    }

    const cleanPhone = data.phone.replace(/\s/g, "")

    // TEST MODE: Bypass disbursement for test phone number
    if (ENABLE_TEST_BYPASS && cleanPhone === TEST_PHONE) {
      console.log("🧪 TEST MODE: Bypass disbursement execution")
      console.log(`   Phone: ${cleanPhone}`)
      console.log(`   ID Solicitud: ${data.idSolicitud}`)
      console.log(`   Monto: Q${data.monto}`)
      console.log(`   Comision: Q${data.comision}`)
      console.log(`   Autorizacion: ${data.autorizacion}`)
      console.log("   ✅ TEST MODE: Disbursement bypassed successfully")

      return {
        success: true,
        hasCommissionIssue: false,
      }
    }

    // Execute disbursement
    console.log("💰 Executing disbursement...")
    console.log(`   Phone: ${data.phone}`)
    console.log(`   ID Solicitud: ${data.idSolicitud}`)
    console.log(`   Monto: Q${data.monto}`)
    console.log(`   Comision: Q${data.comision}`)
    console.log(`   Autorizacion: ${data.autorizacion}`)

    let disbursementResponse
    try {
      disbursementResponse = await executeDisbursement(
        data.phone,
        data.idSolicitud,
        data.monto,
        data.comision,
        data.autorizacion,
      )
    } catch (error) {
      console.error("❌ Error executing disbursement:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error executing disbursement. Please try again later.",
        errorType: "disbursement",
      }
    }

    // Check if disbursement was successful
    // Code 0 = success, Code 34 = success in disbursement but error in commission collection (also consider success)
    const returnCode = disbursementResponse.returnCode
    const isSuccessful = returnCode === 0 || returnCode === "0" || returnCode === 34 || returnCode === "34"

    if (!isSuccessful) {
      // Disbursement failed
      const errorMessage = disbursementResponse.message || "Error executing disbursement"
      console.error("❌ Disbursement execution failed:")
      console.error(`   Code: ${returnCode}`)
      console.error(`   Message: ${errorMessage}`)

      return {
        success: false,
        error: errorMessage,
        errorType: "disbursement",
      }
    }

    // Disbursement executed successfully
    console.log("✅ Disbursement executed successfully")
    console.log(`   Code: ${returnCode}`)
    console.log(`   Message: ${disbursementResponse.message}`)
    const hasCommissionIssue = returnCode === 34 || returnCode === "34"
    if (hasCommissionIssue) {
      console.warn("⚠️ Disbursement successful but commission collection had issues (Code 34)")
    }

    return {
      success: true,
      hasCommissionIssue: hasCommissionIssue,
    }
  } catch (error) {
    console.error("❌ Error in submitStep3Form:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error processing disbursement",
      errorType: "disbursement",
    }
  }
}

