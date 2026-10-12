//! App data files under `%APPDATA%\Agent Burn` (the Windows twin of
//! `~/Library/Application Support/Agent Burn`).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|home| PathBuf::from(home).join("AppData").join("Roaming"))
                .unwrap_or_else(|| PathBuf::from("."))
        })
        .join("Agent Burn")
}

pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)
}

/// Writes through a sibling temp file and renames it over the target.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = path.with_file_name(format!(".{file_name}.{}.{unique}.tmp", std::process::id()));
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    fs::rename(&temp, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

/// Only plain file names inside the data directory are accessible from the UI.
pub fn resolve(name: &str) -> Result<PathBuf, String> {
    let valid = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.starts_with('.');
    if !valid {
        return Err(format!("Invalid data file name: {name}"));
    }
    Ok(data_dir().join(name))
}

pub fn read(name: &str) -> Result<Option<String>, String> {
    let path = resolve(name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// `backup_previous` holds the previous contents' validity as judged by the caller;
/// the old file is copied to `<name>.bak` only when it is a valid document.
pub fn write(name: &str, contents: &str, backup_previous: bool) -> Result<(), String> {
    let path = resolve(name)?;
    if backup_previous {
        if let Ok(previous) = fs::read(&path) {
            write_atomic(&resolve(&format!("{name}.bak"))?, &previous)
                .map_err(|e| e.to_string())?;
        }
    }
    write_atomic(&path, contents.as_bytes()).map_err(|e| e.to_string())
}

pub fn mtime(name: &str) -> Result<Option<f64>, String> {
    let path = resolve(name)?;
    Ok(fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0))
}
