#[cfg(not(windows))]
compile_error!("The Deskoy CLI is currently supported on Windows only.");

#[cfg(windows)]
#[path = "../../src-tauri/src/cli_protocol.rs"]
mod cli_protocol;

#[cfg(windows)]
#[derive(Debug, Eq, PartialEq)]
enum Action {
    Help,
    Version,
    Status,
    ToggleCover,
}

#[cfg(windows)]
fn parse_action(args: &[String]) -> Result<Action, &'static str> {
    match args {
        [] => Ok(Action::Help),
        [a] if a == "--help" || a == "-h" => Ok(Action::Help),
        [a] if a == "--version" || a == "-V" => Ok(Action::Version),
        [a] if a == "status" => Ok(Action::Status),
        [a] if a == "toggle" => Ok(Action::ToggleCover),
        [a, b] if a == "cover" && b == "toggle" => Ok(Action::ToggleCover),
        _ => Err("Unknown command. Run deskoy --help for usage."),
    }
}

#[cfg(windows)]
fn print_help() {
    println!("Deskoy command line\n\nUsage:\n  deskoy --version       Show CLI version\n  deskoy status          Show running-app and cover status\n  deskoy cover toggle    Toggle the privacy cover\n  deskoy --help          Show this help\n\ndeskoy toggle is a shortcut for deskoy cover toggle.");
}

#[cfg(windows)]
fn parse_response(action: Action, response: &str) -> Result<String, String> {
    let response = response.trim_end_matches(['\r', '\n']);
    if let Some(reason) = response.strip_prefix("ERR ") {
        return Err(match reason {
            "disabled" => "Deskoy is disabled. Enable it in the app first.",
            "paused" => "Deskoy is paused. Resume it in the app first.",
            "busy" => "The privacy cover is busy. Try again in a moment.",
            "cover-failed" => "Deskoy could not toggle the privacy cover.",
            _ => "Deskoy rejected the command.",
        }
        .to_string());
    }
    match action {
        Action::Status => {
            let parts: Vec<_> = response.split(' ').collect();
            if parts.len() != 4
                || parts[0] != "OK"
                || parts[1..].iter().any(|part| *part != "0" && *part != "1")
            {
                return Err("Deskoy returned an invalid status response.".into());
            }
            let state = if parts[2] == "1" {
                "paused"
            } else if parts[1] == "1" {
                "active"
            } else {
                "disabled"
            };
            let cover = if parts[3] == "1" { "open" } else { "closed" };
            Ok(format!(
                "Deskoy is running. State: {state}. Privacy cover: {cover}."
            ))
        }
        Action::ToggleCover => match response {
            "OK cover=open" => Ok("Privacy cover opened.".into()),
            "OK cover=closed" => Ok("Privacy cover closed.".into()),
            _ => Err("Deskoy returned an invalid cover response.".into()),
        },
        Action::Help | Action::Version => Err("Unexpected CLI response.".into()),
    }
}

#[cfg(windows)]
async fn send_command(request: u8) -> Result<String, String> {
    let pipe_name =
        cli_protocol::pipe_name().map_err(|_| "Could not identify this Windows session.")?;
    send_command_to(&pipe_name, request).await
}

#[cfg(windows)]
async fn send_command_to(pipe_name: &str, request: u8) -> Result<String, String> {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::windows::named_pipe::ClientOptions,
        time::timeout,
    };

    let mut pipe = match ClientOptions::new().open(pipe_name) {
        Ok(pipe) => pipe,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("Deskoy is not running. Start Deskoy and try again.".into());
        }
        Err(error) => return Err(format!("Could not connect to Deskoy: {error}")),
    };
    timeout(
        std::time::Duration::from_secs(3),
        pipe.write_all(&[request]),
    )
    .await
    .map_err(|_| "Deskoy did not accept the command in time.")?
    .map_err(|error| format!("Could not send command to Deskoy: {error}"))?;
    let mut bytes = Vec::new();
    timeout(
        std::time::Duration::from_secs(8),
        pipe.take(128).read_to_end(&mut bytes),
    )
    .await
    .map_err(|_| "Deskoy did not respond in time.")?
    .map_err(|error| format!("Could not read Deskoy response: {error}"))?;
    String::from_utf8(bytes).map_err(|_| "Deskoy returned an invalid response.".into())
}

#[cfg(windows)]
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let action = match parse_action(&args) {
        Ok(action) => action,
        Err(error) => {
            eprintln!("Error: {error}");
            std::process::exit(2);
        }
    };
    match action {
        Action::Help => print_help(),
        Action::Version => println!("deskoy {}", env!("CARGO_PKG_VERSION")),
        Action::Status | Action::ToggleCover => {
            let request = if action == Action::Status {
                cli_protocol::STATUS_REQUEST
            } else {
                cli_protocol::TOGGLE_REQUEST
            };
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| format!("Could not start CLI: {error}"))
                .and_then(|runtime| runtime.block_on(send_command(request)))
                .and_then(|response| parse_response(action, &response));
            match result {
                Ok(message) => println!("{message}"),
                Err(error) => {
                    eprintln!("Error: {error}");
                    std::process::exit(1);
                }
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn parses_documented_commands() {
        assert_eq!(parse_action(&args(&["--version"])), Ok(Action::Version));
        assert_eq!(parse_action(&args(&["status"])), Ok(Action::Status));
        assert_eq!(
            parse_action(&args(&["cover", "toggle"])),
            Ok(Action::ToggleCover)
        );
        assert!(parse_action(&args(&["licence", "get-key"])).is_err());
    }

    #[test]
    fn only_accepts_status_without_licence_data() {
        assert_eq!(
            parse_response(Action::Status, "OK 1 0 1\n").unwrap(),
            "Deskoy is running. State: active. Privacy cover: open."
        );
        assert!(parse_response(Action::Status, "OK 1 0 1 key=secret\n").is_err());
    }

    #[test]
    fn reports_cover_failures_clearly() {
        assert_eq!(
            parse_response(Action::ToggleCover, "ERR paused\n").unwrap_err(),
            "Deskoy is paused. Resume it in the app first."
        );
        assert_eq!(
            parse_response(Action::ToggleCover, "OK cover=closed\n").unwrap(),
            "Privacy cover closed."
        );
    }

    #[test]
    fn sends_one_cover_command_to_a_local_pipe() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::windows::named_pipe::ServerOptions,
        };

        let name = format!(
            r"\\.\pipe\DeskoyCliTest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async move {
                let mut server = ServerOptions::new()
                    .first_pipe_instance(true)
                    .reject_remote_clients(true)
                    .create(&name)
                    .unwrap();
                let server_task = tokio::spawn(async move {
                    server.connect().await.unwrap();
                    let mut command = [0u8; 1];
                    server.read_exact(&mut command).await.unwrap();
                    assert_eq!(command, [cli_protocol::TOGGLE_REQUEST]);
                    server.write_all(b"OK cover=open\n").await.unwrap();
                });
                let response = send_command_to(&name, cli_protocol::TOGGLE_REQUEST)
                    .await
                    .unwrap();
                server_task.await.unwrap();
                assert_eq!(
                    parse_response(Action::ToggleCover, &response).unwrap(),
                    "Privacy cover opened."
                );
            });
    }
}
