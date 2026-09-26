#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auto_protect;
mod cli_ipc;
mod cli_protocol;
mod defender;
mod defender_watch;
mod defender_windows;
mod feedback;
mod licensing;
mod platform;
mod settings;
mod updates;

use auto_protect::{blocked_app_reason, hostname_from_rule, normalize_blocked_rule};
use feedback::{send_bug_report, send_feedback};
use platform::{
    acquire_single_instance_guard, close_blocked_window, get_active_window_info,
    is_blocked_window_gone_or_minimized, mute_default_audio_endpoints,
    restore_default_audio_endpoints, toggle_volume_mute_vk, AudioMuteResult,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use settings::{normalize_settings, selected_monitor_indices};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
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
use updates::{
    check_app_update, get_updates, install_app_update, send_upgrade_required_if_any,
    start_version_policy_watcher,
};
use url::Url;

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
    #[serde(default)]
    developer_mode: bool,
    #[serde(default)]
    developer_mode_disclaimer_accepted: bool,
    #[serde(default = "default_active_profile_id")]
    active_profile_id: String,
    #[serde(default)]
    profiles: Vec<DeskoyProfile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeskoyProfile {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    settings: DeskoyProfileSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeskoyProfileSettings {
    #[serde(default = "default_cover_mode")]
    cover_mode: String,
    #[serde(default = "default_cover_mode")]
    cover: String,
    #[serde(default = "default_cover_display")]
    cover_display: String,
    #[serde(default)]
    cover_url: String,
    #[serde(default)]
    cover_file_path: String,
    #[serde(default)]
    audio_mute: bool,
    #[serde(default)]
    whitelist: Vec<String>,
    #[serde(default)]
    use_custom_cover: bool,
    #[serde(default)]
    auto_cover_blocked: bool,
    #[serde(default)]
    blocked_apps: Vec<String>,
    #[serde(default)]
    blocked_websites: Vec<String>,
    #[serde(default)]
    blocked_title_keywords: Vec<String>,
}

impl Default for DeskoyProfileSettings {
    fn default() -> Self {
        Self {
            cover_mode: "excel".into(),
            cover: "excel".into(),
            cover_display: default_cover_display(),
            cover_url: String::new(),
            cover_file_path: String::new(),
            audio_mute: false,
            whitelist: vec!["Teams".into(), "Slack".into(), "Outlook".into()],
            use_custom_cover: false,
            auto_cover_blocked: false,
            blocked_apps: vec![],
            blocked_websites: vec![],
            blocked_title_keywords: vec![],
        }
    }
}

fn default_active_profile_id() -> String {
    "default".into()
}

fn default_cover_mode() -> String {
    "excel".into()
}

fn default_cover_display() -> String {
    "all".into()
}

fn default_font_size() -> String {
    "default".into()
}

fn developer_mode_change_allowed(current: &DeskoySettings, patch: &Value) -> bool {
    patch.get("developerMode").and_then(Value::as_bool) != Some(true)
        || current.developer_mode_disclaimer_accepted
        || patch
            .get("developerModeDisclaimerAccepted")
            .and_then(Value::as_bool)
            == Some(true)
}

fn patch_touches_pro_feature(value: &Value) -> bool {
    match value {
        Value::Object(values) => values.iter().any(|(key, nested)| {
            matches!(
                key.as_str(),
                "autoCoverBlocked"
                    | "developerMode"
                    | "useCustomCover"
                    | "coverMode"
                    | "cover"
                    | "coverDisplay"
            ) || patch_touches_pro_feature(nested)
        }),
        Value::Array(values) => values.iter().any(patch_touches_pro_feature),
        _ => false,
    }
}

fn patch_enables_pro_feature(value: &Value) -> bool {
    match value {
        Value::Object(values) => values.iter().any(|(key, nested)| {
            let enabled_flag = matches!(
                key.as_str(),
                "autoCoverBlocked" | "developerMode" | "useCustomCover"
            ) && nested.as_bool() == Some(true);
            let custom_cover_mode =
                key == "coverMode" && matches!(nested.as_str(), Some("url" | "file"));
            let pro_only_cover = matches!(key.as_str(), "coverMode" | "cover")
                && nested.as_str().is_some_and(is_pro_only_cover_mode);
            let custom_cover_display =
                key == "coverDisplay" && nested.as_str().is_some_and(|display| display != "all");
            enabled_flag
                || custom_cover_mode
                || pro_only_cover
                || custom_cover_display
                || patch_enables_pro_feature(nested)
        }),
        Value::Array(values) => values.iter().any(patch_enables_pro_feature),
        _ => false,
    }
}

fn is_pro_only_cover_mode(mode: &str) -> bool {
    matches!(mode, "vscode" | "black")
}

fn apply_free_cover_entitlement(settings: &mut DeskoySettings) {
    let custom_cover_selected =
        settings.use_custom_cover || matches!(settings.cover_mode.as_str(), "url" | "file");
    if custom_cover_selected {
        settings.use_custom_cover = false;
        settings.cover_mode = settings.cover.clone();
        settings.cover_url.clear();
        settings.cover_file_path.clear();
    }
    if is_pro_only_cover_mode(&settings.cover) {
        settings.cover = "excel".into();
    }
    if is_pro_only_cover_mode(&settings.cover_mode) {
        settings.cover_mode = settings.cover.clone();
    }
    settings.cover_display = default_cover_display();
}

fn apply_cover_entitlement(app: &AppHandle, settings: &mut DeskoySettings) {
    if app
        .state::<licensing::LicenseManager>()
        .has_pro_entitlement()
    {
        return;
    }
    apply_free_cover_entitlement(settings);
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
            blocked_apps: vec![],
            blocked_websites: vec![],
            blocked_title_keywords: vec![],
            theme: "dark".into(),
            compact_mode: false,
            font_size: default_font_size(),
            reduce_motion: false,
            developer_mode: false,
            developer_mode_disclaimer_accepted: false,
            active_profile_id: default_active_profile_id(),
            profiles: vec![],
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
    store_lock: Mutex<()>,
    settings: Mutex<DeskoySettings>,
    state: Mutex<RuntimeState>,
}

const AUTO_COVER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const BLOCKED_COVER_COOLDOWN: Duration = Duration::from_secs(6);
const BLOCKED_WINDOW_SETTLE_POLL: Duration = Duration::from_millis(25);
const COVER_BEFORE_HIDE_DELAY: Duration = Duration::from_millis(300);
const COVER_MIN_VISIBLE: Duration = Duration::from_millis(700);
const COVER_WATCHDOG_INTERVAL: Duration = Duration::from_millis(700);
const PROTECTION_LOG_LIMIT: usize = 30;
const REDACTED_WINDOW_TITLE: &str = "Protected window";
const AUTO_HIDE_EXPLICIT_RULES_MIGRATION_KEY: &str = "autoHideExplicitRulesV1";
const LEGACY_IMPLICIT_BLOCKED_APPS: [&str; 6] = [
    "1Password",
    "Bitwarden",
    "KeePass",
    "LastPass",
    "Outlook",
    "Discord",
];

fn main() {
    let _single_instance = match acquire_single_instance_guard() {
        Some(guard) => guard,
        None => return,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
                store_lock: Mutex::new(()),
                state: Mutex::new(RuntimeState::default()),
            });
            app.manage(app_state.clone());
            let licence_manager = licensing::LicenseManager::initialize(&data_dir);
            app.manage(licence_manager.clone());
            cli_ipc::start(app.handle().clone());
            licensing::start_background_validation(app.handle().clone(), licence_manager);
            defender::start(app.handle().clone());
            if let Err(err) = redact_stored_protection_logs(app.handle()) {
                report_runtime_error(app.handle(), "settings", err);
            }
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
            defender::defender_get_state,
            defender::defender_pick_scan,
            defender::defender_scan_path,
            defender::defender_retry_scan,
            defender::defender_set_enabled,
            defender::defender_set_notifications,
            defender::defender_pick_folder,
            defender::defender_remove_folder,
            defender::defender_get_logs,
            defender::defender_clear_logs,
            defender::defender_open_security,
            licensing::licence_get_state,
            licensing::licence_get_key,
            licensing::licence_activate,
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

fn load_store(path: &Path) -> Result<Value, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
        Err(err) => return Err(format!("settings_read_failed: {err}")),
    };
    let store: Value =
        serde_json::from_str(&text).map_err(|err| format!("settings_parse_failed: {err}"))?;
    if !store.is_object() {
        return Err("settings_parse_failed: root value is not an object".into());
    }
    Ok(store)
}

