import { useState, useEffect } from "react"
import { useProjectStore } from "../stores/projectStore"
import { useT } from "../i18n/useT"

interface ServiceUsage {
  name: string
  methods: string[]
}

interface RemoteLink {
  remoteName: string
  fireScripts: Array<{ path: string; kind: string }>
  handleScripts: Array<{ path: string; kind: string }>
}

interface ScriptAnalysis {
  path: string
  relPath: string
  kind: "server" | "client" | "shared"
  services: ServiceUsage[]
  remotesFired: string[]
  remotesHandled: string[]
  requires: string[]
}

interface PerfWarning {
  file: string
  line: number
  rule: string
  message: string
  severity: "error" | "warn" | "info"
  suggestion?: string
}

type Tab = "remotes" | "services" | "perf"

const KIND_COLORS = {
  server: "#22c55e",
  client: "#3b82f6",
  shared: "#a855f7"
}

const SEV_COLORS = {
  error: { bg: "#2d1515", text: "#fca5a5", border: "#7f1d1d" },
  warn: { bg: "#2d2415", text: "#fcd34d", border: "#78350f" },
  info: { bg: "#112030", text: "#93c5fd", border: "#1e3a5a" }
}

export function CrossScriptPanel(): JSX.Element {
  const { projectPath, openFile } = useProjectStore()
  const [tab, setTab] = useState<Tab>("remotes")
  const [remoteLinks, setRemoteLinks] = useState<RemoteLink[]>([])
  const [scripts, setScripts] = useState<ScriptAnalysis[]>([])
  const [perfWarnings, setPerfWarnings] = useState<PerfWarning[]>([])
  const [loading, setLoading] = useState(false)
  const t = useT()

  const analyze = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [crossResult, perfResult] = await Promise.all([
        window.api.analyzeCrossScript(projectPath),
        window.api.perfLint(projectPath)
      ])
      setRemoteLinks((crossResult as { remoteLinks: RemoteLink[] }).remoteLinks)
      setScripts((crossResult as { scripts: ScriptAnalysis[] }).scripts)
      setPerfWarnings(perfResult as PerfWarning[])
    } catch (err) {
      console.error("[CrossScript] Analysis failed:", err)
    }
    setLoading(false)
  }

  useEffect(() => { analyze() }, [projectPath])

  const handleOpenFile = async (filePath: string) => {
    try {
      const content = await window.api.readFile(filePath)
      openFile(filePath, content ?? "")
    } catch {}
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-panel)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t("analysis")}</span>
        <div className="ml-auto">
          <button
            onClick={analyze}
            disabled={loading}
            className="px-2 py-0.5 text-[10px] rounded transition-colors"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? "..." : t("refresh")}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {(["remotes", "services", "perf"] as Tab[]).map((tabId) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className="flex-1 py-1.5 text-[10px] font-medium transition-colors"
            style={{
              color: tab === tabId ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === tabId ? "2px solid var(--accent)" : "2px solid transparent",
              background: "transparent"
            }}
          >
            {tabId === "remotes" ? `${t("remotes")} (${remoteLinks.length})` :
             tabId === "services" ? t("services") :
             `${t("perf")} (${perfWarnings.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "remotes" && (
          <div className="flex flex-col gap-2">
            {remoteLinks.length === 0 && (
              <p className="text-[11px] text-center py-4" style={{ color: "var(--text-muted)" }}>
                {t("noRemotes")}
              </p>
            )}
            {remoteLinks.map((link) => (
              <div
                key={link.remoteName}
                className="rounded-lg p-2"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  <span className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {link.remoteName}
                  </span>
                </div>

                {link.fireScripts.length > 0 && (
                  <div className="mb-1">
                    <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>{t("fire")}</span>
                    {link.fireScripts.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleOpenFile(s.path)}
                        className="block w-full text-left text-[10px] px-1.5 py-0.5 rounded hover:bg-white/5 truncate"
                        style={{ color: KIND_COLORS[scripts.find((sc) => sc.relPath === s.path)?.kind ?? "shared"] }}
                      >
                        {s.path} <span style={{ color: "var(--text-muted)" }}>({s.kind})</span>
                      </button>
                    ))}
                  </div>
                )}

                {link.handleScripts.length > 0 && (
                  <div>
                    <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>{t("handle")}</span>
                    {link.handleScripts.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleOpenFile(s.path)}
                        className="block w-full text-left text-[10px] px-1.5 py-0.5 rounded hover:bg-white/5 truncate"
                        style={{ color: KIND_COLORS[scripts.find((sc) => sc.relPath === s.path)?.kind ?? "shared"] }}
                      >
                        {s.path} <span style={{ color: "var(--text-muted)" }}>({s.kind})</span>
                      </button>
                    ))}
                  </div>
                )}

                {link.handleScripts.length === 0 && (
                  <div className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#fca5a5", background: "#2d151580" }}>
                    {t("noHandler")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "services" && (
          <div className="flex flex-col gap-1">
            {scripts.filter((s) => s.services.length > 0).map((script) => (
              <button
                key={script.relPath}
                onClick={() => handleOpenFile(script.path)}
                className="text-left rounded-lg p-2 hover:bg-white/5 transition-colors"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: KIND_COLORS[script.kind] }} />
                  <span className="text-[10px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {script.relPath}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {script.services.map((svc) => (
                    <span
                      key={svc.name}
                      className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg-base)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                    >
                      {svc.name}
                      {svc.methods.length > 0 && (
                        <span style={{ color: "var(--text-muted)" }}> .{svc.methods.slice(0, 3).join(", .")}</span>
                      )}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === "perf" && (
          <div className="flex flex-col gap-1">
            {perfWarnings.length === 0 && (
              <p className="text-[11px] text-center py-4" style={{ color: "var(--text-muted)" }}>
                {t("noPerfWarnings")}
              </p>
            )}
            {perfWarnings.map((w, i) => {
              const c = SEV_COLORS[w.severity]
              return (
                <button
                  key={i}
                  onClick={() => handleOpenFile(w.file)}
                  className="text-left rounded-lg p-2 transition-colors hover:brightness-110"
                  style={{ background: c.bg, border: `1px solid ${c.border}` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase" style={{ color: c.text }}>
                      {w.severity}
                    </span>
                    <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                      {w.file}:{w.line}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: c.text }}>{w.message}</p>
                  {w.suggestion && (
                    <p className="text-[9px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>
                      {w.suggestion}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
