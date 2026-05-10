<div align="center">
  <img src="assets/logo.png" width="112" alt="Deskoy logo" />

  # Deskoy

  **A fast Windows privacy cover for sensitive moments.**

  Deskoy sits in your system tray and lets you replace your screen with a believable work surface when you need privacy quickly.

  [Website](https://www.deskoy.com) | [Download](https://www.deskoy.com/download) | [Docs](https://www.deskoy.com/docs) | [Support](https://www.deskoy.com/docs/support)
</div>

---

## What Deskoy Does

Deskoy is a desktop decoy utility built for everyday privacy gaps: screen-share surprises, shoulder-surfing, open sensitive tabs, and moments where a quick full-screen cover is easier than closing everything.

| Area | What it provides |
| --- | --- |
| Manual cover | Toggle a full-screen cover with a global hotkey. |
| Built-in covers | Excel, VS Code, Google Docs, Jira, BI dashboard, and blank screen presets. |
| Custom covers | Use a URL or local file as the cover source. |
| Auto-protect | Optionally cover blocked apps or title keywords when they become active. |
| Tray-first flow | Deskoy runs quietly from the Windows tray instead of staying in the way. |
| Feedback path | Feedback and bug reports can be sent directly to the Deskoy team. |

> Deskoy reduces casual exposure. It is not a security boundary, antivirus, DRM, or protection against malware, screen recording, remote administration tools, or a determined user with access to the machine.

---
<img width="895" height="593" alt="2026-04-21 16_13_20-Greenshot" src="https://github.com/user-attachments/assets/22be2308-20bf-4eff-bfb7-4c64ac72596d" />

## Product Highlights

- **Instant cover hotkey.** Configure a global shortcut, then show or hide the cover without hunting through windows.
- **Believable work surfaces.** Use built-in decoys that look like common productivity tools instead of obvious blank overlays.
- **Custom sources.** Point Deskoy at a URL or local file when your team needs a specific cover.
- **Fresh install defaults.** New installs start clean, with no prefilled blocked keyword list.
- **Audio option.** Manual hotkey covers can mute and restore Windows desktop audio when enabled.
- **User feedback path.** Built-in feedback and bug report forms help users reach the team from inside the app.

## Cover Modes

| Mode | Best for | Notes |
| --- | --- | --- |
| Excel | Office-like cover | Good default for work environments. |
| VS Code | Developer cover | Looks natural during engineering work. |
| Google Docs | Writing/document cover | Useful for docs-heavy teams. |
| Jira | Planning cover | Fits product and support workflows. |
| BI dashboard | Analytics cover | Works well in dashboard-heavy environments. |
| Blank | Minimal fallback | Pure black full-screen cover. |
| URL | Team-specific decoy | Some sites may block rendering because of auth, CSP, or browser restrictions. |
| File | Local custom cover | Images, PDFs, and text-like files are supported. |

## How It Works

```mermaid
flowchart LR
  A["User toggles Deskoy"] --> B["Main Electron process"]
  B --> C["Create full-screen cover window"]
  C --> D["Load built-in, URL, file, or blank cover"]
  B --> E["Optional Windows audio mute"]
  F["Auto-protect watcher"] --> G["Check active window"]
  G --> H["Match blocked app or title keyword"]
  H --> C
```

The main process owns the tray, global shortcut, settings store, cover windows, Windows foreground-window checks, and support requests. The renderer owns the settings UI.

## Get Started

For users:

1. Download Deskoy from [deskoy.com/download](https://www.deskoy.com/download).
2. Install the Windows setup package.
3. Open Deskoy from the tray or Start menu.
4. Choose a cover mode.
5. Set a hotkey.
6. Toggle Deskoy when you need a privacy cover.

For local development:

```powershell
cd C:\Users\User\Desktop\deskoy\deskoy-app
npm.cmd install
npm.cmd start
```

Use `npm.cmd` / `npx.cmd` on Windows PowerShell if script execution policy blocks `npm.ps1` or `npx.ps1`.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm.cmd start` | Run the Electron app in development mode. |
| `npm.cmd run lint` | Run ESLint across TypeScript files. |
| `npx.cmd tsc --noEmit` | Type-check the app. |
| `npx.cmd --yes knip` | Check for unused files, exports, and dependencies. |
| `npm.cmd audit --omit=dev` | Audit production runtime dependencies. |
| `npm.cmd run package` | Package the app locally. |
| `npm.cmd run make` | Build distributables, including the Windows NSIS installer. |
| `npm.cmd run build:icons` | Regenerate app icons from `assets/logo.png`. |
| `npm.cmd run build:installer-assets` | Regenerate NSIS installer branding bitmaps. |

## Release Build

```powershell
cd C:\Users\User\Desktop\deskoy\deskoy-app
npm.cmd install
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd audit --omit=dev
npm.cmd run make
```

Current Windows artifact path:

```text
out/make/nsis/arm64/Deskoy Setup 1.2.2 arm64.exe
```

The NSIS installer is configured in [forge.config.ts](forge.config.ts) and [build/installer.nsh](build/installer.nsh). Installer graphics are generated by [scripts/build-installer-assets.cjs](scripts/build-installer-assets.cjs).

## Repository Map

| Path | What lives there |
| --- | --- |
| `src/index.ts` | Electron main process, tray, settings, shortcuts, cover windows, auto-protect, and support requests. |
| `src/preload.ts` | Safe IPC bridge exposed to the renderer. |
| `src/renderer.ts` | Settings UI behavior and front-end state. |
| `src/index.html` | Main settings window markup. |
| `src/cover/*` | Built-in cover pages and shared cover script. |
| `src/windows-session.ts` | Windows audio mute/restore helpers. |
| `assets/*` | Logo, app icons, and installer art. |
| `build/installer.nsh` | NSIS installer and uninstaller customization. |
| `scripts/*` | Asset generation scripts for icons, loading GIF, and installer bitmaps. |
| `webpack.*.ts` | Electron Forge Webpack configuration. |

## Feedback And Bug Reports

Deskoy includes in-app feedback and bug report forms so users can send notes, issue reports, optional screenshots, and basic diagnostics to the team.

This path is intended for product support only. It keeps the desktop app simple for users while giving the team enough context to triage issues quickly.

## Configuration Notes

- Settings are stored with `electron-store`.
- New installs drop a first-run marker so stale local state can be reset.
- Default blocked title keywords are empty for fresh installs.
- Built-in cover mode is used when custom cover override is disabled or incomplete.
- Auto-protect is best-effort because Windows apps and browser titles expose different levels of information.

## Quality Checks

The current codebase is expected to pass:

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
npx.cmd --yes knip
npm.cmd audit --omit=dev
```

Production runtime dependencies currently audit clean with `npm.cmd audit --omit=dev`. Full dev audits may still report Electron Forge/Webpack toolchain advisories that require upstream or breaking toolchain changes.

## Known Limitations

- Browser titles may not include full URLs.
- Some apps may refuse to close or minimize during auto-protect.
- Global shortcuts can fail if another app already owns the same key combination.
- URL covers depend on the target site allowing embedded Chromium rendering.
- Deskoy is a privacy convenience tool, not a security product.

## License

Deskoy is released under `LicenseRef-Deskoy-Source-Available-1.0`.

See [LICENSE](LICENSE) for the full license text.
