//! Local Defender companion. Paths are configuration/runtime-only, never scan history or diagnostics.
use super::defender_watch::DownloadWatcher;
use super::defender_windows::{self, FileStamp};
use super::licensing::LicenseManager;
use super::{app_state, get_settings_from_state, load_store, now_ms, update_store_at_path};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

const HISTORY_LIMIT: usize = 50;
const QUEUE_LIMIT: usize = 64;
const FOLDER_LIMIT: usize = 8;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Folder {
    id: String,
    path: String,
    name: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    enabled: bool,
    notifications: bool,
    folders: Vec<Folder>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanLog {
    id: String,
    timestamp: u128,
    filename: String,
    source: String,
    result: String,
    detail: String,
    action: Option<String>,
    #[serde(skip)]
    retry_available: bool,
}

// Retry availability is transient; history must not contain the original full path.
fn log_value(log: &ScanLog) -> Value {
    let mut value = serde_json::to_value(log).unwrap_or_default();
    value["retryAvailable"] = json!(log.retry_available);
    value
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    id: String,
    filename: String,
    source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveScan {
    #[serde(flatten)]
    scan: ScanSummary,
    phase: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    enabled: bool,
    notifications_enabled: bool,
    developer_mode: bool,
    folders: Vec<Folder>,
    busy: bool,
    queued: usize,
    progress: Option<String>,
    active_scan: Option<ActiveScan>,
    queued_scans: Vec<ScanSummary>,
    last_completed: Option<Value>,
    protection: Option<defender_windows::ProtectionStatus>,
}

#[derive(Clone)]
struct Job {
    id: String,
    path: PathBuf,
    stamp: Option<FileStamp>,
    automatic: bool,
    generation: u64,
}

impl Job {
    fn summary(&self) -> ScanSummary {
        ScanSummary {
            id: self.id.clone(),
            filename: clean_name(&self.path),
            source: if self.automatic { "automatic" } else { "manual" }.into(),
        }
    }
}

struct Runtime {
    config: Config,
    developer_mode: bool,
    generation: u64,
    queue: VecDeque<Job>,
    busy: bool,
    progress: Option<String>,
    active_scan: Option<ActiveScan>,
    last_completed: Option<ScanLog>,
    protection: Option<defender_windows::ProtectionStatus>,
    logs: Vec<ScanLog>,
    retries: HashMap<String, PathBuf>,
    alerts: HashMap<String, Instant>,
    auto_paused: bool,
    sequence: u64,
}

impl Runtime {
    fn protecting(&self) -> bool {
        self.developer_mode && self.config.enabled
    }

    fn watching(&self) -> bool {
        self.protecting()
            && !self.config.folders.is_empty()
            && !self.auto_paused
    }

    fn allows(&self, job: &Job) -> bool {
        self.developer_mode
            && (!job.automatic || (self.watching() && job.generation == self.generation))
    }

    fn reset_queue(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        if self.developer_mode {
            self.queue.retain(|job| !job.automatic);
        } else {
            self.queue.clear();
        }
        self.auto_paused = false;
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            enabled: self.config.enabled,
            notifications_enabled: self.config.notifications,
            developer_mode: self.developer_mode,
            folders: self.config.folders.clone(),
            busy: self.busy,
            queued: self.queue.len(),
            progress: self.progress.clone(),
            active_scan: self.active_scan.clone(),
            queued_scans: self.queue.iter().map(Job::summary).collect(),
            last_completed: self.last_completed.as_ref().map(log_value),
            protection: self.protection.clone(),
        }
    }

    fn next_scan_id(&mut self) -> String {
        self.sequence = self.sequence.wrapping_add(1);
        format!("{}-{}", now_ms(), self.sequence)
    }

    fn should_notify(&mut self, key: String) -> bool {
        let now = Instant::now();
        self.alerts
            .retain(|_, last| now.duration_since(*last) < Duration::from_secs(600));
        if self.alerts.contains_key(&key) {
            return false;
        }
        if self.alerts.len() >= HISTORY_LIMIT {
            self.alerts.clear();
        }
        self.alerts.insert(key, now);
        true
    }
}

struct Service {
    runtime: Mutex<Runtime>,
    wake: Condvar,
    status_wake: Condvar,
}

fn service(app: &AppHandle) -> Arc<Service> {
    app.state::<Arc<Service>>().inner().clone()
}

fn trusted_location(label: &str, url: &url::Url) -> bool {
    if label != "main" || url.username() != "" || url.password().is_some() {
        return false;
    }
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none());
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
        && url.port() == Some(1420);
    bundled || development
}

