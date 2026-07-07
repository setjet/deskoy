#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[cfg(windows)]
use windows::{
    core::GUID,
    Win32::{
        Media::Audio::{
            eConsole, eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        },
    },
};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE},
    System::Threading::{
        CreateMutexW, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        FindWindowW, GetClassNameW, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindow, PostMessageW, SetForegroundWindow,
        ShowWindow, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
    },
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeskoySettings {
    hotkey: String,
    cover_mode: String,
    cover: String,
    #[serde(default = "default_cover_display")]
    cover_display: String,
    cover_url: String,
    cover_file_path: String,
    whitelist: Vec<String>,
    audio_mute: bool,
    enabled: bool,
    use_custom_cover: bool,
    auto_cover_blocked: bool,
    blocked_apps: Vec<String>,
    blocked_websites: Vec<String>,
    blocked_title_keywords: Vec<String>,
    theme: String,
    #[serde(default)]
    compact_mode: bool,
    #[serde(default = "default_font_size")]
    font_size: String,
    #[serde(default)]
    reduce_motion: bool,
}

fn default_cover_display() -> String {
    "all".into()
}

fn default_font_size() -> String {
    "default".into()
}

impl Default for DeskoySettings {
    fn default() -> Self {
        Self {
            hotkey: String::new(),
            cover_mode: "excel".into(),
            cover: "excel".into(),
            cover_display: default_cover_display(),
            cover_url: String::new(),
            cover_file_path: String::new(),
            whitelist: vec!["Teams".into(), "Slack".into(), "Outlook".into()],
            audio_mute: false,
            enabled: false,
            use_custom_cover: false,
            auto_cover_blocked: false,
            blocked_apps: vec![
                "1Password".into(),
                "Bitwarden".into(),
                "KeePass".into(),
                "LastPass".into(),
                "Outlook".into(),
                "Discord".into(),
            ],
            blocked_websites: vec![],
            blocked_title_keywords: vec![],
            theme: "dark".into(),
            compact_mode: false,
            font_size: default_font_size(),
            reduce_motion: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtectionLogEntry {
    timestamp: u128,
    process_name: String,
    title: String,
    action: String,
}

#[derive(Clone, Debug)]
struct CoverSession {
    reason: String,
    trigger: Option<ActiveWindowInfo>,
}

#[derive(Clone, Debug)]
struct ActiveWindowInfo {
    hwnd: i64,
    pid: u32,
    process_name: String,
    title: String,
    _class_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    id: usize,
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
    primary: bool,
}

#[derive(Default)]
struct RuntimeState {
    registered_hotkey: Option<Shortcut>,
    registered_escape: Option<Shortcut>,
    cover_open: bool,
    cover_busy: bool,
    cover_session: Option<CoverSession>,
    cover_open_at: Option<Instant>,
    cover_labels: Vec<String>,
    last_blocked_cover_at: Option<Instant>,
    last_blocked_hwnd: i64,
    last_blocked_pid: u32,
    last_blocked_process_name: String,
    paused_until: Option<Instant>,
    paused_until_restart: bool,
    last_cover_error: String,
    last_cover_fallback: String,
    last_auto_protect_reason: String,
    pending_audio_restore: Option<PendingAudioRestore>,
    updates_cache: Option<(Instant, Value)>,
    app_update_cache: Option<(Instant, Value)>,
    upgrade_block: Option<UpgradeBlock>,
}

#[derive(Clone, Debug)]
enum PendingAudioRestore {
    ComOff(Vec<i32>),
    VkToggle,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpgradeBlock {
    message: String,
    download_url: String,
    minimum_version: Option<String>,
}

struct DeskoyApp {
    settings_path: PathBuf,
    settings: Mutex<DeskoySettings>,
    state: Mutex<RuntimeState>,
}

const FEEDBACK_BUG_COOLDOWN_MS: u128 = 5 * 60 * 60 * 1000;
const UPDATES_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const APP_UPDATE_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const VERSION_POLICY_POLL: Duration = Duration::from_secs(6 * 60 * 60);
const DEFAULT_UPDATER_URL: &str =
    "https://github.com/deskoys/deskoy/releases/latest/download/latest.json";
const DEFAULT_UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQzRTBFMzk4QTVBMUM3ODUKUldTRng2R2xtT1BnUTlwRXY2Z3EyUTl6ZjlJcThiL3FzbkxsaWNibDljWUsxSzVSbE5tZyt3R3IK";
const AUTO_COVER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const BLOCKED_COVER_COOLDOWN: Duration = Duration::from_secs(6);
const BLOCKED_WINDOW_SETTLE_POLL: Duration = Duration::from_millis(25);
const COVER_BEFORE_HIDE_DELAY: Duration = Duration::from_millis(300);
const COVER_MIN_VISIBLE: Duration = Duration::from_millis(700);
const COVER_WATCHDOG_INTERVAL: Duration = Duration::from_millis(700);
const PROTECTION_LOG_LIMIT: usize = 30;

#[cfg(windows)]
struct SingleInstanceGuard {
    handle: HANDLE,
}

#[cfg(windows)]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

#[cfg(not(windows))]
struct SingleInstanceGuard;

#[cfg(windows)]
fn acquire_single_instance_guard() -> Option<SingleInstanceGuard> {
    let name = wide_null("Local\\DeskoySingleInstance");
    unsafe {
        let handle = CreateMutexW(std::ptr::null(), 1, name.as_ptr());
        if handle.is_null() {
            return None;
        }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            focus_existing_main_window();
            None
        } else {
            Some(SingleInstanceGuard { handle })
        }
    }
}

#[cfg(not(windows))]
fn acquire_single_instance_guard() -> Option<SingleInstanceGuard> {
    Some(SingleInstanceGuard)
}

#[cfg(windows)]
fn focus_existing_main_window() {
    let title = wide_null("Deskoy");
    unsafe {
        let hwnd = FindWindowW(std::ptr::null(), title.as_ptr());
        if !hwnd.is_null() {
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn main() {
    let _single_instance = match acquire_single_instance_guard() {
        Some(guard) => guard,
        None => return,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    handle_shortcut_event(app, shortcut, event);
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from(".deskoy"));
            let _ = fs::create_dir_all(&data_dir);
            let settings_path = data_dir.join("settings.json");
            let app_state = Arc::new(DeskoyApp {
                settings: Mutex::new(load_settings_from_path(&settings_path)),
                settings_path,
                state: Mutex::new(RuntimeState::default()),
            });
            app.manage(app_state.clone());
            install_tray(app)?;
            start_auto_cover_watcher(app.handle().clone());
            start_cover_watchdog(app.handle().clone());
            start_version_policy_watcher(app.handle().clone());
            let _ = register_hotkeys(app.handle(), &get_settings_from_state(app.handle()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            get_app_version,
            get_displays,
            get_updates,
            get_state,
            toggle,
            get_settings,
            get_protection_logs,
            clear_protection_logs,
            check_app_update,
            install_app_update,
            save_settings,
            pick_cover_file,
            send_feedback,
            send_bug_report,
            get_diagnostics,
            pause_for_minutes,
            pause_until_restart,
            resume_deskoy,
            window_minimize,
            window_close,
            close_cover
        ])
        .run(tauri::generate_context!())
        .expect("error while running Deskoy");
}

fn app_state(app: &AppHandle) -> Arc<DeskoyApp> {
    app.state::<Arc<DeskoyApp>>().inner().clone()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn load_store(path: &PathBuf) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

fn save_store(path: &PathBuf, store: &Value) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(store) {
        let _ = fs::write(path, text);
    }
}

fn load_protection_logs(app: &AppHandle) -> Vec<ProtectionLogEntry> {
    let state = app_state(app);
    load_store(&state.settings_path)
        .get("protectionLogs")
        .cloned()
        .and_then(|v| serde_json::from_value::<Vec<ProtectionLogEntry>>(v).ok())
        .unwrap_or_default()
}

fn append_activity_log(app: &AppHandle, entry: ProtectionLogEntry) {
    let state = app_state(app);
    let mut store = load_store(&state.settings_path);
    let mut logs = store
        .get("protectionLogs")
        .cloned()
        .and_then(|v| serde_json::from_value::<Vec<ProtectionLogEntry>>(v).ok())
        .unwrap_or_default();
    logs.insert(0, entry);
    logs.truncate(PROTECTION_LOG_LIMIT);
    store["protectionLogs"] = serde_json::to_value(logs).unwrap_or_else(|_| json!([]));
    save_store(&state.settings_path, &store);
}

fn append_protection_log(app: &AppHandle, info: &ActiveWindowInfo) {
    append_activity_log(
        app,
        ProtectionLogEntry {
            timestamp: now_ms(),
            process_name: info.process_name.clone(),
            title: info.title.clone(),
            action: "Covered and hidden".into(),
        },
    );
}

fn cover_activity_title(settings: &DeskoySettings) -> String {
    if settings.cover_mode == "url" && !settings.cover_url.trim().is_empty() {
        return "Custom URL cover".into();
    }
    if settings.cover_mode == "file" && !settings.cover_file_path.trim().is_empty() {
        return "Custom file cover".into();
    }
    let kind = if is_cover_kind(&settings.cover_mode) {
        settings.cover_mode.as_str()
    } else {
        settings.cover.as_str()
    };
    match kind {
        "vscode" => "VS Code cover".into(),
        "docs" => "Google Docs cover".into(),
        "jira" => "Jira Board cover".into(),
        "bi" => "BI Dashboard cover".into(),
        "black" => "Blank cover".into(),
        _ => "Excel Spreadsheet cover".into(),
    }
}

fn append_cover_activation_log(app: &AppHandle, settings: &DeskoySettings) {
    append_activity_log(
        app,
        ProtectionLogEntry {
            timestamp: now_ms(),
            process_name: "Deskoy".into(),
            title: cover_activity_title(settings),
            action: "Cover activated".into(),
        },
    );
}

fn clear_protection_logs_from_store(app: &AppHandle) {
    let state = app_state(app);
    let mut store = load_store(&state.settings_path);
    store["protectionLogs"] = json!([]);
    save_store(&state.settings_path, &store);
}

fn report_runtime_error(app: &AppHandle, area: &str, error: impl Into<String>) {
    let error = error.into();
    eprintln!("[deskoy:{area}] {error}");
    if area == "cover" || area == "watchdog" || area == "hotkey" {
        app_state(app).state.lock().unwrap().last_cover_error = format!("{area}: {error}");
    }
    let _ = app.emit("deskoy:runtimeError", json!({ "area": area, "error": error }));
}

fn get_settings_from_state(app: &AppHandle) -> DeskoySettings {
    let state = app_state(app);
    let settings = state.settings.lock().unwrap().clone();
    settings
}

fn load_settings_from_path(path: &PathBuf) -> DeskoySettings {
    let store = load_store(path);
    normalize_settings(
        store
            .get("settings")
            .cloned()
            .and_then(|v| serde_json::from_value::<DeskoySettings>(v).ok())
            .unwrap_or_default(),
    )
}

fn normalize_settings(mut settings: DeskoySettings) -> DeskoySettings {
    settings.cover_display = normalize_cover_display(&settings.cover_display);
    settings.font_size = normalize_font_size(&settings.font_size);
    if settings.use_custom_cover == false
        && (settings.cover_mode == "url" || settings.cover_mode == "file")
    {
        settings.use_custom_cover = true;
    }
    if settings.blocked_websites.is_empty() && !settings.blocked_title_keywords.is_empty() {
        let mut websites = Vec::new();
        let mut keywords = Vec::new();
        for rule in settings.blocked_title_keywords {
            if hostname_from_rule(&normalize_blocked_rule(&rule)).is_some() {
                websites.push(rule);
            } else {
                keywords.push(rule);
            }
        }
        settings.blocked_websites = normalized_unique_lines(websites);
        settings.blocked_title_keywords = normalized_unique_lines(keywords);
    } else {
        settings.blocked_websites = normalized_unique_lines(settings.blocked_websites);
        settings.blocked_title_keywords = normalized_unique_lines(settings.blocked_title_keywords);
    }
    settings
}

fn normalize_font_size(value: &str) -> String {
    match value.trim() {
        "small" => "small".into(),
        "large" => "large".into(),
        _ => "default".into(),
    }
}

fn normalize_cover_display(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed == "all" {
        return "all".into();
    }
    let Some(index) = trimmed.strip_prefix("monitor:") else {
        return "all".into();
    };
    match index.parse::<usize>() {
        Ok(index) => format!("monitor:{index}"),
        Err(_) => "all".into(),
    }
}

fn selected_monitor_indices(settings: &DeskoySettings, monitor_count: usize) -> Vec<usize> {
    if monitor_count == 0 {
        return Vec::new();
    }
    if let Some(index) = settings
        .cover_display
        .strip_prefix("monitor:")
        .and_then(|index| index.parse::<usize>().ok())
    {
        return vec![index.min(monitor_count - 1)];
    }
    (0..monitor_count).collect()
}

fn normalized_unique_lines(lines: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = lines
        .into_iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    out.sort_by_key(|line| line.to_lowercase());
    out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    out
}

fn set_settings_in_state(app: &AppHandle, patch: Value) -> DeskoySettings {
    let state = app_state(app);
    let mut current =
        serde_json::to_value(get_settings_from_state(app)).unwrap_or_else(|_| json!({}));
    if let (Value::Object(cur), Value::Object(patch_obj)) = (&mut current, patch) {
        for (key, value) in patch_obj {
            if key != "autostart" && key != "closeEverythingOnTrigger" {
                cur.insert(key, value);
            }
        }
    }
    let settings = normalize_settings(serde_json::from_value(current).unwrap_or_default());
    let mut store = load_store(&state.settings_path);
    store["settings"] = serde_json::to_value(&settings).unwrap_or_else(|_| json!({}));
    save_store(&state.settings_path, &store);
    *state.settings.lock().unwrap() = settings.clone();
    settings
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit(
        "deskoy:stateChanged",
        json!({ "active": effective_enabled(app), "paused": is_paused(app) }),
    );
}

fn is_pause_active(rt: &RuntimeState) -> bool {
    rt.paused_until_restart
        || rt
            .paused_until
            .map(|until| until > Instant::now())
            .unwrap_or(false)
}

fn is_paused(app: &AppHandle) -> bool {
    let state = app_state(app);
    let rt = state.state.lock().unwrap();
    is_pause_active(&rt)
}

fn effective_enabled(app: &AppHandle) -> bool {
    get_settings_from_state(app).enabled && !is_paused(app)
}

fn pause_label(app: &AppHandle) -> Value {
    let state = app_state(app);
    let rt = state.state.lock().unwrap();
    if rt.paused_until_restart {
        json!({ "active": true, "mode": "restart" })
    } else if let Some(until) = rt.paused_until {
        if until > Instant::now() {
            json!({
                "active": true,
                "mode": "timer",
                "remainingMs": until.duration_since(Instant::now()).as_millis()
            })
        } else {
            json!({ "active": false })
        }
    } else {
        json!({ "active": false })
    }
}

fn set_pause_until(app: &AppHandle, until: Option<Instant>, until_restart: bool) {
    {
        let state = app_state(app);
        let mut rt = state.state.lock().unwrap();
        rt.paused_until = until;
        rt.paused_until_restart = until_restart;
    }
    let _ = register_hotkeys(app, &get_settings_from_state(app));
    emit_state(app);
}

async fn pause_for_duration(app: AppHandle, duration: Duration) -> Value {
    close_cover_session(&app).await;
    let until = Instant::now() + duration;
    set_pause_until(&app, Some(until), false);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(duration).await;
        let should_resume = {
            let state = app_state(&app2);
            let rt = state.state.lock().unwrap();
            !rt.paused_until_restart
                && rt
                    .paused_until
                    .map(|stored| stored <= Instant::now())
                    .unwrap_or(false)
        };
        if should_resume {
            set_pause_until(&app2, None, false);
        }
    });
    json!({ "ok": true, "paused": pause_label(&app) })
}

async fn pause_until_restart_inner(app: AppHandle) -> Value {
    close_cover_session(&app).await;
    set_pause_until(&app, None, true);
    json!({ "ok": true, "paused": pause_label(&app) })
}

fn resume_deskoy_inner(app: &AppHandle) -> Value {
    set_pause_until(app, None, false);
    json!({ "ok": true, "active": effective_enabled(app) })
}

fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Settings", true, None::<&str>)?;
    let toggle_item = MenuItem::with_id(app, "toggle", "Toggle Deskoy", true, None::<&str>)?;
    let pause_5 = MenuItem::with_id(app, "pause_5", "Pause for 5 minutes", true, None::<&str>)?;
    let pause_15 = MenuItem::with_id(app, "pause_15", "Pause for 15 minutes", true, None::<&str>)?;
    let pause_30 = MenuItem::with_id(app, "pause_30", "Pause for 30 minutes", true, None::<&str>)?;
    let pause_restart =
        MenuItem::with_id(app, "pause_restart", "Pause until restart", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume Deskoy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &toggle_item,
            &PredefinedMenuItem::separator(app)?,
            &pause_5,
            &pause_15,
            &pause_30,
            &pause_restart,
            &resume,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Deskoy")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "toggle" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = toggle(app).await;
                });
            }
            "pause_5" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = pause_for_duration(app, Duration::from_secs(5 * 60)).await;
                });
            }
            "pause_15" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = pause_for_duration(app, Duration::from_secs(15 * 60)).await;
                });
            }
            "pause_30" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = pause_for_duration(app, Duration::from_secs(30 * 60)).await;
                });
            }
            "pause_restart" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = pause_until_restart_inner(app).await;
                });
            }
            "resume" => {
                let _ = resume_deskoy_inner(app);
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    emit_state(app);
}

