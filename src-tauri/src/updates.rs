use super::*;
use tauri_plugin_updater::UpdaterExt;

const UPDATES_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const APP_UPDATE_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const VERSION_POLICY_POLL: Duration = Duration::from_secs(6 * 60 * 60);
const DEFAULT_UPDATER_URL: &str =
    "https://github.com/deskoys/deskoy/releases/latest/download/latest.json";
const DEFAULT_UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQzRTBFMzk4QTVBMUM3ODUKUldTRng2R2xtT1BnUTlwRXY2Z3EyUTl6ZjlJcThiL3FzbkxsaWNibDljWUsxSzVSbE5tZyt3R3IK";

#[tauri::command]
pub(super) async fn get_updates(app: AppHandle) -> Value {
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
pub(super) async fn check_app_update(app: AppHandle) -> Value {
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
                "releaseDate": update.date.map(|date| date.unix_timestamp()),
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

    if result
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        app_state(&app).state.lock().unwrap().app_update_cache =
            Some((Instant::now(), result.clone()));
    }
    result
}

#[tauri::command]
pub(super) async fn install_app_update(app: AppHandle) -> Value {
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

pub(super) fn send_upgrade_required_if_any(app: &AppHandle) {
    if let Some(block) = app_state(app).state.lock().unwrap().upgrade_block.clone() {
        let _ = app.emit("deskoy:upgradeRequired", block);
    }
}

pub(super) fn start_version_policy_watcher(app: AppHandle) {
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
        if let Err(err) = set_settings_in_state(app, json!({ "enabled": false })) {
            report_runtime_error(app, "settings", err);
        }
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
