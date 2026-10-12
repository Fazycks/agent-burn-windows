//! Background quota collection through Windows Task Scheduler, the twin of
//! the macOS launchd agent: one bounded `--collect-quotas` run every minute,
//! resumed when available after sign-in, on battery too.

use std::process::{Command, Stdio};

pub const TASK_NAME: &str = "Agent Burn Quotas";

fn schtasks(args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut command = Command::new("schtasks");
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output()
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn task_xml(executable: &str) -> String {
    let start = chrono::Local::now().format("%Y-%m-%dT%H:%M:00");
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Records live Codex, Claude, and Cursor quotas for Agent Burn every minute.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT3M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>--collect-quotas</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        // Quoted: the per-user install folder ("Agent Burn") contains a space.
        command = xml_escape(&format!("\"{executable}\""))
    )
}

/// `enabled` when the task exists and points at this executable.
pub fn status() -> &'static str {
    match schtasks(&["/Query", "/TN", TASK_NAME, "/XML"]) {
        Ok(output) if output.status.success() => {
            let xml = String::from_utf8_lossy(&output.stdout).to_lowercase();
            let exe = std::env::current_exe().ok();
            let current = exe
                .as_ref()
                .map(|p| format!("\"{}\"", p.to_string_lossy().replace('&', "&amp;")).to_lowercase())
                .unwrap_or_default();
            // schtasks prints in the console code page, so non-ASCII paths only match by file name.
            let matches = if current.is_ascii() {
                xml.contains(&current)
            } else {
                exe.as_ref()
                    .and_then(|p| p.file_name())
                    .map(|n| xml.contains(&n.to_string_lossy().to_lowercase()))
                    .unwrap_or(true)
            };
            if current.is_empty() || matches {
                "enabled"
            } else {
                "outdated"
            }
        }
        _ => "notRegistered",
    }
}

pub fn register() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let xml = task_xml(&exe.to_string_lossy());
    let path = std::env::temp_dir().join(format!("agent-burn-task-{}.xml", std::process::id()));
    // Task Scheduler expects UTF-16 with a byte-order mark.
    let mut bytes = vec![0xFF, 0xFE];
    for unit in xml.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let result = schtasks(&["/Create", "/TN", TASK_NAME, "/XML", &path.to_string_lossy(), "/F"]);
    let _ = std::fs::remove_file(&path);
    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn unregister() -> Result<(), String> {
    if status() == "notRegistered" {
        return Ok(());
    }
    match schtasks(&["/Delete", "/TN", TASK_NAME, "/F"]) {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}
