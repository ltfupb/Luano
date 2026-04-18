<p align="center">
  <img src="resources/icons/icon.png" width="128" alt="Luano">
</p>

<h1 align="center">Luano</h1>

<p align="center">
  <img src="docs/screenshot1.png" width="800" alt="Luano Screenshot">
</p>

<p align="center"><strong>The all-in-one AI-powered code editor for Roblox developers.</strong></p>

Luano is a desktop editor built specifically for Roblox game development. It bundles everything you need — Luau language server, Rojo, Selene, StyLua — so you can open the app and start building immediately. No setup required.

> **Status:** Early beta. Expect rough edges.

---

## Features

**Editor**
- Monaco editor with Luau syntax highlighting and IntelliSense
- Full LSP integration (luau-lsp) — autocomplete, type checking, diagnostics, hover, go-to-definition, rename
- Split editor — side-by-side editing with independent file selection
- 30+ Roblox-specific code snippets (RemoteEvent, DataStore, OOP patterns, etc.)
- Cmd/Ctrl+K inline AI editing
- Command palette (Cmd/Ctrl+Shift+P) for every action
- Auto-save with configurable delay
- Tab drag reordering
- 3 themes: Dark, Light, Tokyo Night

**Integrated Toolchain**
- Customizable toolchain across 5 supported tools: Argon, Rojo, Selene, StyLua, luau-lsp
- Argon is the default sync tool, with Rojo selectable as an alternative
- On-demand binary download from GitHub Releases for non-bundled tools
- Per-project tool configuration via `.luano/toolchain.json`
- Format All / Lint All batch operations
- Toolchain auto-update check for installed tools
- Core tools (Rojo, Selene, StyLua, luau-lsp) bundled out of the box. Zero configuration.

**AI Assistant**
- Chat with AI that understands Roblox architecture, Luau patterns, and your project context
- Markdown rendering in chat (code blocks, tables, GFM)
- Three modes: **Chat** (Q&A), **Plan** (step-by-step), **Agent** (autonomous file editing)
- Agent mode with explore-first workflow and self-verification (lint after every edit)
- 10 built-in skills: `/explain`, `/fix`, `/optimize`, `/refactor`, `/test`, `/type`, `/doc`, `/security`, `/convert`, `/scaffold`
- Custom skills with `{selection}` and `{file}` placeholders
- File attachments for additional context
- Session history with per-project persistence and session handoff
- Prompt caching for token efficiency
- Roblox API documentation RAG for accurate answers
- Works with Claude, OpenAI, Gemini, and local models (Ollama, LM Studio, vLLM)
- Bring Your Own Key

**Studio Integration**
- Studio Live Bridge — real-time instance tree, console logs, script execution
- Persistent bridge token — paired plugins stay authenticated across restarts
- Sync serve + sourcemap with status indicator (Argon or Rojo)
- Studio plugin included (`resources/studio-plugin/LuanoPlugin.lua`)

**Analysis Tools**
- Topology graph — visualize server/client/shared script dependencies and RemoteEvent flow
- Unhandled remote detection with visual warnings
- Performance lint — detect anti-patterns and get fix suggestions
- Cross-script analysis

**Developer Experience**
- Built-in terminal (xterm.js + node-pty) with theme sync
- File explorer with Roblox class icons and script type color indicators
- Full-text search across project files
- Quick Open (Ctrl+P) with fuzzy matching
- Native OS menus (File / Edit / View / Help)
- Drag and drop a folder onto the window to open it as a project
- Project templates (Obby, Tycoon, etc.)
- Unsaved file confirmation on quit
- Session restore — projects, open files, chat history, layout, and window bounds persist across restarts
- Auto-update via GitHub Releases
- Opt-in crash reporting (Sentry) — no telemetry by default
- Multi-language UI: English, 한국어

---

## Getting Started

### Download

Pre-built installers are available on the [Releases](https://github.com/ltfupb/luano/releases) page.

- **Windows**: `.exe` installer
- **macOS**: `.dmg` (Apple Silicon + Intel)
- **Linux**: `.AppImage`

### Build from Source

```bash
# Clone
git clone https://github.com/ltfupb/luano.git
cd luano

# Install dependencies
npm install

# Download sidecar binaries (Rojo, Selene, StyLua, luau-lsp)
npx ts-node scripts/download-binaries.ts win   # or mac / linux

# Run in development mode
npm run dev

# Build for production
npm run package:win   # or package:mac / package:linux
```

### AI Setup

Luano uses Bring Your Own Key (BYOK) for AI features:
1. Open Settings (gear icon)
2. Enter your API key for any supported provider:
   - **Anthropic** (Claude): `sk-ant-...`
   - **OpenAI**: `sk-proj-...`
   - **Google Gemini**: Gemini API key
   - **Local Models**: Set your Ollama/LM Studio/vLLM endpoint URL
3. Select your preferred provider and model
4. Start chatting

AI is optional — the editor, LSP, toolchain, and Studio sync all work without an API key.

---

## Plans

|  | **Free** | **Pro** |
| --- | --- | --- |
| Monaco Editor + Luau LSP | ✅ | ✅ |
| Rojo, Selene, StyLua bundled | ✅ | ✅ |
| File explorer, Terminal, Search | ✅ | ✅ |
| Split editor, Auto-save | ✅ | ✅ |
| Project templates | ✅ | ✅ |
| 3 Themes (Dark / Light / Tokyo Night) | ✅ | ✅ |
| AI Chat (BYOK, Q&A) | ✅ | ✅ |
| AI Agent mode (autonomous coding) | — | ✅ |
| Inline AI Edit (Cmd+K) | — | ✅ |
| Roblox Docs RAG | — | ✅ |
| Studio Live Bridge | — | ✅ |
| Cross-script analysis | — | ✅ |
| Performance lint | — | ✅ |
| Topology visualization | — | ✅ |
| DataStore schema generator | — | ✅ |
| Managed AI (no key needed) | — | Coming Soon |

The free plan is free forever.

---

## Supported AI Models

**Anthropic** — Claude Opus 4.7, Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5

**OpenAI** — GPT-4o, GPT-4o mini, GPT-4 Turbo, o1, o1 mini

**Google Gemini** — Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash

**Local Models** — Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)

---

## Tech Stack

- **Shell:** Electron 31
- **Frontend:** React 18 + TypeScript
- **Editor:** Monaco Editor + monaco-languageclient
- **Bundler:** Vite 5 (electron-vite)
- **State:** Zustand (persisted)
- **Styling:** Tailwind CSS
- **Terminal:** xterm.js + node-pty
- **AI:** Anthropic Claude SDK, OpenAI SDK, Google Gemini API
- **RAG:** better-sqlite3 + FTS5
- **Update:** electron-updater (GitHub Releases)
- **Crash Reporting:** Sentry (opt-in)
- **Sidecar:** Argon, Rojo, Selene, StyLua, luau-lsp

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+P | Quick Open |
| Ctrl+Shift+P | Command Palette |
| Ctrl+Shift+F | Search in files |
| Ctrl+K | Inline AI Edit |
| Ctrl+S | Save file |
| Ctrl+W | Close tab |

On macOS, substitute Cmd for Ctrl.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

By submitting a pull request, you agree that your contribution is licensed under the FSL-1.1-ALv2.

---

## License

Luano is licensed under the [Functional Source License 1.1 (Apache 2.0 Future License)](LICENSE).

After two years, each release automatically converts to Apache 2.0.

AI Agent, Studio Bridge, and other Pro features are available under a separate commercial license. See [luano.dev](https://luano.dev) for details.
