interface LicenseApi {
  getProStatus: () => Promise<{
    isPro: boolean
    features: Record<string, boolean>
  }>
  licenseActivate: (key: string) => Promise<{
    success: boolean
    error?: string
    customerName?: string
    customerEmail?: string
  }>
  licenseDeactivate: () => Promise<{ success: boolean; error?: string }>
  licenseInfo: () => Promise<{
    isActive: boolean
    customerName?: string
    customerEmail?: string
    activatedAt?: string
  }>
  licenseValidate: () => Promise<{ valid: boolean }>
}