fn temporary_store_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("settings.json");
    path.with_file_name(format!(".{file_name}.tmp"))
}

fn save_store(path: &Path, store: &Value) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Err("settings_write_failed: missing parent directory".into());
    };
    fs::create_dir_all(parent).map_err(|err| format!("settings_write_failed: {err}"))?;
    let text =
        serde_json::to_vec_pretty(store).map_err(|err| format!("settings_write_failed: {err}"))?;
    let temporary_path = temporary_store_path(path);
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temporary_path)
            .map_err(|err| format!("settings_write_failed: {err}"))?;
        file.write_all(&text)
            .map_err(|err| format!("settings_write_failed: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("settings_write_failed: {err}"))?;
        drop(file);
        fs::rename(&temporary_path, path)
            .map_err(|err| format!("settings_write_failed: {err}"))?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn update_store_at_path<T>(
    path: &Path,
    store_lock: &Mutex<()>,
    update: impl FnOnce(&mut Value) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = store_lock
        .lock()
        .map_err(|_| "settings_lock_failed".to_string())?;
    let mut store = load_store(path)?;
    let result = update(&mut store)?;
    save_store(path, &store)?;
    Ok(result)
}

fn redact_log_titles(logs: &mut [ProtectionLogEntry]) -> bool {
    let mut changed = false;
    for log in logs {
        let is_cover_activation = log.process_name == "Deskoy" && log.action == "Cover activated";
        if !is_cover_activation && log.title != REDACTED_WINDOW_TITLE {
            log.title = REDACTED_WINDOW_TITLE.into();
            changed = true;
        }
    }
    changed
}

fn load_protection_logs(app: &AppHandle) -> Vec<ProtectionLogEntry> {
    let state = app_state(app);
    let Ok(_guard) = state.store_lock.lock() else {
        return Vec::new();
    };
    let Ok(store) = load_store(&state.settings_path) else {
        return Vec::new();
    };
    let mut logs = store
        .get("protectionLogs")
        .cloned()
        .and_then(|v| serde_json::from_value::<Vec<ProtectionLogEntry>>(v).ok())
        .unwrap_or_default();
    redact_log_titles(&mut logs);
    logs
}

fn redact_stored_protection_logs(app: &AppHandle) -> Result<(), String> {
    let state = app_state(app);
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "settings_lock_failed".to_string())?;
    let mut store = load_store(&state.settings_path)?;
    let Some(raw_logs) = store.get("protectionLogs").cloned() else {
        return Ok(());
    };
    let Ok(mut logs) = serde_json::from_value::<Vec<ProtectionLogEntry>>(raw_logs) else {
        return Ok(());
    };
    if redact_log_titles(&mut logs) {
        store["protectionLogs"] =
            serde_json::to_value(logs).map_err(|err| format!("settings_write_failed: {err}"))?;
        save_store(&state.settings_path, &store)?;
    }
    Ok(())
}

fn append_activity_log(app: &AppHandle, entry: ProtectionLogEntry) -> Result<(), String> {
    let state = app_state(app);
    update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        let mut logs = store
            .get("protectionLogs")
            .cloned()
            .and_then(|v| serde_json::from_value::<Vec<ProtectionLogEntry>>(v).ok())
            .unwrap_or_default();
        redact_log_titles(&mut logs);
        logs.insert(0, entry);
        logs.truncate(PROTECTION_LOG_LIMIT);
        store["protectionLogs"] = serde_json::to_value(logs)
            .map_err(|err| format!("settings_write_failed: {err}"))?;
        Ok(())
    })
}

