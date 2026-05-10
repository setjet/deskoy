# Deskoy Release Notes

## v1.2.2 · 2026-05-10

Cleaner setup defaults and a smoother privacy workflow.

### ADDED

- Faster first-run setup for new users
- Cleaner empty state for blocked window keywords
- More reliable update/version checks in the app
- Better support links from the settings panel

### CHANGED

- New installs now start with an empty blocked keyword list
- Auto-protect settings are easier to configure from scratch
- Settings copy is clearer around privacy covers and blocked windows
- App version updated to `v1.2.2`

### FIXED

- Removed unwanted default blocked keywords from fresh installs
- Improved settings type checks for safer saves
- Reduced stale internal UI paths from older debug tools
- Cleaned up minor dependency and audit issues for production runtime

### KNOWN LIMITATIONS

- Some apps may prevent Deskoy from closing or minimizing their windows automatically.
- Browser window titles may not always include the full URL.
- Global hotkey availability can vary if another app already owns the same shortcut.
