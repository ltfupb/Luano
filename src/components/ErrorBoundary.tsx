import { Component, ErrorInfo, ReactNode } from "react"
import { translations, Lang } from "../i18n/translations"
import { useSettingsStore } from "../stores/settingsStore"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

function getT(key: keyof typeof translations.en): string {
  const lang = (useSettingsStore.getState().language as Lang) in translations
    ? (useSettingsStore.getState().language as Lang)
    : "en"
  return translations[lang][key] ?? translations.en[key]
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div
          className="flex flex-col items-center justify-center gap-4 p-8 h-full"
          style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
        >
          <div className="w-12 h-12 rounded-xl bg-red-950 border border-red-800 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-red-400">{getT("uiError")}</p>
            <p className="text-xs mt-1 max-w-sm font-mono" style={{ color: "var(--text-muted)" }}>
              {this.state.error?.message ?? "Unknown error"}
            </p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-1.5 text-xs rounded-lg bg-[#1a2d45] hover:bg-[#1e3a5a] transition-colors"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {getT("retry")}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