pub(super) fn authorize(window: &WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "This action is available only in Deskoy's main window.")?;
    if !trusted_location(window.label(), &url) {
        return Err("This action is available only in Deskoy's main window.".into());
    }
    Ok(())
}

fn emit(app: &AppHandle, name: &str, value: impl Serialize + Clone) {
    if let Some(window) = app.get_webview_window("main") {
        if authorize(&window).is_ok() {
            let _ = window.emit(name, value);
        }
    }
}

fn changed(app: &AppHandle) {
    let snapshot = service(app).runtime.lock().unwrap().snapshot();
    emit(app, "deskoy:defenderChanged", snapshot);
}

fn require_developer(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    authorize(window)?;
    if !app.state::<LicenseManager>().has_pro_entitlement() {
        return Err("Deskoy Pro is required to use Developer Mode tools.".into());
    }
    if !service(app).runtime.lock().unwrap().developer_mode {
        return Err("Enable Developer Mode to use Defender tools.".into());
    }
    Ok(())
}

fn clean_visible_text(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .take(limit)
        .collect()
}

fn clean_name(path: &Path) -> String {
    let name: String = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .take(240)
        .collect();
    if name.trim().is_empty() {
        "Unknown file".into()
    } else {
        name
    }
}

fn scan_phase(progress: &str) -> &'static str {
    let progress = progress.to_ascii_lowercase();
    if progress.contains("still running") || progress.contains("result is incomplete") {
        "timeout"
    } else if progress.contains("verifying") {
        "checking-result"
    } else if progress.contains("scanning") {
        "scanning"
    } else {
        "checking"
    }
}

fn confirmed_action(value: &str) -> bool {
    !value.is_empty()
        && value
            .split(", ")
            .all(|part| matches!(part, "Cleaned" | "Quarantined" | "Removed"))
}

// No UNC/device paths or reparse points, including an ancestor changed after folder selection.
fn local_path(path: &Path, directory: bool) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Choose a local file or folder using the picker.".into());
    }
    let canonical = fs::canonicalize(path)
        .map_err(|_| "The file or folder is missing or cannot be accessed.")?;
    let raw = canonical.to_string_lossy();
    let raw = raw.strip_prefix("\\\\?\\").unwrap_or(&raw);
    if raw.starts_with("\\\\")
        || raw.starts_with("UNC\\")
        || raw.as_bytes().get(1) != Some(&b':')
        || raw.get(2..).unwrap_or("").contains(':')
    {
        return Err("Choose a regular file or folder on a local drive.".into());
    }
    let normalized = PathBuf::from(raw);
    for ancestor in path.ancestors().chain(normalized.ancestors()) {
        let meta =
            fs::symlink_metadata(ancestor).map_err(|_| "The file or folder cannot be accessed.")?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(
                    "Linked files and folders are not supported for Defender checks.".into(),
                );
            }
        }
        if meta.file_type().is_symlink() {
            return Err("Linked files and folders are not supported for Defender checks.".into());
        }
    }
    let meta = fs::metadata(&normalized).map_err(|_| "The file or folder cannot be accessed.")?;
    if (directory && (!meta.is_dir() || normalized.parent().is_none()))
        || (!directory && !meta.is_file())
    {
        return Err("Choose a regular file or a specific folder, not an entire drive.".into());
    }
    Ok(normalized)
}

