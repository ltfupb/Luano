import { useState, useEffect, useRef, useCallback } from "react"
import { useProjectStore } from "../stores/projectStore"

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W = 148
const NODE_H = 32
const COL_SERVER = 80
const COL_REMOTE = 400
const COL_CLIENT = 700
const NODE_V_GAP = 5
const GROUP_HEADER_H = 18
const GROUP_PAD = 7
const GROUP_GAP = 12
const ROW_START = 60

// ── Colors ────────────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<EdgeKind, string> = {
  require:          "#334155",
  fire_server:      "#f97316",
  fire_client:      "#3b82f6",
  fire_all:         "#a855f7",
  receives_server:  "#f97316",
  receives_client:  "#3b82f6"
}

const KIND_BG: Record<ScriptKind, string> = {
  server: "rgba(59,130,246,0.12)",
  client: "rgba(16,185,129,0.12)",
  shared: "rgba(148,163,184,0.10)"
}

const KIND_BORDER: Record<ScriptKind, string> = {
  server: "rgba(59,130,246,0.45)",
  client: "rgba(16,185,129,0.45)",
  shared: "rgba(148,163,184,0.3)"
}

const KIND_TEXT: Record<ScriptKind, string> = {
  server: "#93c5fd",
  client: "#6ee7b7",
  shared: "#94a3b8"
}

// ── Layout ────────────────────────────────────────────────────────────────────

interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  kind: ScriptKind | "remote"
  path?: string
}

interface LayoutGroup {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  kind: ScriptKind | "remote"
}

function groupBoxHeight(nodeCount: number): number {
  return GROUP_HEADER_H + GROUP_PAD + nodeCount * (NODE_H + NODE_V_GAP) - NODE_V_GAP + GROUP_PAD
}

