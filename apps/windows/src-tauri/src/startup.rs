//! Launch at sign-in through the per-user `Run` key, the twin of the macOS
//! login item. The app starts hidden in the tray.

use windows_registry::{CURRENT_USER, Type};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// Where Task Manager's Startup tab stores its enabled/disabled switch.
const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
/// Same value name as the autostart plugin used up to 0.1.15, so existing entries carry over.
const VALUE_NAME: &str = "Agent Burn";
const APPROVED_ENABLED: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

fn command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Quoted: the per-user install folder ("Agent Burn") contains a space.
    Ok(format!("\"{}\" --hidden", exe.display()))
}

fn registered() -> Option<String> {
    CURRENT_USER.open(RUN_KEY).and_then(|key| key.get_string(VALUE_NAME)).ok()
}

/// Task Manager's switch is the low bit of the first byte: 02/06 enabled, 01/03/07 disabled.
fn approved() -> bool {
    match CURRENT_USER.open(APPROVED_KEY).and_then(|key| key.get_value(VALUE_NAME)) {
        Ok(value) => value.first().is_none_or(|byte| byte & 1 == 0),
        Err(_) => true,
    }
}

pub fn is_enabled() -> bool {
    registered().is_some() && approved()
}

pub fn set(enabled: bool) -> Result<(), String> {
    if enabled {
        let command = command()?;
        CURRENT_USER
            .create(RUN_KEY)
            .and_then(|key| key.set_string(VALUE_NAME, command.as_str()))
            .map_err(|e| e.to_string())?;
        // Clears a "Disabled" left by Task Manager, which would otherwise win silently.
        CURRENT_USER
            .create(APPROVED_KEY)
            .and_then(|key| key.set_bytes(VALUE_NAME, Type::Bytes, &APPROVED_ENABLED))
            .map_err(|e| e.to_string())?;
    } else {
        for path in [RUN_KEY, APPROVED_KEY] {
            if let Ok(key) = CURRENT_USER.options().write().open(path) {
                let _ = key.remove_value(VALUE_NAME);
            }
        }
    }
    Ok(())
}

/// Rewrites an existing entry that points elsewhere or lacks quotes (written by 0.1.15 and
/// earlier), leaving the user's choice untouched. Release builds only, so a dev build never
/// takes over the installed app's entry.
#[cfg(not(debug_assertions))]
pub fn repair() {
    let Ok(expected) = command() else { return };
    if registered().is_some_and(|current| current != expected) {
        if let Ok(key) = CURRENT_USER.create(RUN_KEY) {
            let _ = key.set_string(VALUE_NAME, expected.as_str());
        }
    }
}

#[cfg(debug_assertions)]
pub fn repair() {}