pub(super) fn start(app: AppHandle) {
    let state = app_state(&app);
    let store = load_store(&state.settings_path).unwrap_or_else(|_| json!({}));
    let mut config: Config = store
        .get("defender")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    config.folders.retain(|folder| {
        let path = Path::new(&folder.path);
        folder.path.len() <= 32_767
            && path.is_absolute()
            && path.parent().is_some()
            && !folder.path.starts_with("\\\\")
    });
    for (index, folder) in config.folders.iter_mut().enumerate() {
        folder.id = clean_visible_text(&folder.id, 64);
        if folder.id.is_empty() {
            folder.id = format!("folder-{index}");
        }
        folder.name = clean_name(Path::new(&folder.path));
    }
    let mut seen_folders = HashSet::new();
    config
        .folders
        .retain(|folder| seen_folders.insert(folder.path.to_lowercase()));
    config.folders.truncate(FOLDER_LIMIT);
    let mut logs: Vec<ScanLog> = store
        .get("defenderScans")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    logs.retain(|log| {
        matches!(log.source.as_str(), "manual" | "automatic")
            && matches!(
                log.result.as_str(),
                "clean" | "threat" | "remediated" | "failed" | "incomplete"
            )
    });
    for log in &mut logs {
        log.id = clean_visible_text(&log.id, 80);
        log.filename = clean_name(Path::new(&log.filename));
        log.detail = clean_visible_text(&log.detail, 800);
        log.action = log
            .action
            .as_deref()
            .filter(|action| confirmed_action(action))
            .map(|action| action.to_string());
        log.retry_available = false;
    }
    logs.truncate(HISTORY_LIMIT);
    let last_completed = logs.first().cloned();
    let runtime = Runtime {
        config,
        developer_mode: get_settings_from_state(&app).developer_mode
            && app.state::<LicenseManager>().has_pro_entitlement(),
        generation: 0,
        queue: VecDeque::new(),
        busy: false,
        progress: None,
        active_scan: None,
        last_completed,
        protection: None,
        logs,
        retries: HashMap::new(),
        alerts: HashMap::new(),
        auto_paused: false,
        sequence: 0,
    };
    let service = Arc::new(Service {
        runtime: Mutex::new(runtime),
        wake: Condvar::new(),
        status_wake: Condvar::new(),
    });
    app.manage(service.clone());
    let scan_app = app.clone();
    let scan_service = service.clone();
    thread::spawn(move || scan_loop(scan_app, scan_service));
    let watch_app = app.clone();
    let watch_service = service.clone();
    thread::spawn(move || watch_loop(watch_app, watch_service));
    thread::spawn(move || protection_loop(app, service));
}

pub(super) fn developer_mode_changed(app: &AppHandle, enabled: bool) {
    let service = service(app);
    let enabled = enabled && app.state::<LicenseManager>().has_pro_entitlement();
    {
        let mut rt = service.runtime.lock().unwrap();
        if rt.developer_mode == enabled {
            return;
        }
        rt.developer_mode = enabled;
        rt.reset_queue();
        if !enabled && rt.busy {
            rt.progress = Some(
                "Developer Mode is off. An already-started Defender scan may still finish.".into(),
            );
        }
    }
    service.wake.notify_all();
    service.status_wake.notify_all();
    changed(app);
}

fn save_config(
    app: &AppHandle,
    update: impl FnOnce(&mut Config) -> Result<(), String>,
) -> Result<Snapshot, String> {
    let service = service(app);
    let mut rt = service.runtime.lock().unwrap();
    let mut next = rt.config.clone();
    update(&mut next)?;
    let state = app_state(app);
    update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        store["defender"] =
            serde_json::to_value(&next).map_err(|_| "Unable to save Defender preferences.")?;
        Ok(())
    })
    .map_err(|_| "Unable to save Defender preferences. The previous settings are unchanged.")?;
    rt.config = next;
    rt.reset_queue();
    if !rt.busy {
        rt.progress = None;
    } else if !rt.config.enabled {
        rt.progress =
            Some("Auto Protect is off. An already-started Defender scan may still finish.".into());
    }
    if !rt.config.enabled {
        rt.protection = None;
    }
    let snapshot = rt.snapshot();
    drop(rt);
    service.wake.notify_all();
    service.status_wake.notify_all();
    changed(app);
    Ok(snapshot)
}