fn handle_shortcut_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let (should_toggle, should_escape) = {
        let state = app_state(app);
        let rt = state.state.lock().unwrap();
        (
            rt.registered_hotkey
                .as_ref()
                .map(|hk| hk == shortcut)
                .unwrap_or(false),
            rt.registered_escape
                .as_ref()
                .map(|hk| hk == shortcut)
                .unwrap_or(false),
        )
    };
    if should_toggle {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            toggle_cover_via_hotkey(app2).await;
        });
    } else if should_escape {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            close_cover_session(&app2).await;
        });
    }
}

fn parse_hotkey(combo: &str) -> Option<Shortcut> {
    let parts: Vec<String> = combo
        .split('+')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    let mut mods = Modifiers::empty();
    let mut code = None;
    for part in parts {
        match part.as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            "meta" | "cmd" | "command" | "win" | "super" => mods |= Modifiers::SUPER,
            key => code = code_from_key(key),
        }
    }
    code.map(|c| Shortcut::new(Some(mods), c))
}

fn code_from_key(key: &str) -> Option<Code> {
    match key {
        "a" => Some(Code::KeyA),
        "b" => Some(Code::KeyB),
        "c" => Some(Code::KeyC),
        "d" => Some(Code::KeyD),
        "e" => Some(Code::KeyE),
        "f" => Some(Code::KeyF),
        "g" => Some(Code::KeyG),
        "h" => Some(Code::KeyH),
        "i" => Some(Code::KeyI),
        "j" => Some(Code::KeyJ),
        "k" => Some(Code::KeyK),
        "l" => Some(Code::KeyL),
        "m" => Some(Code::KeyM),
        "n" => Some(Code::KeyN),
        "o" => Some(Code::KeyO),
        "p" => Some(Code::KeyP),
        "q" => Some(Code::KeyQ),
        "r" => Some(Code::KeyR),
        "s" => Some(Code::KeyS),
        "t" => Some(Code::KeyT),
        "u" => Some(Code::KeyU),
        "v" => Some(Code::KeyV),
        "w" => Some(Code::KeyW),
        "x" => Some(Code::KeyX),
        "y" => Some(Code::KeyY),
        "z" => Some(Code::KeyZ),
        "0" => Some(Code::Digit0),
        "1" => Some(Code::Digit1),
        "2" => Some(Code::Digit2),
        "3" => Some(Code::Digit3),
        "4" => Some(Code::Digit4),
        "5" => Some(Code::Digit5),
        "6" => Some(Code::Digit6),
        "7" => Some(Code::Digit7),
        "8" => Some(Code::Digit8),
        "9" => Some(Code::Digit9),
        "escape" | "esc" => Some(Code::Escape),
        "space" | " " => Some(Code::Space),
        "f1" => Some(Code::F1),
        "f2" => Some(Code::F2),
        "f3" => Some(Code::F3),
        "f4" => Some(Code::F4),
        "f5" => Some(Code::F5),
        "f6" => Some(Code::F6),
        "f7" => Some(Code::F7),
        "f8" => Some(Code::F8),
        "f9" => Some(Code::F9),
        "f10" => Some(Code::F10),
        "f11" => Some(Code::F11),
        "f12" => Some(Code::F12),
        _ => None,
    }
}

