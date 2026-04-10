import React from "react"
import ReactDOM from "react-dom/client"
import { initSentryRenderer } from "./sentry"
import App from "./App"
import "./styles/globals.css"

initSentryRenderer()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
