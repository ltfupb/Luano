# Luano

**The all-in-one AI-powered code editor for Roblox developers.**

Luano is a desktop editor built specifically for Roblox game development. It bundles everything you need — Luau language server, Rojo, Selene, StyLua — so you can open the app and start building immediately. No setup required.

> **Status:** Early beta. Expect rough edges.

---

## Features

**Editor**
- Monaco editor with Luau syntax highlighting and IntelliSense
- Full LSP integration (luau-lsp) — autocomplete, type checking, diagnostics
- 30+ Roblox-specific code snippets (RemoteEvent, DataStore, OOP patterns, etc.)
- Cmd/Ctrl+K inline AI editing

**Integrated Toolchain**
- **Rojo** — sync files to Roblox Studio with one click
- **Selene** — Roblox-aware linting on save
- **StyLua** — auto-formatting on save
- All tools bundled. Zero configuration.

**AI Assistant**
- Chat with AI that understands Roblox architecture, Luau patterns, and your project context
- Three modes: **Ask** (Q&A), **Plan** (step-by-step), **Agent** (autonomous)
- Agent mode with explore-first workflow and self-verification (lint after every edit)
- Roblox API documentation RAG for accurate answers
- Works with both Claude and OpenAI (including Agent mode)
- Bring Your Own Key

**Developer Experience**
- Built-in terminal
- File explorer with Roblox script type indicators
- Quick Open (Ctrl+P)
- Project templates (Obby, Tycoon, etc.)
- Roblox topology visualization (dependency graph + remote events)
- Dark theme designed for long sessions

---

## Getting Started

### Download

Pre-built installers are available on the [Releases](https://github.com/ltfupb/luano/releases) page.

- **Windows**: `.exe` installer
- **macOS**: `.dmg`
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
2. Enter your Claude API key (`sk-ant-...`) or OpenAI API key (`sk-proj-...`)
3. Start chatting

AI is optional — the editor, LSP, Rojo, Selene, and StyLua all work without an API key.

---

## Plans

|  | **Community (Free)** | **Pro** |
| --- | --- | --- |
| Monaco Editor + Luau LSP | ✅ | ✅ |
| Rojo, Selene, StyLua bundled | ✅ | ✅ |
| File explorer, Terminal | ✅ | ✅ |
| Project templates | ✅ | ✅ |
| AI Chat (BYOK) | ✅ | ✅ |
| AI Agent mode (autonomous coding) | — | ✅ |
| Inline AI Edit (Cmd+K) | — | ✅ |
| Roblox Docs RAG | — | ✅ |
| Studio Live Bridge | — | ✅ |
| Cross-script analysis | — | ✅ |
| Performance lint | — | ✅ |
| DataStore schema generator | — | ✅ |
| Managed AI (no key needed) | — | Coming Soon |

The Community edition is fully open-source and free forever.

---

## Tech Stack

- **Shell:** Electron
- **Frontend:** React + TypeScript
- **Editor:** Monaco Editor + monaco-languageclient
- **Bundler:** Vite (electron-vite)
- **State:** Zustand
- **Styling:** Tailwind CSS
- **AI:** Anthropic Claude SDK, OpenAI SDK
- **Sidecar:** Rojo, Selene, StyLua, luau-lsp

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

By submitting a pull request, you agree that your contribution is licensed under the FSL-1.1-ALv2.

---

## License

Luano is licensed under the [Functional Source License 1.1 (Apache 2.0 Future License)](LICENSE).

After two years, each release automatically converts to Apache 2.0.

AI Agent, Studio Bridge, and other Pro features are available under a separate commercial license. See [luano.dev/pricing](https://luano.dev/pricing) for details.
