#[cfg(windows)]
pub(crate) const STATUS_REQUEST: u8 = b'S';
#[cfg(windows)]
pub(crate) const TOGGLE_REQUEST: u8 = b'T';

#[cfg(windows)]
pub(crate) fn pipe_name() -> std::io::Result<String> {
    use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;

    let mut session_id = 0u32;
    let ok = unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session_id) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(format!(r"\\.\pipe\DeskoyCli-v1-{session_id}"))
}
