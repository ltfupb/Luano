/**
 * tests/settings-panel-deactivate.test.tsx — SettingsPanel license deactivate flow
 *
 * Covers the deactivate confirmation state machine:
 *   idle → confirm-prompt → deactivate (success) → idle
 *   idle → confirm-prompt → deactivate (failure) → error shown
 *   idle → confirm-prompt → cancel → idle
 */

import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

void React

// ── Stub window.api before importing the component ──────────────────────────

const mockApi = {
  aiGetProviderModel: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    models: { anthropic: [], openai: [], gemini: [], local: [] },
  }),
  aiGetAdvisor: vi.fn().mockResolvedValue(false),
  aiGetThinkingEffort: vi.fn().mockResolvedValue("medium"),
  aiGetLocalKey: vi.fn().mockResolvedValue(""),
  skillsLoad: vi.fn().mockResolvedValue([]),
  telemetryIsEnabled: vi.fn().mockResolvedValue(false),
  crashReportsIsEnabled: vi.fn().mockResolvedValue(false),
  analyticsUsageIsEnabled: vi.fn().mockResolvedValue(false),
  getProStatus: vi.fn().mockResolvedValue({ isPro: true }),
  licenseInfo: vi.fn().mockResolvedValue({
    isActive: true,
    customerName: "Test User",
    customerEmail: "test@example.com",
  }),
  licenseDeactivate: vi.fn(),
  licenseActivate: vi.fn(),
  aiSetAdvisor: vi.fn().mockResolvedValue(undefined),
  crashReportsSetEnabled: vi.fn().mockResolvedValue(undefined),
  analyticsUsageSetEnabled: vi.fn().mockResolvedValue(undefined),
  telemetrySetEnabled: vi.fn().mockResolvedValue(undefined),
}

// @ts-expect-error — partial mock for tests
globalThis.window = globalThis.window ?? {}
// @ts-expect-error — partial mock
window.api = mockApi

// Import AFTER window.api is set so the component sees the mock
import { SettingsPanel } from "../src/components/SettingsPanel"

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.licenseInfo.mockResolvedValue({
    isActive: true,
    customerName: "Test User",
    customerEmail: "test@example.com",
  })
  mockApi.getProStatus.mockResolvedValue({ isPro: true })
})

describe("SettingsPanel license deactivate state machine", () => {
  it("initial render shows 'Deactivate License' button, no confirm prompt", async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    // Wait for licenseInfo to resolve
    expect(await screen.findByRole("button", { name: /deactivate/i })).toBeInTheDocument()
    expect(screen.queryByText(/this will remove pro/i)).not.toBeInTheDocument()
  })

  it("clicking Deactivate shows confirmation prompt with Yes and Cancel buttons", async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    const deactivateBtn = await screen.findByRole("button", { name: /deactivate license/i })
    fireEvent.click(deactivateBtn)
    expect(screen.getByText(/this will remove pro/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /yes, deactivate/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
  })

  it("Cancel resets to idle without calling licenseDeactivate", async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    const deactivateBtn = await screen.findByRole("button", { name: /deactivate license/i })
    fireEvent.click(deactivateBtn)
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(mockApi.licenseDeactivate).not.toHaveBeenCalled()
    expect(await screen.findByRole("button", { name: /deactivate license/i })).toBeInTheDocument()
    expect(screen.queryByText(/this will remove pro/i)).not.toBeInTheDocument()
  })

  it("successful deactivate clears Pro status and exits confirm state", async () => {
    mockApi.licenseDeactivate.mockResolvedValue({ success: true })
    render(<SettingsPanel onClose={vi.fn()} />)
    const deactivateBtn = await screen.findByRole("button", { name: /deactivate license/i })
    fireEvent.click(deactivateBtn)
    fireEvent.click(screen.getByRole("button", { name: /yes, deactivate/i }))
    await waitFor(() => {
      expect(mockApi.licenseDeactivate).toHaveBeenCalledTimes(1)
    })
    // After success, confirm prompt should be gone
    await waitFor(() => {
      expect(screen.queryByText(/this will remove pro/i)).not.toBeInTheDocument()
    })
  })

  it("failed deactivate surfaces error via setLicenseError (no silent success)", async () => {
    mockApi.licenseDeactivate.mockResolvedValue({ success: false, error: "Network down" })
    render(<SettingsPanel onClose={vi.fn()} />)
    const deactivateBtn = await screen.findByRole("button", { name: /deactivate license/i })
    fireEvent.click(deactivateBtn)
    fireEvent.click(screen.getByRole("button", { name: /yes, deactivate/i }))
    await waitFor(() => {
      expect(mockApi.licenseDeactivate).toHaveBeenCalled()
    })
    // Error text should appear somewhere
    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeInTheDocument()
    })
  })

  it("failed deactivate without explicit error still shows a fallback message", async () => {
    mockApi.licenseDeactivate.mockResolvedValue({ success: false })
    render(<SettingsPanel onClose={vi.fn()} />)
    const deactivateBtn = await screen.findByRole("button", { name: /deactivate license/i })
    fireEvent.click(deactivateBtn)
    fireEvent.click(screen.getByRole("button", { name: /yes, deactivate/i }))
    await waitFor(() => {
      expect(screen.getByText(/deactivation failed/i)).toBeInTheDocument()
    })
  })
})

describe("SettingsPanel onProActivated callback", () => {
  it("successful license activation fires onProActivated", async () => {
    // Start with inactive license
    mockApi.licenseInfo.mockResolvedValue({ isActive: false })
    mockApi.getProStatus.mockResolvedValue({ isPro: false })
    mockApi.licenseActivate.mockResolvedValue({
      success: true,
      customerName: "Test User",
      customerEmail: "test@example.com",
    })
    const onProActivated = vi.fn()
    render(<SettingsPanel onClose={vi.fn()} onProActivated={onProActivated} />)

    // Find the input and Activate button
    const input = await screen.findByPlaceholderText(/enter license key/i)
    fireEvent.change(input, { target: { value: "TEST-KEY-12345" } })
    const activateBtn = screen.getByRole("button", { name: /^activate$/i })
    fireEvent.click(activateBtn)

    await waitFor(() => {
      expect(mockApi.licenseActivate).toHaveBeenCalledWith("TEST-KEY-12345")
    })
    await waitFor(() => {
      expect(onProActivated).toHaveBeenCalledTimes(1)
    })
  })

  it("failed license activation does NOT fire onProActivated", async () => {
    mockApi.licenseInfo.mockResolvedValue({ isActive: false })
    mockApi.getProStatus.mockResolvedValue({ isPro: false })
    mockApi.licenseActivate.mockResolvedValue({
      success: false,
      error: "Invalid key",
    })
    const onProActivated = vi.fn()
    render(<SettingsPanel onClose={vi.fn()} onProActivated={onProActivated} />)

    const input = await screen.findByPlaceholderText(/enter license key/i)
    fireEvent.change(input, { target: { value: "BAD-KEY" } })
    fireEvent.click(screen.getByRole("button", { name: /^activate$/i }))

    await waitFor(() => {
      expect(mockApi.licenseActivate).toHaveBeenCalled()
    })
    expect(onProActivated).not.toHaveBeenCalled()
  })
})
