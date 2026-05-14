# Deskoy v1.2.3

This release makes Auto Protect faster and more precise, adds local protection logs with a clear action, and fixes Windows installer/tray icon branding.

## Changes

- Bumped Deskoy from `1.2.2` to `1.2.3`.
- Made Auto Protect website matching more specific. Domain-style entries now match hostname tokens instead of loosely matching any empty tab or unrelated title text.
- Split Auto Protect targeting into separate `Blocked Websites` and `Blocked Keywords` fields.
- Added a `Logs` page in Settings for recent Auto Protect events.
- Added `Clear Logs` so users can remove local Auto Protect history.
- Improved Auto Protect speed with direct Windows foreground-window checks and cached settings.
- Improved cover timing so Deskoy opens the cover quickly, keeps it visible long enough to be useful, and removes it promptly after the blocked window is hidden.
- Made Mute Audio faster by using Windows Core Audio APIs before falling back to the keyboard mute toggle.
- Hardened failure handling for cover creation, cover closing, audio restore, and blocked-window hiding so Deskoy resets state instead of getting stuck.
- Polished Settings scrollbars and the Logs empty state to better match the rest of the UI.
- Updated Windows NSIS installer and uninstaller icons to use the Deskoy app icon.
- Fixed the running tray icon so Deskoy no longer appears as an invisible/blank tray item.

## Validation

- `cargo check`
- `cargo test`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run tauri:build`

Windows artifacts:

- `src-tauri/target/release/bundle/nsis/Deskoy_1.2.3_arm64-setup.exe`
- `src-tauri/target/release/bundle/msi/Deskoy_1.2.3_arm64_en-US.msi`

## Notes

- Current generated Windows artifacts are ARM64 builds.
- For broad public Windows distribution, build an x64 installer too.
- Public releases should still be code-signed to reduce Windows SmartScreen warnings.
