# Hermes Desktop ☤

<p align="center">
  <a href="https://github.com/NousResearch/hermes-agent/releases"><img src="https://img.shields.io/badge/Download-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-FFD700?style=for-the-badge" alt="Download"></a>
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/hermes-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
</p>

**The native desktop app for [Hermes Agent](../../README.md) — the self-improving AI agent from [Nous Research](https://nousresearch.com).** Same agent, same skills, same memory as the CLI and gateway, in a polished native window — chat with streaming tool output, side-by-side previews, a file browser, voice, and settings, no terminal required. Available for **macOS, Windows, and Linux**.

<table>
<tr><td><b>Chat with the full agent</b></td><td>Streaming responses, live tool activity, structured tool summaries, and the same conversation history as every other Hermes surface.</td></tr>
<tr><td><b>Side-by-side previews</b></td><td>Render web pages, files, and tool outputs in a right-hand pane while you keep chatting.</td></tr>
<tr><td><b>File browser</b></td><td>Explore and preview the working directory without leaving the app.</td></tr>
<tr><td><b>Voice</b></td><td>Talk to Hermes and hear it back.</td></tr>
<tr><td><b>Settings & onboarding</b></td><td>Manage providers, models, tools, and credentials from a real UI. First-run setup gets you to your first message in seconds.</td></tr>
<tr><td><b>Stays current</b></td><td>Built-in updates pull the latest agent and rebuild the app in place.</td></tr>
</table>

---

## Install

### Install with Hermes (recommended)

Already have the Hermes CLI? Just run:

```bash
hermes desktop
```

It builds and launches the GUI against your existing install — same config, keys, sessions, and skills. On first launch Hermes walks you through picking a provider and model; nothing else to configure.

### Prebuilt installers

Prebuilt installers are built and distributed via [the Hermes Desktop website.](https://hermes-agent.nousresearch.com/).

---

## Updating

The app checks for updates in the background and offers a one-click update when one is ready. You can also update any time from the CLI:

```bash
hermes update
```

---

## Requirements

The installer handles everything for you (Python 3.11+, a portable Git, ripgrep).

---

## Development

Want to hack on the app itself? Install workspace deps from the repo root once, then run the dev server from this directory:

```bash
npm install          # from repo root — links apps/desktop, web, apps/shared
cd apps/desktop
npm run dev          # Vite renderer + Electron, which boots the Python backend
```

Point the app at a specific source checkout, or sandbox it away from your real config:

```bash
HERMES_DESKTOP_HERMES_ROOT=/path/to/clone npm run dev
HERMES_HOME=/tmp/throwaway npm run dev
npm run dev:fake-boot   # exercise the startup overlay with deterministic delays
```

### Building installers

```bash
npm run dist:mac     # DMG + zip
npm run dist:win     # NSIS + MSI
npm run dist:linux   # AppImage + deb + rpm
npm run pack         # unpacked app under release/ (no installer)
```

Installers are built and uploaded to GitHub Releases manually. macOS/Windows signing & notarization happen automatically when the relevant credentials are present in the environment (`CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_*` for macOS, `WIN_CSC_*` for Windows).

### How it works in this OPL candidate

This checkout is the One Person Lab Hermes candidate shell. The official Hermes
Desktop renderer, settings, onboarding, and packaging shape are preserved, but
the ordinary OPL path does not install Hermes Agent as the chat executor. First
launch runs the OPL startup split: lightweight checks, one-time local
initialization only when needed, gflabtoken model access, and deferred OPL
maintenance. Chat runs through the OPL Codex gateway backed by
`codex app-server --listen stdio://`.

The packaged candidate app is built by `npm run package` and verified by
`npm run smoke:opl-first-run`. The smoke launches the real `.app`, checks the
branded macOS executable, verifies missing-key/configured/hot-launch/fallback
startup paths, sends a fixture Codex app-server turn, and records MAS
Skill-prompt evidence under `out/smoke-opl-first-run/summary.json`.

### Verification

Run before opening a PR (lint may surface pre-existing warnings but must exit cleanly):

```bash
npm run fix
npm run typecheck
npm run lint
npm run test:desktop:all
```

### Troubleshooting

Boot logs land in `HERMES_HOME/logs/desktop.log` (includes backend output and recent Python tracebacks) — check it first if the app reports a boot failure.

**macOS / Linux:**

```bash
# Force a clean first-launch setup
rm "$HOME/.hermes/hermes-agent/.hermes-bootstrap-complete"
# Rebuild a broken Python venv
rm -rf "$HOME/.hermes/hermes-agent/venv"
# Reset a stuck macOS microphone prompt (macOS only)
tccutil reset Microphone com.nousresearch.hermes
```

**Windows (PowerShell):**

```powershell
# Force a clean first-launch setup
Remove-Item "$env:LOCALAPPDATA\hermes\hermes-agent\.hermes-bootstrap-complete"
# Rebuild a broken Python venv
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\hermes\hermes-agent\venv"
```

> The default Hermes home on Windows is `%LOCALAPPDATA%\hermes`. Set the `HERMES_HOME` env var if you've relocated it.

---

## Community

- 💬 [Discord](https://discord.gg/NousResearch)
- 📖 [Documentation](https://hermes-agent.nousresearch.com/docs/)
- 🐛 [Issues](https://github.com/NousResearch/hermes-agent/issues)

---

## License

MIT — see [LICENSE](../../LICENSE).

Built by [Nous Research](https://nousresearch.com).
