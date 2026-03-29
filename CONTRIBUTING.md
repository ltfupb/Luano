# Contributing to Luano

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/ltfupb/luano.git
cd luano
npm install
npx ts-node scripts/download-binaries.ts win  # or mac / linux
npm run dev
```

## How to Contribute

### Bug Reports
- Use the [Bug Report](https://github.com/ltfupb/luano/issues/new?template=bug_report.md) template
- Include steps to reproduce, expected behavior, and screenshots if possible

### Feature Requests
- Use the [Feature Request](https://github.com/ltfupb/luano/issues/new?template=feature_request.md) template
- Explain the use case and why it matters for Roblox developers

### Pull Requests
1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test with `npm run dev` and `npm run build`
4. Submit a PR with a clear description of what changed and why

## Code Style

- TypeScript strict mode
- Tailwind CSS for styling
- IPC handler naming: `"domain:action"` (e.g., `"ai:chat-stream"`)
- Zustand for state management

## Project Structure

- `electron/` — Main process (Node.js)
- `src/` — Renderer process (React)
- `resources/` — Sidecar binaries, docs DB, templates
- `scripts/` — Build-time utilities

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
