import React from "react"
import ReactDOM from "react-dom/client"
import { initSentryRenderer } from "./sentry"
import { initPostHog } from "./analytics"
import App from "./App"
import { useSettingsStore } from "./stores/settingsStore"
import "./styles/globals.css"

initSentryRenderer()
initPostHog()

// H17a: rehydrate Zustand persist store BEFORE first render so the correct
// theme is applied without a flash. Without this await, the initial render
// uses the default "dark" theme for ~100ms before the persisted value lands.
async function mount(): Promise<void> {
  await useSettingsStore.persist.rehydrate()
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void mount()
