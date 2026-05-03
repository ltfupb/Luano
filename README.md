<p align="center">
  <img src="resources/icons/icon.png" width="128" alt="Luano">
</p>

<h1 align="center">Luano</h1>

<p align="center">
  <img src="docs/screenshot1.png" width="800" alt="Luano Screenshot">
</p>

<p align="center"><strong>The all-in-one AI code editor for Roblox developers.</strong></p>

Open the app. Start building. Luau LSP, Rojo, Selene, StyLua, Wally, pesde, and the Studio bridge are wired in — Luano fetches each tool on first use, no system install or PATH changes.

> **Status:** Early beta. Expect rough edges.

---

## Features

**Roblox-aware editor**
- Luau LSP wired in (autocomplete, type checking, diagnostics, hover, go-to-definition, rename)
- 30+ Roblox snippets (RemoteEvent, DataStore, OOP patterns)
- Inline AI edit — select code, press Cmd/Ctrl+K

**AI**
- Three modes: **Chat** (Q&A), **Plan** (read-only design), **Agent** (autonomous file editing) — each with its own auto-accept toggle
- Pre-edit preview with Accept (Y) / Reject (N) before any write
- Agent mode self-verifies (lints after every edit, fixes the errors it finds)
- 10 ready-to-use skills (`/explain`, `/fix`, `/optimize`, `/refactor`, `/test`, `/type`, `/doc`, `/security`, `/convert`, `/scaffold`) plus your own as JSON / Markdown
- Project instructions in `LUANO.md` (global / project / directory) auto-loaded
- Per-project chat history, session handoff so long conversations stay coherent
- Roblox API docs retrieval (Pro)
- Claude, GPT, Gemini, or any local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM) — BYOK or **Managed AI** (Pro, no key needed)

**Roblox Studio integration**
- Studio Live Bridge: live instance tree, console logs, script execution (Pro)
- One-click pair with the Studio plugin — stays authenticated across restarts
- Rojo / Argon sync serve with sourcemap, status in the sidebar

**Analysis (Pro)**
- Topology graph — server / client / shared script dependencies and RemoteEvent flow
- Unhandled remote detection
- Performance lint — anti-patterns with fix suggestions
- Cross-script analysis
- DataStore schema generator

**Toolchain — fetched on demand**
- Luau LSP, Rojo / Argon, Selene, StyLua, Wally, pesde — auto-downloaded the first time you use them, no system installs, no PATH changes

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
   - Claude
   - GPT
   - Gemini
   - Any local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)

AI is optional. The editor, language support, toolchain, and Studio sync all work without a key.

---

## Plans

|  | **Free** | **Pro** |
| --- | --- | --- |
| Luau editor with full language support | ✅ | ✅ |
| Rojo / Argon / Selene / StyLua auto-fetched | ✅ | ✅ |
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

- **Claude** — Opus 4.7, Sonnet 4.6, Opus 4.6, Haiku 4.5
- **GPT** — 4o, 4o mini, 4 Turbo, o1, o1 mini
- **Gemini** — 2.5 Pro, 2.5 Flash, 2.0 Flash
- **Local** — any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)

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