fn escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

fn register_hotkeys(app: &AppHandle, settings: &DeskoySettings) -> bool {
    let state = app_state(app);
    let mut rt = state.state.lock().unwrap();
    if let Some(old) = rt.registered_hotkey.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Some(old) = rt.registered_escape.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    if !settings.enabled || is_pause_active(&rt) {
        return true;
    }
    let escape = escape_shortcut();
    match app.global_shortcut().register(escape) {
        Ok(()) => {
            rt.registered_escape = Some(escape);
        }
        Err(err) => {
            rt.last_cover_error = format!("hotkey: failed to register Escape: {err}");
        }
    }
    if settings.hotkey.trim().is_empty() {
        return true;
    }
    let Some(hotkey) = parse_hotkey(&settings.hotkey) else {
        return false;
    };
    if app.global_shortcut().register(hotkey).is_ok() {
        rt.registered_hotkey = Some(hotkey);
        true
    } else {
        false
    }
}

async fn toggle_cover_via_hotkey(app: AppHandle) {
    if !effective_enabled(&app) {
        return;
    }
    let should_open = {
        let state = app_state(&app);
        let mut rt = state.state.lock().unwrap();
        if rt.cover_busy {
            return;
        }
        if !rt.cover_open {
            rt.cover_open = true;
            rt.cover_busy = true;
            rt.cover_session = Some(CoverSession {
                reason: "manual".into(),
                trigger: None,
            });
            true
        } else {
            false
        }
    };
    if should_open {
        let settings = get_settings_from_state(&app);
        let app2 = app.clone();
        let mute = settings.audio_mute;
        let cover_settings = settings.clone();
        let cover = tauri::async_runtime::spawn(async move {
            open_cover_from_settings(&app2, &cover_settings).await
        });
        let app3 = app.clone();
        let audio = tauri::async_runtime::spawn(async move {
            on_cover_open_audio(&app3, mute).await;
        });
        let cover_opened = cover.await.unwrap_or(false);
        let _ = audio.await;
        if !cover_opened {
            on_cover_close_audio(&app).await;
            let state = app_state(&app);
            let mut rt = state.state.lock().unwrap();
            rt.cover_open = false;
            rt.cover_busy = false;
            rt.cover_open_at = None;
            rt.cover_session = None;
            return;
        }
        append_cover_activation_log(&app, &settings);
        app_state(&app).state.lock().unwrap().cover_busy = false;
    } else {
        close_cover_session(&app).await;
    }
}

async fn open_cover_from_settings(app: &AppHandle, settings: &DeskoySettings) -> bool {
    if cover_window_exists(app) {
        return true;
    }
    match open_cover_windows(app, settings, false) {
        Ok(labels) if !labels.is_empty() => {
            let state = app_state(app);
            let mut rt = state.state.lock().unwrap();
            rt.cover_labels = labels;
            rt.cover_open_at = Some(Instant::now());
            true
        }
        Ok(_) => false,
        Err(err) => {
            report_runtime_error(app, "cover", err);
            close_cover_window(app);
            match open_cover_windows(app, settings, true) {
                Ok(labels) if !labels.is_empty() => {
                    let reason = "Cover failed, using black fallback.";
                    {
                        let state = app_state(app);
                        let mut rt = state.state.lock().unwrap();
                        rt.cover_labels = labels;
                        rt.cover_open_at = Some(Instant::now());
                        rt.last_cover_fallback = reason.into();
                    }
                    let _ = app.emit("deskoy:coverFallback", json!({ "reason": reason }));
                    true
                }
                Ok(_) => false,
                Err(err) => {
                    report_runtime_error(app, "cover", format!("failed to build black fallback: {err}"));
                    false
                }
            }
        }
    }
}

fn cover_window_label(index: usize) -> String {
    if index == 0 {
        "cover".into()
    } else {
        format!("cover-{index}")
    }
}

fn known_cover_labels(app: &AppHandle) -> Vec<String> {
    let mut labels = app_state(app).state.lock().unwrap().cover_labels.clone();
    if labels.is_empty() {
        labels.push("cover".into());
    }
    for index in 1..16 {
        let label = cover_window_label(index);
        if app.get_webview_window(&label).is_some() && !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels
}

fn cover_window_exists(app: &AppHandle) -> bool {
    known_cover_labels(app)
        .iter()
        .any(|label| app.get_webview_window(label).is_some())
}

fn open_cover_windows(
    app: &AppHandle,
    settings: &DeskoySettings,
    force_blank: bool,
) -> Result<Vec<String>, String> {
    let monitors = app.available_monitors().unwrap_or_default();
    let mut labels = Vec::new();
    if monitors.is_empty() {
        labels.push(build_cover_window(app, "cover", settings, force_blank, None, true)?);
        return Ok(labels);
    }
    for (label_index, monitor_index) in selected_monitor_indices(settings, monitors.len())
        .into_iter()
        .enumerate()
    {
        let Some(monitor) = monitors.get(monitor_index) else {
            continue;
        };
        let label = cover_window_label(label_index);
        match build_cover_window(app, &label, settings, force_blank, Some(monitor), label_index == 0) {
            Ok(label) => labels.push(label),
            Err(err) => {
                for label in labels {
                    if let Some(win) = app.get_webview_window(&label) {
                        let _ = win.close();
                    }
                }
                return Err(err);
            }
        }
    }
    Ok(labels)
}

fn build_cover_window(
    app: &AppHandle,
    label: &str,
    settings: &DeskoySettings,
    force_blank: bool,
    monitor: Option<&Monitor>,
    focus: bool,
) -> Result<String, String> {
    let mut builder = WebviewWindowBuilder::new(app, label, cover_webview_url(settings, force_blank))
        .title("Cover")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .background_color(tauri::utils::config::Color(0, 0, 0, 255));
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor().max(1.0);
        let position = monitor.position();
        let size = monitor.size();
        builder = builder
            .position(position.x as f64 / scale, position.y as f64 / scale)
            .inner_size(size.width as f64 / scale, size.height as f64 / scale);
    } else {
        builder = builder.fullscreen(true);
    }
    let win = builder
        .build()
        .map_err(|err| format!("failed to build cover window {label}: {err}"))?;
    if let Err(err) = win.set_fullscreen(true) {
        report_runtime_error(app, "cover", format!("failed to fullscreen cover {label}: {err}"));
    }
    win.show()
        .map_err(|err| format!("failed to show cover window {label}: {err}"))?;
    if let Err(err) = win.set_always_on_top(true) {
        report_runtime_error(app, "cover", format!("failed to pin cover {label}: {err}"));
    }
    if focus {
        if let Err(err) = win.set_focus() {
            report_runtime_error(app, "cover", format!("failed to focus cover {label}: {err}"));
        }
    }
    Ok(label.to_string())
}

fn cover_webview_url(settings: &DeskoySettings, force_blank: bool) -> WebviewUrl {
    if force_blank || settings.cover_mode == "black" {
        return WebviewUrl::App("cover/blank.html".into());
    }
    if settings.cover_mode == "url" {
        if let Ok(url) = Url::parse(settings.cover_url.trim()) {
            return WebviewUrl::External(url);
        }
    }
    if settings.cover_mode == "file" {
        if let Ok(url) = Url::from_file_path(settings.cover_file_path.trim()) {
            return WebviewUrl::External(url);
        }
    }
    let kind = if is_cover_kind(&settings.cover_mode) {
        settings.cover_mode.as_str()
    } else {
        settings.cover.as_str()
    };
    let file = match kind {
        "vscode" => "vscode.html",
        "docs" => "docs.html",
        "jira" => "jira.html",
        "bi" => "bi.html",
        _ => "excel.html",
    };
    WebviewUrl::App(format!("cover/{file}").into())
}

