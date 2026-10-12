// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--collect-quotas") {
        std::process::exit(agent_burn_windows_lib::collect_quotas_headless());
    }
    agent_burn_windows_lib::run()
}
