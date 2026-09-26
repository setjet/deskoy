//! Single-file Defender companion. Exit codes are never used as a clean verdict.
//! Microsoft documents custom scans, scan events, and MSFT_MpThreatDetection at:
//! https://learn.microsoft.com/defender-endpoint/command-line-arguments-microsoft-defender-antivirus
//! https://learn.microsoft.com/defender-endpoint/troubleshoot-microsoft-defender-antivirus
//! https://learn.microsoft.com/previous-versions/windows/desktop/defender/msft-mpthreatdetection

use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionStatus {
    pub state: String,
    pub running_mode: String,
    pub antivirus_enabled: bool,
    pub real_time_enabled: bool,
    pub behavior_monitor_enabled: bool,
    pub on_access_enabled: bool,
    pub download_scanning_enabled: bool,
    pub checked_at: u128,
    pub detail: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawProtectionStatus {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    running_mode: String,
    #[serde(default)]
    antivirus_enabled: bool,
    #[serde(default)]
    real_time_enabled: bool,
    #[serde(default)]
    behavior_monitor_enabled: bool,
    #[serde(default)]
    on_access_enabled: bool,
    #[serde(default)]
    download_scanning_enabled: bool,
}

fn checked_at() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

impl ProtectionStatus {
    pub fn checking() -> Self {
        Self {
            state: "checking".into(),
            running_mode: String::new(),
            antivirus_enabled: false,
            real_time_enabled: false,
            behavior_monitor_enabled: false,
            on_access_enabled: false,
            download_scanning_enabled: false,
            checked_at: 0,
            detail: "Checking Microsoft Defender protection…".into(),
        }
    }

    fn unavailable(detail: &str) -> Self {
        Self {
            state: "unavailable".into(),
            checked_at: checked_at(),
            detail: detail.into(),
            ..Self::checking()
        }
    }

    fn from_raw(raw: RawProtectionStatus) -> Self {
        if !raw.ok {
            return Self::unavailable(
                "Deskoy could not read Microsoft Defender's protection status. Review Windows Security.",
            );
        }
        let fully_protected = raw.running_mode.eq_ignore_ascii_case("normal")
            && raw.antivirus_enabled
            && raw.real_time_enabled
            && raw.behavior_monitor_enabled
            && raw.on_access_enabled
            && raw.download_scanning_enabled;
        let detail = if fully_protected {
            "Microsoft Defender reports real-time, behavior, on-access and download protection active."
        } else if !raw.running_mode.eq_ignore_ascii_case("normal") {
            "Microsoft Defender is not the active antivirus. Review the current provider in Windows Security."
        } else {
            "One or more Microsoft Defender real-time protection layers need attention. Review Windows Security."
        };
        Self {
            state: if fully_protected { "protected" } else { "attention" }.into(),
            running_mode: raw.running_mode,
            antivirus_enabled: raw.antivirus_enabled,
            real_time_enabled: raw.real_time_enabled,
            behavior_monitor_enabled: raw.behavior_monitor_enabled,
            on_access_enabled: raw.on_access_enabled,
            download_scanning_enabled: raw.download_scanning_enabled,
            checked_at: checked_at(),
            detail: detail.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FileStamp {
    pub identity: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Clone, Debug)]
pub struct NativeResult {
    pub result: String,
    pub detail: String,
    pub action: Option<String>,
    pub systemic: bool,
}

impl NativeResult {
    fn new(result: &str, detail: &str) -> Self {
        Self {
            result: result.into(),
            detail: detail.into(),
            action: None,
            systemic: false,
        }
    }

    fn systemic(mut self) -> Self {
        self.systemic = true;
        self
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Detection {
    action_success: bool,
    status: u32,
    error: i64,
    additional: u64,
    remediation_ms: i64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Evidence {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    telemetry: bool,
    #[serde(default)]
    started: bool,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    cancelled: bool,
    #[serde(default)]
    ambiguous: bool,
    #[serde(default)]
    detected: bool,
    #[serde(default)]
    detections: Vec<Detection>,
}

#[derive(Clone, Copy)]
enum FileAfter {
    Same,
    Missing,
    Changed,
}

fn reduce(
    evidence: &Evidence,
    exit: Option<i32>,
    after: FileAfter,
    timed_out: bool,
    exclusion_verified: bool,
) -> NativeResult {
    let detected = evidence.detected || !evidence.detections.is_empty();
    let confirmed = |d: &Detection| {
        d.action_success
            && matches!(d.status, 2..=4)
            && d.error == 0
            && d.additional == 0
            && d.remediation_ms > 0
    };
    let remediation = !evidence.detections.is_empty() && evidence.detections.iter().all(confirmed);
    let actions: Vec<&str> = [(2, "Cleaned"), (3, "Quarantined"), (4, "Removed")]
        .into_iter()
        .filter(|(status, _)| {
            evidence
                .detections
                .iter()
                .any(|d| d.status == *status && confirmed(d))
        })
        .map(|(_, action)| action)
        .collect();
    if matches!(after, FileAfter::Changed) || (matches!(after, FileAfter::Missing) && !remediation)
    {
        let mut result = NativeResult::new(
            "incomplete",
            if detected {
                if remediation {
                    "Defender confirmed remediation for the scanned file, but a different file now occupies the path. Scan the current file again."
                } else {
                    "Defender reported a threat, but the file changed or disappeared. This result cannot describe the current file. Review Windows Security."
                }
            } else {
                "The file changed, was replaced, or disappeared during scanning. Scan the current file again."
            },
        );
        if !actions.is_empty() {
            result.action = Some(actions.join(", "));
        }
        return result;
    }
    if detected {
        if remediation && !evidence.ambiguous {
            let mut result = NativeResult::new(
                "remediated",
                if timed_out || !evidence.completed || evidence.cancelled {
                    "Defender confirmed remediation of a detected threat. A complete scan result was not verified."
                } else {
                    "Defender confirmed remediation of the detected threat."
                },
            );
            result.action = Some(actions.join(", "));
            return result;
        }
        let mut result = NativeResult::new(
            "threat",
            if actions.is_empty() {
                "Defender detected a threat. Completed remediation is not confirmed; review Windows Security."
            } else {
                "Defender detected a threat and confirmed the listed action, but complete remediation of every detection is not confirmed. Review Windows Security."
            },
        );
        if !actions.is_empty() {
            result.action = Some(actions.join(", "));
        }
        return result;
    }
    if !evidence.ok || !evidence.telemetry {
        return NativeResult::new("incomplete", "Defender's scan or detection records could not be verified. Review Windows Security or retry.").systemic();
    }
    if timed_out {
        return NativeResult::new("incomplete", "The scan exceeded Deskoy's time limit. Defender has finished, but Deskoy did not verify a timely result. Retry or review Windows Security.");
    }
    if evidence.cancelled {
        return NativeResult::new(
            "incomplete",
            "Defender stopped the scan before it completed. Retry when ready.",
        );
    }
    if !evidence.started || !evidence.completed || evidence.ambiguous {
        return NativeResult::new("incomplete", "A complete scan and detection outcome for this file could not be isolated in Defender's records. Retry or review Windows Security.");
    }
    if !exclusion_verified {
        return NativeResult::new("incomplete", "Defender completed the scan request and reported no threat, but Windows did not permit Deskoy to verify whether this file is excluded. Open Windows Security for a conclusive check.").systemic();
    }
    if exit != Some(0) {
        return NativeResult::new("failed", "Defender reported a scan error without a confirmed threat result. Retry or review Windows Security.");
    }
    NativeResult::new("clean", "No threats detected by Microsoft Defender in this scan. This does not guarantee the file is safe.")
}

#[cfg(windows)]
mod native {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        ffi::c_void,
        fs::{self, File, OpenOptions},
        io::{Read, Write},
        os::windows::{
            fs::{MetadataExt, OpenOptionsExt},
            io::AsRawHandle,
            process::CommandExt,
        },
        path::{Component, PathBuf},
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    const REPARSE: u32 = 0x400;
    const HIDDEN_PROCESS: u32 = 0x08000000;
    const BELOW_NORMAL: u32 = 0x00004000;

    #[repr(C)]
    #[derive(Default)]
    struct WinFileTime {
        low: u32,
        high: u32,
    }
    impl WinFileTime {
        fn value(&self) -> u64 {
            ((self.high as u64) << 32) | self.low as u64
        }
    }
    #[repr(C)]
    #[derive(Default)]
    struct HandleInformation {
        attributes: u32,
        creation: WinFileTime,
        access: WinFileTime,
        write: WinFileTime,
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct BasicInformation {
        creation: i64,
        access: i64,
        write: i64,
        change: i64,
        attributes: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            handle: *mut c_void,
            information: *mut HandleInformation,
        ) -> i32;
        fn GetFileInformationByHandleEx(
            handle: *mut c_void,
            class: i32,
            information: *mut c_void,
            size: u32,
        ) -> i32;
        fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    }

    fn file_error(error: std::io::Error) -> String {
        match error.raw_os_error() {
            Some(2 | 3) => "The file is missing. Select an existing file.",
            Some(5) => "Deskoy does not have permission to read this file.",
            Some(32 | 33) => {
                "The file is locked or still being written. Try again after it finishes."
            }
            Some(225 | 226) => "Windows security software blocked or removed this file before Deskoy's requested scan began. Review Windows Security; Deskoy cannot attribute that action to this scan.",
            _ => "The file could not be read. Check that it is available and try again.",
        }
        .into()
    }

    fn local_path(path: &Path) -> Result<PathBuf, String> {
        let value = path.to_str().ok_or("This file path is not supported.")?;
        let ordinary = value.strip_prefix("\\\\?\\").unwrap_or(value);
        let bytes = ordinary.as_bytes();
        if bytes.len() < 3
            || !bytes[0].is_ascii_alphabetic()
            || bytes[1] != b':'
            || !matches!(bytes[2], b'\\' | b'/')
            || ordinary[2..].contains(':')
            || value.contains('\0')
        {
            return Err("Select a regular file on a local drive. Network and device paths are not supported.".into());
        }
        let path = PathBuf::from(ordinary);
        if path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(
                "Select the file directly; parent-relative paths are not supported.".into(),
            );
        }
        // Check every ancestor before canonicalization so junctions cannot silently
        // redirect an opted-in folder or a selected file outside its scope.
        for ancestor in path.ancestors() {
            let metadata = fs::symlink_metadata(ancestor).map_err(file_error)?;
            if metadata.file_attributes() & REPARSE != 0 {
                return Err("Linked, redirected, and cloud-placeholder files are not supported. Select a local regular file.".into());
            }
        }
        let metadata = fs::metadata(&path).map_err(file_error)?;
        if !metadata.is_file() {
            return Err("Select one regular file, not a folder or device.".into());
        }
        let canonical = fs::canonicalize(path).map_err(file_error)?;
        let canonical_text = canonical
            .to_str()
            .ok_or("This file path is not supported.")?;
        let normal = canonical_text
            .strip_prefix("\\\\?\\")
            .unwrap_or(canonical_text);
        if normal.starts_with("\\\\") || normal.starts_with("UNC\\") {
            return Err("Network files are not supported. Select a local file.".into());
        }
        Ok(PathBuf::from(normal))
    }

    fn stamp_open(file: &File) -> Result<FileStamp, String> {
        let mut information = HandleInformation::default();
        let mut basic = BasicInformation::default();
        unsafe {
            if GetFileInformationByHandle(file.as_raw_handle(), &mut information) == 0
                || GetFileInformationByHandleEx(
                    file.as_raw_handle(),
                    0,
                    (&mut basic as *mut BasicInformation).cast(),
                    std::mem::size_of::<BasicInformation>() as u32,
                ) == 0
            {
                return Err(file_error(std::io::Error::last_os_error()));
            }
        }
        if information.attributes & (REPARSE | 0x10) != 0 {
            return Err("Select a regular local file, not a linked file or folder.".into());
        }
        Ok(FileStamp {
            identity: format!(
                "{:x}:{:x}:{:x}:{:x}",
                information.volume,
                information.index_high,
                information.index_low,
                information.creation.value()
            ),
            size: ((information.size_high as u64) << 32) | information.size_low as u64,
            // NTFS change time detects same-size writes and restored last-write times.
            modified: (basic.change.max(basic.write).max(0)) as u64,
        })
    }

    pub(super) fn stamp(path: &Path, ready: bool) -> Result<FileStamp, String> {
        let path = local_path(path)?;
        let file = OpenOptions::new()
            .read(true)
            .share_mode(if ready { 1 | 4 } else { 1 | 2 | 4 })
            .custom_flags(0x00200000) // FILE_FLAG_OPEN_REPARSE_POINT: reject a final-component race.
            .open(path)
            .map_err(file_error)?;
        stamp_open(&file)
    }

    fn probe(request: serde_json::Value) -> Result<serde_json::Value, String> {
        let mut buffer = vec![0u16; 32768];
        let length =
            unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
        if length == 0 || length >= buffer.len() {
            return Err("unavailable".into());
        }
        let powershell = PathBuf::from(String::from_utf16_lossy(&buffer[..length]))
            .join("WindowsPowerShell/v1.0/powershell.exe");
        let source: Vec<u8> = include_str!("defender_probe.ps1")
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let mut child = Command::new(powershell)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
            ])
            .arg(STANDARD.encode(source))
            // Do not let a launcher-provided module path redirect trusted cmdlets.
            .env_remove("PSModulePath")
            .creation_flags(HIDDEN_PROCESS | BELOW_NORMAL)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "unavailable")?;
        let stdout = child.stdout.take().ok_or("probe")?;
        let reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            let read = stdout.take(1_048_577).read_to_end(&mut bytes);
            (read, bytes)
        });
        let input = serde_json::to_vec(&request).map_err(|_| "probe")?;
        if child
            .stdin
            .take()
            .ok_or("probe")?
            .write_all(&input)
            .is_err()
        {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("probe".into());
        }
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                    thread::sleep(Duration::from_millis(50))
                }
                _ => {
                    // This is the fixed read-only evidence probe, never the scan process.
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err("probe_timeout".into());
                }
            }
        };
        let (read, bytes) = reader.join().map_err(|_| "probe")?;
        if !status.success() || read.is_err() || bytes.len() > 1_048_576 {
            return Err("probe".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "probe".into())
    }

    pub(super) fn preparation_failure(code: &str) -> NativeResult {
        match code {
            "unavailable" => NativeResult::new("failed", "Microsoft Defender is unavailable or not running as the active antivirus. Open Windows Security to check its status.").systemic(),
            "permission" => NativeResult::new("failed", "Windows did not permit this Defender operation. Deskoy will not elevate itself; open Windows Security to scan the file.").systemic(),
            "excluded" => NativeResult::new("incomplete", "This file is excluded by Defender's current settings. Deskoy did not change the exclusion or scan the file."),
            "exclusion_unknown" => NativeResult::new("failed", "Windows did not permit Defender's required exclusion check. Deskoy will not elevate itself; open Windows Security to scan the file.").systemic(),
            "probe_timeout" => NativeResult::new("failed", "Defender's status check timed out. Try again or open Windows Security.").systemic(),
            _ => NativeResult::new("incomplete", "Defender's scan and detection records are unavailable to Deskoy. Open Windows Security to check the file.").systemic(),
        }
    }

    pub(super) fn protection_status() -> ProtectionStatus {
        match probe(serde_json::json!({ "mode": "status" })) {
            Ok(value) => serde_json::from_value::<RawProtectionStatus>(value)
                .map(ProtectionStatus::from_raw)
                .unwrap_or_else(|_| ProtectionStatus::unavailable(
                    "Deskoy could not understand Microsoft Defender's protection status. Review Windows Security.",
                )),
            Err(_) => ProtectionStatus::unavailable(
                "Deskoy could not read Microsoft Defender's protection status. Review Windows Security.",
            ),
        }
    }

    pub(super) fn scan(
        path: &Path,
        progress: impl Fn(&str),
        allowed: impl Fn() -> bool,
    ) -> NativeResult {
        let cancelled =
            || NativeResult::new("incomplete", "Scan cancelled before Defender started.");
        if !allowed() {
            return cancelled();
        }
        progress("Checking the file and Microsoft Defender…");
        let canonical = match local_path(path) {
            Ok(path) => path,
            Err(detail) => return NativeResult::new("failed", &detail),
        };
        let before = match stamp(&canonical, true) {
            Ok(stamp) => stamp,
            Err(detail) => return NativeResult::new("failed", &detail),
        };
        let prepared = match probe(serde_json::json!({ "mode": "prepare", "path": canonical })) {
            Ok(value) => value,
            Err(code) => return preparation_failure(&code),
        };
        if prepared["ok"].as_bool() != Some(true) {
            return preparation_failure(prepared["error"].as_str().unwrap_or("probe"));
        }
        let Some(mp_path) = prepared["mpPath"].as_str() else {
            return preparation_failure("unavailable");
        };
        let exclusion_verified = prepared["exclusionVerified"].as_bool() == Some(true);
        if stamp(&canonical, true).ok().as_ref() != Some(&before) {
            return NativeResult::new("incomplete", "The file changed or became busy before Defender started. Try again after it finishes.");
        }
        if !allowed() {
            return cancelled();
        }
        progress("Microsoft Defender is scanning the file…");
        // Arguments are passed directly to the trusted signed executable. No shell.
        let mut child = match Command::new(mp_path)
            .args(["-Scan", "-ScanType", "3", "-File"])
            .arg(&canonical)
            .arg("-CpuThrottling")
            .creation_flags(HIDDEN_PROCESS | BELOW_NORMAL)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                return preparation_failure(
                    if error.kind() == std::io::ErrorKind::PermissionDenied {
                        "permission"
                    } else {
                        "unavailable"
                    },
                )
            }
        };
        let started = Instant::now();
        let mut timed_out = false;
        let exit = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {}
                Err(_) => {
                    timed_out = true;
                    break child.wait().ok().and_then(|status| status.code());
                }
            }
            if !timed_out && started.elapsed() >= Duration::from_secs(120) {
                timed_out = true;
                progress("Defender is still running; the result is incomplete. Waiting for this scan to finish before starting another.");
            }
            // No supported per-custom-scan cancel exists. Keep this one worker
            // occupied until Defender returns, even if automatic checking is disabled.
            thread::sleep(Duration::from_millis(100));
        };
        progress("Verifying Defender's detection and action records…");
        let request = serde_json::json!({ "mode": "collect", "path": canonical,
            "cursor": prepared["cursor"], "startedMs": prepared["startedMs"], "baseline": prepared["baseline"] });
        let mut evidence = Evidence::default();
        // Allow bounded time for Defender to publish completion/remediation records.
        for attempt in 0..3 {
            if attempt > 0 {
                thread::sleep(Duration::from_millis(750));
            }
            let value = match probe(request.clone()) {
                Ok(value) => value,
                Err(code) => return preparation_failure(&code),
            };
            evidence = match serde_json::from_value(value) {
                Ok(evidence) => evidence,
                Err(_) => return preparation_failure("probe"),
            };
            if evidence.ok && evidence.telemetry && (evidence.completed || evidence.cancelled) {
                break;
            }
        }
        let after = match stamp(&canonical, false) {
            Ok(after) if after == before => FileAfter::Same,
            Ok(_) => FileAfter::Changed,
            Err(_)
                if fs::symlink_metadata(&canonical)
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) =>
            {
                FileAfter::Missing
            }
            Err(_) => FileAfter::Changed,
        };
        reduce(&evidence, exit, after, timed_out, exclusion_verified)
    }
}