fn is_cover_kind(mode: &str) -> bool {
    matches!(mode, "excel" | "vscode" | "docs" | "jira" | "bi" | "black")
}

fn close_cover_window(app: &AppHandle) {
    for label in known_cover_labels(app) {
        if let Some(win) = app.get_webview_window(&label) {
            if let Err(err) = win.close() {
                report_runtime_error(app, "cover", format!("failed to close {label}: {err}"));
            }
        }
    }
    app_state(app).state.lock().unwrap().cover_labels.clear();
}

async fn close_cover_session(app: &AppHandle) {
    {
        let state = app_state(app);
        let mut rt = state.state.lock().unwrap();
        if rt.cover_busy {
            return;
        }
        rt.cover_busy = true;
        let blocked_trigger = rt
            .cover_session
            .as_ref()
            .filter(|session| session.reason == "blocked")
            .and_then(|session| session.trigger.clone());
        if let Some(trigger) = blocked_trigger {
            rt.last_blocked_cover_at = Some(Instant::now());
            rt.last_blocked_hwnd = trigger.hwnd;
            rt.last_blocked_pid = trigger.pid;
            rt.last_blocked_process_name = trigger.process_name.to_lowercase();
        }
        rt.cover_open = false;
        rt.cover_open_at = None;
        rt.cover_labels.clear();
        rt.cover_session = None;
    }
    close_cover_window(app);
    on_cover_close_audio(app).await;
    app_state(app).state.lock().unwrap().cover_busy = false;
}

async fn open_cover_if_allowed(app: AppHandle, trigger: Option<ActiveWindowInfo>) {
    let settings = get_settings_from_state(&app);
    if !settings.enabled || is_paused(&app) {
        return;
    }
    {
        let state = app_state(&app);
        let mut rt = state.state.lock().unwrap();
        if rt.cover_open || rt.cover_busy {
            return;
        }
        if rt
            .last_blocked_cover_at
            .map(|t| t.elapsed() < BLOCKED_COVER_COOLDOWN)
            .unwrap_or(false)
        {
            return;
        }
        if let Some(info) = &trigger {
            let same_hwnd = rt.last_blocked_hwnd != 0
                && info.hwnd == rt.last_blocked_hwnd
                && info.pid == rt.last_blocked_pid;
            let same_process = !rt.last_blocked_process_name.is_empty()
                && info.process_name.to_lowercase() == rt.last_blocked_process_name;
            if same_hwnd || same_process {
                return;
            }
        }
        rt.last_blocked_cover_at = Some(Instant::now());
        rt.cover_open = true;
        rt.cover_busy = true;
        rt.cover_session = Some(CoverSession {
            reason: "blocked".into(),
            trigger: trigger.clone(),
        });
    }

    let mut cover_settings = settings.clone();
    cover_settings.use_custom_cover = false;
    cover_settings.cover_mode = cover_settings.cover.clone();
    cover_settings.cover_url.clear();
    cover_settings.cover_file_path.clear();
    if let Some(info) = &trigger {
        append_protection_log(&app, info);
    }
    let app2 = app.clone();
    let cover = tauri::async_runtime::spawn(async move {
        open_cover_from_settings(&app2, &cover_settings).await
    });
    let cover_opened = cover.await.unwrap_or(false);
    if !cover_opened {
        let state = app_state(&app);
        let mut rt = state.state.lock().unwrap();
        rt.cover_open = false;
        rt.cover_busy = false;
        rt.cover_open_at = None;
        rt.cover_session = None;
        return;
    }
    if let Some(t) = &trigger {
        tokio::time::sleep(COVER_BEFORE_HIDE_DELAY).await;
        if !close_blocked_window(t).await {
            report_runtime_error(
                &app,
                "blocked-window",
                format!("failed to hide blocked window: {}", t.process_name),
            );
        }
    }
    app_state(&app).state.lock().unwrap().cover_busy = false;

    if let Some(info) = trigger {
        let app3 = app.clone();
        tauri::async_runtime::spawn(async move {
            let started = Instant::now();
            loop {
                tokio::time::sleep(BLOCKED_WINDOW_SETTLE_POLL).await;
                if started.elapsed() > Duration::from_millis(4500) {
                    close_cover_session(&app3).await;
                    break;
                }
                if is_blocked_window_gone_or_minimized(info.hwnd, info.pid) {
                    let remaining = {
                        let state = app_state(&app3);
                        let rt = state.state.lock().unwrap();
                        rt.cover_open_at
                            .map(|t| COVER_MIN_VISIBLE.saturating_sub(t.elapsed()))
                            .unwrap_or_default()
                    };
                    if !remaining.is_zero() {
                        tokio::time::sleep(remaining).await;
                    }
                    close_cover_session(&app3).await;
                    break;
                }
            }
        });
    } else {
        let app3 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            close_cover_session(&app3).await;
        });
    }
}

fn start_cover_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(COVER_WATCHDOG_INTERVAL).await;
            let labels = {
                let state = app_state(&app);
                let rt = state.state.lock().unwrap();
                if !rt.cover_open || rt.cover_busy {
                    continue;
                }
                rt.cover_labels.clone()
            };
            if labels.is_empty() {
                recover_cover_from_watchdog(&app, "Cover watchdog found no cover windows.").await;
                continue;
            }
            let mut needs_recovery = false;
            for label in &labels {
                let Some(win) = app.get_webview_window(label) else {
                    needs_recovery = true;
                    break;
                };
                match win.is_visible() {
                    Ok(true) => {}
                    Ok(false) | Err(_) => {
                        needs_recovery = true;
                        break;
                    }
                }
                if let Err(err) = win.set_always_on_top(true) {
                    report_runtime_error(
                        &app,
                        "watchdog",
                        format!("failed to re-pin {label}: {err}"),
                    );
                }
            }
            if needs_recovery {
                recover_cover_from_watchdog(&app, "Cover watchdog restored black fallback.").await;
            }
        }
    });
}

async fn recover_cover_from_watchdog(app: &AppHandle, reason: &str) {
    {
        let state = app_state(app);
        let mut rt = state.state.lock().unwrap();
        if rt.cover_busy {
            return;
        }
        rt.cover_busy = true;
        rt.last_cover_error = reason.into();
    }
    close_cover_window(app);
    let settings = get_settings_from_state(app);
    match open_cover_windows(app, &settings, true) {
        Ok(labels) if !labels.is_empty() => {
            {
                let state = app_state(app);
                let mut rt = state.state.lock().unwrap();
                rt.cover_open = true;
                rt.cover_labels = labels;
                rt.cover_open_at = Some(Instant::now());
                rt.cover_busy = false;
                rt.last_cover_fallback = reason.into();
            }
            let _ = app.emit("deskoy:coverFallback", json!({ "reason": reason }));
        }
        Ok(_) => {
            let state = app_state(app);
            let mut rt = state.state.lock().unwrap();
            rt.cover_open = false;
            rt.cover_open_at = None;
            rt.cover_busy = false;
            rt.cover_labels.clear();
        }
        Err(err) => {
            report_runtime_error(app, "watchdog", err);
            let state = app_state(app);
            let mut rt = state.state.lock().unwrap();
            rt.cover_open = false;
            rt.cover_open_at = None;
            rt.cover_busy = false;
            rt.cover_labels.clear();
        }
    }
}

fn start_auto_cover_watcher(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(AUTO_COVER_POLL_INTERVAL);
        let s = get_settings_from_state(&app);
        if !s.enabled || is_paused(&app) || !s.auto_cover_blocked {
            continue;
        }
        {
            let state = app_state(&app);
            let mut rt = state.state.lock().unwrap();
            if rt.cover_open || rt.cover_busy {
                continue;
            }
            if rt
                .last_blocked_cover_at
                .map(|t| t.elapsed() >= BLOCKED_COVER_COOLDOWN)
                .unwrap_or(false)
            {
                rt.last_blocked_hwnd = 0;
                rt.last_blocked_pid = 0;
                rt.last_blocked_process_name.clear();
            }
        }
        if let Some(info) = get_active_window_info() {
            let Some(reason) = blocked_app_reason(&info, &s) else {
                continue;
            };
            app_state(&app).state.lock().unwrap().last_auto_protect_reason = reason;
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                open_cover_if_allowed(app2, Some(info)).await;
            });
        }
    });
}

fn is_deskoy_window(info: &ActiveWindowInfo) -> bool {
    info.process_name.to_lowercase().contains("deskoy")
}

fn blocked_app_reason(info: &ActiveWindowInfo, settings: &DeskoySettings) -> Option<String> {
    if is_deskoy_window(info) || is_whitelisted_process(&info.process_name, &settings.whitelist) {
        return None;
    }
    if let Some(rule) = settings
        .blocked_apps
        .iter()
        .find(|rule| process_rule_matches(&info.process_name, rule))
    {
        return Some(format!("app rule matched: {rule}"));
    }
    if let Some(rule) = settings
        .blocked_websites
        .iter()
        .find(|rule| website_rule_matches_window(info, rule))
    {
        return Some(format!("website rule matched: {rule}"));
    }
    settings
        .blocked_title_keywords
        .iter()
        .find(|rule| blocked_title_rule_matches(&info.title, rule))
        .map(|rule| format!("title keyword matched: {rule}"))
}

fn is_whitelisted_process(process_name: &str, whitelist: &[String]) -> bool {
    whitelist
        .iter()
        .any(|rule| process_rule_matches(process_name, rule))
}

