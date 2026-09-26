use super::ActiveWindowInfo;
use base64::{engine::general_purpose, Engine as _};
use std::{path::PathBuf, process::Command};

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
        GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
        SetForegroundWindow, ShowWindow, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
    },
};

#[cfg(windows)]
pub(super) struct SingleInstanceGuard {
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
pub(super) struct SingleInstanceGuard;

#[cfg(windows)]
pub(super) fn acquire_single_instance_guard() -> Option<SingleInstanceGuard> {
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
pub(super) fn acquire_single_instance_guard() -> Option<SingleInstanceGuard> {
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
pub(super) fn get_active_window_info() -> Option<ActiveWindowInfo> {
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
pub(super) fn get_active_window_info() -> Option<ActiveWindowInfo> {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum BlockedWindowState {
    Gone,
    Replaced,
    Hidden,
    Minimized,
    Visible,
}
pub(super) async fn close_blocked_window(target: &ActiveWindowInfo) -> bool {
    let target = target.clone();
    tauri::async_runtime::spawn_blocking(move || hide_blocked_window(&target))
        .await
        .unwrap_or(false)
}

#[cfg(windows)]
fn hide_blocked_window(target: &ActiveWindowInfo) -> bool {
    unsafe {
        let Some(hwnd) = verified_target_handle(target) else {
            return true;
        };
        let mut ok = true;
        if IsIconic(hwnd) == 0 {
            ok = ShowWindow(hwnd, SW_MINIMIZE) != 0;
        }
        PostMessageW(hwnd, WM_CLOSE, 0, 0) != 0 || ok
    }
}

#[cfg(not(windows))]
fn hide_blocked_window(_target: &ActiveWindowInfo) -> bool {
    true
}

pub(super) fn is_blocked_window_gone_or_minimized(target: &ActiveWindowInfo) -> bool {
    matches!(
        blocked_window_state(target),
        BlockedWindowState::Gone | BlockedWindowState::Replaced | BlockedWindowState::Minimized
    )
}

#[cfg(windows)]
pub(super) fn blocked_window_state(target: &ActiveWindowInfo) -> BlockedWindowState {
    unsafe {
        let hwnd = target.hwnd as isize as *mut std::ffi::c_void;
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return BlockedWindowState::Gone;
        }
        if target.pid == 0 || window_pid(hwnd) != Some(target.pid) {
            return BlockedWindowState::Replaced;
        }
        if IsWindowVisible(hwnd) == 0 {
            BlockedWindowState::Hidden
        } else if IsIconic(hwnd) != 0 {
            BlockedWindowState::Minimized
        } else {
            BlockedWindowState::Visible
        }
    }
}

#[cfg(not(windows))]
pub(super) fn blocked_window_state(_target: &ActiveWindowInfo) -> BlockedWindowState {
    BlockedWindowState::Gone
}

#[cfg(windows)]
unsafe fn verified_target_handle(
    target: &ActiveWindowInfo,
) -> Option<*mut std::ffi::c_void> {
    let hwnd = target.hwnd as isize as *mut std::ffi::c_void;
    if hwnd.is_null() || IsWindow(hwnd) == 0 || target.pid == 0 {
        return None;
    }
    if window_pid(hwnd) != Some(target.pid) {
        return None;
    }
    if !target.process_name.is_empty() {
        let current_process = process_name_from_pid(target.pid)?;
        if !current_process.eq_ignore_ascii_case(&target.process_name) {
            return None;
        }
    }
    Some(hwnd)
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

pub(super) enum AudioMuteResult {
    Muted(Vec<i32>),
    AlreadyMuted,
    Failed,
}

#[cfg(windows)]
pub(super) fn mute_default_audio_endpoints() -> AudioMuteResult {
    match set_default_audio_mute(true, &[0, 1], true) {
        Ok(roles) if roles.is_empty() => AudioMuteResult::AlreadyMuted,
        Ok(roles) => AudioMuteResult::Muted(roles),
        Err(_) => AudioMuteResult::Failed,
    }
}

#[cfg(not(windows))]
pub(super) fn mute_default_audio_endpoints() -> AudioMuteResult {
    AudioMuteResult::Failed
}

#[cfg(windows)]
pub(super) fn restore_default_audio_endpoints(roles: &[i32]) -> bool {
    set_default_audio_mute(false, roles, false).is_ok()
}

#[cfg(not(windows))]
pub(super) fn restore_default_audio_endpoints(_roles: &[i32]) -> bool {
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

pub(super) fn toggle_volume_mute_vk() {
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
