use super::{defender, get_settings_from_state};
use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{pkcs8::DecodePublicKey, Signature, VerifyingKey};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

const API_BASE_URL: &str = match option_env!("DESKOY_LICENSE_API_URL") {
    Some(value) => value,
    None => "https://pywxdcmbcpixfkswuvqy.supabase.co/functions/v1",
};
const RECEIPT_PUBLIC_KEY: &str = "MCowBQYDK2VwAyEAsUyBulk85sAYADWNMHqJgaehrq7uFFdaAdaWnW9rbe4=";
const OFFLINE_ALLOWANCE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const REFRESH_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const CLOCK_SKEW_ALLOWANCE_SECS: i64 = 5 * 60;
const STORE_FILE: &str = "licence.dat";

#[derive(Clone)]
pub(crate) struct LicenseManager {
    inner: Arc<Mutex<LicenseRuntime>>,
    store_path: PathBuf,
    store_lock: Arc<Mutex<()>>,
    client: reqwest::Client,
}

#[derive(Clone)]
struct LicenseRuntime {
    store: ProtectedStore,
    view: LicenceView,
    entitled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LicenceView {
    status: LicenceStatus,
    message: String,
    offline_days_remaining: Option<u32>,
    last_checked_at: Option<i64>,
    activated_at: Option<i64>,
    key_hint: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LicenceStatus {
    Free,
    Activating,
    ProActive,
    InvalidOrRevoked,
    AlreadyActivatedElsewhere,
    ConnectionError,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtectedStore {
    version: u8,
    device_id: String,
    activation: Option<StoredActivation>,
    last_seen_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredActivation {
    receipt: String,
    activation_proof: String,
    key_hint: String,
    #[serde(default)]
    licence_key: Option<String>,
    #[serde(default)]
    activated_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ReceiptPayload {
    version: u8,
    entitlement: String,
    activation_id: i64,
    receipt_id: String,
    device_binding: String,
    issued_at: i64,
    validated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivateRequest<'a> {
    licence_key: &'a str,
    device_id: &'a str,
    activation_proof: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialRequest<'a> {
    device_id: &'a str,
    activation_proof: &'a str,
    receipt: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse {
    status: String,
    receipt: Option<String>,
    #[allow(dead_code)]
    retry_after_seconds: Option<u64>,
}

impl LicenceView {
    fn free() -> Self {
        Self {
            status: LicenceStatus::Free,
            message: "Deskoy Free".into(),
            offline_days_remaining: None,
            last_checked_at: None,
            activated_at: None,
            key_hint: None,
        }
    }

    fn status(status: LicenceStatus, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            offline_days_remaining: None,
            last_checked_at: None,
            activated_at: None,
            key_hint: None,
        }
    }
}

impl LicenseManager {
    pub(crate) fn initialize(data_dir: &Path) -> Self {
        let store_path = data_dir.join(STORE_FILE);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Deskoy/2 licensing")
            .build()
            .unwrap_or_default();

        let (store, view, entitled) = match load_protected_store(&store_path) {
            Ok(Some(mut store)) if valid_device_id(&store.device_id) => {
                let now = unix_time();
                store.last_seen_at = store.last_seen_at.max(now);
                let (view, entitled) = cached_view(&store, now);
                (store, view, entitled)
            }
            Ok(Some(_)) => {
                let store = fresh_store();
                (
                    store,
                    LicenceView::status(
                        LicenceStatus::InvalidOrRevoked,
                        "Protected licence data is invalid.",
                    ),
                    false,
                )
            }
            Ok(None) => {
                let store = fresh_store();
                let view = match save_protected_store(&store_path, &store) {
                    Ok(()) => LicenceView::free(),
                    Err(_) => LicenceView::status(
                        LicenceStatus::ConnectionError,
                        "Windows protected storage is unavailable.",
                    ),
                };
                (store, view, false)
            }
            Err(_) => (
                fresh_store(),
                LicenceView::status(
                    LicenceStatus::InvalidOrRevoked,
                    "Protected licence data could not be read.",
                ),
                false,
            ),
        };

        let manager = Self {
            inner: Arc::new(Mutex::new(LicenseRuntime {
                store,
                view,
                entitled,
            })),
            store_path,
            store_lock: Arc::new(Mutex::new(())),
            client,
        };
        let _ = manager.persist_current_store();
        manager
    }

    pub(crate) fn has_pro_entitlement(&self) -> bool {
        self.inner
            .lock()
            .map(|state| state.entitled)
            .unwrap_or(false)
    }

    fn view(&self) -> LicenceView {
        self.inner
            .lock()
            .map(|state| state.view.clone())
            .unwrap_or_else(|_| {
                LicenceView::status(
                    LicenceStatus::ConnectionError,
                    "Licence state is unavailable.",
                )
            })
    }

    fn licence_key(&self) -> Option<String> {
        let key = self
            .inner
            .lock()
            .ok()?
            .store
            .activation
            .as_ref()?
            .licence_key
            .clone()?;
        normalize_licence_key(&key)
    }

    fn set_view(&self, app: &AppHandle, view: LicenceView, entitled: bool) {
        if let Ok(mut state) = self.inner.lock() {
            state.view = view.clone();
            state.entitled = entitled;
        }
        defender::developer_mode_changed(
            app,
            entitled && get_settings_from_state(app).developer_mode,
        );
        let _ = app.emit("licence-state-changed", view);
    }

    fn persist_current_store(&self) -> Result<(), String> {
        let _guard = self
            .store_lock
            .lock()
            .map_err(|_| "protected_store_lock_failed".to_string())?;
        let store = self
            .inner
            .lock()
            .map_err(|_| "licence_state_lock_failed".to_string())?
            .store
            .clone();
        save_protected_store(&self.store_path, &store)
    }

    async fn activate(&self, app: &AppHandle, raw_key: String) -> LicenceView {
        let Some(key) = normalize_licence_key(&raw_key) else {
            let entitled = self.has_pro_entitlement();
            let view = LicenceView::status(
                LicenceStatus::InvalidOrRevoked,
                "Enter a valid Deskoy Pro licence key.",
            );
            self.set_view(app, view.clone(), entitled);
            return view;
        };

        let (device_id, previous_entitlement) = self
            .inner
            .lock()
            .map(|state| (state.store.device_id.clone(), state.entitled))
            .unwrap_or_default();
        if !valid_device_id(&device_id) {
            let view = LicenceView::status(
                LicenceStatus::ConnectionError,
                "Windows protected storage is unavailable.",
            );
            self.set_view(app, view.clone(), false);
            return view;
        }

        self.set_view(
            app,
            LicenceView::status(LicenceStatus::Activating, "Activating licence…"),
            previous_entitlement,
        );
        let proof = random_secret();
        let request = ActivateRequest {
            licence_key: &key,
            device_id: &device_id,
            activation_proof: &proof,
        };
        let response = self.post("license-activate", &request).await;
        match response {
            Ok(response) if response.status == "pro_active" => {
                let Some(receipt) = response.receipt else {
                    return self.connection_error(app, previous_entitlement);
                };
                if verify_receipt(&receipt, &device_id, unix_time()).is_err() {
                    let view = LicenceView::status(
                        LicenceStatus::InvalidOrRevoked,
                        "The activation receipt could not be verified.",
                    );
                    self.set_view(app, view.clone(), false);
                    return view;
                }
                let key_hint: String = key
                    .chars()
                    .rev()
                    .take(5)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
                let activated_at = unix_time();
                if let Ok(mut state) = self.inner.lock() {
                    state.store.activation = Some(StoredActivation {
                        receipt,
                        activation_proof: proof,
                        key_hint: key_hint.clone(),
                        licence_key: Some(key.clone()),
                        activated_at,
                    });
                    state.store.last_seen_at = activated_at;
                }
                if self.persist_current_store().is_err() {
                    let view = LicenceView::status(
                        LicenceStatus::ConnectionError,
                        "Activation succeeded, but Windows protected storage could not save it.",
                    );
                    self.set_view(app, view.clone(), false);
                    return view;
                }
                let view = self.current_cached_view();
                self.set_view(app, view.clone(), true);
                view
            }
            Ok(response) if response.status == "already_activated_elsewhere" => {
                let view = LicenceView::status(
                    LicenceStatus::AlreadyActivatedElsewhere,
                    "This licence is active on another device.",
                );
                self.set_view(app, view.clone(), previous_entitlement);
                view
            }
            Ok(response) if response.status == "invalid_or_revoked" => {
                let view = LicenceView::status(
                    LicenceStatus::InvalidOrRevoked,
                    "This licence is invalid or has been revoked.",
                );
                self.set_view(app, view.clone(), false);
                view
            }
            Ok(response) if response.status == "rate_limited" => {
                let view = LicenceView::status(
                    LicenceStatus::ConnectionError,
                    "Too many activation attempts. Try again later.",
                );
                self.set_view(app, view.clone(), previous_entitlement);
                view
            }
            _ => self.connection_error(app, previous_entitlement),
        }
    }

    async fn refresh(&self, app: &AppHandle) -> LicenceView {
        let (store, entitled) = match self.inner.lock() {
            Ok(state) => (state.store.clone(), state.entitled),
            Err(_) => return self.connection_error(app, false),
        };
        let Some(activation) = store.activation else {
            return self.view();
        };
        if verify_receipt(&activation.receipt, &store.device_id, unix_time()).is_err() {
            let view = LicenceView::status(
                LicenceStatus::InvalidOrRevoked,
                "The saved activation receipt is invalid.",
            );
            self.set_view(app, view.clone(), false);
            return view;
        }
        let request = CredentialRequest {
            device_id: &store.device_id,
            activation_proof: &activation.activation_proof,
            receipt: &activation.receipt,
        };
        match self.post("license-validate", &request).await {
            Ok(response) if response.status == "pro_active" => {
                let Some(receipt) = response.receipt else {
                    return self.connection_error(app, entitled);
                };
                if verify_receipt(&receipt, &store.device_id, unix_time()).is_err() {
                    let view = LicenceView::status(
                        LicenceStatus::InvalidOrRevoked,
                        "The validation receipt could not be verified.",
                    );
                    self.set_view(app, view.clone(), false);
                    return view;
                }
                if let Ok(mut state) = self.inner.lock() {
                    if let Some(saved) = &mut state.store.activation {
                        saved.receipt = receipt;
                    }
                    state.store.last_seen_at = unix_time();
                }
                if self.persist_current_store().is_err() {
                    return self.connection_error(app, entitled);
                }
                let view = self.current_cached_view();
                self.set_view(app, view.clone(), true);
                view
            }
            Ok(response) if response.status == "invalid_or_revoked" => {
                let view = LicenceView::status(
                    LicenceStatus::InvalidOrRevoked,
                    "This licence is invalid or has been revoked.",
                );
                self.set_view(app, view.clone(), false);
                view
            }
            _ => self.connection_error(app, entitled),
        }
    }

    async fn post<T: Serialize + ?Sized>(
        &self,
        endpoint: &str,
        body: &T,
    ) -> Result<ApiResponse, ()> {
        let response = self
            .client
            .post(format!(
                "{}/{}",
                API_BASE_URL.trim_end_matches('/'),
                endpoint
            ))
            .json(body)
            .send()
            .await
            .map_err(|_| ())?;
        response.json::<ApiResponse>().await.map_err(|_| ())
    }

    fn current_cached_view(&self) -> LicenceView {
        match self.inner.lock() {
            Ok(state) => cached_view(&state.store, unix_time()).0,
            Err(_) => LicenceView::status(
                LicenceStatus::ConnectionError,
                "Licence state is unavailable.",
            ),
        }
    }

    fn connection_error(&self, app: &AppHandle, was_entitled: bool) -> LicenceView {
        let (mut view, cached_entitlement) = match self.inner.lock() {
            Ok(state) => cached_view(&state.store, unix_time()),
            Err(_) => (
                LicenceView::status(
                    LicenceStatus::ConnectionError,
                    "Could not connect to the licence service.",
                ),
                false,
            ),
        };
        if cached_entitlement {
            view.message = "Pro Active — using cached validation.".into();
        } else {
            view = LicenceView::status(
                LicenceStatus::ConnectionError,
                if was_entitled {
                    "Reconnect to Deskoy to refresh the expired offline allowance."
                } else {
                    "Could not connect to the licence service."
                },
            );
        }
        self.set_view(app, view.clone(), cached_entitlement);
        view
    }
}

pub(crate) fn start_background_validation(app: AppHandle, manager: LicenseManager) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        loop {
            let _ = manager.refresh(&app).await;
            tokio::time::sleep(REFRESH_INTERVAL).await;
        }
    });
}

fn cached_view(store: &ProtectedStore, now: i64) -> (LicenceView, bool) {
    cached_view_with_key(store, now, RECEIPT_PUBLIC_KEY)
}

fn cached_view_with_key(store: &ProtectedStore, now: i64, public_key: &str) -> (LicenceView, bool) {
    let Some(activation) = &store.activation else {
        return (LicenceView::free(), false);
    };
    let effective_now = now.max(store.last_seen_at);
    match verify_receipt_with_key(
        &activation.receipt,
        &store.device_id,
        effective_now,
        public_key,
    ) {
        Ok(payload) => {
            if let Some(days_left) = offline_days_remaining(payload.validated_at, effective_now) {
                (
                    LicenceView {
                        status: LicenceStatus::ProActive,
                        message: "Deskoy Pro is active.".into(),
                        offline_days_remaining: Some(days_left),
                        last_checked_at: Some(payload.validated_at),
                        activated_at: (activation.activated_at > 0)
                            .then_some(activation.activated_at),
                        key_hint: Some(activation.key_hint.clone()),
                    },
                    true,
                )
            } else {
                (
                    LicenceView {
                        status: LicenceStatus::ConnectionError,
                        message: "Reconnect to renew the offline allowance.".into(),
                        offline_days_remaining: Some(0),
                        last_checked_at: Some(payload.validated_at),
                        activated_at: (activation.activated_at > 0)
                            .then_some(activation.activated_at),
                        key_hint: Some(activation.key_hint.clone()),
                    },
                    false,
                )
            }
        }
        Err(_) => (
            LicenceView::status(
                LicenceStatus::InvalidOrRevoked,
                "The saved activation receipt is invalid.",
            ),
            false,
        ),
    }
}

fn offline_days_remaining(validated_at: i64, now: i64) -> Option<u32> {
    let age = now.saturating_sub(validated_at).max(0) as u64;
    if age > OFFLINE_ALLOWANCE.as_secs() {
        return None;
    }
    let seconds_left = OFFLINE_ALLOWANCE.as_secs().saturating_sub(age);
    Some(seconds_left.div_ceil(24 * 60 * 60) as u32)
}

fn verify_receipt(receipt: &str, device_id: &str, now: i64) -> Result<ReceiptPayload, String> {
    verify_receipt_with_key(receipt, device_id, now, RECEIPT_PUBLIC_KEY)
}

fn verify_receipt_with_key(
    receipt: &str,
    device_id: &str,
    now: i64,
    public_key: &str,
) -> Result<ReceiptPayload, String> {
    if receipt.len() > 4096 {
        return Err("receipt_too_large".into());
    }
    let mut parts = receipt.split('.');
    let payload_part = parts.next().ok_or("receipt_format")?;
    let signature_part = parts.next().ok_or("receipt_format")?;
    if parts.next().is_some() || payload_part.is_empty() || signature_part.is_empty() {
        return Err("receipt_format".into());
    }

    let public_der = general_purpose::STANDARD
        .decode(public_key)
        .map_err(|_| "public_key_invalid")?;
    let verifying_key =
        VerifyingKey::from_public_key_der(&public_der).map_err(|_| "public_key_invalid")?;
    let signature_bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| "receipt_signature_invalid")?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| "receipt_signature_invalid")?;
    verifying_key
        .verify_strict(payload_part.as_bytes(), &signature)
        .map_err(|_| "receipt_signature_invalid")?;