fn append_protection_log(
    app: &AppHandle,
    info: &ActiveWindowInfo,
    action: &str,
) -> Result<(), String> {
    append_activity_log(
        app,
        ProtectionLogEntry {
            timestamp: now_ms(),
            process_name: info.process_name.clone(),
            title: REDACTED_WINDOW_TITLE.into(),
            action: action.into(),
        },
    )
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

fn append_cover_activation_log(app: &AppHandle, settings: &DeskoySettings) -> Result<(), String> {
    append_activity_log(
        app,
        ProtectionLogEntry {
            timestamp: now_ms(),
            process_name: "Deskoy".into(),
            title: cover_activity_title(settings),
            action: "Cover activated".into(),
        },
    )
}

fn clear_protection_logs_from_store(app: &AppHandle) -> Result<(), String> {
    let state = app_state(app);
    update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        store["protectionLogs"] = json!([]);
        Ok(())
    })
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

fn remove_legacy_seeded_auto_hide_rules(settings: &mut DeskoySettings) -> bool {
    fn retain_explicit_rules(rules: &mut Vec<String>) -> bool {
        let original_len = rules.len();
        rules.retain(|rule| {
            !LEGACY_IMPLICIT_BLOCKED_APPS
                .iter()
                .any(|legacy| rule.trim().eq_ignore_ascii_case(legacy))
        });
        rules.len() != original_len
    }

    let mut changed = retain_explicit_rules(&mut settings.blocked_apps);
    for profile in &mut settings.profiles {
        changed |= retain_explicit_rules(&mut profile.settings.blocked_apps);
    }
    changed
}