fn process_rule_matches(process_name: &str, raw_rule: &str) -> bool {
    let process = normalize_process_identifier(process_name);
    let rule = normalize_process_identifier(raw_rule);
    if rule.is_empty() || process.is_empty() {
        return false;
    }
    if process.eq_ignore_ascii_case(&rule) {
        return true;
    }

    let process_tokens = identifier_tokens(&process);
    let rule_tokens = identifier_tokens(&rule);
    !rule_tokens.is_empty() && contains_token_sequence(&process_tokens, &rule_tokens)
}

fn normalize_process_identifier(value: &str) -> String {
    let value = value.trim().trim_matches('"').trim_matches('\'');
    let file_name = value
        .rsplit(&['\\', '/'][..])
        .next()
        .unwrap_or(value)
        .trim();
    strip_case_insensitive_suffix(file_name, ".exe")
        .trim()
        .to_string()
}

fn strip_case_insensitive_suffix<'a>(value: &'a str, suffix: &str) -> &'a str {
    if value.to_ascii_lowercase().ends_with(suffix) {
        &value[..value.len() - suffix.len()]
    } else {
        value
    }
}

fn identifier_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut prev_lower_or_digit = false;
    let chars: Vec<char> = value.chars().collect();

    for (index, ch) in chars.iter().copied().enumerate() {
        if ch.is_ascii_alphanumeric() {
            let next_is_lower = chars
                .get(index + 1)
                .map(|next| next.is_ascii_lowercase())
                .unwrap_or(false);
            if ch.is_ascii_uppercase()
                && !current.is_empty()
                && (prev_lower_or_digit || next_is_lower)
            {
                tokens.push(current.to_lowercase());
                current.clear();
            }
            current.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        } else {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            prev_lower_or_digit = false;
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn contains_token_sequence(haystack: &[String], needle: &[String]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn website_rule_matches_title(title: &str, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    hostname_from_rule(&rule)
        .map(|host| title_contains_hostname(title, &host))
        .unwrap_or(false)
}

fn website_rule_matches_window(info: &ActiveWindowInfo, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    let Some(host) = hostname_from_rule(&rule) else {
        return false;
    };
    if is_browser_process(&info.process_name) {
        title_contains_hostname(&info.title, &host)
            || browser_title_matches_host(&info.title, &info.process_name, &host)
    } else {
        title_contains_explicit_url_hostname(&info.title, &host)
    }
}

fn is_browser_process(process_name: &str) -> bool {
    let compact = identifier_tokens(&normalize_process_identifier(process_name)).join("");
    matches!(
        compact.as_str(),
        "arc"
            | "brave"
            | "bravebrowser"
            | "chrome"
            | "chromium"
            | "duckduckgo"
            | "firefox"
            | "iexplore"
            | "librewolf"
            | "msedge"
            | "opera"
            | "operagx"
            | "torbrowser"
            | "vivaldi"
            | "waterfox"
            | "zen"
    )
}

fn blocked_title_rule_matches(title: &str, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    if rule.is_empty() {
        return false;
    }
    if hostname_from_rule(&rule).is_some() {
        return website_rule_matches_title(title, &rule);
    }

    let title = title.to_lowercase();
    expand_keyword_rule(&rule)
        .iter()
        .any(|needle| contains_bounded_phrase(&title, needle))
}

fn browser_title_matches_host(title: &str, process_name: &str, host: &str) -> bool {
    if !is_browser_process(process_name) {
        return false;
    }
    let title = browser_page_title(title).to_lowercase();
    host_title_phrases(host)
        .iter()
        .any(|phrase| contains_bounded_phrase(&title, phrase))
}

fn browser_page_title(title: &str) -> String {
    let mut page_title = title.trim();
    loop {
        let mut trimmed = false;
        for separator in [" - ", " — ", " – "] {
            if let Some((before, suffix)) = page_title.rsplit_once(separator) {
                if is_browser_title_suffix(suffix) {
                    page_title = before.trim();
                    trimmed = true;
                    break;
                }
            }
        }
        if !trimmed {
            break;
        }
    }
    page_title.to_string()
}

fn is_browser_title_suffix(value: &str) -> bool {
    let suffix = identifier_tokens(value).join("");
    matches!(
        suffix.as_str(),
        "arc"
            | "brave"
            | "bravebrowser"
            | "chrome"
            | "chromium"
            | "duckduckgo"
            | "firefox"
            | "googlechrome"
            | "internetexplorer"
            | "librewolf"
            | "microsoftedge"
            | "mozillafirefox"
            | "opera"
            | "operagx"
            | "torbrowser"
            | "vivaldi"
            | "waterfox"
            | "zen"
            | "zenbrowser"
    )
}

fn host_title_phrases(host: &str) -> Vec<String> {
    let host = strip_www(host);
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Vec::new();
    }

    let mut phrases = Vec::new();
    let registrable = parts[parts.len().saturating_sub(2)];
    if is_meaningful_host_label(registrable) {
        phrases.push(registrable.replace('-', " "));
    }

    for part in &parts[..parts.len().saturating_sub(1)] {
        if is_meaningful_host_label(part) {
            phrases.push(part.replace('-', " "));
        }
    }

    phrases.sort();
    phrases.dedup();
    phrases
}

fn is_meaningful_host_label(label: &str) -> bool {
    !matches!(
        label,
        "ac" | "accounts" | "app" | "apps" | "auth" | "cdn" | "co" | "com" | "edu" | "gov"
            | "io" | "login" | "m" | "mail" | "mobile" | "net" | "org" | "secure"
            | "signin" | "www" | "www2"
    )
}

fn normalize_blocked_rule(raw: &str) -> String {
    raw.trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_lowercase()
}

fn hostname_from_rule(rule: &str) -> Option<String> {
    let candidate = rule
        .strip_prefix("http://")
        .or_else(|| rule.strip_prefix("https://"))
        .unwrap_or(rule);
    let host = candidate
        .split(&['/', '?', '#'][..])
        .next()
        .unwrap_or("")
        .split('@')
        .last()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_matches('.');

    if is_specific_hostname(host) {
        Some(strip_www(host).to_string())
    } else {
        None
    }
}

fn is_specific_hostname(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            part.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                && !part.starts_with('-')
                && !part.ends_with('-')
        })
}

fn strip_www(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
}

fn title_contains_hostname(title: &str, host: &str) -> bool {
    let host = strip_www(host);
    title_hostname_candidates(title)
        .into_iter()
        .map(|(candidate, _explicit_url)| candidate)
        .any(|candidate| candidate == host || candidate.ends_with(&format!(".{host}")))
}

fn title_contains_explicit_url_hostname(title: &str, host: &str) -> bool {
    let host = strip_www(host);
    title_hostname_candidates(title)
        .into_iter()
        .filter(|(_candidate, explicit_url)| *explicit_url)
        .map(|(candidate, _explicit_url)| candidate)
        .any(|candidate| candidate == host || candidate.ends_with(&format!(".{host}")))
}

fn title_hostname_candidates(title: &str) -> Vec<(String, bool)> {
    title
        .to_lowercase()
        .split(|ch: char| {
            !(ch.is_ascii_alphanumeric()
                || ch == '-'
                || ch == '.'
                || ch == ':'
                || ch == '/'
                || ch == '@')
        })
        .filter_map(|token| {
            let token = token.trim_matches('.');
            let explicit_url = token.starts_with("http://") || token.starts_with("https://");
            hostname_from_title_token(token).map(|host| (host, explicit_url))
        })
        .collect()
}

fn hostname_from_title_token(token: &str) -> Option<String> {
    let token = token
        .trim_matches('.')
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('@')
        .last()
        .unwrap_or("")
        .split(&['/', '?', '#'][..])
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_matches('.');

    if is_specific_hostname(token) {
        Some(strip_www(token).to_string())
    } else {
        None
    }
}

