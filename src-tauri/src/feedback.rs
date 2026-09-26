use super::*;

const FEEDBACK_BUG_COOLDOWN_MS: u128 = 5 * 60 * 60 * 1000;

fn rate_limit_key(kind: &str) -> String {
    format!("rateLimit.{kind}.lastSentAt")
}
fn can_send_after_cooldown(app: &AppHandle, kind: &str) -> bool {
    let state = app_state(app);
    let Ok(_guard) = state.store_lock.lock() else {
        return true;
    };
    let Ok(store) = load_store(&state.settings_path) else {
        return true;
    };
    let last = store
        .get(rate_limit_key(kind))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u128;
    now_ms().saturating_sub(last) >= FEEDBACK_BUG_COOLDOWN_MS
}

fn mark_sent_rate_limit(app: &AppHandle, kind: &str) -> Result<(), String> {
    let state = app_state(app);
    update_store_at_path(&state.settings_path, &state.store_lock, |store| {
        store[rate_limit_key(kind)] = json!(now_ms());
        Ok(())
    })
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
pub(super) async fn send_feedback(app: AppHandle, payload: Value) -> Value {
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
            if let Err(err) = mark_sent_rate_limit(&app, "feedback") {
                report_runtime_error(&app, "settings", err);
            }
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}
#[tauri::command]
pub(super) async fn send_bug_report(app: AppHandle, payload: Value) -> Value {
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
            if let Err(err) = mark_sent_rate_limit(&app, "bug") {
                report_runtime_error(&app, "settings", err);
            }
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}
