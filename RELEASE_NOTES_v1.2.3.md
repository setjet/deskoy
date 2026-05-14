# Deskoy Release Notes

## v1.2.3 - 2026-05-14

Faster Auto Protect, cleaner targeting, local logs, and better Windows branding.

### ADDED

- Separate `Blocked Websites` and `Blocked Keywords` fields for Auto Protect
- Settings `Logs` page for recent Auto Protect events
- `Clear Logs` action for removing local protection history
- Explicit Windows installer and uninstaller icon configuration

### CHANGED

- Auto Protect now checks active windows much faster
- Website rules now target hostname-style matches more specifically
- Cover open/hide timing is smoother and more reliable
- Mute Audio now uses Windows Core Audio for faster mute/restore behavior
- Settings scrollbars and Logs empty states now better match the app UI
- App version updated to `v1.2.3`

### FIXED

- Empty browser tabs no longer trigger domain-style blocked website entries
- Cover state now recovers if cover creation or fallback cover creation fails
- Audio restore failures are handled without leaving Deskoy stuck
- Blocked-window hide failures are reported internally instead of silently wedging state
- Windows setup files now use the Deskoy icon
- Deskoy's running tray icon now uses the app icon instead of appearing blank

### KNOWN LIMITATIONS

- Some apps may prevent Deskoy from closing or minimizing their windows automatically.
- Browser window titles may not always include the full URL.
- Global hotkey availability can vary if another app already owns the same shortcut.
- Current packaged Windows artifacts are ARM64; x64 should be built separately for most Windows users.
