/**
 * src/lib/loadPro.tsx — Centralized Pro component loader (renderer)
 *
 * Uses Vite's import.meta.glob to discover optional Pro-only components.
 * In Free edition these files are absent; typed placeholders are used.
 */

import { lazy, Suspense, type ComponentType, type FC } from "react"

function ProPlaceholder({ name }: { name: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)", fontSize: 12 }}>
      {name} requires Luano Pro — upgrade at luano.dev/pricing
    </div>
  )
}

// ── Panel loader ─────────────────────────────────────────────────────────────

const panelModules = import.meta.glob<Record<string, ComponentType>>([
  "../analysis/CrossScriptPanel.tsx",
  "../datastore/DataStorePanel.tsx",
  "../topology/TopologyPanel.tsx",
])

function loadProPanel(path: string, exportName: string, fallback: string): FC {
  const loader = panelModules[path]
  if (!loader) {
    const Placeholder: FC = function ProPanelPlaceholder() { return <ProPlaceholder name={fallback} /> }
    return Placeholder
  }
  const Lazy = lazy(() =>
    loader().then(m => ({ default: (m[exportName] as ComponentType) ?? (() => <ProPlaceholder name={fallback} />) }))
  )
  const Wrapper: FC = function ProPanelWrapper() { return <Suspense fallback={null}><Lazy /></Suspense> }
  return Wrapper
}

// CrossScriptPanel needs props (onShowTopology), so use typed loader
function loadProPanelWithProps<P>(path: string, exportName: string, fallback: string): ComponentType<P> {
  const loader = panelModules[path]
  if (!loader) {
    const Placeholder: ComponentType<P> = function ProPanelPlaceholder() { return <ProPlaceholder name={fallback} /> }
    return Placeholder
  }
  const Lazy = lazy(() =>
    loader().then(m => ({ default: (m[exportName] as ComponentType<P>) ?? (() => <ProPlaceholder name={fallback} />) }))
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function ProPanelWrapper(props: P) { return <Suspense fallback={null}><Lazy {...(props as any)} /></Suspense> }
}

export const CrossScriptPanel = loadProPanelWithProps<{ onShowTopology?: (show: boolean) => void }>(
  "../analysis/CrossScriptPanel.tsx", "CrossScriptPanel", "Analysis"
)
export const DataStorePanel = loadProPanel("../datastore/DataStorePanel.tsx", "DataStorePanel", "DataStore")
export const TopologyPanel = loadProPanel("../topology/TopologyPanel.tsx", "TopologyPanel", "Topology")

// ── Component loader ─────────────────────────────────────────────────────────

const componentModules = import.meta.glob<Record<string, ComponentType>>([
  "../ai/DiffView.tsx",
  "../ai/InlineEditOverlay.tsx",
])

function ProComponentLoading(): JSX.Element {
  // Visible fallback while a lazy Pro component's chunk loads. Without this,
  // pressing Ctrl+K on a cold start was rendering nothing (Suspense fallback=null)
  // for the 100-500ms the chunk takes to resolve — perceived as "nothing happened".
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--bg-base)", color: "var(--text-muted)", fontSize: 12 }}
    >
      <span className="animate-spin inline-block mr-2">⟳</span>
      Loading…
    </div>
  )
}

function loadProComponent<P>(path: string, exportName: string): ComponentType<P> | null {
  const loader = componentModules[path]
  if (!loader) return null
  const Lazy = lazy(() => loader().then(m => ({ default: m[exportName] as ComponentType<P> })))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function ProComponentWrapper(props: P) { return <Suspense fallback={<ProComponentLoading />}><Lazy {...(props as any)} /></Suspense> }
  return ProComponentWrapper as ComponentType<P>
}

export const DiffView = loadProComponent<{ original: string; modified: string }>(
  "../ai/DiffView.tsx", "DiffView"
)

export const InlineEditOverlay = loadProComponent<{
  filePath: string; content: string; isSelection?: boolean;
  onAccept: (code: string) => void; onClose: () => void
}>("../ai/InlineEditOverlay.tsx", "InlineEditOverlay")