    let payload_bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(payload_part)
        .map_err(|_| "receipt_payload_invalid")?;
    let payload: ReceiptPayload =
        serde_json::from_slice(&payload_bytes).map_err(|_| "receipt_payload_invalid")?;
    if payload.version != 1
        || payload.entitlement != "pro_perpetual"
        || payload.activation_id <= 0
        || payload.receipt_id.len() != 36
        || payload.validated_at <= 0
        || payload.issued_at <= 0
        || payload.validated_at > now.saturating_add(CLOCK_SKEW_ALLOWANCE_SECS)
        || payload.issued_at > now.saturating_add(CLOCK_SKEW_ALLOWANCE_SECS)
        || payload.device_binding != device_binding(device_id)
    {
        return Err("receipt_binding_invalid".into());
    }
    Ok(payload)
}

fn device_binding(device_id: &str) -> String {
    let digest = Sha256::digest(device_id.as_bytes());
    general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn normalize_licence_key(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_uppercase();
    if normalized.len() < 24
        || normalized.len() > 80
        || !normalized.starts_with("DSKY-PRO-")
        || !normalized.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return None;
    }
    Some(normalized)
}

fn valid_device_id(value: &str) -> bool {
    (32..=128).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn fresh_store() -> ProtectedStore {
    ProtectedStore {
        version: 1,
        device_id: random_secret(),
        activation: None,
        last_seen_at: unix_time(),
    }
}

fn unix_time() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn load_protected_store(path: &Path) -> Result<Option<ProtectedStore>, String> {
    let encrypted = match fs::read(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("protected_store_read_failed".into()),
    };
    let plaintext = unprotect_data(&encrypted)?;
    let store: ProtectedStore =
        serde_json::from_slice(&plaintext).map_err(|_| "protected_store_invalid")?;
    if store.version != 1 {
        return Err("protected_store_version_invalid".into());
    }
    Ok(Some(store))
}

fn save_protected_store(path: &Path, store: &ProtectedStore) -> Result<(), String> {
    let plaintext = serde_json::to_vec(store).map_err(|_| "protected_store_encode_failed")?;
    let encrypted = protect_data(&plaintext)?;
    let parent = path.parent().ok_or("protected_store_path_invalid")?;
    fs::create_dir_all(parent).map_err(|_| "protected_store_write_failed")?;
    let temporary = path.with_extension("dat.tmp");
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "protected_store_write_failed")?;
        file.write_all(&encrypted)
            .map_err(|_| "protected_store_write_failed")?;
        file.sync_all()
            .map_err(|_| "protected_store_write_failed")?;
        drop(file);
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn protect_data(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data
            .len()
            .try_into()
            .map_err(|_| "protected_store_too_large")?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("protected_store_encrypt_failed".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(result)
}

#[cfg(windows)]
fn unprotect_data(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data
            .len()
            .try_into()
            .map_err(|_| "protected_store_too_large")?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("protected_store_decrypt_failed".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(result)
}

#[cfg(not(windows))]
fn protect_data(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("windows_protected_storage_required".into())
}

#[cfg(not(windows))]
fn unprotect_data(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("windows_protected_storage_required".into())
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err("protected_store_replace_failed".into())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|_| "protected_store_replace_failed".into())
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Licensing is available only in Deskoy's main window.".into())
    }
}

#[tauri::command]
pub(crate) async fn licence_get_state(
    window: WebviewWindow,
    manager: State<'_, LicenseManager>,
) -> Result<LicenceView, String> {
    authorize(&window)?;
    Ok(manager.view())
}

#[tauri::command]
pub(crate) fn licence_get_key(
    window: WebviewWindow,
    manager: State<'_, LicenseManager>,
) -> Result<Option<String>, String> {
    authorize(&window)?;
    Ok(manager.licence_key())
}

#[tauri::command]
pub(crate) async fn licence_activate(
    app: AppHandle,
    window: WebviewWindow,
    manager: State<'_, LicenseManager>,
    licence_key: String,
) -> Result<LicenceView, String> {
    authorize(&window)?;
    let manager = manager.inner().clone();
    Ok(manager.activate(&app, licence_key).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{pkcs8::EncodePublicKey, Signer, SigningKey};

    fn test_receipt(device_id: &str, validated_at: i64) -> (String, String) {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let public_key = general_purpose::STANDARD.encode(
            signing
                .verifying_key()
                .to_public_key_der()
                .unwrap()
                .as_bytes(),
        );
        let payload = ReceiptPayload {
            version: 1,
            entitlement: "pro_perpetual".into(),
            activation_id: 7,
            receipt_id: "4dff0a86-3589-47d1-9bab-2a34842dc61a".into(),
            device_binding: device_binding(device_id),
            issued_at: validated_at,
            validated_at,
        };
        let bytes = serde_json::to_vec(&payload).unwrap();
        let encoded = general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        let signature = signing.sign(encoded.as_bytes());
        let receipt = format!(
            "{}.{}",
            encoded,
            general_purpose::URL_SAFE_NO_PAD.encode(signature.to_bytes())
        );
        (receipt, public_key)
    }

    #[test]
    fn receipt_is_device_bound_and_tamper_evident() {
        let now = 1_800_000_000;
        let (receipt, key) = test_receipt("device_abcdefghijklmnopqrstuvwxyz1234", now);
        assert!(verify_receipt_with_key(
            &receipt,
            "device_abcdefghijklmnopqrstuvwxyz1234",
            now,
            &key
        )
        .is_ok());
        assert!(verify_receipt_with_key(
            &receipt,
            "other_device_abcdefghijklmnopqrstuvwxyz",
            now,
            &key
        )
        .is_err());
        let mut tampered = receipt.into_bytes();
        tampered[4] ^= 1;
        assert!(verify_receipt_with_key(
            std::str::from_utf8(&tampered).unwrap(),
            "device_abcdefghijklmnopqrstuvwxyz1234",
            now,
            &key
        )
        .is_err());
    }

    #[test]
    fn offline_allowance_expires_after_thirty_days() {
        let validated = 1_800_000_000;
        let device = "device_abcdefghijklmnopqrstuvwxyz1234";
        let (receipt, key) = test_receipt(device, validated);
        let store = ProtectedStore {
            version: 1,
            device_id: device.into(),
            activation: Some(StoredActivation {
                receipt,
                activation_proof: "proof_abcdefghijklmnopqrstuvwxyz123456".into(),
                key_hint: "XYZ23".into(),
                licence_key: Some("DSKY-PRO-TEST-ABCDEFGHIJKLMNOPQRSTUVWXYZ".into()),
                activated_at: validated,
            }),
            last_seen_at: validated,
        };
        let (active_view, active) =
            cached_view_with_key(&store, validated + 29 * 24 * 60 * 60, &key);
        assert!(active);
        assert_eq!(active_view.status, LicenceStatus::ProActive);
        assert_eq!(active_view.activated_at, Some(validated));
        let (expired_view, active) =
            cached_view_with_key(&store, validated + 31 * 24 * 60 * 60, &key);
        assert!(!active);
        assert_eq!(expired_view.status, LicenceStatus::ConnectionError);
        assert_eq!(offline_days_remaining(validated, validated), Some(30));
        assert_eq!(
            offline_days_remaining(validated, validated + OFFLINE_ALLOWANCE.as_secs() as i64),
            Some(0)
        );
        assert_eq!(
            offline_days_remaining(
                validated,
                validated + OFFLINE_ALLOWANCE.as_secs() as i64 + 1
            ),
            None
        );
        assert_eq!(
            offline_days_remaining(validated + CLOCK_SKEW_ALLOWANCE_SECS, validated),
            Some(30)
        );
    }

    #[test]
    fn new_install_defaults_to_free() {
        let store = fresh_store();
        let (view, entitled) = cached_view(&store, unix_time());
        assert_eq!(view.status, LicenceStatus::Free);
        assert!(!entitled);
    }

    #[cfg(windows)]
    #[test]
    fn windows_protected_storage_round_trip() {
        let plaintext = b"test activation credential";
        let encrypted = protect_data(plaintext).unwrap();
        assert_ne!(encrypted, plaintext);
        assert_eq!(unprotect_data(&encrypted).unwrap(), plaintext);
    }
}
