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
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};
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
    Foundation::CloseHandle,
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindow, PostMessageW, ShowWindow, SW_MINIMIZE,
        WM_CLOSE,
    },
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeskoySettings {
    hotkey: String,
    cover_mode: String,
    cover: String,
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
}

impl Default for DeskoySettings {
    fn default() -> Self {
        Self {
            hotkey: String::new(),
            cover_mode: "excel".into(),
            cover: "excel".into(),
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

#[derive(Default)]
struct RuntimeState {
    registered_hotkey: Option<Shortcut>,
    cover_open: bool,
    cover_busy: bool,
    cover_session: Option<CoverSession>,
    cover_open_at: Option<Instant>,
    last_blocked_cover_at: Option<Instant>,
    last_blocked_hwnd: i64,
    last_blocked_pid: u32,
    last_blocked_process_name: String,
    pending_audio_restore: Option<PendingAudioRestore>,
    updates_cache: Option<(Instant, Value)>,
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
const VERSION_POLICY_POLL: Duration = Duration::from_secs(6 * 60 * 60);
const AUTO_COVER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const BLOCKED_COVER_COOLDOWN: Duration = Duration::from_secs(6);
const BLOCKED_WINDOW_SETTLE_POLL: Duration = Duration::from_millis(25);
const COVER_BEFORE_HIDE_DELAY: Duration = Duration::from_millis(300);
const COVER_MIN_VISIBLE: Duration = Duration::from_millis(700);
const PROTECTION_LOG_LIMIT: usize = 30;

fn main() {
    tauri::Builder::default()
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
            start_version_policy_watcher(app.handle().clone());
            let _ = register_hotkeys(app.handle(), &get_settings_from_state(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            get_app_version,
            get_updates,
            get_state,
            toggle,
            get_settings,
            get_protection_logs,
            clear_protection_logs,
            save_settings,
            pick_cover_file,
            send_feedback,
            send_bug_report,
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

fn append_protection_log(app: &AppHandle, info: &ActiveWindowInfo) {
    let state = app_state(app);
    let mut store = load_store(&state.settings_path);
    let mut logs = store
        .get("protectionLogs")
        .cloned()
        .and_then(|v| serde_json::from_value::<Vec<ProtectionLogEntry>>(v).ok())
        .unwrap_or_default();
    logs.insert(
        0,
        ProtectionLogEntry {
            timestamp: now_ms(),
            process_name: info.process_name.clone(),
            title: info.title.clone(),
            action: "Covered and hidden".into(),
        },
    );
    logs.truncate(PROTECTION_LOG_LIMIT);
    store["protectionLogs"] = serde_json::to_value(logs).unwrap_or_else(|_| json!([]));
    save_store(&state.settings_path, &store);
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
        json!({ "active": get_settings_from_state(app).enabled }),
    );
}

fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Settings", true, None::<&str>)?;
    let toggle_item = MenuItem::with_id(app, "toggle", "Toggle Deskoy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &toggle_item,
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
            false,
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

fn register_hotkeys(app: &AppHandle, settings: &DeskoySettings) -> bool {
    let state = app_state(app);
    let mut rt = state.state.lock().unwrap();
    if let Some(old) = rt.registered_hotkey.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    if !settings.enabled || settings.hotkey.trim().is_empty() {
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
    if !get_settings_from_state(&app).enabled {
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
        let cover = tauri::async_runtime::spawn(async move {
            open_cover_from_settings(&app2, &settings).await
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
        app_state(&app).state.lock().unwrap().cover_busy = false;
    } else {
        close_cover_session(&app).await;
    }
}

async fn open_cover_from_settings(app: &AppHandle, settings: &DeskoySettings) -> bool {
    if app.get_webview_window("cover").is_some() {
        return true;
    }
    let url = cover_webview_url(settings);
    let builder = WebviewWindowBuilder::new(app, "cover", url)
        .title("Cover")
        .fullscreen(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .background_color(tauri::utils::config::Color(0, 0, 0, 255));
    match builder.build() {
        Ok(win) => {
            if let Err(err) = win.show() {
                report_runtime_error(app, "cover", format!("failed to show cover: {err}"));
            }
            if let Err(err) = win.set_focus() {
                report_runtime_error(app, "cover", format!("failed to focus cover: {err}"));
            }
            app_state(app).state.lock().unwrap().cover_open_at = Some(Instant::now());
            true
        }
        Err(err) => {
            report_runtime_error(app, "cover", format!("failed to build cover: {err}"));
            match
                WebviewWindowBuilder::new(app, "cover", WebviewUrl::App("cover/excel.html".into()))
                    .title("Cover")
                    .fullscreen(true)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .background_color(tauri::utils::config::Color(0, 0, 0, 255))
                    .build()
            {
                Ok(win) => {
                    if let Err(err) = win.show() {
                        report_runtime_error(
                            app,
                            "cover",
                            format!("failed to show fallback cover: {err}"),
                        );
                    }
                    if let Err(err) = win.set_focus() {
                        report_runtime_error(
                            app,
                            "cover",
                            format!("failed to focus fallback cover: {err}"),
                        );
                    }
                    let _ = app.emit(
                        "deskoy:coverFallback",
                        json!({ "reason": "Cover failed, using Excel fallback." }),
                    );
                    app_state(app).state.lock().unwrap().cover_open_at = Some(Instant::now());
                    true
                }
                Err(err) => {
                    report_runtime_error(
                        app,
                        "cover",
                        format!("failed to build fallback cover: {err}"),
                    );
                    false
                }
            }
        }
    }
}

fn cover_webview_url(settings: &DeskoySettings) -> WebviewUrl {
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
    if settings.cover_mode == "black" {
        return WebviewUrl::External(
            Url::parse(
                "data:text/html,<html><body style='margin:0;background:%23000'></body></html>",
            )
            .unwrap(),
        );
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
    if let Some(win) = app.get_webview_window("cover") {
        if let Err(err) = win.close() {
            report_runtime_error(app, "cover", format!("failed to close cover: {err}"));
        }
    }
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
        rt.cover_session = None;
    }
    close_cover_window(app);
    on_cover_close_audio(app).await;
    app_state(app).state.lock().unwrap().cover_busy = false;
}

async fn open_cover_if_allowed(app: AppHandle, trigger: Option<ActiveWindowInfo>) {
    let settings = get_settings_from_state(&app);
    if !settings.enabled {
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

fn start_auto_cover_watcher(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(AUTO_COVER_POLL_INTERVAL);
        let s = get_settings_from_state(&app);
        if !s.enabled || !s.auto_cover_blocked {
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
            if is_deskoy_window(&info) || !is_blocked_app(&info, &s) {
                continue;
            }
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

fn matches_any(process_name: &str, list: &[String]) -> bool {
    let p = process_name.to_lowercase();
    list.iter().any(|x| p.contains(&x.to_lowercase()))
}

fn is_blocked_app(info: &ActiveWindowInfo, settings: &DeskoySettings) -> bool {
    if is_deskoy_window(info) {
        return false;
    }
    if matches_any(&info.process_name, &settings.blocked_apps) {
        return true;
    }
    if settings
        .blocked_websites
        .iter()
        .any(|rule| website_rule_matches_title(&info.title, rule))
    {
        return true;
    }
    settings
        .blocked_title_keywords
        .iter()
        .any(|rule| blocked_title_rule_matches(&info.title, rule))
}

fn website_rule_matches_title(title: &str, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    hostname_from_rule(&rule)
        .map(|host| title_contains_hostname(title, &host))
        .unwrap_or(false)
}

fn blocked_title_rule_matches(title: &str, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    if rule.is_empty() {
        return false;
    }

    let title = title.to_lowercase();
    expand_keyword_rule(&rule)
        .iter()
        .any(|needle| title.contains(needle))
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
        .filter_map(hostname_from_title_token)
        .any(|candidate| candidate == host || candidate.ends_with(&format!(".{host}")))
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn plain_keyword_rules_keep_title_matching() {
        assert!(blocked_title_rule_matches(
            "Inbox - Gmail - Google Chrome",
            "gmail"
        ));
        assert!(blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "taxes.xlsx"
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

#[tauri::command]
async fn get_state(app: AppHandle) -> Value {
    json!({
        "active": get_settings_from_state(&app).enabled,
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
    }
    let next = set_settings_in_state(&app, json!({ "enabled": next_enabled }));
    if !register_hotkeys(&app, &next) {
        let rolled = set_settings_in_state(&app, json!({ "enabled": false }));
        let _ = register_hotkeys(&app, &rolled);
        emit_state(&app);
        show_main_window(&app);
        return json!({ "ok": false, "active": false, "error": "hotkey_unavailable" });
    }
    emit_state(&app);
    json!({ "ok": true, "active": next_enabled })
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
        let _ = win.hide();
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
