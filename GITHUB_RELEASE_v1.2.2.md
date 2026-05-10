# Deskoy v1.2.2

This release tightens the fresh-install experience, cleans up release packaging, and improves the Windows setup/uninstall flow.

## Changes

- Bumped Deskoy from `1.2.1` to `1.2.2`.
- Removed the default blocked window keyword list for new installs. Fresh installs now start with an empty keyword list instead of prefilled entries like `password`, `bank`, `invoice`, and `tax`.
- Refined Windows NSIS setup branding, welcome/finish copy, and installer/uninstaller progress messaging.
- Updated the Windows installer size estimate to match the current package footprint.
- Updated TypeScript tooling to a newer compatible version so local type-checking works with current Electron/Node type definitions.
- Cleaned up unused debug/preload surface and stale installer/dead-code scan configuration.
- Updated production dependency lockfile entries and resolved the production audit finding.

## Validation

- `npm.cmd run lint`
- `npx.cmd tsc --noEmit`
- `npx.cmd --yes knip`
- `npm.cmd audit --omit=dev`
- `npm.cmd run make`

Windows NSIS artifact:

- `out/make/nsis/arm64/Deskoy Setup 1.2.2 arm64.exe`

## Notes

- Production dependency audit reports `0 vulnerabilities`.
- Full dev dependency audit still includes Electron Forge/Webpack toolchain advisories that require upstream or breaking toolchain changes.