fn enqueue(app: &AppHandle, path: PathBuf) -> Result<Value, String> {
    let path = local_path(&path, false)?;
    let filename = clean_name(&path);
    let stamp = defender_windows::file_stamp(&path).ok();
    let service = service(app);
    let mut rt = service.runtime.lock().unwrap();
    if !rt.developer_mode {
        return Err("Developer Mode is off. No scan was started.".into());
    }
    if rt.queue.len() >= QUEUE_LIMIT {
        return Err("The scan queue is full. Try again after the current check finishes.".into());
    }
    if rt.queue.iter().any(|job| job.path == path) {
        return Err("This file is already queued.".into());
    }
    let id = rt.next_scan_id();
    let generation = rt.generation;
    rt.queue.push_front(Job {
        id: id.clone(),
        path,
        stamp,
        automatic: false,
        generation,
    });
    drop(rt);
    service.wake.notify_one();
    changed(app);
    Ok(json!({ "queued": true, "scanId": id, "filename": filename }))
}

fn record(
    app: &AppHandle,
    service: &Service,
    scan_id: Option<&str>,
    path: Option<&Path>,
    automatic: bool,
    result: &str,
    detail: String,
    action: Option<String>,
) {
    let mut rt = service.runtime.lock().unwrap();
    let id = scan_id
        .map(str::to_owned)
        .unwrap_or_else(|| rt.next_scan_id());
    let filename = path
        .map(clean_name)
        .unwrap_or_else(|| "Automatic download checking".into());
    let notifications_allowed = !automatic || rt.config.notifications;
    let notify = result != "clean"
        && notifications_allowed
        && rt.should_notify(if matches!(result, "threat" | "remediated") {
            format!("{filename}:{result}:{detail}")
        } else {
            format!("{result}:{detail}")
        });
    let action = action.filter(|value| confirmed_action(value));
    let log = ScanLog {
        id: id.clone(),
        timestamp: now_ms(),
        filename,
        source: if automatic { "automatic" } else { "manual" }.into(),
        result: result.into(),
        detail: clean_visible_text(&detail, 800),
        action,
        retry_available: path.is_some(),
    };
    if let Some(path) = path {
        rt.retries.insert(id.clone(), path.into());
    }
    rt.last_completed = Some(log.clone());
    rt.logs.insert(0, log.clone());
    rt.logs.truncate(HISTORY_LIMIT);
    let ids: Vec<_> = rt.logs.iter().map(|log| log.id.clone()).collect();
    rt.retries.retain(|id, _| ids.contains(id));
    let state = app_state(app);
    let persisted = update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        store["defenderScans"] =
            serde_json::to_value(&rt.logs).map_err(|_| "Unable to save scan history.")?;
        Ok(())
    })
    .is_ok();
    if !persisted {
        rt.progress = Some("Scan finished, but its local history could not be saved. View Details before closing Deskoy.".into());
    }
    let desktop_notification = automatic && notify;
    let notification_body = match result {
        "threat" => format!(
            "Microsoft Defender detected a threat in {}. Review Windows Security.",
            log.filename
        ),
        "remediated" => format!(
            "Microsoft Defender confirmed remediation for {}.",
            log.filename
        ),
        _ => "An automatic Defender check needs attention. Open Deskoy for details.".into(),
    };
    drop(rt);
    if desktop_notification {
        let _ = app
            .notification()
            .builder()
            .title("Deskoy Auto Protect")
            .body(notification_body)
            .show();
    }
    emit(
        app,
        "deskoy:defenderScan",
        json!({"log":log_value(&log), "notify": notify || !persisted}),
    );
}

