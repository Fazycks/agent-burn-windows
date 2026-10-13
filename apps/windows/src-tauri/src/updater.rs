//! Updates from the GitHub releases: checked once when the app process starts
//! (never when a window opens, since the app keeps running in the tray), then
//! downloaded, verified against the release's SHA-256 digest, and installed
//! silently by the NSIS installer, which relaunches the app.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tauri::AppHandle;

const LATEST_URL: &str = "https://api.github.com/repos/Fazycks/agent-burn-windows/releases/latest";
/// Sign-in can start the app before the network is up.
const ATTEMPTS: u32 = 4;
const RETRY_DELAY: Duration = Duration::from_secs(60);
/// Holds the version last handed to the installer: when the app comes back up
/// older than it, that install failed and is not retried on every launch.
const ATTEMPT_FILE: &str = "attempted";

/// One install at a time: the launch check and "Check for Updates…" share it.
static INSTALLING: AtomicBool = AtomicBool::new(false);

fn update_dir() -> PathBuf {
    std::env::temp_dir().join("agent-burn-update")
}

/// The Internet Options proxy (as the webview uses), which curl does not read itself.
fn system_proxy() -> Option<String> {
    use windows_registry::CURRENT_USER;
    let key = CURRENT_USER.open(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings").ok()?;
    if key.get_u32("ProxyEnable").ok()? == 0 {
        return None;
    }
    let server = key.get_string("ProxyServer").ok()?;
    // Either "host:port" or per protocol: "http=host:port;https=host:port".
    if !server.contains('=') {
        return Some(server.trim().to_string()).filter(|s| !s.is_empty());
    }
    let entry = |scheme: &str| {
        server.split(';').find_map(|part| part.trim().strip_prefix(scheme).map(|v| v.trim().to_string()))
    };
    entry("https=").or_else(|| entry("http="))
}

#[derive(serde::Serialize, Clone)]
pub struct Update {
    pub version: String,
    name: String,
    url: String,
    sha256: String,
}

fn curl(args: &[&str]) -> Result<Vec<u8>, String> {
    // Windows' own curl, never one found on PATH.
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let mut command = Command::new(Path::new(&root).join(r"System32\curl.exe"));
    command
        .args(["-fsSL", "--proto", "=https", "--ssl-revoke-best-effort", "-A", "agent-burn-windows"]);
    if let Some(proxy) = system_proxy() {
        command.args(["--proxy", &proxy]);
    }
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output.stdout)
}

fn parse(version: &str) -> [u64; 3] {
    let mut parts = version.trim_start_matches(['v', 'V']).split(['.', '-']);
    std::array::from_fn(|_| parts.next().and_then(|p| p.parse().ok()).unwrap_or(0))
}

/// The newest release when it is newer than `current`.
pub fn check(current: &str) -> Result<Option<Update>, String> {
    let body = curl(&["--max-time", "20", "-H", "Accept: application/vnd.github+json", LATEST_URL])?;
    let release: serde_json::Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    let tag = release["tag_name"].as_str().ok_or("The release has no tag.")?;
    if parse(tag) <= parse(current) {
        return Ok(None);
    }
    let asset = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find(|a| a["name"].as_str().is_some_and(|n| n.to_lowercase().ends_with("setup.exe")))
        })
        .ok_or("The release has no installer.")?;
    let sha256 = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or("The installer has no checksum.")?;
    Ok(Some(Update {
        version: tag.trim_start_matches(['v', 'V']).to_string(),
        name: asset["name"].as_str().unwrap_or("setup.exe").replace(['/', '\\'], "_"),
        url: asset["browser_download_url"].as_str().ok_or("The installer has no URL.")?.to_string(),
        sha256: sha256.to_lowercase(),
    }))
}

fn download(update: &Update) -> Result<PathBuf, String> {
    let dir = update_dir();
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&update.name);
    let target = path.to_string_lossy().to_string();
    curl(&["--max-time", "600", "-o", &target, &update.url])?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let digest = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
    if digest != update.sha256 {
        let _ = std::fs::remove_dir_all(&dir);
        return Err("The downloaded installer does not match the release checksum.".into());
    }
    Ok(path)
}

/// Stops the bundled CLI helper: the Restart Manager only closes the app, and a
/// running helper would keep its file locked during the install.
fn stop_helper() {
    let Some(helper) = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.join("agent-burn.exe"))) else {
        return;
    };
    let script = format!(
        "Get-Process agent-burn -ErrorAction SilentlyContinue | Where-Object Path -eq '{}' | Stop-Process -Force",
        helper.display().to_string().replace('\'', "''")
    );
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let _ = command.status();
}

/// Downloads and starts the silent installer, then quits so it can replace the app.
pub fn install(app: &AppHandle, update: &Update, relaunch_hidden: bool) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("An update is already being installed.".into());
    }
    let result = start_installer(update, relaunch_hidden);
    match result {
        Ok(()) => app.exit(0),
        Err(_) => INSTALLING.store(false, Ordering::SeqCst),
    }
    result
}

fn start_installer(update: &Update, relaunch_hidden: bool) -> Result<(), String> {
    let installer = download(update)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = if relaunch_hidden { " --hidden" } else { "" };
    let relaunch_args = if relaunch_hidden { " /ARGS --hidden" } else { "" };
    // The installer relaunches the app when it succeeds; when it fails the
    // previous version is started again instead of leaving the app closed.
    let script = format!(
        "@echo off\r\n\"{}\" /S /R{relaunch_args}\r\nif errorlevel 1 start \"\" \"{}\"{args}\r\n",
        installer.display(),
        exe.display()
    );
    let script_path = update_dir().join("install.cmd");
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;
    std::fs::write(update_dir().join(ATTEMPT_FILE), &update.version).map_err(|e| e.to_string())?;
    stop_helper();
    let mut command = Command::new("cmd.exe");
    command.arg("/d").arg("/c").arg(&script_path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// The version whose install was started but did not take.
fn failed_attempt() -> Option<String> {
    std::fs::read_to_string(update_dir().join(ATTEMPT_FILE)).ok().map(|v| v.trim().to_string())
}

/// The once-per-launch check, on its own thread.
pub fn on_launch(app: AppHandle, launched_hidden: bool) {
    let current = app.package_info().version.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        for attempt in 1..=ATTEMPTS {
            match check(&current) {
                Ok(Some(update)) => {
                    // A failed install is left to "Check for Updates…" until a newer release.
                    if failed_attempt().as_deref() != Some(update.version.as_str()) {
                        let _ = install(&app, &update, launched_hidden);
                    }
                    return;
                }
                Ok(None) => return,
                Err(_) if attempt < ATTEMPTS => std::thread::sleep(RETRY_DELAY),
                Err(_) => return,
            }
        }
    });
}