pub fn file_stamp(path: &Path) -> Result<FileStamp, String> {
    #[cfg(windows)]
    {
        native::stamp(path, false)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Microsoft Defender scanning requires Windows.".into())
    }
}

pub fn protection_status() -> ProtectionStatus {
    #[cfg(windows)]
    {
        native::protection_status()
    }
    #[cfg(not(windows))]
    {
        ProtectionStatus::unavailable("Microsoft Defender protection status requires Windows.")
    }
}

pub fn ready_file(path: &Path) -> Result<FileStamp, String> {
    #[cfg(windows)]
    {
        native::stamp(path, true)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Microsoft Defender scanning requires Windows.".into())
    }
}

pub fn scan(path: &Path, progress: impl Fn(&str), allowed: impl Fn() -> bool) -> NativeResult {
    #[cfg(windows)]
    {
        native::scan(path, progress, allowed)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, progress, allowed);
        NativeResult::new("failed", "Microsoft Defender scanning requires Windows.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protection_status_requires_every_reported_real_time_layer() {
        let protected = ProtectionStatus::from_raw(RawProtectionStatus {
            ok: true,
            running_mode: "Normal".into(),
            antivirus_enabled: true,
            real_time_enabled: true,
            behavior_monitor_enabled: true,
            on_access_enabled: true,
            download_scanning_enabled: true,
        });
        assert_eq!(protected.state, "protected");

        let attention = ProtectionStatus::from_raw(RawProtectionStatus {
            behavior_monitor_enabled: false,
            ..RawProtectionStatus {
                ok: true,
                running_mode: "Normal".into(),
                antivirus_enabled: true,
                real_time_enabled: true,
                behavior_monitor_enabled: true,
                on_access_enabled: true,
                download_scanning_enabled: true,
            }
        });
        assert_eq!(attention.state, "attention");
    }

    fn complete() -> Evidence {
        Evidence {
            ok: true,
            telemetry: true,
            started: true,
            completed: true,
            ..Default::default()
        }
    }
    fn quarantined() -> Evidence {
        Evidence {
            detected: true,
            detections: vec![Detection {
                action_success: true,
                status: 3,
                remediation_ms: 100,
                ..Default::default()
            }],
            ..complete()
        }
    }
    #[test]
    fn zero_exit_needs_complete_correlated_evidence() {
        assert_eq!(
            reduce(&complete(), Some(0), FileAfter::Same, false, true).result,
            "clean"
        );
        assert_eq!(
            reduce(&Evidence::default(), Some(0), FileAfter::Same, false, true).result,
            "incomplete"
        );
        let mut evidence = complete();
        evidence.started = false;
        assert_eq!(
            reduce(&evidence, Some(0), FileAfter::Same, false, true).result,
            "incomplete"
        );
        evidence.started = true;
        evidence.ambiguous = true;
        assert_eq!(
            reduce(&evidence, Some(0), FileAfter::Same, false, true).result,
            "incomplete"
        );
        assert_eq!(
            reduce(&complete(), Some(0), FileAfter::Same, false, false).result,
            "incomplete"
        );
        assert!(reduce(&complete(), Some(0), FileAfter::Same, false, false).systemic);
    }
    #[test]
    fn zero_exit_can_mean_remediated_and_missing_file_is_not_independent_proof() {
        let result = reduce(&quarantined(), Some(0), FileAfter::Missing, false, true);
        assert_eq!(result.result, "remediated");
        assert_eq!(result.action.as_deref(), Some("Quarantined"));
        assert_eq!(
            reduce(&complete(), Some(0), FileAfter::Missing, false, true).result,
            "incomplete"
        );
    }
    #[test]
    fn allowed_or_additional_actions_are_not_remediation() {
        for status in [0, 1, 5, 6, 102] {
            let mut evidence = quarantined();
            evidence.detections[0].status = status;
            let result = reduce(&evidence, Some(0), FileAfter::Same, false, true);
            assert_eq!(result.result, "threat");
            assert!(result.action.is_none());
        }
        let mut evidence = quarantined();
        evidence.detections[0].additional = 8;
        assert_eq!(
            reduce(&evidence, Some(0), FileAfter::Same, false, true).result,
            "threat"
        );
        evidence.detections[0].additional = 0;
        evidence.detections[0].error = 5;
        assert_eq!(
            reduce(&evidence, Some(0), FileAfter::Same, false, true).result,
            "threat"
        );

        let mut partial = quarantined();
        partial.detections.push(Detection {
            status: 1,
            ..Default::default()
        });
        let result = reduce(&partial, Some(0), FileAfter::Same, false, true);
        assert_eq!(result.result, "threat");
        assert_eq!(result.action.as_deref(), Some("Quarantined"));
    }
    #[test]
    fn exact_detection_is_not_hidden_by_incomplete_scan_telemetry() {
        let mut evidence = quarantined();
        evidence.telemetry = false;
        assert_eq!(
            reduce(&evidence, Some(0), FileAfter::Same, false, true).result,
            "remediated"
        );
        let result = reduce(&evidence, Some(0), FileAfter::Changed, false, true);
        assert_eq!(result.result, "incomplete");
        assert_eq!(result.action.as_deref(), Some("Quarantined"));
    }
    #[test]
    fn changes_cancellation_timeout_and_errors_cannot_report_clean() {
        assert_eq!(
            reduce(&quarantined(), Some(0), FileAfter::Changed, false, true).result,
            "incomplete"
        );
        assert_eq!(
            reduce(&complete(), Some(0), FileAfter::Same, true, true).result,
            "incomplete"
        );
        assert_eq!(
            reduce(&complete(), Some(2), FileAfter::Same, false, true).result,
            "failed"
        );
        let mut evidence = complete();
        evidence.cancelled = true;
        assert_eq!(
            reduce(&evidence, Some(0), FileAfter::Same, false, true).result,
            "incomplete"
        );
    }
    #[test]
    fn preparation_failures_do_not_claim_scanning_or_elevate() {
        #[cfg(windows)]
        {
            let unavailable = super::native::preparation_failure("unavailable");
            assert_eq!(unavailable.result, "failed");
            assert!(unavailable.systemic);
            assert!(unavailable.detail.contains("unavailable"));

            let denied = super::native::preparation_failure("permission");
            assert_eq!(denied.result, "failed");
            assert!(denied.systemic);
            assert!(denied.detail.contains("will not elevate"));

            let result = scan(Path::new("C:\\missing.txt"), |_| {}, || false);
            assert_eq!(result.result, "incomplete");
            assert!(result.detail.contains("cancelled before"));
        }
    }

    #[cfg(windows)]
    fn integration_file(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("deskoy-defender-{}-{name}", std::process::id()))
    }

    /// Run explicitly on Windows; it invokes the locally configured Defender.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_defender_scans_a_benign_fixture() {
        let path = integration_file("benign.txt");
        std::fs::write(&path, b"Deskoy benign Defender integration fixture.").unwrap();
        let result = scan(&path, |phase| eprintln!("{phase}"), || true);
        eprintln!("benign result: {result:?}");
        let _ = std::fs::remove_file(&path);
        assert!(
            result.result == "clean"
                || (result.result == "incomplete" && result.detail.contains("excluded"))
                || (result.result == "failed"
                    && (result.detail.contains("permit") || result.detail.contains("unavailable"))),
            "benign fixture produced an unexpected result: {result:?}"
        );
    }

    /// EICAR is a harmless antivirus test fixture documented by Microsoft. Real-time
    /// protection may remove it before the requested scan; that must never be clean.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_defender_never_calls_the_eicar_fixture_clean() {
        let path = integration_file("eicar.com.txt");
        let pieces = [
            "X5O!P%@AP[4\\PZX54(P^)",
            "7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
        ];
        let write_result = std::fs::write(&path, pieces.concat().as_bytes());
        let result = if write_result.is_ok() {
            scan(&path, |phase| eprintln!("{phase}"), || true)
        } else {
            NativeResult::new("incomplete", "Real-time protection blocked the harmless EICAR test fixture before Deskoy could request a scan.")
        };
        eprintln!("EICAR result: {result:?}");
        let _ = std::fs::remove_file(&path);
        assert_ne!(result.result, "clean");
    }
}
