# Design System — Luano

## Product Context
- **What this is:** All-in-one AI code editor for Roblox developers (Electron desktop app)
- **Who it's for:** Roblox game developers, including younger/creative demographics
- **Space:** Developer tools / code editors (VS Code, Cursor, Zed, Roblox Studio)
- **Project type:** Desktop IDE with sidebar, editor pane, AI chat panel, terminal

## Design Principles

1. **Don't get in the way.** Developers care about code readability, not flashy design. Every visual decision must serve productivity first.
2. **Feel familiar.** Users come from VS Code and similar editors. Stick to conventions they already know. Differentiation through design is not a goal.
3. **Be consistent.** One way to do things. One source of truth for colors, sizes, spacing. No hardcoded hex values scattered across components.

## Typography
- **UI/Body:** System font stack: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif`
- **Code:** Monaco editor handles its own fonts (user-configurable)
- **Base size:** 14px (body global)
- **Common sizes in UI:** 11px (status bar, labels), 12px (file tree, panel headers), 13px (buttons, chat), 14px (body text)
- **Weights:** 400 (regular), 500 (medium), 600 (semibold)

## Color System

All colors are defined as CSS custom properties in `src/styles/globals.css`. Themes are switched via `data-theme` attribute on the root element.

### Tokens (19 variables)

| Token | Purpose |
|-------|---------|
| `--bg-base` | App background, editor background |
| `--bg-panel` | Sidebar, chat panel, panel backgrounds |
| `--bg-elevated` | Active items, hover states level 1 |
| `--bg-surface` | Cards, popups, dropdown backgrounds |
| `--bg-hover` | Hover states level 2 |
| `--border-subtle` | Separator lines, inactive borders |
| `--border` | Standard borders (inputs, cards) |
| `--border-strong` | Emphasized borders, scrollbar hover |
| `--accent` | Primary action color (buttons, links, active tabs) |
| `--accent-hover` | Accent hover state |
| `--accent-muted` | Accent at ~10% opacity (backgrounds, selections) |
| `--accent-glow` | Accent at ~20% opacity (glows, pulses) |
| `--text-primary` | Main text color |
| `--text-secondary` | Secondary text, descriptions |
| `--text-muted` | Tertiary text, labels, placeholders |
| `--text-ghost` | Disabled text, line numbers |
| `--success` | Connected, passed, enabled |
| `--warning` | Warnings, caution states |
| `--danger` | Errors, destructive actions |
| `--info` | Links, informational highlights, update buttons |

### Theme Values

| Token | Dark | Light | Tokyo Night |
|-------|------|-------|-------------|
| `--bg-base` | `#1e1e1e` | `#ffffff` | `#1a1b26` |
| `--bg-panel` | `#252526` | `#f5f5f5` | `#1f2133` |
| `--bg-elevated` | `#2d2d2d` | `#ebebeb` | `#262840` |
| `--bg-surface` | `#333333` | `#e0e0e0` | `#2c2e48` |
| `--bg-hover` | `#3a3a3a` | `#d6d6d6` | `#33354e` |
| `--border-subtle` | `#353535` | `#e0e0e0` | `#323450` |
| `--border` | `#444444` | `#cccccc` | `#3e4060` |
| `--border-strong` | `#585858` | `#aaaaaa` | `#515375` |
| `--accent` | `#569cd6` | `#2563eb` | `#7aa2f7` |
| `--accent-hover` | `#4a8cc7` | `#1d4ed8` | `#5d87e0` |
| `--accent-muted` | `rgba(86,156,214,0.1)` | `rgba(37,99,235,0.08)` | `rgba(122,162,247,0.1)` |
| `--accent-glow` | `rgba(86,156,214,0.2)` | `rgba(37,99,235,0.15)` | `rgba(122,162,247,0.2)` |
| `--text-primary` | `#d4d4d4` | `#1a1a1a` | `#c0caf5` |
| `--text-secondary` | `#bdbdbd` | `#3d3d3d` | `#b4bce0` |
| `--text-muted` | `#939393` | `#6b6b6b` | `#7e86a8` |
| `--text-ghost` | `#6e6e6e` | `#9a9a9a` | `#565e7e` |
| `--success` | `#4ec9b0` | `#16a34a` | `#73daca` |
| `--warning` | `#dcdcaa` | `#ca8a04` | `#e0af68` |
| `--danger` | `#f44747` | `#dc2626` | `#f7768e` |
| `--info` | `#60a5fa` | `#2563eb` | `#7aa2f7` |

