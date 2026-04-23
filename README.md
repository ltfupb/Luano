<p align="center">
  <img src="resources/icons/icon.png" width="128" alt="Luano">
</p>

<h1 align="center">Luano</h1>

<p align="center">
  <img src="docs/screenshot1.png" width="800" alt="Luano Screenshot">
</p>

<p align="center"><strong>The all-in-one AI code editor for Roblox developers.</strong></p>

Open the app. Start building. Luano ships with the Luau language server, Rojo, Selene, StyLua, and a Studio bridge already wired up — no setup, no config files, no separate installs.

> **Status:** Early beta. Expect rough edges.

---

## Features

**Editor**
- Luau syntax highlighting, autocomplete, type checking, diagnostics, hover, go-to-definition, rename
- Side-by-side split editor
- 30+ Roblox snippets (RemoteEvent, DataStore, OOP patterns, and more)
- Inline AI edit: select code, press Cmd/Ctrl+K
- Command palette (Cmd/Ctrl+Shift+P) for every action
- Quick open (Cmd/Ctrl+P) with fuzzy match
- Full-text search across the project
- Auto-save with configurable delay
- Drag-and-drop tab reorder
- Dark, Light, Tokyo Night themes

**AI**
- Chat that understands Roblox architecture, Luau patterns, and your project
- Three modes: **Chat** (Q&A), **Plan** (step-by-step design), **Agent** (autonomous file editing) — each with its own auto-accept toggle
- Pre-edit preview with Accept (Y) / Reject (N) before any write
- Agent mode self-verifies (lints after every edit, fixes the errors it finds)
- 10 built-in skills: `/explain`, `/fix`, `/optimize`, `/refactor`, `/test`, `/type`, `/doc`, `/security`, `/convert`, `/scaffold`. Bring your own as JSON or Markdown.
- Project instructions in `LUANO.md` (global / project / directory) loaded automatically
- Attach files for context
- Per-project chat history, session handoff so long conversations stay coherent
- Roblox API docs retrieval built in (Pro)
- Works with Claude, OpenAI, Gemini, or any local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)
- Bring Your Own Key, or use **Managed AI** (Pro — no key needed)

**Roblox Studio**
- Studio Live Bridge: see the live instance tree, read console logs, run scripts (Pro)
- One-click pair with the Studio plugin — stays authenticated across restarts
- Rojo or Argon sync serve with sourcemap, status in the sidebar
- Studio plugin included at `resources/studio-plugin/LuanoPlugin.lua`

**Analysis (Pro)**
- Topology graph — server / client / shared script dependencies and RemoteEvent flow
- Unhandled remote detection
- Performance lint — anti-patterns with fix suggestions
- Cross-script analysis
- DataStore schema generator

**Other**
- Built-in terminal with theme sync
- File explorer with Roblox class icons
- Project templates (Obby, Tycoon, and more)
- Native OS menus (File / Edit / View / Help)
- Drag a folder onto the window to open it as a project
- Session restore: projects, open files, chat, layout, window bounds persist across restarts
- Auto-update via GitHub Releases
- Opt-in crash reporting; no telemetry by default
- English + 한국어 UI

---

## Getting Started

### Download

Pre-built installers on the [Releases](https://github.com/ltfupb/luano/releases) page.

- **Windows**: `.exe`
- **macOS**: `.dmg` (Apple Silicon + Intel)
- **Linux**: `.AppImage`

### AI Setup

Two options:

1. **Managed AI (Pro)** — no key, no config. Activate your Pro license in Settings and pick "Managed" as the provider. 2.5M tokens/month included.
2. **Bring Your Own Key** — open Settings, paste a key for any supported provider:
   - Anthropic Claude
   - OpenAI
   - Google Gemini
   - Any local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)

AI is optional. The editor, language support, toolchain, and Studio sync all work without a key.

---

## Plans

|  | **Free** | **Pro** |
| --- | --- | --- |
| Luau editor with full language support | ✅ | ✅ |
| Rojo / Argon / Selene / StyLua bundled | ✅ | ✅ |
| File explorer, terminal, search | ✅ | ✅ |
| Split editor, auto-save | ✅ | ✅ |
| Project templates | ✅ | ✅ |
| Dark / Light / Tokyo Night themes | ✅ | ✅ |
| AI Chat (BYOK) | ✅ | ✅ |
| AI Agent mode (autonomous coding) | — | ✅ |
| Inline AI Edit (Cmd/Ctrl+K) | — | ✅ |
| Managed AI (no key needed, 2.5M tokens/mo) | — | ✅ |
| Roblox Docs retrieval | — | ✅ |
| Studio Live Bridge | — | ✅ |
| Topology / cross-script / performance analysis | — | ✅ |
| DataStore schema generator | — | ✅ |

The Free plan is free forever.

---

## Supported AI Models

| Provider | Models |
| --- | --- |
| Anthropic | Claude Opus 4.7, Sonnet 4.6, Opus 4.6, Haiku 4.5 |
| OpenAI | GPT-4o, GPT-4o mini, GPT-4 Turbo, o1, o1 mini |
| Google | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |
| Local | Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl + P | Quick Open |
| Cmd/Ctrl + Shift + P | Command Palette |
| Cmd/Ctrl + Shift + F | Search in files |
| Cmd/Ctrl + K | Inline AI Edit |
| Cmd/Ctrl + S | Save file |
| Cmd/Ctrl + W | Close tab |
| Cmd/Ctrl + ` | Toggle terminal |
| Cmd/Ctrl + J | Toggle AI chat |
| Cmd/Ctrl + B | Toggle side panel |

---

## Contributing

Build instructions, architecture notes, and contribution guidelines live in [CONTRIBUTING.md](CONTRIBUTING.md).

By submitting a pull request, you agree that your contribution is licensed under the FSL-1.1-ALv2.

---

## License

Luano is licensed under the [Functional Source License 1.1 (Apache 2.0 Future License)](LICENSE).

After two years, each release automatically converts to Apache 2.0.

AI Agent, Studio Bridge, and other Pro features are available under a separate commercial license. See [luano.dev](https://luano.dev) for details.
