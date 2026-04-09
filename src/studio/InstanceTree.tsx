import { useState } from "react"

// ── Class color / icon map ────────────────────────────────────────────────────
function getClassColor(className: string): string {
  if (className === "DataModel" || className === "game") return "#60a5fa"
  if (className.endsWith("Service"))                    return "#818cf8"
  if (className === "Script")                           return "#4ade80"
  if (className === "LocalScript")                      return "#34d399"
  if (className === "ModuleScript")                     return "#6ee7b7"
  if (className === "Model" || className === "Folder")  return "var(--text-secondary)"
  if (className.includes("Part") || className.includes("Mesh")) return "#fb923c"
  if (className.includes("Gui") || className.includes("Frame") || className.includes("Label")) return "#c084fc"
  if (className === "RemoteEvent" || className === "RemoteFunction") return "#f472b6"
  return "var(--text-muted)"
}

function ClassIcon({ className }: { className: string }): JSX.Element {
  const color = getClassColor(className)
  // Script types
  if (className === "Script" || className === "LocalScript" || className === "ModuleScript") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    )
  }
  // Services
  if (className.endsWith("Service")) {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    )
  }
  // Parts
  if (className.includes("Part") || className.includes("Mesh") || className.includes("Union")) {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    )
  }
  // Folder / Model
  if (className === "Folder" || className === "Model") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    )
  }
  // Default dot
  return (
    <span style={{ width: 11, height: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "block" }} />
    </span>
  )
}

// ── Chevron ───────────────────────────────────────────────────────────────────
function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: "transform 0.12s ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", color: "var(--text-muted)" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// ── Tree node ─────────────────────────────────────────────────────────────────
interface TreeNodeProps {
  node: BridgeInstanceNode
  depth?: number
}

function TreeNode({ node, depth = 0 }: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = (node.children?.length ?? 0) > 0

  return (
    <div>
      <div
        className="flex items-center gap-1 py-[2px] cursor-pointer select-none rounded"
        style={{
          paddingLeft: `${6 + depth * 11}px`,
          paddingRight: "6px"
        }}
        onClick={() => hasChildren && setExpanded((v) => !v)}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
      >
        {hasChildren ? (
          <Chevron open={expanded} />
        ) : (
          <span style={{ width: 8, flexShrink: 0 }} />
        )}
        <ClassIcon className={node.class} />
        <span
          className="truncate"
          style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: 3 }}
          title={`${node.name} [${node.class}]`}
        >
          {node.name}
        </span>
        <span
          className="ml-auto"
          style={{ fontSize: "10px", color: "var(--text-ghost)", fontFamily: "monospace", flexShrink: 0 }}
        >
          {node.class !== node.name ? node.class : ""}
        </span>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child, i) => (
            <TreeNode key={`${child.name}-${i}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Instance tree root ────────────────────────────────────────────────────────
interface InstanceTreeProps {
  tree: BridgeInstanceNode | null
}

export function InstanceTree({ tree }: InstanceTreeProps): JSX.Element {
  if (!tree) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8" style={{ color: "var(--text-muted)", fontSize: "11px" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35, marginBottom: 8 }}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <polyline points="8 21 12 17 16 21" />
        </svg>
        Studio not connected
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      <TreeNode node={tree} depth={0} />
    </div>
  )
}