// Build ordered groups: root ("") comes last, rest alphabetical
function buildGroups(scripts: TopologyScriptNode[]): Map<string, TopologyScriptNode[]> {
  const map = new Map<string, TopologyScriptNode[]>()
  for (const s of scripts) {
    const key = s.group
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  // Sort: named groups first (alpha), root "" last
  const sorted = new Map<string, TopologyScriptNode[]>()
  const keys = [...map.keys()].sort((a, b) => {
    if (a === "" && b !== "") return 1
    if (b === "" && a !== "") return -1
    return a.localeCompare(b)
  })
  for (const k of keys) sorted.set(k, map.get(k)!)
  return sorted
}

function layoutColumn(
  scripts: TopologyScriptNode[],
  kind: ScriptKind,
  colX: number,
  startY: number
): { nodes: LayoutNode[]; groups: LayoutGroup[]; totalHeight: number } {
  const nodes: LayoutNode[] = []
  const groups: LayoutGroup[] = []
  const grouped = buildGroups(scripts)
  let curY = startY

  for (const [groupName, members] of grouped) {
    const boxH = groupBoxHeight(members.length)
    const label = groupName === "" ? kind.charAt(0).toUpperCase() + kind.slice(1) : groupName

    groups.push({
      id: `grp-${kind}-${groupName || "_root"}`,
      x: colX - 8, y: curY,
      width: NODE_W + 16, height: boxH,
      label, kind
    })

    members.forEach((s, i) => {
      nodes.push({
        id: s.id,
        x: colX,
        y: curY + GROUP_HEADER_H + GROUP_PAD + i * (NODE_H + NODE_V_GAP),
        width: NODE_W, height: NODE_H,
        label: s.name, kind, path: s.path
      })
    })

    curY += boxH + GROUP_GAP
  }

  return { nodes, groups, totalHeight: curY - startY }
}

function computeLayout(result: TopologyResult): {
  nodes: LayoutNode[]
  groups: LayoutGroup[]
  canvasH: number
} {
  const servers = result.scripts.filter((s) => s.kind === "server")
  const clients = result.scripts.filter((s) => s.kind === "client")
  const shared  = result.scripts.filter((s) => s.kind === "shared")

  const serverLayout = layoutColumn(servers, "server", COL_SERVER, ROW_START)
  const clientLayout = layoutColumn(clients, "client", COL_CLIENT, ROW_START)

  // Remotes: same group-box rhythm as server/client columns
  const remoteNodes: LayoutNode[] = result.remotes.map((r, i) => ({
    id: r.id,
    x: COL_REMOTE,
    y: ROW_START + GROUP_HEADER_H + GROUP_PAD + i * (NODE_H + NODE_V_GAP),
    width: NODE_W - 20, height: NODE_H,
    label: r.name, kind: "remote" as const
  }))
  const remotesBoxH = result.remotes.length > 0 ? groupBoxHeight(result.remotes.length) : 0

  // Shared: row of groups below
  const sharedBaseY = ROW_START + Math.max(
    serverLayout.totalHeight, clientLayout.totalHeight, remotesBoxH, 40
  ) + 40
  const sharedLayout = shared.length > 0
    ? layoutColumn(shared, "shared", COL_SERVER, sharedBaseY)
    : { nodes: [], groups: [], totalHeight: 0 }

  const nodes = [...serverLayout.nodes, ...clientLayout.nodes, ...remoteNodes, ...sharedLayout.nodes]
  const groups = [...serverLayout.groups, ...clientLayout.groups, ...sharedLayout.groups]
  const canvasH = sharedBaseY + sharedLayout.totalHeight + 60

  return { nodes, groups, canvasH }
}

// ── SVG Helpers ───────────────────────────────────────────────────────────────

function nodeCenterY(node: LayoutNode): number {
  return node.y + node.height / 2
}

function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2
  return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ScriptIcon({ kind }: { kind: ScriptKind | "remote" }): JSX.Element {
  if (kind === "remote") return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
      <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
    </svg>
  )
  if (kind === "server") return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2">
      <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  )
  if (kind === "client") return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <polyline points="8 21 12 17 16 21"/>
    </svg>
  )
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TopologyPanel(): JSX.Element {
  const { projectPath, openFile } = useProjectStore()
  const [result, setResult] = useState<TopologyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Pan/Zoom state
  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 1 })
  const svgRef = useRef<SVGSVGElement>(null)
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  const analyze = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const r = await window.api.analyzeTopology(projectPath)
      setResult(r)
    } catch (err) {
      console.error("[Topology]", err)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => { analyze() }, [analyze])

  // Wheel zoom — must be registered with { passive: false } so preventDefault works.
  // React's onWheel prop attaches a passive listener (React 17+), which silently
  // ignores preventDefault and logs the warning. We use a direct addEventListener instead.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      setTransform((t) => {
        const newScale = Math.max(0.2, Math.min(3, t.scale * factor))
        const wx = (mouseX - t.x) / t.scale
        const wy = (mouseY - t.y) / t.scale
        return {
          scale: newScale,
          x: mouseX - wx * newScale,
          y: mouseY - wy * newScale
        }
      })
    }
    svg.addEventListener("wheel", handler, { passive: false })
    return () => svg.removeEventListener("wheel", handler)
  }, [result]) // re-run after result loads so svgRef.current is not null

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isPanning.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }, [])

  const onMouseUp = useCallback(() => { isPanning.current = false }, [])

  const fitView = useCallback(() => {
    setTransform({ x: 20, y: 20, scale: 1 })
  }, [])

  const handleNodeClick = useCallback(async (node: LayoutNode) => {
    if (!node.path) return
    try {
      const content = await window.api.readFile(node.path)
      openFile(node.path, content)
    } catch {}
  }, [openFile])

  if (!projectPath) {
    return (
      <div className="flex-1 w-full flex items-center justify-center" style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Open a project first
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 w-full flex items-center justify-center" style={{ color: "var(--text-muted)", fontSize: 12 }}>
        <span className="text-shimmer">Analyzing scripts…</span>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex-1 w-full flex items-center justify-center flex-col gap-3">
        <button
          onClick={analyze}
          className="px-4 py-1.5 rounded-md text-xs"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Analyze
        </button>
      </div>
    )
  }

  const { nodes, groups, canvasH } = computeLayout(result)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const canvasW = COL_CLIENT + NODE_W + 80

  // Determine which nodes/edges are highlighted on hover
  const highlightedEdgeIds = new Set<string>()
  const highlightedNodeIds = new Set<string>()
  if (hoveredId) {
    highlightedNodeIds.add(hoveredId)
    for (const e of result.edges) {
      if (e.source === hoveredId || e.target === hoveredId) {
        highlightedEdgeIds.add(e.id)
        highlightedNodeIds.add(e.source)
        highlightedNodeIds.add(e.target)
      }
    }
  }
  const dimming = hoveredId !== null

  // Unhandled remotes — no receives_* edge
  const unhandledRemoteIds = new Set<string>()
  for (const r of result.remotes) {
    const hasHandler = result.edges.some(
      e => (e.kind === "receives_server" || e.kind === "receives_client") &&
           (e.source === r.id || e.target === r.id)
    )
    if (!hasHandler) unhandledRemoteIds.add(r.id)
  }

  const servers = result.scripts.filter((s) => s.kind === "server")
  const clients = result.scripts.filter((s) => s.kind === "client")
  const shared  = result.scripts.filter((s) => s.kind === "shared")

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
            Script Topology
          </span>
          <div className="flex items-center gap-2">
            <Dot color="#93c5fd" label={`${servers.length} Server`} />
            <Dot color="#6ee7b7" label={`${clients.length} Client`} />
            <Dot color="#94a3b8" label={`${shared.length} Shared`} />
            <Dot color="#f59e0b" label={`${result.remotes.length} Remote`} />
            {unhandledRemoteIds.size > 0 && (
              <span style={{ fontSize: 10, color: "#fca5a5", fontWeight: 600 }}>
                {unhandledRemoteIds.size} no handler
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ZoomBtn label="−" onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.2, t.scale * 0.8) }))} />
          <ZoomBtn label="⊡" onClick={fitView} title="Fit" />
          <ZoomBtn label="+" onClick={() => setTransform((t) => ({ ...t, scale: Math.min(3, t.scale * 1.2) }))} />
          <button
            onClick={analyze}
            className="ml-1 px-2 py-0.5 rounded text-xs"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            ↺
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden relative" style={{ cursor: isPanning.current ? "grabbing" : "grab" }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <defs>
            {(["orange", "blue", "purple"] as const).map((c) => {
              const fill = c === "orange" ? "#f97316" : c === "blue" ? "#3b82f6" : "#a855f7"
              return (
                <marker key={c} id={`arrow-${c}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M 0 0 L 6 3 L 0 6 Z" fill={fill} />
                </marker>
              )
            })}
            <marker id="arrow-gray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M 0 0 L 6 3 L 0 6 Z" fill="#334155" />
            </marker>
          </defs>

          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
            {/* Background grid */}
            <GridBackground width={canvasW} height={canvasH} />

            {/* Zone backgrounds */}
            <ZoneBg x={COL_SERVER - 24} y={20} w={NODE_W + 48} h={canvasH - 40} color="rgba(59,130,246,0.03)" label="SERVER" labelColor="#3b82f6" />
            <ZoneBg x={COL_CLIENT - 24} y={20} w={NODE_W + 48} h={canvasH - 40} color="rgba(16,185,129,0.03)" label="CLIENT" labelColor="#10b981" />
            {result.remotes.length > 0 && (
              <ZoneBg x={COL_REMOTE - 16} y={ROW_START} w={NODE_W} h={groupBoxHeight(result.remotes.length)} color="rgba(245,158,11,0.04)" label="REMOTES" labelColor="#f59e0b" />
            )}

            {/* Group boxes */}
            {groups.map((g) => {
              const bg = g.kind === "server" ? "rgba(59,130,246,0.07)"
                : g.kind === "client" ? "rgba(16,185,129,0.07)"
                : "rgba(148,163,184,0.07)"
              const border = g.kind === "server" ? "rgba(59,130,246,0.2)"
                : g.kind === "client" ? "rgba(16,185,129,0.2)"
                : "rgba(148,163,184,0.15)"
              const labelColor = g.kind === "server" ? "#60a5fa"
                : g.kind === "client" ? "#34d399"
                : "#64748b"
              return (
                <g key={g.id}>
                  <rect x={g.x} y={g.y} width={g.width} height={g.height}
                    rx={6} fill={bg} stroke={border} strokeWidth={1} />
                  <text x={g.x + 8} y={g.y + 13}
                    fontSize={9} fill={labelColor} fontWeight={700}
                    letterSpacing={0.8}>
                    {g.label.toUpperCase()}
                  </text>
                </g>
              )
            })}

            {/* Edges */}
            {result.edges.map((edge) => {
              const src = nodeById.get(edge.source)
              const tgt = nodeById.get(edge.target)
              if (!src || !tgt) return null

              const isDim = dimming && !highlightedEdgeIds.has(edge.id)
              const color = EDGE_COLORS[edge.kind]
              const markerColor = edge.kind === "require" ? "gray"
                : (edge.kind === "fire_server" || edge.kind === "receives_server") ? "orange"
                : edge.kind === "fire_all" || edge.kind === "receives_client" ? "blue"
                : "purple"

              const sx = edge.kind === "require"
                ? src.x + src.width : src.x + src.width / 2
              const sy = nodeCenterY(src)
              const tx = edge.kind === "require"
                ? tgt.x : tgt.x + tgt.width / 2
              const ty = nodeCenterY(tgt)

              return (
                <g key={edge.id} style={{ opacity: isDim ? 0.08 : 1, transition: "opacity 0.15s" }}>
                  <path
                    d={edgePath(sx, sy, tx, ty)}
                    fill="none"
                    stroke={color}
                    strokeWidth={edge.kind === "require" ? 1 : 1.5}
                    strokeDasharray={edge.kind === "require" ? "4 3" : undefined}
                    markerEnd={`url(#arrow-${markerColor})`}
                    style={{ opacity: 0.75 }}
                  />
                </g>
              )
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const isDim = dimming && !highlightedNodeIds.has(node.id)
              const isHovered = hoveredId === node.id
              const isUnhandled = node.kind === "remote" && unhandledRemoteIds.has(node.id)
              const bg = node.kind === "remote"
                ? isUnhandled ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.12)"
                : KIND_BG[node.kind as ScriptKind]
              const border = node.kind === "remote"
                ? isUnhandled ? "rgba(239,68,68,0.6)" : "rgba(245,158,11,0.45)"
                : KIND_BORDER[node.kind as ScriptKind]
              const textColor = node.kind === "remote"
                ? isUnhandled ? "#fca5a5" : "#fbbf24"
                : KIND_TEXT[node.kind as ScriptKind]

              return (
                <g
                  key={node.id}
                  style={{ opacity: isDim ? 0.15 : 1, transition: "opacity 0.15s", cursor: node.path ? "pointer" : "default" }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => handleNodeClick(node)}
                >
                  <rect
                    x={node.x} y={node.y}
                    width={node.width} height={node.height}
                    rx={6}
                    fill={bg}
                    stroke={isHovered ? (node.kind === "remote" ? "#f59e0b" : border.replace("0.45", "0.9")) : border}
                    strokeWidth={isHovered ? 1.5 : 1}
                  />
                  {/* Icon + label */}
                  <foreignObject
                    x={node.x + 8} y={node.y}
                    width={node.width - 16} height={node.height}
                  >
                    <div
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        height: "100%", overflow: "hidden"
                      }}
                    >
                      <ScriptIcon kind={node.kind} />
                      <span style={{
                        fontSize: 11, color: textColor,
                        fontFamily: "monospace", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }}>
                        {node.label}
                      </span>
                    </div>
                  </foreignObject>
                </g>
              )
            })}

          </g>
        </svg>

        {/* Empty state overlay */}
        {result.scripts.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No scripts found in src/</p>
          </div>
        )}

        {/* Legend */}
        <div
          className="absolute bottom-3 right-3 flex flex-col gap-1 px-2.5 py-2 rounded-lg"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: 10 }}
        >
          <LegendRow color="#334155" dash label="require()" />
          <LegendRow color="#f97316" label="FireServer" />
          <LegendRow color="#3b82f6" label="FireClient / All" />
          <LegendRow color="#a855f7" label="FireAllClients" />
          <LegendRow color="#ef4444" label="No handler" />
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Dot({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--text-muted)" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  )
}

function ZoomBtn({ label, onClick, title }: { label: string; onClick: () => void; title?: string }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
      style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
    >
      {label}
    </button>
  )
}

function GridBackground({ width, height }: { width: number; height: number }): JSX.Element {
  return (
    <>
      <defs>
        <pattern id="topo-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="0.5" cy="0.5" r="0.5" fill="#1e293b" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#topo-grid)" />
    </>
  )
}

function ZoneBg({
  x, y, w, h, color, label, labelColor
}: {
  x: number; y: number; w: number; h: number
  color: string; label: string; labelColor: string
}): JSX.Element {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={color} />
      <text x={x + 8} y={y + 14} fontSize={9} fill={labelColor} letterSpacing={1.5} fontWeight={700} style={{ opacity: 0.6 }}>
        {label}
      </text>
    </>
  )
}

function LegendRow({ color, label, dash }: { color: string; label: string; dash?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <svg width={24} height={8}>
        <line x1={0} y1={4} x2={24} y2={4} stroke={color} strokeWidth={1.5}
          strokeDasharray={dash ? "4 3" : undefined} />
        <polygon points="20,1 24,4 20,7" fill={color} />
      </svg>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  )
}
