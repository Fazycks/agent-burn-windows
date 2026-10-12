//! Runs the native `agent-burn` CLI. Port of CLIClient.swift.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 16_000_000;

#[derive(Debug, Clone, PartialEq)]
pub enum CliError {
    Missing,
    Failed(i32),
    TimedOut,
    InvalidOutput,
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::Missing => write!(
                f,
                "Agent Burn CLI not found. Choose the native agent-burn executable in Settings."
            ),
            CliError::Failed(code) => write!(
                f,
                "Agent Burn exited with status {code}. Check your CLI configuration and harness sign-in, then retry."
            ),
            CliError::TimedOut => {
                write!(f, "Usage could not be updated in time. Please try again shortly.")
            }
            CliError::InvalidOutput => write!(
                f,
                "The CLI returned an unsupported report. Rebuild the app with the current Agent Burn CLI."
            ),
        }
    }
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        return home().join(rest);
    }
    if path == "~" {
        return home();
    }
    PathBuf::from(path)
}

fn is_file(path: &Path) -> bool {
    path.is_file()
}

/// Bundled CLI next to the app executable first, then common install locations and PATH.
pub fn executable(custom_path: &str) -> Result<PathBuf, CliError> {
    let custom = custom_path.trim().trim_matches('"').trim();
    if !custom.is_empty() {
        let path = expand_tilde(custom);
        return if is_file(&path) { Ok(path) } else { Err(CliError::Missing) };
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("agent-burn.exe"));
            candidates.push(dir.join("resources").join("agent-burn.exe"));
        }
    }
    let home = home();
    candidates.push(home.join(".cargo").join("bin").join("agent-burn.exe"));
    candidates.push(home.join(".local").join("bin").join("agent-burn.exe"));
    if let Some(appdata) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("npm").join("agent-burn.cmd"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("agent-burn.exe"));
        }
    }
    candidates
        .into_iter()
        .find(|candidate| is_file(candidate))
        .ok_or(CliError::Missing)
}

/// Runs the CLI with `--json --no-color [--offline]` appended and returns stdout.
pub fn run(
    executable: &Path,
    arguments: &[String],
    offline: bool,
    environment: &HashMap<String, String>,
    timeout: Duration,
) -> Result<Vec<u8>, CliError> {
    let mut args: Vec<String> = arguments.to_vec();
    args.push("--json".into());
    args.push("--no-color".into());
    if offline {
        args.push("--offline".into());
    }
    let mut command = Command::new(executable);
    command
        .args(&args)
        .envs(environment)
        .current_dir(home())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| CliError::Missing)?;
    let mut stdout = child.stdout.take().ok_or(CliError::InvalidOutput)?;
    let reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 65536];
        let mut overflow = false;
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if buffer.len() + n > MAX_OUTPUT {
                        overflow = true;
                    } else {
                        buffer.extend_from_slice(&chunk[..n]);
                    }
                }
            }
        }
        (buffer, overflow)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    // A grandchild may still hold the pipe open; let the reader thread finish on its own.
                    drop(reader);
                    return Err(CliError::TimedOut);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return Err(CliError::InvalidOutput),
        }
    };
    let (buffer, overflow) = reader.join().map_err(|_| CliError::InvalidOutput)?;
    if !status.success() {
        return Err(CliError::Failed(status.code().unwrap_or(-1)));
    }
    if overflow {
        return Err(CliError::InvalidOutput);
    }
    Ok(buffer)
}

/// `SourcePaths.codexHomes`: `~/.codex` plus any inherited `CODEX_HOME` entries,
/// tilde-expanded and de-duplicated.
pub fn default_codex_homes() -> String {
    let inherited = std::env::var("CODEX_HOME").unwrap_or_default();
    let candidates = std::iter::once(home().join(".codex").to_string_lossy().into_owned())
        .chain(inherited.split(',').map(str::to_string));
    let mut paths: Vec<String> = Vec::new();
    for candidate in candidates {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = expand_tilde(trimmed).to_string_lossy().trim_end_matches(['\\', '/']).to_string();
        if !paths.iter().any(|p| p.eq_ignore_ascii_case(&path)) {
            paths.push(path);
        }
    }
    paths.join(",")
}