fn load_settings_from_path(path: &PathBuf) -> DeskoySettings {
    let mut store = load_store(path).unwrap_or_else(|err| {
        eprintln!("[deskoy:settings] {err}");
        json!({})
    });
    let had_saved_settings = store.get("settings").is_some();
    let mut settings = normalize_settings(
        store
            .get("settings")
            .cloned()
            .and_then(|v| serde_json::from_value::<DeskoySettings>(v).ok())
            .unwrap_or_default(),
    );

    if had_saved_settings
        && store
            .get(AUTO_HIDE_EXPLICIT_RULES_MIGRATION_KEY)
            .and_then(Value::as_bool)
            != Some(true)
    {
        remove_legacy_seeded_auto_hide_rules(&mut settings);
        store[AUTO_HIDE_EXPLICIT_RULES_MIGRATION_KEY] = Value::Bool(true);
        store["settings"] = serde_json::to_value(&settings).unwrap_or_else(|_| json!({}));
        if let Err(err) = save_store(path, &store) {
            eprintln!("[deskoy:settings] {err}");
        }
    }

    settings
}

fn set_settings_in_state(app: &AppHandle, patch: Value) -> Result<DeskoySettings, String> {
    let state = app_state(app);
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "settings_lock_failed".to_string())?;
    let mut current = serde_json::to_value(state.settings.lock().unwrap().clone())
        .map_err(|err| format!("settings_write_failed: {err}"))?;
    if let (Value::Object(cur), Value::Object(patch_obj)) = (&mut current, patch) {
        for (key, value) in patch_obj {
            if key != "autostart" && key != "closeEverythingOnTrigger" {
                cur.insert(key, value);
            }
        }
    }
    let settings = normalize_settings(serde_json::from_value(current).unwrap_or_default());
    let mut store = load_store(&state.settings_path)?;
    store["settings"] = serde_json::to_value(&settings)
        .map_err(|err| format!("settings_write_failed: {err}"))?;
    save_store(&state.settings_path, &store)?;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
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
    let open = MenuItem::with_id(app, "open", "Open Deskoy", true, None::<&str>)?;
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
            &resume,
            &pause_5,
            &pause_15,
            &pause_30,
            &pause_restart,
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
        let mut settings = get_settings_from_state(&app);
        apply_cover_entitlement(&app, &mut settings);
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
        if let Err(err) = append_cover_activation_log(&app, &settings) {
            report_runtime_error(&app, "activity-log", err);
        }
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
    if let Some(info) = &trigger {
        tokio::time::sleep(COVER_BEFORE_HIDE_DELAY).await;
        let handled = close_blocked_window(info).await;
        if let Err(err) = append_protection_log(&app, info, "Covered and hidden") {
            report_runtime_error(&app, "activity-log", err);
        }
        if !handled {
            report_runtime_error(&app, "blocked-window", "failed to hide blocked window");
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
                if is_blocked_window_gone_or_minimized(&info) {
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
        if !app
            .state::<licensing::LicenseManager>()
            .has_pro_entitlement()
            || !s.enabled
            || is_paused(&app)
            || !s.auto_cover_blocked
        {
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
    match clear_protection_logs_from_store(&app) {
        Ok(()) => json!({ "ok": true }),
        Err(err) => {
            report_runtime_error(&app, "settings", err);
            json!({ "ok": false, "error": "settings_write_failed" })
        }
    }
}

#[tauri::command]
async fn save_settings(app: AppHandle, window: tauri::WebviewWindow, patch: Value) -> Value {
    if (patch.get("developerMode").is_some()
        || patch.get("developerModeDisclaimerAccepted").is_some()
        || patch_touches_pro_feature(&patch))
        && defender::authorize(&window).is_err()
    {
        return json!({ "ok": false, "error": "This setting is available only in Deskoy's main window." });
    }
    let enables_pro_feature = patch_enables_pro_feature(&patch);
    if enables_pro_feature
        && !app
            .state::<licensing::LicenseManager>()
            .has_pro_entitlement()
    {
        return json!({ "ok": false, "error": "pro_required" });
    }
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
    if !developer_mode_change_allowed(&prev, &patch) {
        return json!({ "ok": false, "error": "Accept the Developer Mode disclaimer first." });
    }
    let next = match set_settings_in_state(&app, patch) {
        Ok(settings) => settings,
        Err(err) => {
            report_runtime_error(&app, "settings", err);
            return json!({ "ok": false, "error": "settings_write_failed" });
        }
    };
    if !register_hotkeys(&app, &next) {
        if let Err(err) =
            set_settings_in_state(&app, serde_json::to_value(prev.clone()).unwrap_or_default())
        {
            report_runtime_error(&app, "settings", err);
            return json!({ "ok": false, "error": "settings_write_failed" });
        }
        let _ = register_hotkeys(&app, &prev);
        return json!({ "ok": false, "error": "hotkey_unavailable" });
    }
    defender::developer_mode_changed(&app, next.developer_mode);
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
    let next = match set_settings_in_state(&app, json!({ "enabled": next_enabled })) {
        Ok(settings) => settings,
        Err(err) => {
            report_runtime_error(&app, "settings", err);
            return json!({ "ok": false, "active": prev.enabled, "error": "settings_write_failed" });
        }
    };
    if !register_hotkeys(&app, &next) {
        let rolled = set_settings_in_state(&app, json!({ "enabled": false }));
        if let Ok(rolled) = &rolled {
            let _ = register_hotkeys(&app, rolled);
        } else if let Err(err) = rolled {
            report_runtime_error(&app, "settings", err);
            emit_state(&app);
            show_main_window(&app);
            return json!({ "ok": false, "active": effective_enabled(&app), "error": "settings_write_failed" });
        }
        emit_state(&app);
        show_main_window(&app);
        return json!({ "ok": false, "active": false, "error": "hotkey_unavailable" });
    }
    let active = effective_enabled(&app);
    emit_state(&app);
    json!({ "ok": true, "active": active })
}

#[tauri::command]
async fn pick_cover_file(app: AppHandle, window: tauri::WebviewWindow) -> Value {
    if defender::authorize(&window).is_err() {
        return json!({ "ok": false, "path": "", "error": "This setting is available only in Deskoy's main window." });
    }
    if !app
        .state::<licensing::LicenseManager>()
        .has_pro_entitlement()
    {
        return json!({ "ok": false, "path": "", "error": "pro_required" });
    }
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
        match set_settings_in_state(
            &app,
            json!({ "coverFilePath": path_text, "coverMode": "file" }),
        ) {
            Ok(_) => json!({ "ok": true, "path": path.to_string_lossy() }),
            Err(err) => {
                report_runtime_error(&app, "settings", err);
                json!({ "ok": false, "path": "", "error": "settings_write_failed" })
            }
        }
    } else {
        json!({ "ok": true, "path": "" })
    }
}

fn sanitized_settings(settings: &DeskoySettings) -> Value {
    json!({
        "hotkeySet": !settings.hotkey.trim().is_empty(),
        "coverMode": settings.cover_mode,
        "cover": settings.cover,
        "coverDisplay": settings.cover_display,
        "customCoverEnabled": settings.use_custom_cover,
        "customCoverUrlSet": !settings.cover_url.trim().is_empty(),
        "customCoverFileSet": !settings.cover_file_path.trim().is_empty(),
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

#[cfg(test)]
mod regression_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIRECTORY_ID: AtomicU64 = AtomicU64::new(0);

    fn test_store_path(label: &str) -> PathBuf {
        let id = TEST_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "deskoy-{label}-{}-{id}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory.join("settings.json")
    }

    fn remove_test_store(path: &Path) {
        if let Some(directory) = path.parent() {
            let _ = fs::remove_dir_all(directory);
        }
    }

    #[test]
    fn activation_hotkeys_allow_the_legacy_single_key_bindings() {
        assert!(parse_hotkey("A").is_some());
        assert!(parse_hotkey("7").is_some());
        assert!(parse_hotkey("Escape").is_some());
        assert!(parse_hotkey("Ctrl+A").is_some());
        assert!(parse_hotkey("Alt+7").is_some());
        assert!(parse_hotkey("Shift+Escape").is_some());
        assert!(parse_hotkey("F8").is_some());
    }

    #[test]
    fn developer_mode_and_disclaimer_defaults_and_persist() {
        let mut existing_user = serde_json::to_value(DeskoySettings::default()).unwrap();
        let existing_user_object = existing_user.as_object_mut().unwrap();
        existing_user_object.remove("developerMode");
        existing_user_object.remove("developerModeDisclaimerAccepted");
        let existing_user: DeskoySettings = serde_json::from_value(existing_user).unwrap();
        assert!(!existing_user.developer_mode);
        assert!(!existing_user.developer_mode_disclaimer_accepted);
        assert!(!developer_mode_change_allowed(
            &existing_user,
            &json!({ "developerMode": true })
        ));
        assert!(developer_mode_change_allowed(
            &existing_user,
            &json!({
                "developerMode": true,
                "developerModeDisclaimerAccepted": true
            })
        ));

        let mut enabled = existing_user;
        enabled.developer_mode = true;
        enabled.developer_mode_disclaimer_accepted = true;
        let restored: DeskoySettings =
            serde_json::from_value(serde_json::to_value(enabled).unwrap()).unwrap();
        assert!(restored.developer_mode);
        assert!(restored.developer_mode_disclaimer_accepted);
        assert!(developer_mode_change_allowed(
            &restored,
            &json!({ "developerMode": true })
        ));
    }

    #[test]
    fn pro_settings_include_custom_cover_and_profile_values() {
        assert!(patch_enables_pro_feature(
            &json!({ "useCustomCover": true })
        ));
        assert!(patch_enables_pro_feature(&json!({ "coverMode": "url" })));
        assert!(patch_enables_pro_feature(&json!({ "coverMode": "vscode" })));
        assert!(patch_enables_pro_feature(&json!({ "cover": "black" })));
        assert!(patch_enables_pro_feature(
            &json!({ "coverDisplay": "monitor:1" })
        ));
        assert!(patch_enables_pro_feature(&json!({
            "profiles": [{ "settings": { "useCustomCover": true } }]
        })));
        assert!(patch_touches_pro_feature(
            &json!({ "useCustomCover": false })
        ));
        assert!(patch_touches_pro_feature(&json!({ "coverDisplay": "all" })));
        assert!(!patch_enables_pro_feature(&json!({
            "coverMode": "docs",
            "cover": "jira",
            "coverDisplay": "all",
            "useCustomCover": false
        })));
    }

    #[test]
    fn free_entitlement_replaces_pro_only_covers() {
        let mut settings = DeskoySettings {
            cover_mode: "vscode".into(),
            cover: "black".into(),
            ..DeskoySettings::default()
        };

        apply_free_cover_entitlement(&mut settings);

        assert_eq!(settings.cover_mode, "excel");
        assert_eq!(settings.cover, "excel");
    }

    #[test]
    fn legacy_implicit_auto_hide_rules_are_removed_without_touching_custom_rules() {
        let mut settings = DeskoySettings::default();
        settings.blocked_apps = vec!["Discord".into(), "My Private App".into()];
        settings.profiles.push(DeskoyProfile {
            id: "work".into(),
            name: "Work".into(),
            settings: DeskoyProfileSettings {
                blocked_apps: vec!["Outlook".into(), "Accounting Tool".into()],
                ..DeskoyProfileSettings::default()
            },
        });

        assert!(remove_legacy_seeded_auto_hide_rules(&mut settings));
        assert_eq!(settings.blocked_apps, vec!["My Private App"]);
        assert_eq!(
            settings.profiles[0].settings.blocked_apps,
            vec!["Accounting Tool"]
        );
    }

    #[test]
    fn loading_existing_settings_migrates_implicit_auto_hide_rules_once() {
        let path = test_store_path("auto-hide-migration");
        let mut settings = DeskoySettings::default();
        settings.blocked_apps = vec!["Discord".into(), "Custom App".into()];
        save_store(&path, &json!({ "settings": settings })).unwrap();

        let loaded = load_settings_from_path(&path);
        let stored = load_store(&path).unwrap();

        assert_eq!(loaded.blocked_apps, vec!["Custom App"]);
        assert_eq!(
            stored[AUTO_HIDE_EXPLICIT_RULES_MIGRATION_KEY],
            Value::Bool(true)
        );
        assert_eq!(stored["settings"]["blockedApps"], json!(["Custom App"]));
        remove_test_store(&path);
    }

    #[test]
    fn atomic_store_write_replaces_with_valid_json() {
        let path = test_store_path("atomic-replace");
        save_store(&path, &json!({ "settings": { "enabled": false } })).unwrap();
        save_store(&path, &json!({ "settings": { "enabled": true } })).unwrap();

        let store = load_store(&path).unwrap();
        assert_eq!(store["settings"]["enabled"], json!(true));
        assert!(!temporary_store_path(&path).exists());
        remove_test_store(&path);
    }

    #[test]
    fn failed_store_write_is_reported() {
        let path = test_store_path("write-error");
        fs::create_dir(&path).unwrap();

        assert!(save_store(&path, &json!({ "settings": {} })).is_err());
        remove_test_store(&path);
    }

    #[test]
    fn corrupt_store_is_not_overwritten_by_an_update() {
        let path = test_store_path("preserve-corrupt");
        fs::write(&path, "not json").unwrap();
        let lock = Mutex::new(());

        let result = update_store_at_path(&path, &lock, |store| {
            store["settings"] = json!({ "enabled": true });
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
        remove_test_store(&path);
    }

    #[test]
    fn concurrent_store_updates_preserve_every_change() {
        let path = Arc::new(test_store_path("concurrent"));
        let lock = Arc::new(Mutex::new(()));
        let mut workers = Vec::new();
        for index in 0..12 {
            let path = path.clone();
            let lock = lock.clone();
            workers.push(thread::spawn(move || {
                update_store_at_path(&path, &lock, |store| {
                    store
                        .as_object_mut()
                        .unwrap()
                        .insert(format!("item-{index}"), json!(index));
                    Ok(())
                })
                .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }

        let store = load_store(&path).unwrap();
        for index in 0..12 {
            assert_eq!(store[format!("item-{index}")], json!(index));
        }
        remove_test_store(&path);
    }

    #[test]
    fn stored_window_titles_are_redacted_but_cover_labels_remain() {
        let mut logs = vec![
            ProtectionLogEntry {
                timestamp: 1,
                process_name: "Excel".into(),
                title: "C:\\Users\\Someone\\private.xlsx - Excel".into(),
                action: "Covered and hidden".into(),
            },
            ProtectionLogEntry {
                timestamp: 2,
                process_name: "Deskoy".into(),
                title: "Excel Spreadsheet cover".into(),
                action: "Cover activated".into(),
            },
        ];

        assert!(redact_log_titles(&mut logs));
        assert_eq!(logs[0].title, REDACTED_WINDOW_TITLE);
        assert_eq!(logs[1].title, "Excel Spreadsheet cover");
    }

}