fn expand_keyword_rule(rule: &str) -> Vec<String> {
    let mut out = Vec::new();
    out.push(rule.to_string());
    if rule.contains('\\') || rule.contains('/') {
        if let Some(base) = rule
            .split(&['\\', '/'][..])
            .filter(|p| !p.is_empty())
            .last()
        {
            if base != rule {
                out.push(base.into());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn contains_bounded_phrase(title: &str, needle: &str) -> bool {
    let needle = needle.trim();
    if needle.is_empty() {
        return false;
    }
    title.match_indices(needle)
        .any(|(start, _)| has_phrase_boundaries(title, start, needle.len()))
}

fn has_phrase_boundaries(text: &str, start: usize, len: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[start + len..].chars().next();
    before.map(is_keyword_boundary).unwrap_or(true) && after.map(is_keyword_boundary).unwrap_or(true)
}

fn is_keyword_boundary(ch: char) -> bool {
    !ch.is_ascii_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_info(process_name: &str, title: &str) -> ActiveWindowInfo {
        ActiveWindowInfo {
            hwnd: 1,
            pid: 1,
            process_name: process_name.into(),
            title: title.into(),
            _class_name: String::new(),
        }
    }

    #[test]
    fn domain_rules_require_hostname_tokens() {
        assert!(website_rule_matches_title(
            "https://mail.gmail.com/mail/u/0/#inbox - Google Chrome",
            "gmail.com"
        ));
        assert!(website_rule_matches_title(
            "Inbox - https://gmail.com - Google Chrome",
            "https://gmail.com"
        ));
        assert!(!website_rule_matches_title(
            "Gmail - New Tab - Google Chrome",
            "gmail.com"
        ));
        assert!(!website_rule_matches_title(
            "https://gmail.com.evil.test - Google Chrome",
            "gmail.com"
        ));
    }

    #[test]
    fn website_rules_prefer_browser_or_explicit_url_context() {
        assert!(website_rule_matches_window(
            &active_info("chrome", "https://mail.gmail.com/mail/u/0/#inbox - Google Chrome"),
            "gmail.com"
        ));
        assert!(website_rule_matches_window(
            &active_info("notepad", "Notes - https://gmail.com - Notepad"),
            "gmail.com"
        ));
        assert!(!website_rule_matches_window(
            &active_info("notepad", "gmail.com notes.txt - Notepad"),
            "gmail.com"
        ));
        assert!(website_rule_matches_window(
            &active_info("chrome", "Gmail - Google Chrome"),
            "gmail.com"
        ));
        assert!(website_rule_matches_window(
            &active_info("msedge", "YouTube - Microsoft Edge"),
            "youtube.com"
        ));
        assert!(!website_rule_matches_window(
            &active_info("chrome", "New Tab - Google Chrome"),
            "google.com"
        ));
    }

    #[test]
    fn app_rules_match_process_tokens_not_substrings() {
        assert!(process_rule_matches("Microsoft Teams", "Teams"));
        assert!(process_rule_matches("MSTeams", "Teams"));
        assert!(process_rule_matches("DiscordCanary", "Discord"));
        assert!(process_rule_matches(
            "C:\\Program Files\\Bitwarden.exe",
            "Bitwarden"
        ));
        assert!(!process_rule_matches("Steam", "Teams"));
        assert!(!process_rule_matches("TeamViewer", "Teams"));
    }

    #[test]
    fn whitelisted_processes_skip_auto_protect() {
        let mut settings = DeskoySettings::default();
        settings.blocked_title_keywords = vec!["gmail".into()];
        assert!(blocked_app_reason(&active_info("chrome", "Gmail - Google Chrome"), &settings).is_some());
        assert!(blocked_app_reason(&active_info("Outlook", "Gmail password reset"), &settings).is_none());
    }

    #[test]
    fn plain_keyword_rules_keep_title_matching() {
        assert!(blocked_title_rule_matches(
            "Inbox - Gmail - Google Chrome",
            "gmail"
        ));
        assert!(blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "taxes.xlsx"
        ));
        assert!(blocked_title_rule_matches("Mail - Outlook", "mail"));
        assert!(blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "taxes"
        ));
        assert!(!blocked_title_rule_matches("thumbnail.png - Photos", "mail"));
        assert!(!blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "tax"
        ));
    }
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(not(windows))]
trait CommandCreationFlags {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self;
}

#[cfg(not(windows))]
impl CommandCreationFlags for Command {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self {
        self
    }
}

#[cfg(windows)]
fn get_active_window_info() -> Option<ActiveWindowInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }

        Some(ActiveWindowInfo {
            hwnd: hwnd as isize as i64,
            pid,
            process_name: process_name_from_pid(pid).unwrap_or_default(),
            title: window_text(hwnd),
            _class_name: window_class_name(hwnd),
        })
    }
}

#[cfg(not(windows))]
fn get_active_window_info() -> Option<ActiveWindowInfo> {
    None
}

#[cfg(windows)]
unsafe fn window_text(hwnd: *mut std::ffi::c_void) -> String {
    let len = GetWindowTextLengthW(hwnd).max(0) as usize;
    let mut buffer = vec![0u16; len + 1];
    let read = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
    String::from_utf16_lossy(&buffer[..read.max(0) as usize])
}

#[cfg(windows)]
unsafe fn window_class_name(hwnd: *mut std::ffi::c_void) -> String {
    let mut buffer = vec![0u16; 256];
    let read = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
    String::from_utf16_lossy(&buffer[..read.max(0) as usize])
}

#[cfg(windows)]
unsafe fn process_name_from_pid(pid: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if handle.is_null() {
        return None;
    }

    let mut buffer = vec![0u16; 32768];
    let mut len = buffer.len() as u32;
    let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut len);
    CloseHandle(handle);
    if ok == 0 || len == 0 {
        return None;
    }

    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    Some(
        PathBuf::from(path)
            .file_stem()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
    )
}

async fn close_blocked_window(trg: &ActiveWindowInfo) -> bool {
    let hwnd = trg.hwnd;
    let pid = trg.pid;
    tauri::async_runtime::spawn_blocking(move || hide_blocked_window(hwnd, pid))
        .await
        .unwrap_or(false)
}

#[cfg(windows)]
fn hide_blocked_window(hwnd: i64, pid: u32) -> bool {
    unsafe {
        let hwnd = hwnd as isize as *mut std::ffi::c_void;
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return true;
        }
        if pid != 0 && window_pid(hwnd) != Some(pid) {
            return true;
        }
        let mut ok = true;
        if IsIconic(hwnd) == 0 {
            ok = ShowWindow(hwnd, SW_MINIMIZE) != 0;
        }
        PostMessageW(hwnd, WM_CLOSE, 0, 0) != 0 || ok
    }
}

#[cfg(not(windows))]
fn hide_blocked_window(_hwnd: i64, _pid: u32) -> bool {
    true
}

#[cfg(windows)]
fn is_blocked_window_gone_or_minimized(hwnd: i64, pid: u32) -> bool {
    unsafe {
        let hwnd = hwnd as isize as *mut std::ffi::c_void;
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return true;
        }
        if pid != 0 && window_pid(hwnd) != Some(pid) {
            return true;
        }
        IsIconic(hwnd) != 0
    }
}

#[cfg(not(windows))]
fn is_blocked_window_gone_or_minimized(_hwnd: i64, _pid: u32) -> bool {
    false
}

#[cfg(windows)]
unsafe fn window_pid(hwnd: *mut std::ffi::c_void) -> Option<u32> {
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        None
    } else {
        Some(pid)
    }
}

fn run_pwsh_encoded(script: String) -> Option<String> {
    let encoded = general_purpose::STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect::<Vec<u8>>(),
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Sta",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded,
        ])
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().into())
}

async fn on_cover_open_audio(app: &AppHandle, want_mute: bool) {
    app_state(app).state.lock().unwrap().pending_audio_restore = None;
    if !want_mute || !cfg!(windows) {
        return;
    }

    match mute_default_audio_endpoints() {
        AudioMuteResult::Muted(roles) => {
            app_state(app).state.lock().unwrap().pending_audio_restore =
                Some(PendingAudioRestore::ComOff(roles));
        }
        AudioMuteResult::AlreadyMuted => {}
        AudioMuteResult::Failed => {
            toggle_volume_mute_vk();
            app_state(app).state.lock().unwrap().pending_audio_restore =
                Some(PendingAudioRestore::VkToggle);
            report_runtime_error(
                app,
                "audio",
                "Core Audio mute failed; used keyboard mute fallback.",
            );
        }
    }
}

async fn on_cover_close_audio(app: &AppHandle) {
    if !cfg!(windows) {
        return;
    }
    let pending = app_state(app)
        .state
        .lock()
        .unwrap()
        .pending_audio_restore
        .take();
    match pending {
        Some(PendingAudioRestore::ComOff(roles)) if !roles.is_empty() => {
            if !restore_default_audio_endpoints(&roles) {
                report_runtime_error(app, "audio", "failed to restore muted audio endpoints");
            }
        }
        Some(PendingAudioRestore::VkToggle) => toggle_volume_mute_vk(),
        _ => {}
    }
}

enum AudioMuteResult {
    Muted(Vec<i32>),
    AlreadyMuted,
    Failed,
}

#[cfg(windows)]
fn mute_default_audio_endpoints() -> AudioMuteResult {
    match set_default_audio_mute(true, &[0, 1], true) {
        Ok(roles) if roles.is_empty() => AudioMuteResult::AlreadyMuted,
        Ok(roles) => AudioMuteResult::Muted(roles),
        Err(_) => AudioMuteResult::Failed,
    }
}

#[cfg(not(windows))]
fn mute_default_audio_endpoints() -> AudioMuteResult {
    AudioMuteResult::Failed
}

#[cfg(windows)]
fn restore_default_audio_endpoints(roles: &[i32]) -> bool {
    set_default_audio_mute(false, roles, false).is_ok()
}

#[cfg(not(windows))]
fn restore_default_audio_endpoints(_roles: &[i32]) -> bool {
    true
}

#[cfg(windows)]
fn set_default_audio_mute(
    muted: bool,
    roles: &[i32],
    only_record_changes: bool,
) -> windows::core::Result<Vec<i32>> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = set_default_audio_mute_inner(muted, roles, only_record_changes);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
unsafe fn set_default_audio_mute_inner(
    muted: bool,
    roles: &[i32],
    only_record_changes: bool,
) -> windows::core::Result<Vec<i32>> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let mut touched = Vec::new();

    for role in roles {
        let Ok(endpoint_role) = audio_role_from_i32(*role) else {
            continue;
        };
        let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, endpoint_role) else {
            continue;
        };
        let Ok(volume) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) else {
            continue;
        };

        let was_muted = volume.GetMute()?.as_bool();
        if was_muted != muted {
            let event_context = GUID::zeroed();
            volume.SetMute(muted, &event_context)?;
            touched.push(*role);
        } else if !only_record_changes {
            let event_context = GUID::zeroed();
            volume.SetMute(muted, &event_context)?;
        }
    }

    Ok(touched)
}

#[cfg(windows)]
fn audio_role_from_i32(role: i32) -> windows::core::Result<windows::Win32::Media::Audio::ERole> {
    match role {
        0 => Ok(eConsole),
        1 => Ok(eMultimedia),
        _ => Err(windows::core::Error::from_win32()),
    }
}

fn toggle_volume_mute_vk() {
    let script = r#"
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DeskoyK {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr ex);
  public static void MuteKey() {
    keybd_event((byte)0xAD, 0, 0, UIntPtr.Zero);
    keybd_event((byte)0xAD, 0, 2, UIntPtr.Zero);
  }
}
'@
[DeskoyK]::MuteKey()
"#;
    let _ = run_pwsh_encoded(script.into());
}