fn protection_loop(app: AppHandle, service: Arc<Service>) {
    loop {
        let should_check = service.runtime.lock().unwrap().protecting();
        if should_check {
            {
                let mut rt = service.runtime.lock().unwrap();
                if rt.protection.is_none() {
                    rt.protection = Some(defender_windows::ProtectionStatus::checking());
                }
            }
            changed(&app);
            let status = defender_windows::protection_status();
            let notify = {
                let mut rt = service.runtime.lock().unwrap();
                if rt.protecting() {
                    let changed_to_attention = status.state != "protected"
                        && status.state != "checking"
                        && rt
                            .protection
                            .as_ref()
                            .is_none_or(|previous| previous.state != status.state);
                    let notify = rt.config.notifications
                        && changed_to_attention
                        && rt.should_notify(format!("protection:{}", status.state));
                    rt.protection = Some(status);
                    notify
                } else {
                    false
                }
            };
            if notify {
                let _ = app
                    .notification()
                    .builder()
                    .title("Deskoy Auto Protect")
                    .body("Microsoft Defender protection needs attention. Review Windows Security.")
                    .show();
            }
            changed(&app);
        } else {
            let changed_status = service.runtime.lock().unwrap().protection.take().is_some();
            if changed_status {
                changed(&app);
            }
        }

        let wait = if should_check {
            Duration::from_secs(45)
        } else {
            Duration::from_secs(3_600)
        };
        let rt = service.runtime.lock().unwrap();
        let _ = service.status_wake.wait_timeout(rt, wait).unwrap();
    }
}

fn scan_loop(app: AppHandle, service: Arc<Service>) {
    loop {
        let job = {
            let mut rt = service.runtime.lock().unwrap();
            while rt.queue.is_empty() {
                rt = service.wake.wait(rt).unwrap();
            }
            let job = rt.queue.pop_front().unwrap();
            if !rt.allows(&job) {
                continue;
            }
            rt.busy = true;
            rt.progress = Some(format!(
                "Preparing Defender check: {}",
                clean_name(&job.path)
            ));
            rt.active_scan = Some(ActiveScan {
                scan: job.summary(),
                phase: "checking".into(),
            });
            job
        };
        changed(&app);
        let unchanged = job
            .stamp
            .as_ref()
            .is_none_or(|stamp| defender_windows::file_stamp(&job.path).as_ref() == Ok(stamp));
        let result = if !unchanged {
            defender_windows::NativeResult { result: "incomplete".into(), detail: "The file changed or disappeared while queued. Choose it again to scan the current file.".into(), action: None, systemic: false }
        } else {
            defender_windows::scan(
                &job.path,
                |phase| {
                    let mut rt = service.runtime.lock().unwrap();
                    rt.progress = Some(phase.into());
                    if rt
                        .active_scan
                        .as_ref()
                        .is_some_and(|active| active.scan.id == job.id)
                    {
                        rt.active_scan.as_mut().unwrap().phase = scan_phase(phase).into();
                    }
                    drop(rt);
                    changed(&app);
                },
                || service.runtime.lock().unwrap().allows(&job),
            )
        };
        {
            let mut rt = service.runtime.lock().unwrap();
            rt.busy = false;
            rt.progress = None;
            rt.active_scan = None;
            if job.automatic && result.systemic {
                rt.auto_paused = true;
                rt.queue.retain(|job| !job.automatic);
                rt.progress = Some("Automatic checks paused because Defender could not provide a conclusive system-level result. View Details, then turn Auto Protect off and on to retry.".into());
            }
        }
        record(
            &app,
            &service,
            Some(&job.id),
            Some(&job.path),
            job.automatic,
            &result.result,
            result.detail,
            result.action,
        );
        changed(&app);
    }
}

