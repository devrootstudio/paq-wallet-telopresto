"use client"

import type { WizardState } from "./store"
import { submitStep0Form, submitStep1Form, submitStep2Form, resendToken } from "@/app/actions"

// Re-export types for convenience
export type { WizardState }

/**
 * Handler for Step 0: Phone validation
 */
// Helper function to generate authorization number
function generateAutorizacion(): string {
  return `AUTH-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
}

export async function handleStep0Submit(
  phone: string,
  store: Pick<WizardState, "updateFormData" | "setLoading" | "setErrorStep" | "goToStepAsync" | "formData">,
) {
  const cleanPhone = phone.replace(/\s/g, "")

  // Generate authorization number at step 0 for end-to-end tracking
  const autorizacion = generateAutorizacion()
  store.updateFormData({ autorizacion })

  // Activate global loader
  store.setLoading(true)

  try {
    const formDataToSubmit = {
      phone: cleanPhone,
      autorizacion: autorizacion,
    }

    // Call server action to validate phone
    const result = await submitStep0Form(formDataToSubmit)

    if (result.success) {
      // If client data is available, pre-fill form fields
      if (result.clientData) {
        const clientData = result.clientData

        // Check if all required fields are filled
        const allFieldsFilled =
          clientData.identification &&
          clientData.fullName &&
          clientData.email &&
          clientData.nit &&
          clientData.startDate &&
          clientData.salary &&
          clientData.paymentFrequency

        if (allFieldsFilled) {
          // All data is complete, execute step 1 form submission process
          // This will: validate client, send to webhook, send OTP token, etc.
          console.log("✅ All client data is complete, executing step 1 form submission...")
          store.setLoading(true)

          // If data is already complete from WS, we DON'T need create/edit.
          // We only continue the normal flow (continue).
          const clientId = result.clientId || ""
          const nextAction: "continue" = "continue"

          // Update store with all client data (so UI stays in sync)
          store.updateFormData({
            identification: clientData.identification || "",
            phone: clientData.phone || cleanPhone,
            fullName: clientData.fullName || "",
            email: clientData.email || "",
            nit: clientData.nit || "",
            startDate: clientData.startDate || "",
            salary: clientData.salary || "",
            paymentFrequency: clientData.paymentFrequency || "",
            clientId,
            nextAction,
          })

          try {
            // Prepare form data for step 1 submission
            const step1FormData = {
              identification: clientData.identification || "",
              fullName: clientData.fullName || "",
              phone: clientData.phone || cleanPhone,
              email: clientData.email || "",
              nit: clientData.nit || "",
              startDate: clientData.startDate || "",
              salary: clientData.salary || "",
              paymentFrequency: clientData.paymentFrequency || "",
              autorizacion: store.formData.autorizacion,
              nextAction,
              clientId,
            }

            // Call submitStep1Form to execute the full process
            // This will: validate client, send to webhook (Airtable), send OTP token
            const step1Result = await submitStep1Form(step1FormData)

            if (step1Result.success) {
              // Check if we should skip step 2 (OTP validation)
              if (step1Result.skipStep2 && step1Result.approvedAmount !== undefined) {
                // Client already accepted terms (Code 24), cupo validated, skip to step 3
                console.log("⏭️ Skipping step 2 (OTP), going directly to step 3")
                store.updateFormData({
                  approvedAmount: step1Result.approvedAmount,
                  idSolicitud: step1Result.idSolicitud || "",
                })
                store.setLoading(false)
                await store.goToStepAsync(3)
              } else {
                // Normal flow: go to step 2 for OTP validation
                store.setLoading(false)
                await store.goToStepAsync(2)
              }
            } else {
              // Error in step 1 process
              const errorType = step1Result.errorType || "general"
              const errorMsg = step1Result.error || "Error processing form"
              store.setLoading(false)
              store.setErrorStep(errorType, errorMsg)
            }
          } catch (error) {
            console.error("Error executing step 1 form submission:", error)
            const errorMsg = error instanceof Error ? error.message : "Error processing form"
            store.setLoading(false)
            store.setErrorStep("general", errorMsg)
          }
        } else {
          // Some data is missing, go to step 1 to complete
          console.log("⚠️ Some client data is missing, redirecting to step 1")
          
          // Determine nextAction based on clientId
          const clientId = result.clientId || ""
          const nextAction = clientId ? "edit" : "create"
          console.log(`   Client ID: ${clientId || "N/A"}`)
          console.log(`   Next Action: ${nextAction}`)
          
          // Update formData with available client data (at least the phone)
          store.updateFormData({
            phone: clientData.phone || cleanPhone,
            identification: clientData.identification || "",
            fullName: clientData.fullName || "",
            email: clientData.email || "",
            nit: clientData.nit || "",
            startDate: clientData.startDate || "",
            salary: clientData.salary || "",
            paymentFrequency: clientData.paymentFrequency || "",
            clientId: clientId,
            nextAction: nextAction,
          })
          store.setLoading(false)
          await store.goToStepAsync(1)
        }
      } else {
        // No client data available, go to step 1 to fill form
        console.log("⚠️ No client data available, redirecting to step 1")
        
        // Determine nextAction based on clientId (should be empty for new clients)
        const clientId = result.clientId || ""
        const nextAction = clientId ? "edit" : "create"
        console.log(`   Client ID: ${clientId || "N/A"}`)
        console.log(`   Next Action: ${nextAction}`)
        
        // At least save the phone number and action info
        store.updateFormData({
          phone: cleanPhone,
          clientId: clientId,
          nextAction: nextAction,
        })
        store.setLoading(false)
        await store.goToStepAsync(1)
      }
    } else {
      // Use setErrorStep to analyze and decide where to go
      const errorType = result.errorType || "general"
      const errorMsg = result.error || "Error validating phone"
      store.setLoading(false)
      store.setErrorStep(errorType, errorMsg)
    }
  } catch (error) {
    console.error("Error submitting phone:", error)
    const errorMsg = error instanceof Error ? error.message : "Unknown error validating phone"
    store.setLoading(false)
    store.setErrorStep("general", errorMsg)
  }
}

/**
 * Handler for Step 1: Form submission
 */
export async function handleStep1Submit(
  formData: {
    identification: string
    fullName: string
    phone: string
    email: string
    nit: string
    startDate: string
    salary: string
    paymentFrequency: string
  },
  store: Pick<WizardState, "nextStepAsync" | "setLoading" | "setErrorStep" | "updateFormData" | "goToStepAsync" | "formData">,
) {
  // Activate global loader
  store.setLoading(true)

  try {
    // Prepare data for server action
    const formDataToSubmit = {
      identification: formData.identification.replace(/\s/g, ""),
      fullName: formData.fullName.trim(),
      phone: formData.phone.replace(/\s/g, ""),
      email: formData.email.trim(),
      nit: formData.nit.trim(),
      startDate: formData.startDate,
      salary: formData.salary,
      paymentFrequency: formData.paymentFrequency,
      autorizacion: store.formData.autorizacion,
      nextAction: store.formData.nextAction,
      clientId: store.formData.clientId,
    }

    // Call server action
    const result = await submitStep1Form(formDataToSubmit)

    if (result.success) {
      // Check if we should skip step 2 (OTP validation)
      if (result.skipStep2 && result.approvedAmount !== undefined) {
        // Client already accepted terms (Code 24), cupo validated, skip to step 3
        console.log("⏭️ Skipping step 2 (OTP), going directly to step 3")
        store.updateFormData({
          approvedAmount: result.approvedAmount,
          idSolicitud: result.idSolicitud || "",
        })
        store.setLoading(false)
        await store.goToStepAsync(3)
      } else {
        // Normal flow: advance to next step (step 2)
        await store.nextStepAsync()
      }
    } else {
      // Use setErrorStep to analyze and decide where to go
      const errorType = result.errorType || "general"
      const errorMsg = result.error || "Error al procesar el formulario"
      store.setLoading(false)
      store.setErrorStep(errorType, errorMsg)
    }
  } catch (error) {
    console.error("Error submitting form:", error)
    const errorMsg = error instanceof Error ? error.message : "Error desconocido al enviar el formulario"
    store.setLoading(false)
    store.setErrorStep("general", errorMsg)
  }
}

/**
 * Handler for Step 2: OTP token validation
 */
export async function handleStep2Submit(
  phone: string,
  token: string,
  store: Pick<WizardState, "nextStepAsync" | "updateFormData" | "setLoading" | "setErrorStep" | "formData">,
) {
  // Activate global loader
  store.setLoading(true)

  try {
    // Prepare data for server action
    const formDataToSubmit = {
      phone: phone.replace(/\s/g, ""),
      token: token,
      autorizacion: store.formData.autorizacion,
    }

    // Call server action to validate token
    const result = await submitStep2Form(formDataToSubmit)

    if (result.success) {
      // Update approved amount and idSolicitud from response if available
      if (result.approvedAmount !== undefined) {
        store.updateFormData({
          approvedAmount: result.approvedAmount,
          idSolicitud: result.idSolicitud || "",
        })
      }

      // If successful, advance to next step
      await store.nextStepAsync()
    } else {
      // Use setErrorStep to analyze and decide where to go
      const errorType = result.errorType || "token"
      const errorMsg = result.error || "Error validating token"
      store.setLoading(false)
      store.setErrorStep(errorType, errorMsg)
    }
  } catch (error) {
    console.error("Error submitting token:", error)
    const errorMsg = error instanceof Error ? error.message : "Unknown error validating token"
    store.setLoading(false)
    store.setErrorStep("token", errorMsg)
  }
}

/**
 * Handler for resending OTP token in Step 2
 */
export async function handleResendToken(
  phone: string,
  store: Pick<WizardState, "setLoading" | "setErrorStep">,
  onSuccess?: () => void,
) {
  // Prevent resend if already processing
  store.setLoading(true)

  try {
    const cleanPhone = phone.replace(/\s/g, "")
    const result = await resendToken(cleanPhone)

    if (result.success) {
      // Reset countdown callback
      if (onSuccess) {
        onSuccess()
      }
    } else {
      // If error, go to fallback
      const errorMsg = result.error || "Error resending token"
      store.setLoading(false)
      store.setErrorStep(result.errorType || "token", errorMsg)
    }
  } catch (error) {
    console.error("Error resending token:", error)
    const errorMsg = error instanceof Error ? error.message : "Unknown error resending token"
    store.setLoading(false)
    store.setErrorStep("token", errorMsg)
  } finally {
    store.setLoading(false)
  }
}

