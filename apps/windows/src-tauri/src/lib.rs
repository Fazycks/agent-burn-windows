mod background;
mod cli;
mod quota;
mod startup;
mod storage;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const TRAY_ID: &str = "agent-burn";
/// WebView2 throttles timers in hidden windows; the dashboard keeps collecting
/// from the tray, so background throttling is disabled for every window.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

#[derive(Default)]
struct PopoverState {
    hidden_at: Option<Instant>,
    anchor: Option<Rect>,
}

struct AppState {
    popover: Mutex<PopoverState>,
}

/// Collects quotas once without starting the UI; run by Task Scheduler.
pub fn collect_quotas_headless() -> i32 {
    match quota::collect(&storage::data_dir(), false) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Quota collection failed: {error}");
            1
        }
    }
}

// MARK: Commands

#[tauri::command]
async fn run_cli(
    args: Vec<String>,
    env: HashMap<String, String>,
    offline: bool,
    custom_path: String,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe = cli::executable(&custom_path).map_err(|e| e.to_string())?;
        let data = cli::run(
            &exe,
            &args,
            offline,
            &env,
            Duration::from_secs(timeout_secs.unwrap_or(120)),
        )
        .map_err(|e| e.to_string())?;
        String::from_utf8(data).map_err(|_| cli::CliError::InvalidOutput.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cli_available(custom_path: String) -> bool {
    cli::executable(&custom_path).is_ok()
}

#[tauri::command]
fn default_codex_homes() -> String {
    cli::default_codex_homes()
}

#[tauri::command]
fn data_dir() -> String {
    storage::data_dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn data_read(name: String) -> Result<Option<String>, String> {
    storage::read(&name)
}

#[tauri::command]
fn data_write(name: String, contents: String, backup_previous: bool) -> Result<(), String> {
    storage::write(&name, &contents, backup_previous)
}

#[tauri::command]
fn data_mtime(name: String) -> Result<Option<f64>, String> {
    storage::mtime(&name)
}

#[derive(Serialize)]
struct QuotaLoad {
    history: Option<quota::QuotaHistory>,
    mtime: Option<f64>,
}

#[tauri::command]
async fn quota_load(known_mtime: Option<f64>) -> Result<Option<QuotaLoad>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = storage::data_dir();
        let mtime = quota::archive_mtime(&dir);
        if mtime.is_some() && mtime == known_mtime {
            return Ok(None);
        }
        let history = quota::load(&dir)?;
        Ok(Some(QuotaLoad { history, mtime }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn quota_commit(
    readings: Vec<quota::QuotaReading>,
    source: String,
    failures: HashMap<String, Option<String>>,
) -> Result<quota::QuotaHistory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        quota::commit(&storage::data_dir(), &readings, &source, &failures)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn quota_collect(force: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || quota::collect(&storage::data_dir(), force))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn quota_config_save(custom_path: String, codex_homes: String) -> Result<(), String> {
    quota::save_config(
        &storage::data_dir(),
        &quota::CollectorConfig { custom_path, codex_homes },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn background_status() -> String {
    tauri::async_runtime::spawn_blocking(|| background::status().to_string())
        .await
        .unwrap_or_else(|_| "notRegistered".into())
}

#[tauri::command]
async fn background_set(enabled: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            background::register()?;
        } else {
            background::unregister()?;
        }
        Ok(background::status().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn sync_startup(app: &AppHandle) -> bool {
    let enabled = startup::is_enabled();
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
        let _ = item.set_checked(enabled);
    }
    enabled
}

#[tauri::command]
fn startup_status(app: AppHandle) -> bool {
    sync_startup(&app)
}

#[tauri::command]
fn startup_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let result = startup::set(enabled);
    let enabled = sync_startup(&app);
    let _ = app.emit("startup:changed", enabled);
    result.map(|_| enabled)
}

#[tauri::command]
fn set_tray_status(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("Agent Burn {text}")));
    }
}

#[tauri::command]
fn show_dashboard(app: AppHandle) {
    open_dashboard(&app);
}

#[tauri::command]
fn show_settings(app: AppHandle, tab: Option<String>) {
    open_settings(&app, tab);
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    if let Some(window) = app.get_webview_window("popover") {
        let _ = window.hide();
    }
}

/// Fits the popover to its content height, keeping it attached to the tray icon.
#[tauri::command]
fn popover_resize(app: AppHandle, height: f64) {
    let Some(window) = app.get_webview_window("popover") else { return };
    let _ = window.set_size(tauri::LogicalSize::new(440.0, height.clamp(200.0, 900.0)));
    let anchor = app.try_state::<AppState>().and_then(|state| state.popover.lock().unwrap().anchor);
    if window.is_visible().unwrap_or(false) {
        position_popover(&window, anchor);
    }
}

#[tauri::command]
fn set_menu_bar_only(app: AppHandle, enabled: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(enabled);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// MARK: Windows

fn open_dashboard(app: &AppHandle) {
    hide_popover(app.clone());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The version in the URL keeps WebView2 from serving the previous version's
/// cached frontend after an update.
fn app_url(app: &AppHandle, window: &str) -> WebviewUrl {
    let version = &app.package_info().version;
    WebviewUrl::App(format!("index.html?window={window}&v={version}").into())
}

fn open_settings(app: &AppHandle, tab: Option<String>) {
    hide_popover(app.clone());
    if let Some(window) = app.get_webview_window("settings") {
        if let Some(tab) = tab {
            let _ = window.emit("settings:tab", tab);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let query = tab.map(|t| format!("&tab={t}")).unwrap_or_default();
    let url = app_url(app, &format!("settings{query}"));
    if let Ok(window) = WebviewWindowBuilder::new(app, "settings", url)
        .title("Agent Burn Settings")
        .inner_size(560.0, 600.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .visible(false)
        .center()
        .additional_browser_args(BROWSER_ARGS)
        .build()
    {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The dashboard window; built here rather than in tauri.conf.json so its URL carries the version.
fn build_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, "main", app_url(app, "main"))
        .title("Agent Burn")
        .inner_size(1240.0, 820.0)
        .min_inner_size(980.0, 650.0)
        .decorations(false)
        .shadow(true)
        .visible(false)
        .center()
        .additional_browser_args(BROWSER_ARGS)
        .build()
}

fn build_popover(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app,
        "popover",
        app_url(app, "popover"),
    )
    .title("Agent Burn")
    .inner_size(440.0, 700.0)
    .resizable(false)
    .decorations(false)
    .shadow(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .focused(false)
    .additional_browser_args(BROWSER_ARGS)
    .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if let Some(window) = handle.get_webview_window("popover") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                    if let Some(state) = handle.try_state::<AppState>() {
                        state.popover.lock().unwrap().hidden_at = Some(Instant::now());
                    }
                }
            }
        }
    });
    Ok(window)
}

/// Places the popover above (or below) the tray icon, inside the monitor's work area.
fn position_popover(window: &WebviewWindow, anchor: Option<Rect>) {
    let Ok(size) = window.outer_size() else { return };
    let monitor = window.current_monitor().ok().flatten().or_else(|| {
        anchor.and_then(|rect| {
            let p = rect.position.to_physical::<f64>(1.0);
            window.monitor_from_point(p.x, p.y).ok().flatten()
        })
    });
    let Some(monitor) = monitor else { return };
    let area = monitor.work_area();
    let (ax, ay, aw, ah) = match anchor {
        Some(rect) => {
            let scale = monitor.scale_factor();
            let p = rect.position.to_physical::<f64>(scale);
            let s = rect.size.to_physical::<f64>(scale);
            (p.x, p.y, s.width, s.height)
        }
        None => (
            (area.position.x + area.size.width as i32) as f64 - 24.0,
            (area.position.y + area.size.height as i32) as f64,
            0.0,
            0.0,
        ),
    };
    let width = size.width as f64;
    let height = size.height as f64;
    let left = area.position.x as f64;
    let top = area.position.y as f64;
    let right = left + area.size.width as f64;
    let bottom = top + area.size.height as f64;
    let mut x = ax + aw / 2.0 - width / 2.0;
    x = x.min(right - width - 8.0).max(left + 8.0);
    let y = if ay - height - 8.0 >= top { ay - height - 8.0 } else { ay + ah + 8.0 };
    let y = y.min(bottom - height - 8.0).max(top + 8.0);
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn toggle_popover(app: &AppHandle, anchor: Option<Rect>) {
    let window = match app.get_webview_window("popover") {
        Some(window) => window,
        None => match build_popover(app) {
            Ok(window) => window,
            Err(_) => return,
        },
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        // The click that blurred (and hid) the popover must not reopen it.
        let recently = state
            .popover
            .lock()
            .unwrap()
            .hidden_at
            .is_some_and(|at| at.elapsed() < Duration::from_millis(300));
        if recently {
            return;
        }
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.popover.lock().unwrap().anchor = anchor;
    }
    position_popover(&window, anchor);
    let _ = window.emit("popover:shown", ());
    let _ = window.show();
    let _ = window.set_focus();
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open dashboard", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, Some("Ctrl+R"))?;
    let check = MenuItem::with_id(app, "check", "Check Live Usage Now", true, Some("Ctrl+Shift+R"))?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("Ctrl+,"))?;
    let updates = MenuItem::with_id(app, "updates", "Check for Updates…", true, None::<&str>)?;
    let launch = CheckMenuItem::with_id(app, "startup", "Launch at Startup", true, startup::is_enabled(), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Agent Burn", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&open, &separator, &refresh, &check, &settings, &updates, &launch, &separator2, &quit],
    )?;
    app.manage(launch);
    let icon = app.default_window_icon().cloned().expect("app icon");
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Agent Burn")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_dashboard(app),
            "settings" => open_settings(app, None),
            "updates" => open_settings(app, Some("updates".into())),
            "refresh" => {
                let _ = app.emit("store:action", serde_json::json!({ "type": "refreshAll" }));
            }
            "check" => {
                let _ = app.emit(
                    "store:action",
                    serde_json::json!({ "type": "refreshAll", "hard": true }),
                );
            }
            "startup" => {
                let _ = startup_set(app.clone(), !startup::is_enabled());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Task Manager can switch the entry off while the app runs.
            if let TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Down, .. } = event {
                sync_startup(tray.app_handle());
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;
    Ok(())
}

fn read_menu_bar_only() -> bool {
    storage::read("preferences.json")
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("menuBarOnly").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launched_hidden = std::env::args().any(|arg| arg == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == "--settings") {
                open_settings(app, None);
            } else {
                open_dashboard(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { popover: Mutex::new(PopoverState::default()) })
        .invoke_handler(tauri::generate_handler![
            run_cli,
            cli_available,
            default_codex_homes,
            data_dir,
            data_read,
            data_write,
            data_mtime,
            quota_load,
            quota_commit,
            quota_collect,
            quota_config_save,
            background_status,
            background_set,
            startup_status,
            startup_set,
            set_tray_status,
            show_dashboard,
            show_settings,
            hide_popover,
            popover_resize,
            set_menu_bar_only,
            quit_app,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            startup::repair();
            build_tray(&handle)?;
            let main = build_main(&handle);
            let _ = build_popover(&handle);
            let menu_bar_only = read_menu_bar_only();
            if let Ok(main) = main {
                let _ = main.set_skip_taskbar(menu_bar_only);
                if !menu_bar_only && !launched_hidden {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the dashboard keeps Agent Burn running in the notification area.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Agent Burn");
}