fn watch_loop(app: AppHandle, service: Arc<Service>) {
    let mut watcher = DownloadWatcher::new();
    let mut observed_generation = None;
    loop {
        let snapshot = {
            let rt = service.runtime.lock().unwrap();
            rt.watching().then(|| {
                (
                    rt.generation,
                    rt.config.folders.clone(),
                    QUEUE_LIMIT.saturating_sub(rt.queue.len()),
                )
            })
        };
        if let Some((generation, folders, capacity)) = snapshot {
            if observed_generation != Some(generation) {
                watcher.reset();
                observed_generation = Some(generation);
            }
            let validated: Result<Vec<_>, _> = folders
                .iter()
                .map(|folder| local_path(Path::new(&folder.path), true))
                .collect();
            match validated {
                Ok(paths) => {
                    let batch = watcher.poll_with_limit(&paths, capacity);
                    let mut overflow = false;
                    {
                        let mut rt = service.runtime.lock().unwrap();
                        if rt.generation == generation && rt.watching() {
                            for path in batch.ready {
                                if rt.queue.len() >= QUEUE_LIMIT { overflow = true; break; }
                                if rt.queue.iter().any(|job| job.path == path) { continue; }
                                let stamp = defender_windows::file_stamp(&path).ok();
                                let id = rt.next_scan_id();
                                rt.queue.push_back(Job { id, path, stamp, automatic: true, generation });
                            }
                        }
                    }
                    let warning = batch.warning.or_else(|| overflow.then(|| "The automatic scan queue is full. Use Scan File for files that were not queued.".into()));
                    if let Some(warning) = warning {
                        let warning = if batch.pause {
                            format!("Automatic checks are paused. {warning} Turn Auto Protect off and on after correcting it.")
                        } else {
                            warning
                        };
                        watch_warning(&app, &service, warning, batch.pause);
                    }
                    service.wake.notify_one();
                }
                Err(_) => watch_warning(&app, &service, "An enabled folder is missing, inaccessible or linked. Automatic checks are paused. Check your folders, then turn Auto Protect off and on.".into(), true),
            }
        } else {
            watcher.reset();
            observed_generation = None;
        }
        thread::sleep(Duration::from_secs(2));
    }
}

fn watch_warning(app: &AppHandle, service: &Service, warning: String, pause: bool) {
    let record_warning = {
        let mut rt = service.runtime.lock().unwrap();
        rt.auto_paused |= pause;
        if pause {
            rt.queue.retain(|job| !job.automatic);
        }
        rt.progress = Some(warning.clone());
        rt.should_notify(format!("watch:{warning}"))
    };
    if record_warning {
        record(app, service, None, None, true, "incomplete", warning, None);
        changed(app);
    }
}

#[tauri::command]
pub async fn defender_get_state(app: AppHandle, window: WebviewWindow) -> Result<Snapshot, String> {
    authorize(&window)?;
    Ok(service(&app).runtime.lock().unwrap().snapshot())
}

#[tauri::command]
pub async fn defender_pick_scan(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    require_developer(&app, &window)?;
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Scan a file with Microsoft Defender")
            .pick_file()
    })
    .await
    .map_err(|_| "The file picker could not be opened.")?;
    authorize(&window)?;
    match path {
        Some(path) => enqueue(&app, path),
        None => Ok(json!({"queued":false})),
    }
}

#[tauri::command]
pub async fn defender_scan_path(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<Value, String> {
    require_developer(&app, &window)?;
    enqueue(&app, PathBuf::from(path))
}

#[tauri::command]
pub async fn defender_retry_scan(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Value, String> {
    require_developer(&app, &window)?;
    let path = service(&app)
        .runtime
        .lock()
        .unwrap()
        .retries
        .get(&id)
        .cloned()
        .ok_or(
            "Choose the file again using Scan File; retry paths are not retained after restarting.",
        )?;
    enqueue(&app, path)
}

#[tauri::command]
pub async fn defender_set_enabled(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    if enabled {
        require_developer(&app, &window)?;
    }
    save_config(&app, |config| {
        config.enabled = enabled;
        Ok(())
    })
}

#[tauri::command]
pub async fn defender_set_notifications(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    if enabled {
        require_developer(&app, &window)?;
    }
    let service = service(&app);
    let mut rt = service.runtime.lock().unwrap();
    let mut next = rt.config.clone();
    next.notifications = enabled;
    let state = app_state(&app);
    update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        store["defender"] =
            serde_json::to_value(&next).map_err(|_| "Unable to save Defender preferences.")?;
        Ok(())
    })
    .map_err(|_| "Unable to save Defender preferences. The previous settings are unchanged.")?;
    rt.config = next;
    let snapshot = rt.snapshot();
    drop(rt);
    changed(&app);
    Ok(snapshot)
}