## Spacing
- **Base unit:** 4px
- **Common patterns:** `py-1.5` (6px), `py-2` (8px), `px-3` (12px), `px-4` (16px), `gap-2` (8px), `gap-3` (12px)
- **Density:** Compact (similar to VS Code)

## Layout
- **Sidebar:** 44px (w-11) icon column, always visible
- **Left panel:** 150-500px, resizable (file explorer, search, sync)
- **Editor:** Fills remaining space
- **Chat panel:** Overlay from right, 240-600px (scales with viewport)
- **Status bar:** 22px fixed bottom
- **Terminal:** Optional bottom pane, 80-600px resizable
- **Resize handles:** 3px dividers

## Border Radius
- **Buttons:** `rounded-lg` (8px)
- **Inputs:** `rounded-lg` (8px)
- **Cards/panels:** `rounded-lg` (8px) or `rounded-xl` (12px)
- **Code blocks:** `rounded-xl` (12px)
- **Scrollbar:** 10px
- **Focus ring:** 4px

## Motion
- **Approach:** Minimal-functional
- **Animations:**
  - `fadeIn` — 0.18s ease-out (most common, general entrance)
  - `slideUp` — 0.2s ease-out (modals, tooltips)
  - `slideInRight` — 0.22s ease-out (panels opening)
  - `slideDown` — 0.2s ease-out (dropdowns)
  - `glowPulse` — 2.4s ease-in-out infinite (loading, active states)
  - `shimmer` — 1.8s ease-in-out infinite (text loading)
- **Transitions:** `transition-all duration-150` (standard), `transition-colors duration-100` (simple)
- **Button press:** `transform: scale(0.97)`

## Modal/Overlay
- **Backdrop:** `rgba(5,8,15,0.88)` with `backdrop-filter: blur(12px)`
- **Position:** `fixed inset-0 z-50`
- **Panel border:** `1px solid var(--border)`
- **Panel shadow:** `0 8px 24px rgba(0,0,0,0.5)`

## Scrollbar
- **Width:** 5px
- **Track:** transparent
- **Thumb:** `var(--border)`, 10px radius
- **Thumb hover:** `var(--border-strong)`

## Focus Ring
- `outline: 1.5px solid var(--accent)`
- `outline-offset: 2px`
- `border-radius: 4px`

## Icons
- **Standard size:** 14px (buttons, menus, file tree)
- **Sidebar:** 18px (main navigation icons)

---

## Known Issues

### Fixed
- ~~Hardcoded hex colors~~ — Replaced with CSS variables in all non-Pro components
- ~~Tailwind config mismatch~~ — Now references CSS variables instead of separate palette
- ~~Modal overlay inconsistency~~ — SyncPanel standardized to match App.tsx pattern

### Remaining
- **Terminal theme colors** — xterm.js themes are hardcoded per-theme instead of CSS variables
- **QuickOpen file icon colors** — Intentionally hardcoded (syntax-highlighting-style, theme-independent)
- **Some rgba() backgrounds** — Opacity-based backgrounds can't easily reference CSS vars; acceptable
- **Pro file hardcoded colors** — InlineEditOverlay, DiffView, StudioPanel, etc. (Pro files, separate repo)

### Rules
- Always use CSS variables for solid colors. Never hardcode hex values in components.
- Exception: Monaco editor themes and QuickOpen file type icons (intentionally static).

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-10 | Keep current color palette (VS Code blue accent) | Familiar to target users. Design differentiation is not a goal for a dev tool. |
| 2026-04-10 | Keep system font stack | Fast, familiar, zero loading cost. Custom fonts add friction with no real benefit for an IDE. |
| 2026-04-10 | CSS variables are the single source of truth | Tailwind config should reference CSS vars, not define its own colors. |
| 2026-04-10 | No secondary accent color | Unnecessary complexity. Semantic colors (success/warning/danger) cover all use cases. |