fn rate_limit_key(kind: &str) -> String {
    format!("rateLimit.{kind}.lastSentAt")
}

fn can_send_after_cooldown(app: &AppHandle, kind: &str) -> bool {
    let state = app_state(app);
    let store = load_store(&state.settings_path);
    let last = store
        .get(rate_limit_key(kind))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u128;
    now_ms().saturating_sub(last) >= FEEDBACK_BUG_COOLDOWN_MS
}

fn mark_sent_rate_limit(app: &AppHandle, kind: &str) {
    let state = app_state(app);
    let mut store = load_store(&state.settings_path);
    store[rate_limit_key(kind)] = json!(now_ms());
    save_store(&state.settings_path, &store);
}

async fn post_relay(url: &str, body: Value) -> Result<(), String> {
    let resp = reqwest::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .header("User-Agent", "DeskoyDesktop/1 (Tauri)")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("relay_http_{}", resp.status().as_u16()))
    }
}

#[tauri::command]
async fn open_external(url: String) -> Value {
    match Url::parse(url.trim()) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => {
            json!({ "ok": open::that(parsed.as_str()).is_ok() })
        }
        _ => json!({ "ok": false }),
    }
}

#[tauri::command]
async fn get_app_version(app: AppHandle) -> Value {
    let pkg = app.package_info();
    json!({ "version": pkg.version.to_string(), "name": pkg.name })
}

fn monitor_matches(a: &Monitor, b: &Monitor) -> bool {
    a.name() == b.name()
        && a.size() == b.size()
        && a.position() == b.position()
        && (a.scale_factor() - b.scale_factor()).abs() < f64::EPSILON
}

#[tauri::command]
async fn get_displays(app: AppHandle) -> Value {
    let primary = app.primary_monitor().ok().flatten();
    let displays: Vec<DisplayInfo> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let size = monitor.size();
            let position = monitor.position();
            let primary = primary
                .as_ref()
                .map(|primary| monitor_matches(monitor, primary))
                .unwrap_or(index == 0);
            DisplayInfo {
                id: index,
                name: monitor
                    .name()
                    .cloned()
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| format!("Display {}", index + 1)),
                width: size.width,
                height: size.height,
                x: position.x,
                y: position.y,
                scale_factor: monitor.scale_factor(),
                primary,
            }
        })
        .collect();
    json!({ "ok": true, "displays": displays })
}

#[tauri::command]
async fn get_state(app: AppHandle) -> Value {
    json!({
        "active": effective_enabled(&app),
        "paused": is_paused(&app),
        "maximized": app.get_webview_window("main").and_then(|w| w.is_maximized().ok()).unwrap_or(false)
    })
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> DeskoySettings {
    get_settings_from_state(&app)
}

#[tauri::command]
async fn get_protection_logs(app: AppHandle) -> Vec<ProtectionLogEntry> {
    load_protection_logs(&app)
}

#[tauri::command]
async fn clear_protection_logs(app: AppHandle) -> Value {
    clear_protection_logs_from_store(&app);
    json!({ "ok": true })
}

#[tauri::command]
async fn save_settings(app: AppHandle, patch: Value) -> Value {
    if patch
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && app_state(&app)
            .state
            .lock()
            .unwrap()
            .upgrade_block
            .is_some()
    {
        return json!({ "ok": false, "error": "upgrade_required" });
    }
    let prev = get_settings_from_state(&app);
    let next = set_settings_in_state(&app, patch);
    if !register_hotkeys(&app, &next) {
        let _ = set_settings_in_state(&app, serde_json::to_value(prev.clone()).unwrap_or_default());
        let _ = register_hotkeys(&app, &prev);
        return json!({ "ok": false, "error": "hotkey_unavailable" });
    }
    json!({ "ok": true })
}

#[tauri::command]
async fn toggle(app: AppHandle) -> Value {
    if app_state(&app)
        .state
        .lock()
        .unwrap()
        .upgrade_block
        .is_some()
    {
        show_main_window(&app);
        send_upgrade_required_if_any(&app);
        return json!({ "ok": false, "active": false, "error": "upgrade_required" });
    }
    let prev = get_settings_from_state(&app);
    let next_enabled = !prev.enabled;
    if !next_enabled {
        close_cover_session(&app).await;
    } else {
        let state = app_state(&app);
        let mut rt = state.state.lock().unwrap();
        rt.paused_until = None;
        rt.paused_until_restart = false;
    }
    let next = set_settings_in_state(&app, json!({ "enabled": next_enabled }));
    if !register_hotkeys(&app, &next) {
        let rolled = set_settings_in_state(&app, json!({ "enabled": false }));
        let _ = register_hotkeys(&app, &rolled);
        emit_state(&app);
        show_main_window(&app);
        return json!({ "ok": false, "active": false, "error": "hotkey_unavailable" });
    }
    let active = effective_enabled(&app);
    emit_state(&app);
    json!({ "ok": true, "active": active })
}

#[tauri::command]
async fn pick_cover_file(app: AppHandle) -> Value {
    let picked = rfd::FileDialog::new()
        .add_filter(
            "Cover files",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "log", "json",
            ],
        )
        .pick_file();
    if let Some(path) = picked {
        let path_text = path.to_string_lossy().to_string();
        let _ = set_settings_in_state(
            &app,
            json!({ "coverFilePath": path_text, "coverMode": "file" }),
        );
        json!({ "ok": true, "path": path.to_string_lossy() })
    } else {
        json!({ "ok": true, "path": "" })
    }
}

fn sanitized_settings(settings: &DeskoySettings) -> Value {
    let cover_url_host = Url::parse(settings.cover_url.trim())
        .ok()
        .and_then(|url| url.host_str().map(str::to_string));
    let cover_file_name = PathBuf::from(settings.cover_file_path.trim())
        .file_name()
        .map(|name| name.to_string_lossy().to_string());
    json!({
        "hotkeySet": !settings.hotkey.trim().is_empty(),
        "coverMode": settings.cover_mode,
        "cover": settings.cover,
        "coverDisplay": settings.cover_display,
        "customCoverEnabled": settings.use_custom_cover,
        "customCoverUrlHost": cover_url_host,
        "customCoverFileName": cover_file_name,
        "audioMute": settings.audio_mute,
        "enabled": settings.enabled,
        "autoCoverBlocked": settings.auto_cover_blocked,
        "blockedAppsCount": settings.blocked_apps.len(),
        "blockedWebsitesCount": settings.blocked_websites.len(),
        "blockedTitleKeywordsCount": settings.blocked_title_keywords.len(),
        "theme": settings.theme,
    })
}

fn diagnostics_payload(app: &AppHandle) -> Value {
    let settings = get_settings_from_state(app);
    let logs = load_protection_logs(app);
    let (registered_hotkey, registered_escape, cover_open, cover_busy, cover_labels, session_reason, last_cover_error, last_cover_fallback, last_auto_protect_reason) = {
        let state = app_state(app);
        let rt = state.state.lock().unwrap();
        (
            rt.registered_hotkey.is_some(),
            rt.registered_escape.is_some(),
            rt.cover_open,
            rt.cover_busy,
            rt.cover_labels.clone(),
            rt.cover_session.as_ref().map(|session| session.reason.clone()),
            rt.last_cover_error.clone(),
            rt.last_cover_fallback.clone(),
            rt.last_auto_protect_reason.clone(),
        )
    };
    let pkg = app.package_info();
    json!({
        "version": pkg.version.to_string(),
        "name": pkg.name,
        "settings": sanitized_settings(&settings),
        "runtime": {
            "effectiveEnabled": effective_enabled(app),
            "paused": pause_label(app),
            "registeredHotkey": registered_hotkey,
            "registeredEscape": registered_escape,
            "coverOpen": cover_open,
            "coverBusy": cover_busy,
            "coverWindowCount": cover_labels.len(),
            "coverSessionReason": session_reason,
            "lastCoverError": if last_cover_error.is_empty() { Value::Null } else { json!(last_cover_error) },
            "lastCoverFallback": if last_cover_fallback.is_empty() { Value::Null } else { json!(last_cover_fallback) },
            "lastAutoProtectReason": if last_auto_protect_reason.is_empty() { Value::Null } else { json!(last_auto_protect_reason) },
        },
        "recentProtectionLogs": logs.into_iter().take(5).map(|log| {
            json!({
                "timestamp": log.timestamp,
                "processName": log.process_name,
                "titleLength": log.title.chars().count(),
                "action": log.action,
            })
        }).collect::<Vec<_>>()
    })
}

#[tauri::command]
async fn get_diagnostics(app: AppHandle) -> Value {
    json!({ "ok": true, "data": diagnostics_payload(&app) })
}

#[tauri::command]
async fn pause_for_minutes(app: AppHandle, minutes: u64) -> Value {
    let minutes = minutes.clamp(1, 240);
    pause_for_duration(app, Duration::from_secs(minutes * 60)).await
}

#[tauri::command]
async fn pause_until_restart(app: AppHandle) -> Value {
    pause_until_restart_inner(app).await
}

#[tauri::command]
async fn resume_deskoy(app: AppHandle) -> Value {
    resume_deskoy_inner(&app)
}