#[tauri::command]
pub async fn defender_pick_folder(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Snapshot, String> {
    require_developer(&app, &window)?;
    let suggested = app.path().download_dir().ok();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new()
            .set_title("Enable automatic download checks in this folder (no subfolders)");
        match suggested {
            Some(path) => dialog.set_directory(path),
            None => dialog,
        }
        .pick_folder()
    })
    .await
    .map_err(|_| "The folder picker could not be opened.")?;
    require_developer(&app, &window)?;
    if let Some(path) = path {
        let path = local_path(&path, true)?;
        let name = clean_name(&path);
        let path = path.to_string_lossy().into_owned();
        save_config(&app, |config| {
            if config
                .folders
                .iter()
                .any(|folder| folder.path.eq_ignore_ascii_case(&path))
            {
                return Ok(());
            }
            if config.folders.len() >= FOLDER_LIMIT {
                return Err("Up to eight folders can be enabled. Remove a folder first.".into());
            }
            config.folders.push(Folder {
                id: format!("folder-{}", now_ms()),
                path,
                name,
            });
            Ok(())
        })
    } else {
        Ok(service(&app).runtime.lock().unwrap().snapshot())
    }
}

#[tauri::command]
pub async fn defender_remove_folder(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    save_config(&app, |config| {
        config.folders.retain(|folder| folder.id != id);
        Ok(())
    })
}

#[tauri::command]
pub async fn defender_get_logs(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<Value>, String> {
    authorize(&window)?;
    Ok(service(&app)
        .runtime
        .lock()
        .unwrap()
        .logs
        .iter()
        .map(log_value)
        .collect())
}

#[tauri::command]
pub async fn defender_clear_logs(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    authorize(&window)?;
    let service = service(&app);
    let mut rt = service.runtime.lock().unwrap();
    let state = app_state(&app);
    update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        store["defenderScans"] = json!([]);
        Ok(())
    })
    .map_err(|_| "Scan history could not be cleared. Try again.")?;
    rt.logs.clear();
    rt.retries.clear();
    Ok(json!({"ok":true}))
}

