import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock electron store before importing license module
vi.mock("../electron/store", () => {
  const data: Record<string, unknown> = {}
  return {
    store: {
      get: vi.fn((key: string) => data[key]),
      set: vi.fn((key: string, value: unknown) => { data[key] = value }),
      delete: vi.fn((key: string) => { delete data[key] }),
      _data: data,
      _clear: () => { Object.keys(data).forEach((k) => delete data[k]) }
    }
  }
})

// Mock os.hostname
vi.mock("os", () => ({ hostname: () => "test-host" }))

import { activateLicense, validateLicense, deactivateLicense, getLicenseInfo, hasValidLicense } from "../electron/pro/license"
import { store } from "../electron/store"

const mockStore = store as unknown as {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  _data: Record<string, unknown>
  _clear: () => void
}

beforeEach(() => {
  mockStore._clear()
  vi.restoreAllMocks()
})

describe("activateLicense", () => {
  it("activates a valid license key", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        activated: true,
        instance: { id: "inst_123" },
        meta: {
          store_id: 1,
          product_id: 937627,
          customer_name: "Test User",
          customer_email: "test@example.com"
        }
      })
    }) as unknown as typeof fetch

    const result = await activateLicense("test-key-123")
    expect(result.success).toBe(true)
    expect(result.customerName).toBe("Test User")
    expect(mockStore.set).toHaveBeenCalledWith("license", expect.objectContaining({
      key: "test-key-123",
      instanceId: "inst_123",
      valid: true,
      lastValidatedAt: expect.any(String)
    }))
  })

  it("rejects wrong product_id", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          activated: true,
          instance: { id: "inst_123" },
          meta: { store_id: 1, product_id: 999999, customer_name: "X", customer_email: "x@x.com" }
        })
      })
      // Second call is the deactivation
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as unknown as typeof fetch

    const result = await activateLicense("wrong-key")
    expect(result.success).toBe(false)
    expect(result.error).toContain("not for Luano")
  })

  it("handles network errors", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failed")) as unknown as typeof fetch

    const result = await activateLicense("test-key")
    expect(result.success).toBe(false)
    expect(result.error).toBe("Network failed")
  })
})

describe("validateLicense", () => {
  it("returns false when no license stored", async () => {
    expect(await validateLicense()).toBe(false)
  })

  it("validates a good license and updates lastValidatedAt", async () => {
    mockStore._data.license = {
      key: "key", instanceId: "inst", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01T00:00:00Z",
      lastValidatedAt: "2026-01-01T00:00:00Z"
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        meta: { store_id: 1, product_id: 937627, customer_name: "T", customer_email: "t@t.com" }
      })
    }) as unknown as typeof fetch

    expect(await validateLicense()).toBe(true)
    expect(mockStore.set).toHaveBeenCalledWith("license", expect.objectContaining({
      valid: true,
      lastValidatedAt: expect.any(String)
    }))
  })

  it("marks license invalid when API says invalid", async () => {
    mockStore._data.license = {
      key: "key", instanceId: "inst", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01T00:00:00Z"
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: false })
    }) as unknown as typeof fetch

    expect(await validateLicense()).toBe(false)
  })

  it("allows offline grace within 7 days", async () => {
    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    mockStore._data.license = {
      key: "key", instanceId: "inst", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01T00:00:00Z",
      lastValidatedAt: recentDate
    }

    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch

    expect(await validateLicense()).toBe(true)
  })

  it("rejects offline grace after 7 days", async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    mockStore._data.license = {
      key: "key", instanceId: "inst", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01T00:00:00Z",
      lastValidatedAt: oldDate
    }

    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch

    expect(await validateLicense()).toBe(false)
  })

  it("rejects offline grace with no lastValidatedAt (pre-migration)", async () => {
    mockStore._data.license = {
      key: "key", instanceId: "inst", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01T00:00:00Z"
    }

    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch

    expect(await validateLicense()).toBe(false)
  })
})

describe("deactivateLicense", () => {
  it("clears license on success", async () => {
    mockStore._data.license = {
      key: "key", instanceId: "inst", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01T00:00:00Z"
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deactivated: true })
    }) as unknown as typeof fetch

    const result = await deactivateLicense()
    expect(result.success).toBe(true)
    expect(mockStore.delete).toHaveBeenCalledWith("license")
  })

  it("succeeds when no license stored", async () => {
    const result = await deactivateLicense()
    expect(result.success).toBe(true)
  })
})

describe("getLicenseInfo", () => {
  it("returns inactive when no license", () => {
    expect(getLicenseInfo()).toEqual({ isActive: false })
  })

  it("returns active with customer info", () => {
    mockStore._data.license = {
      key: "k", instanceId: "i", valid: true,
      customerName: "Test", customerEmail: "t@t.com",
      activatedAt: "2026-01-01"
    }
    const info = getLicenseInfo()
    expect(info.isActive).toBe(true)
    expect(info.customerName).toBe("Test")
  })
})

describe("hasValidLicense", () => {
  it("returns false when no license", () => {
    expect(hasValidLicense()).toBe(false)
  })

  it("returns true when valid license stored", () => {
    mockStore._data.license = {
      key: "k", instanceId: "i", valid: true,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01"
    }
    expect(hasValidLicense()).toBe(true)
  })

  it("returns false when license marked invalid", () => {
    mockStore._data.license = {
      key: "k", instanceId: "i", valid: false,
      customerName: "T", customerEmail: "t@t.com",
      activatedAt: "2026-01-01"
    }
    expect(hasValidLicense()).toBe(false)
  })
})
