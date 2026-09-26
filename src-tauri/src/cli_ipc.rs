use tauri::AppHandle;

#[cfg(windows)]
pub(super) fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = listen(app).await {
            eprintln!("Deskoy CLI listener unavailable: {error}");
        }
    });
}

#[cfg(not(windows))]
pub(super) fn start(_app: AppHandle) {}

#[cfg(windows)]
async fn listen(app: AppHandle) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = super::cli_protocol::pipe_name()?;
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&pipe_name)?;
    loop {
        server.connect().await?;
        let connected = server;
        server = ServerOptions::new()
            .reject_remote_clients(true)
            .create(&pipe_name)?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = serve(app, connected).await;
        });
    }
}

#[cfg(windows)]
async fn serve(
    app: AppHandle,
    mut pipe: tokio::net::windows::named_pipe::NamedPipeServer,
) -> std::io::Result<()> {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        time::timeout,
    };

    let mut request = [0u8; 1];
    timeout(
        std::time::Duration::from_secs(2),
        pipe.read_exact(&mut request),
    )
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "CLI request timed out"))??;
    let response = match request[0] {
        super::cli_protocol::STATUS_REQUEST => status(&app),
        super::cli_protocol::TOGGLE_REQUEST => toggle(&app).await,
        _ => "ERR unknown-command\n".to_string(),
    };
    timeout(
        std::time::Duration::from_secs(5),
        pipe.write_all(response.as_bytes()),
    )
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "CLI response timed out"))??;
    Ok(())
}

#[cfg(windows)]
fn status(app: &AppHandle) -> String {
    let state = super::app_state(app);
    let cover_open = state.state.lock().unwrap().cover_open;
    format!(
        "OK {} {} {}\n",
        u8::from(super::effective_enabled(app)),
        u8::from(super::is_paused(app)),
        u8::from(cover_open),
    )
}

#[cfg(windows)]
async fn toggle(app: &AppHandle) -> String {
    if !super::effective_enabled(app) {
        return if super::is_paused(app) {
            "ERR paused\n".to_string()
        } else {
            "ERR disabled\n".to_string()
        };
    }
    let before = {
        let state = super::app_state(app);
        let runtime = state.state.lock().unwrap();
        if runtime.cover_busy {
            return "ERR busy\n".to_string();
        }
        runtime.cover_open
    };

    // The same path used by the global hotkey applies cover entitlement in Rust.
    super::toggle_cover_via_hotkey(app.clone()).await;
    let after = super::app_state(app).state.lock().unwrap().cover_open;
    if before == after {
        "ERR cover-failed\n".to_string()
    } else {
        format!("OK cover={}\n", if after { "open" } else { "closed" })
    }
}