#[tauri::command]
pub async fn defender_open_security(window: WebviewWindow) -> Result<Value, String> {
    authorize(&window)?;
    open::that("windowsdefender:").map_err(|_| "Windows Security could not be opened.")?;
    Ok(json!({"ok":true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> Runtime {
        Runtime {
            config: Config::default(),
            developer_mode: true,
            generation: 1,
            queue: VecDeque::new(),
            busy: false,
            progress: None,
            active_scan: None,
            last_completed: None,
            protection: None,
            logs: vec![],
            retries: HashMap::new(),
            alerts: HashMap::new(),
            auto_paused: false,
            sequence: 0,
        }
    }

    fn job(automatic: bool) -> Job {
        Job {
            id: if automatic { "automatic-job" } else { "manual-job" }.into(),
            path: "C:\\Downloads\\fixture.txt".into(),
            stamp: None,
            automatic,
            generation: 1,
        }
    }

    #[test]
    fn default_has_no_watchers_or_enrolled_folders() {
        let config: Config = serde_json::from_value(json!({})).unwrap();
        assert!(!config.enabled);
        assert!(!config.notifications);
        assert!(config.folders.is_empty());
        assert!(!runtime().watching());
    }

    #[test]
    fn real_time_companion_can_run_without_enrolling_a_folder() {
        let mut rt = runtime();
        rt.config.enabled = true;
        assert!(rt.protecting());
        assert!(!rt.watching());
    }

    #[test]
    fn automatic_preferences_round_trip_without_enrolling_a_default_folder() {
        let default: Config = serde_json::from_value(json!({})).unwrap();
        assert!(!default.enabled);
        assert!(default.folders.is_empty());

        let configured = Config {
            enabled: true,
            notifications: true,
            folders: vec![Folder {
                id: "downloads".into(),
                path: "C:\\Users\\Example\\Downloads".into(),
                name: "Downloads".into(),
            }],
        };
        let restored: Config =
            serde_json::from_value(serde_json::to_value(configured).unwrap()).unwrap();
        assert!(restored.enabled);
        assert!(restored.notifications);
        assert_eq!(restored.folders.len(), 1);
        assert_eq!(restored.folders[0].name, "Downloads");
    }

    #[test]
    fn snapshot_correlates_jobs_and_completed_results_without_paths() {
        let mut rt = runtime();
        let active = job(false);
        let queued = job(true);
        rt.busy = true;
        rt.active_scan = Some(ActiveScan {
            scan: active.summary(),
            phase: "scanning".into(),
        });
        rt.queue.push_back(queued);
        rt.last_completed = Some(ScanLog {
            id: "completed-job".into(),
            timestamp: 1,
            filename: "finished.txt".into(),
            source: "manual".into(),
            result: "clean".into(),
            detail: "No threats detected by Defender.".into(),
            action: None,
            retry_available: true,
        });

        let value = serde_json::to_value(rt.snapshot()).unwrap();
        assert_eq!(value["activeScan"]["id"], "manual-job");
        assert_eq!(value["activeScan"]["filename"], "fixture.txt");
        assert_eq!(value["activeScan"]["phase"], "scanning");
        assert_eq!(value["queuedScans"][0]["id"], "automatic-job");
        assert_eq!(value["lastCompleted"]["id"], "completed-job");
        assert_eq!(value["lastCompleted"]["retryAvailable"], true);
        assert!(!value.to_string().contains("C:\\\\Downloads"));
    }

    #[test]
    fn generated_scan_ids_are_unique() {
        let mut rt = runtime();
        let first = rt.next_scan_id();
        let second = rt.next_scan_id();
        assert_ne!(first, second);
    }

    #[test]
    fn disabling_auto_drops_automatic_work_but_allows_manual() {
        let mut rt = runtime();
        rt.busy = true;
        rt.queue.extend([job(true), job(false)]);
        rt.reset_queue();
        assert!(
            rt.busy,
            "an already-started Defender scan remains monitored"
        );
        assert_eq!(rt.queue.len(), 1);
        assert!(!rt.allows(&job(true)));
        assert!(rt.allows(&job(false)));
    }

    #[test]
    fn disabling_developer_mode_rejects_all_work() {
        let mut rt = runtime();
        rt.queue.extend([job(true), job(false)]);
        rt.developer_mode = false;
        rt.reset_queue();
        assert!(rt.queue.is_empty());
        assert!(!rt.allows(&job(false)));
        assert!(!rt.allows(&job(true)));
    }

    #[test]
    fn stale_generation_cannot_restart_automatic_scan() {
        let mut rt = runtime();
        rt.config.enabled = true;
        rt.config.folders.push(Folder {
            id: "1".into(),
            path: "C:\\Downloads".into(),
            name: "Downloads".into(),
        });
        assert!(rt.allows(&job(true)));
        rt.reset_queue();
        assert!(!rt.allows(&job(true)));
        assert!(rt.watching());
    }

    #[test]
    fn commands_reject_cover_webviews_and_remote_main_navigation() {
        assert!(!trusted_location(
            "cover-0",
            &url::Url::parse("http://tauri.localhost/").unwrap()
        ));
        assert!(!trusted_location(
            "main",
            &url::Url::parse("https://example.com/").unwrap()
        ));
        assert!(!trusted_location(
            "main",
            &url::Url::parse("http://tauri.localhost.evil.test/").unwrap()
        ));
        assert!(trusted_location(
            "main",
            &url::Url::parse("http://tauri.localhost/").unwrap()
        ));
    }

    #[test]
    fn local_history_has_filename_but_no_retry_path() {
        let log = ScanLog {
            id: "1".into(),
            timestamp: 1,
            filename: "example.txt".into(),
            source: "manual".into(),
            result: "clean".into(),
            detail: "No threats detected by Defender.".into(),
            action: None,
            retry_available: true,
        };
        let stored = serde_json::to_value(log).unwrap();
        assert!(stored.get("retryAvailable").is_none());
        assert!(stored.get("path").is_none());
        let restored: ScanLog = serde_json::from_value(stored).unwrap();
        assert!(!restored.retry_available);
        assert!(confirmed_action("Quarantined"));
        assert!(confirmed_action("Cleaned, Removed"));
        assert!(!confirmed_action("Allowed"));
    }

    #[test]
    fn repeated_actionable_failures_notify_once() {
        let mut rt = runtime();
        assert!(rt.should_notify("Defender unavailable".into()));
        assert!(!rt.should_notify("Defender unavailable".into()));
        assert!(rt.should_notify("Threat detected".into()));
    }
}
