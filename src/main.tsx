import React from "react"
import ReactDOM from "react-dom/client"
import { initSentryRenderer } from "./sentry"
import { initPostHog } from "./analytics"
import App from "./App"
import "./styles/globals.css"

initSentryRenderer()
initPostHog()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
