/**
 * e2e/app.spec.ts — Basic Electron app E2E tests
 *
 * Tests that the app launches, renders, and basic UI interactions work.
 * Uses Playwright's Electron support.
 */

import { test, expect, type ElectronApplication, type Page } from "@playwright/test"
import { _electron as electron } from "playwright"
import { resolve } from "path"

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // Build first if needed — assumes `npm run build` was run
  app = await electron.launch({
    args: [resolve(__dirname, "../out/main/index.js")],
    env: { ...process.env, NODE_ENV: "test" }
  })
  page = await app.firstWindow()
  // Wait for the app to fully render
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await app?.close()
})

test("app launches and has a window", async () => {
  const title = await page.title()
  expect(title).toBeTruthy()
  const windows = app.windows()
  expect(windows.length).toBeGreaterThanOrEqual(1)
})

test("app window has correct minimum size", async () => {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 }
  expect(width).toBeGreaterThanOrEqual(900)
  expect(height).toBeGreaterThanOrEqual(600)
})

test("sidebar is visible", async () => {
  // The sidebar should have navigation items
  const sidebar = page.locator('[class*="flex"][class*="flex-col"]').first()
  await expect(sidebar).toBeVisible()
})

test("welcome screen or editor is shown", async () => {
  // Either the welcome screen or the editor pane should be visible
  const welcomeText = page.getByText("Welcome to Luano")
  const editorPane = page.getByText("Open a file to edit")
  const hasWelcome = await welcomeText.isVisible().catch(() => false)
  const hasEditor = await editorPane.isVisible().catch(() => false)
  expect(hasWelcome || hasEditor).toBeTruthy()
})

test("settings panel opens and closes", async () => {
  // Find and click settings button (gear icon)
  const settingsBtn = page.getByText("Settings").first()
  if (await settingsBtn.isVisible().catch(() => false)) {
    await settingsBtn.click()
    await page.waitForTimeout(300)

    // Settings panel should be visible
    const settingsPanel = page.getByText("AI Provider")
    await expect(settingsPanel).toBeVisible({ timeout: 3000 })

    // Check all 4 provider buttons exist
    await expect(page.getByText("Anthropic")).toBeVisible()
    await expect(page.getByText("OpenAI")).toBeVisible()
    await expect(page.getByText("Gemini")).toBeVisible()
    await expect(page.getByText("Local")).toBeVisible()

    // Close settings
    const closeBtn = page.locator("svg").filter({ has: page.locator("line") }).first()
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
      await page.waitForTimeout(300)
    }
  }
})
