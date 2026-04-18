/**
 * electron/pro/license.ts — LemonSqueezy license key management
 *
 * Handles license activation, validation, and deactivation via LemonSqueezy API.
 * License data is persisted in electron store.
 */

import { hostname } from "os"
import { store } from "../store"

import { isInternalKey } from "./modules"

const LS_API = "https://api.lemonsqueezy.com/v1/licenses"
const LUANO_PRODUCT_ID = 937627

interface LicenseData {
  key: string
  instanceId: string
  valid: boolean
  customerName: string
  customerEmail: string
  activatedAt: string
  lastValidatedAt?: string
}

interface LSActivateResponse {
  activated: boolean
  instance: { id: string }
  meta: {
    store_id: number
    product_id: number
    customer_name: string
    customer_email: string
  }
  error?: string
}

interface LSValidateResponse {
  valid: boolean
  meta?: {
    store_id: number
    product_id: number
    customer_name: string
    customer_email: string
  }
  error?: string
}

function getStoredLicense(): LicenseData | null {
  return store.get<LicenseData>("license") ?? null
}

function storeLicense(data: LicenseData): void {
  store.set("license", data)
}

function clearLicense(): void {
  store.delete("license")
}

/** Machine identifier for LemonSqueezy instance tracking */
function getInstanceName(): string {
  return `${hostname()}-${process.platform}`
}

export async function activateLicense(key: string): Promise<{
  success: boolean
  error?: string
  customerName?: string
  customerEmail?: string
}> {
  // Internal dev key — skip API, activate permanently
  if (isInternalKey(key)) {
    storeLicense({
      key,
      instanceId: "internal",
      valid: true,
      customerName: "Developer",
      customerEmail: "",
      activatedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString()
    })
    return { success: true, customerName: "Developer" }
  }

  try {
    const res = await fetch(`${LS_API}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        license_key: key,
        instance_name: getInstanceName()
      })
    })

    const data = await res.json() as LSActivateResponse

    if (!res.ok || !data.activated) {
      return { success: false, error: data.error ?? "Activation failed" }
    }

    if (data.meta.product_id !== LUANO_PRODUCT_ID) {
      // Deactivate the wrongly-activated instance
      fetch(`${LS_API}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ license_key: key, instance_id: data.instance.id })
      }).catch(() => {})
      return { success: false, error: "This license key is not for Luano" }
    }

    storeLicense({
      key,
      instanceId: data.instance.id,
      valid: true,
      customerName: data.meta.customer_name,
      customerEmail: data.meta.customer_email,
      activatedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString()
    })

    return {
      success: true,
      customerName: data.meta.customer_name,
      customerEmail: data.meta.customer_email
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function validateLicense(): Promise<boolean> {
  const license = getStoredLicense()
  if (!license) return false

  // Internal dev key — always valid, no API call
  if (license.instanceId === "internal") {
    storeLicense({ ...license, valid: true, lastValidatedAt: new Date().toISOString() })
    return true
  }

  try {
    const res = await fetch(`${LS_API}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        license_key: license.key,
        instance_id: license.instanceId
      })
    })

    const data = await res.json() as LSValidateResponse

    if (data.valid && data.meta?.product_id === LUANO_PRODUCT_ID) {
      storeLicense({ ...license, valid: true, lastValidatedAt: new Date().toISOString() })
      return true
    }

    // License invalid — clear local data
    storeLicense({ ...license, valid: false })
    return false
  } catch {
    // Network error — 7-day offline grace period
    if (!license.valid) return false
    const lastValidated = license.lastValidatedAt
      ? new Date(license.lastValidatedAt).getTime()
      : 0
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    if (lastValidated > 0 && Date.now() - lastValidated < sevenDays) {
      return true
    }
    // Grace expired or no timestamp (pre-migration) — require revalidation
    storeLicense({ ...license, valid: false })
    return false
  }
}

export async function deactivateLicense(): Promise<{ success: boolean; error?: string }> {
  const license = getStoredLicense()
  if (!license) return { success: true }

  // Internal dev key — just clear locally, no API call
  if (license.instanceId === "internal") {
    clearLicense()
    return { success: true }
  }

  try {
    const res = await fetch(`${LS_API}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        license_key: license.key,
        instance_id: license.instanceId
      })
    })

    const data = await res.json() as { deactivated?: boolean; error?: string }

    if (!res.ok || !data.deactivated) {
      return { success: false, error: data.error ?? "Deactivation failed" }
    }

    clearLicense()
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export function getLicenseInfo(): {
  isActive: boolean
  customerName?: string
  customerEmail?: string
  activatedAt?: string
} {
  const license = getStoredLicense()
  if (!license || !license.valid) return { isActive: false }
  return {
    isActive: true,
    customerName: license.customerName,
    customerEmail: license.customerEmail,
    activatedAt: license.activatedAt
  }
}

export function hasValidLicense(): boolean {
  const license = getStoredLicense()
  return license !== null && license.valid
}
