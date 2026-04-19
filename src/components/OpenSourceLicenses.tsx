/**
 * OpenSourceLicenses.tsx — Attribution for bundled third-party content.
 *
 * Roblox Creator Documentation (bundled as resources/roblox-docs/roblox_docs.db)
 * is licensed under CC BY 4.0. The license requires attribution that is
 * "reasonable to the medium" — for a desktop app that means a visible
 * credits screen with the copyright line, license name, and a link back
 * to the source. That attribution is hard-coded below because it's the one
 * non-npm piece of bundled content.
 *
 * For the npm packages themselves — Monaco, React, Electron, AI SDKs, etc.
 * — we don't maintain a second hand-curated list here. A build-time script
 * (scripts/generate-third-party-licenses.js) walks the full production
 * dependency tree, reads every LICENSE file, and writes them to
 * resources/THIRD_PARTY_LICENSES.txt. That's the authoritative surface and
 * it's reachable via the "View full license texts" button, which opens the
 * file in the user's default text viewer. Single source of truth, no
 * drift when deps are added or removed.
 *
 * Toolchain binaries (Rojo, Selene, StyLua, Luau LSP, Argon) are NOT in
 * this credits surface because Luano downloads them on first use from their
 * upstream GitHub Releases — we don't redistribute them, so attribution
 * lives at the upstream release page the user effectively agrees to when
 * downloading.
 */

import { useState } from "react"

export function OpenSourceLicenses(): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 transition-all duration-150"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontSize: "11px",
          alignSelf: "flex-start"
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 120ms ease",
            fontSize: "8px",
            color: "var(--text-muted)"
          }}
        >
          ▶
        </span>
        Open source licenses
      </button>

      {expanded && (
        <div
          className="flex flex-col gap-3 rounded-lg px-3 py-3"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)"
          }}
        >
          {/* CC BY 4.0 Roblox docs attribution — the one non-npm piece that
              can't be covered by the generated bundle and has to live in the UI. */}
          <div className="flex flex-col gap-1">
            <a
              href="https://github.com/Roblox/creator-docs"
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "11px",
                color: "var(--text-primary)",
                textDecoration: "none",
                fontWeight: 500
              }}
              onMouseOver={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseOut={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              Roblox Creator Documentation{" "}
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>— CC BY 4.0</span>
            </a>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>
              © Roblox Corporation. Bundled as a searchable index for AI context.
            </span>
          </div>

          <span style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.5 }}>
            The bundled npm packages (Monaco, React, Electron, AI SDKs, and
            their dependencies) are listed with their original MIT / Apache-2.0
            / BSD notices in THIRD_PARTY_LICENSES.txt. Toolchain binaries
            (Rojo, Selene, StyLua, Luau LSP, Argon) are downloaded on demand
            from their upstream GitHub Releases and are not redistributed
            by Luano.
          </span>

          <button
            onClick={() => { void window.api.licensesOpen() }}
            className="transition-all duration-150"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontSize: "11px",
              padding: "6px 10px",
              borderRadius: "6px",
              cursor: "pointer",
              alignSelf: "flex-start"
            }}
            onMouseOver={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onMouseOut={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          >
            View full license texts
          </button>
        </div>
      )}
    </div>
  )
}
