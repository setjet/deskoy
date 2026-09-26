# Contributing to Deskoy

Deskoy is a Windows tray app for putting a privacy cover over your desktop quickly. This repository holds the v2 desktop and CLI source; the latest published installer remains v1.3.0 until a v2 release is made.

## Ways to help

- Fix a reproducible bug or improve Windows compatibility.
- Add focused tests, improve accessibility, or clarify documentation.
- Share product feedback through Deskoy's in-app feedback and bug-report forms.

For a larger change, keep the proposal narrow and explain the user problem in the pull request before expanding the implementation.

## Windows prerequisites

- Node.js 22 and npm.
- Stable Rust with the MSVC toolchain.
- Microsoft C++ Build Tools and WebView2, as described in the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

Use PowerShell from the repository root. The `.cmd` form avoids PowerShell script-execution-policy problems with npm.

## Local setup

```powershell
git clone https://github.com/setjet/deskoy.git
cd deskoy
npm.cmd ci
npm.cmd run cli:build:release
npm.cmd start
```

The CLI release build must run before the desktop build because the app embeds that executable. Local development does not require payment credentials or an updater signing key. Free features work without a licence; Pro activation still uses the official service and the app's native entitlement checks. Never commit a real licence key or customer data.

## Checks

Run the checks that apply to your change before submitting it:

```powershell
npm.cmd run lint
npm.cmd run test:defender-ui
npm.cmd run test:licensing-ui
npm.cmd run test:local-assets
npm.cmd run build
cargo test --manifest-path cli/Cargo.toml --locked
npm.cmd run cli:build:release
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm.cmd run tauri:build:unsigned
npm.cmd audit --omit=dev
```

The unsigned build checks the Windows executable; it does not create a signed release or installer. Do not add generated `dist/`, `target/`, or `node_modules/` files to a pull request.

## Pull requests

Create a branch from `main` and open a [pull request](https://github.com/setjet/deskoy/pulls) with one focused change. Explain what changed and why, list the checks you ran, and attach before/after screenshots for visible UI changes. Keep unrelated formatting and dependency upgrades out of the same PR. Do not include secrets or private user information.

Contributions to Deskoy-authored code and assets are submitted under the repository's [GPLv3 licence](LICENSE); third-party code keeps its original terms.