#[tauri::command]
async fn send_feedback(app: AppHandle, payload: Value) -> Value {
    if !can_send_after_cooldown(&app, "feedback") {
        return json!({ "ok": false, "error": "rate_limited" });
    }
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if message.is_empty() {
        return json!({ "ok": false, "error": "missing_message" });
    }
    let email = payload
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !email.is_empty() && !(email.contains('@') && email.contains('.')) {
        return json!({ "ok": false, "error": "invalid_email" });
    }
    let url = std::env::var("DESKOY_FEEDBACK_RELAY_URL")
        .unwrap_or_else(|_| "https://api.deskoy.com/api/feedback".into());
    let res = post_relay(
        &url,
        json!({
            "type": "feedback",
            "message": message,
            "email": if email.is_empty() { Value::Null } else { json!(email) },
            "diagnostics": payload.get("diagnostics").cloned().unwrap_or(Value::Null)
        }),
    )
    .await;
    match res {
        Ok(()) => {
            mark_sent_rate_limit(&app, "feedback");
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
async fn send_bug_report(app: AppHandle, payload: Value) -> Value {
    if !can_send_after_cooldown(&app, "bug") {
        return json!({ "ok": false, "error": "rate_limited" });
    }
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if message.is_empty() {
        return json!({ "ok": false, "error": "missing_message" });
    }
    let email = payload
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !email.is_empty() && !(email.contains('@') && email.contains('.')) {
        return json!({ "ok": false, "error": "invalid_email" });
    }
    let url = std::env::var("DESKOY_BUG_RELAY_URL")
        .unwrap_or_else(|_| "https://api.deskoy.com/api/bug-report".into());
    let res = post_relay(
        &url,
        json!({
            "type": "bug",
            "message": message,
            "email": if email.is_empty() { Value::Null } else { json!(email) },
            "steps": payload.get("steps").cloned().unwrap_or(Value::Null),
            "screenshot": payload.get("screenshot").cloned().unwrap_or(Value::Null),
            "diagnostics": payload.get("diagnostics").cloned().unwrap_or(Value::Null)
        }),
    )
    .await;
    match res {
        Ok(()) => {
            mark_sent_rate_limit(&app, "bug");
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
async fn get_updates(app: AppHandle) -> Value {
    {
        let state = app_state(&app);
        let rt = state.state.lock().unwrap();
        if let Some((at, value)) = &rt.updates_cache {
            if at.elapsed() < UPDATES_CACHE_TTL {
                return json!({ "ok": true, "data": value });
            }
        }
    }
    let url = std::env::var("DESKOY_UPDATES_URL")
        .unwrap_or_else(|_| "https://api.deskoy.com/api/updates".into());
    let resp = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "DeskoyDesktop/1 (Tauri)")
        .send()
        .await;
    match resp {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(data) if data.is_object() => {
                app_state(&app).state.lock().unwrap().updates_cache =
                    Some((Instant::now(), data.clone()));
                json!({ "ok": true, "data": data })
            }
            _ => json!({ "ok": false, "error": "updates_bad_payload" }),
        },
        Ok(resp) => {
            json!({ "ok": false, "error": format!("updates_http_{}", resp.status().as_u16()) })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

fn updater_public_key() -> Option<String> {
    std::env::var("DESKOY_UPDATER_PUBKEY")
        .ok()
        .or_else(|| option_env!("DESKOY_UPDATER_PUBKEY").map(str::to_string))
        .or_else(|| Some(DEFAULT_UPDATER_PUBKEY.into()))
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

fn updater_endpoint() -> String {
    std::env::var("DESKOY_UPDATER_URL")
        .ok()
        .or_else(|| option_env!("DESKOY_UPDATER_URL").map(str::to_string))
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATER_URL.into())
}

fn updater_builder(app: &AppHandle) -> Result<tauri_plugin_updater::UpdaterBuilder, String> {
    let Some(pubkey) = updater_public_key() else {
        return Err("updater_not_configured".into());
    };
    let endpoint = Url::parse(&updater_endpoint()).map_err(|_| "updater_bad_endpoint".to_string())?;
    app.updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn check_app_update(app: AppHandle) -> Value {
    {
        let state = app_state(&app);
        let rt = state.state.lock().unwrap();
        if let Some((at, value)) = &rt.app_update_cache {
            if at.elapsed() < APP_UPDATE_CACHE_TTL {
                return value.clone();
            }
        }
    }

    let result = match updater_builder(&app).and_then(|builder| {
        builder
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|err| err.to_string())
    }) {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => json!({
                "ok": true,
                "configured": true,
                "available": true,
                "version": update.version,
                "currentVersion": update.current_version,
                "notes": update.body.unwrap_or_default(),
                "url": update.download_url.as_str()
            }),
            Ok(None) => json!({
                "ok": true,
                "configured": true,
                "available": false
            }),
            Err(err) => json!({
                "ok": false,
                "configured": true,
                "available": false,
                "error": err.to_string()
            }),
        },
        Err(error) => json!({
            "ok": true,
            "configured": false,
            "available": false,
            "error": error
        }),
    };

    app_state(&app).state.lock().unwrap().app_update_cache =
        Some((Instant::now(), result.clone()));
    result
}

#[tauri::command]
async fn install_app_update(app: AppHandle) -> Value {
    let updater = match updater_builder(&app).and_then(|builder| {
        builder
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|err| err.to_string())
    }) {
        Ok(updater) => updater,
        Err(error) => {
            return json!({ "ok": false, "error": error });
        }
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return json!({ "ok": false, "error": "update_unavailable" }),
        Err(err) => return json!({ "ok": false, "error": err.to_string() }),
    };
    close_cover_session(&app).await;
    let _ = app.emit(
        "deskoy:updateProgress",
        json!({ "event": "started", "downloaded": 0 }),
    );
    let downloaded = Arc::new(Mutex::new(0_u64));
    let app_progress = app.clone();
    let downloaded_progress = downloaded.clone();
    let result = update
        .download_and_install(
            move |chunk_length, content_length| {
                let mut total = downloaded_progress.lock().unwrap();
                *total += chunk_length as u64;
                let _ = app_progress.emit(
                    "deskoy:updateProgress",
                    json!({
                        "event": "progress",
                        "downloaded": *total,
                        "total": content_length
                    }),
                );
            },
            {
                let app = app.clone();
                move || {
                    let _ = app.emit("deskoy:updateProgress", json!({ "event": "finished" }));
                }
            },
        )
        .await;
    match result {
        Ok(()) => {
            let _ = app.emit("deskoy:updateProgress", json!({ "event": "installed" }));
            json!({ "ok": true })
        }
        Err(err) => {
            let error = err.to_string();
            let _ = app.emit(
                "deskoy:updateProgress",
                json!({ "event": "error", "error": error }),
            );
            json!({ "ok": false, "error": error })
        }
    }
}

#[tauri::command]
async fn window_minimize(app: AppHandle) -> Value {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
    json!({ "ok": true })
}

#[tauri::command]
async fn window_close(app: AppHandle) -> Value {
    if let Some(win) = app.get_webview_window("main") {
        if win.hide().is_err() {
            let _ = win.minimize();
        }
    }
    json!({ "ok": true })
}

#[tauri::command]
async fn close_cover(app: AppHandle) -> Value {
    close_cover_session(&app).await;
    json!({ "ok": true })
}

fn send_upgrade_required_if_any(app: &AppHandle) {
    if let Some(block) = app_state(app).state.lock().unwrap().upgrade_block.clone() {
        let _ = app.emit("deskoy:upgradeRequired", block);
    }
}

fn start_version_policy_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            check_version_policy_fail_open(&app).await;
            tokio::time::sleep(VERSION_POLICY_POLL).await;
        }
    });
}

async fn check_version_policy_fail_open(app: &AppHandle) {
    if app_state(app).state.lock().unwrap().upgrade_block.is_some() {
        return;
    }
    let url = std::env::var("DESKOY_VERSION_POLICY_URL")
        .unwrap_or_else(|_| "https://api.deskoy.com/api/version-policy".into());
    let Ok(resp) = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "DeskoyDesktop/1 (Tauri)")
        .send()
        .await
    else {
        return;
    };
    if !resp.status().is_success() {
        return;
    }
    let Ok(data) = resp.json::<Value>().await else {
        return;
    };
    if data.get("ok").and_then(Value::as_bool) != Some(true) {
        return;
    }
    let version = app.package_info().version.to_string();
    let blocked = data
        .get("blockedVersions")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().any(|v| v.as_str() == Some(&version)))
        .unwrap_or(false);
    let min = data
        .get("minimumVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    let below_min = min
        .as_ref()
        .map(|m| is_version_less_than(&version, m))
        .unwrap_or(false);
    if !blocked && !below_min {
        return;
    }
    let block = UpgradeBlock {
        message: data
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or(
                "This version is discontinued. Please install the latest Deskoy to keep using it.",
            )
            .trim()
            .to_string(),
        download_url: data
            .get("downloadUrl")
            .and_then(Value::as_str)
            .unwrap_or("https://www.deskoy.com/download")
            .trim()
            .to_string(),
        minimum_version: min,
    };
    app_state(app).state.lock().unwrap().upgrade_block = Some(block.clone());
    if get_settings_from_state(app).enabled {
        let _ = set_settings_in_state(app, json!({ "enabled": false }));
        emit_state(app);
    }
    show_main_window(app);
    let _ = app.emit("deskoy:upgradeRequired", block);
}

fn parse_triplet(v: &str) -> Option<[u32; 3]> {
    let mut out = [0, 0, 0];
    for (i, part) in v.trim().split('.').take(3).enumerate() {
        out[i] = part
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .ok()?;
    }
    Some(out)
}

fn is_version_less_than(a: &str, b: &str) -> bool {
    match (parse_triplet(a), parse_triplet(b)) {
        (Some(av), Some(bv)) => av < bv,
        _ => false,
    }
}
