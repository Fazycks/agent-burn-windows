# Agent Burn for Windows

A Windows port of the native macOS Agent Burn app: the same dashboard, tray popover, Settings and features, built with Tauri v2 + React.

| macOS | Windows |
| --- | --- |
| Menu bar extra | System tray icon + popover |
| Dashboard window | Dashboard window (custom title bar) |
| `launchd` quota agent | Task Scheduler task, every minute |
| Login item | Run at login (registry) |
| Sparkle updates | GitHub releases check |

Data lives in `%APPDATA%\Agent Burn`, and usage is read by the bundled native `agent-burn.exe` CLI from your local agent logs.

## Install

Download `Agent Burn_<version>_x64-setup.exe` from the [releases](https://github.com/Fazycks/agent-burn-windows/releases) and run it. It installs per-user, without admin rights.

## Build

Requirements: Node 22+, pnpm, Rust (see `rust-toolchain.toml`), WebView2 (preinstalled on Windows 10/11).

```bash
pnpm install
cd apps/windows
pnpm bundle
```

`pnpm bundle` builds the CLI (`rust/`), copies it to `src-tauri/binaries/agent-burn.exe` and produces the NSIS installer in `src-tauri/target/release/bundle/nsis/`.

For development: `pnpm sidecar` once, then `pnpm tauri dev`.
