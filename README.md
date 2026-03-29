# Luano

**The all-in-one AI-powered code editor for Roblox developers.**

Luano is a desktop editor built specifically for Roblox game development. It bundles everything you need — Luau language server, Rojo, Selene, StyLua — so you can open the app and start building immediately. No setup required.

> **Status:** Early alpha. Expect rough edges.

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
- Roblox API documentation RAG for accurate answers
- Bring Your Own Key (Claude or OpenAI)

**Developer Experience**
- Built-in terminal
- File explorer with Roblox script type indicators
- Quick Open (Ctrl+P)
- Project templates (Obby, Tycoon, etc.)
- Dark theme designed for long sessions

---

## Getting Started

### Download

Pre-built installers will be available on the [Releases](https://github.com/ltfupb/luano/releases) page.

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

---

## Plans

| | **Community (Free)** | **Pro (Coming Soon)** |
|---|---|---|
| Editor + LSP + Snippets | ✅ | ✅ |
| Rojo, Selene, StyLua | ✅ | ✅ |
| File explorer, Terminal | ✅ | ✅ |
| AI Chat (BYOK) | ✅ | ✅ |
| Inline AI Edit (BYOK) | ✅ | ✅ |
| Managed AI (no key needed) | — | ✅ |
| Agent & Plan modes | — | ✅ |
| Roblox Docs RAG | — | ✅ |
| Studio Live Bridge | — | ✅ |

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

By submitting a pull request, you agree that your contribution is licensed under the MIT License.

---

## License

[MIT](LICENSE) — free for personal and commercial use.
