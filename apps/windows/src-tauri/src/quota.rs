//! Quota archive, CSV journal and collector. Ports QuotaHistory.swift,
//! QuotaJournal.swift and QuotaCollector.swift; the read-side helpers
//! (`current`, `samples`, `resets`) live in the TypeScript store.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::cli;
use crate::storage;

pub const CLAUDE_SESSION_AGENT: &str = "claude-session";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub window_minutes: f64,
    pub used_percent: f64,
    pub elapsed_percent: f64,
    #[serde(default)]
    pub api_equivalent_spent: f64,
}

impl QuotaWindow {
    pub fn is_valid(&self) -> bool {
        self.window_minutes.is_finite()
            && self.window_minutes > 0.0
            && self.used_percent.is_finite()
            && self.elapsed_percent.is_finite()
            && (0.0..=100.0).contains(&self.elapsed_percent)
            && (0.0..=100.0).contains(&self.used_percent)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaReading {
    pub agent: String,
    pub observed_at: f64,
    pub window: QuotaWindow,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QuotaHistory {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub readings: BTreeMap<String, BTreeMap<String, Vec<QuotaReading>>>,
    #[serde(default)]
    pub failures: BTreeMap<String, BTreeMap<String, String>>,
}

impl QuotaHistory {
    pub fn new() -> Self {
        QuotaHistory { version: 1, ..Default::default() }
    }

    fn latest_observed(&self, agent: &str, source: &str) -> f64 {
        self.readings
            .get(source)
            .and_then(|agents| agents.get(agent))
            .and_then(|rows| rows.last())
            .map(|row| row.observed_at)
            .unwrap_or(0.0)
    }

    pub fn record(&mut self, reading: &QuotaReading, source: &str) -> bool {
        if !reading.observed_at.is_finite()
            || !reading.window.is_valid()
            || reading.observed_at <= self.latest_observed(&reading.agent, source)
        {
            return false;
        }
        self.readings
            .entry(source.to_string())
            .or_default()
            .entry(reading.agent.clone())
            .or_default()
            .push(reading.clone());
        if let Some(failures) = self.failures.get_mut(source) {
            failures.remove(&reading.agent);
        }
        true
    }

    pub fn fail(&mut self, agent: &str, source: &str, message: &str) {
        self.failures
            .entry(source.to_string())
            .or_default()
            .insert(agent.to_string(), message.to_string());
    }
}

// MARK: Journal

const JOURNAL_FILE: &str = "quota-readings.csv";
const JOURNAL_HEADER: [&str; 10] = [
    "observed_at",
    "observed_at_ms",
    "source",
    "agent",
    "window_minutes",
    "used_percent",
    "remaining_percent",
    "elapsed_percent",
    "resets_at",
    "api_equivalent_spent",
];

fn journal_path(dir: &Path) -> PathBuf {
    dir.join(JOURNAL_FILE)
}

fn iso(ms: f64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms as i64)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn number(value: f64) -> String {
    if value == value.round() && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        format!("{value:.4}")
    }
}

fn csv_line(fields: &[String]) -> String {
    let mut line = fields
        .iter()
        .map(|field| {
            if field.contains([',', '"', '\n', '\r']) {
                format!("\"{}\"", field.replace('"', "\"\""))
            } else {
                field.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    line.push('\n');
    line
}

fn journal_fields(reading: &QuotaReading, source: &str) -> Vec<String> {
    let window = reading.window;
    let resets_at = reading.observed_at
        + (100.0 - window.elapsed_percent) / 100.0 * window.window_minutes * 60_000.0;
    vec![
        iso(reading.observed_at),
        format!("{}", reading.observed_at as i64),
        source.to_string(),
        reading.agent.clone(),
        number(window.window_minutes),
        number(window.used_percent),
        number(100.0 - window.used_percent),
        number(window.elapsed_percent),
        iso(resets_at),
        number(window.api_equivalent_spent),
    ]
}

fn csv_parse(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                match chars.next() {
                    Some('"') => field.push('"'),
                    Some(',') => {
                        quoted = false;
                        fields.push(std::mem::take(&mut field));
                    }
                    Some(next) => {
                        quoted = false;
                        field.push(next);
                    }
                    None => quoted = false,
                }
            } else {
                field.push(c);
            }
        } else if c == '"' {
            quoted = true;
        } else if c == ',' {
            fields.push(std::mem::take(&mut field));
        } else {
            field.push(c);
        }
    }
    fields.push(field);
    fields
}

fn journal_append(dir: &Path, rows: &[(String, QuotaReading)]) -> std::io::Result<()> {
    storage::ensure_dir(dir)?;
    let path = journal_path(dir);
    let is_new = !path.exists();
    let mut text = String::new();
    if is_new {
        text.push_str(&csv_line(&JOURNAL_HEADER.map(String::from)));
    }
    for (source, reading) in rows {
        text.push_str(&csv_line(&journal_fields(reading, source)));
    }
    if text.is_empty() {
        return Ok(());
    }
    if is_new {
        return storage::write_atomic(&path, text.as_bytes());
    }
    let mut file = OpenOptions::new().append(true).open(&path)?;
    file.write_all(text.as_bytes())
}

fn journal_seed_if_missing(dir: &Path, history: &QuotaHistory) -> std::io::Result<()> {
    if journal_path(dir).exists() {
        return Ok(());
    }
    let mut rows: Vec<(String, QuotaReading)> = history
        .readings
        .iter()
        .flat_map(|(source, agents)| {
            agents
                .values()
                .flat_map(move |rows| rows.iter().map(move |r| (source.clone(), r.clone())))
        })
        .collect();
    rows.sort_by(|a, b| a.1.observed_at.total_cmp(&b.1.observed_at));
    journal_append(dir, &rows)
}

fn journal_load(dir: &Path) -> Option<QuotaHistory> {
    let text = fs::read_to_string(journal_path(dir)).ok()?;
    let mut rows: Vec<(String, QuotaReading)> = text
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let f = csv_parse(line);
            if f.len() < JOURNAL_HEADER.len() {
                return None;
            }
            let window = QuotaWindow {
                window_minutes: f[4].parse().ok()?,
                used_percent: f[5].parse().ok()?,
                elapsed_percent: f[7].parse().ok()?,
                api_equivalent_spent: f[9].parse().ok()?,
            };
            let reading =
                QuotaReading { agent: f[3].clone(), observed_at: f[1].parse().ok()?, window };
            window.is_valid().then(|| (f[2].clone(), reading))
        })
        .collect();
    if rows.is_empty() {
        return None;
    }
    rows.sort_by(|a, b| a.1.observed_at.total_cmp(&b.1.observed_at));
    let mut history = QuotaHistory::new();
    for (source, reading) in &rows {
        history.record(reading, source);
    }
    Some(history)
}

// MARK: Archive file

const ARCHIVE_FILE: &str = "quota-archive.json";

fn decode(data: &[u8]) -> Option<QuotaHistory> {
    serde_json::from_slice::<QuotaHistory>(data).ok().filter(|h| h.version == 1)
}

/// Archive, then its backup, then a rebuild from the append-only CSV journal.
pub fn load(dir: &Path) -> Result<Option<QuotaHistory>, String> {
    let path = dir.join(ARCHIVE_FILE);
    let backup = dir.join(format!("{ARCHIVE_FILE}.bak"));
    let mut failed = false;
    for candidate in [&path, &backup] {
        if candidate.exists() {
            match fs::read(candidate).ok().and_then(|data| decode(&data)) {
                Some(history) => return Ok(Some(history)),
                None => failed = true,
            }
        }
    }
    if let Some(rebuilt) = journal_load(dir) {
        return Ok(Some(rebuilt));
    }
    if failed {
        return Err("Quota archive is unreadable".into());
    }
    Ok(None)
}

pub fn save(dir: &Path, history: &QuotaHistory) -> std::io::Result<()> {
    storage::ensure_dir(dir)?;
    let path = dir.join(ARCHIVE_FILE);
    if let Ok(data) = fs::read(&path) {
        if decode(&data).is_some() {
            storage::write_atomic(&dir.join(format!("{ARCHIVE_FILE}.bak")), &data)?;
        }
    }
    let data = serde_json::to_vec(history).map_err(std::io::Error::other)?;
    storage::write_atomic(&path, &data)
}

/// Merges readings into the latest archive on disk so concurrent writers
/// (the app and the background collector) never drop each other's rows.
pub fn commit(
    dir: &Path,
    readings: &[QuotaReading],
    source: &str,
    failures: &HashMap<String, Option<String>>,
) -> std::io::Result<QuotaHistory> {
    let mut history = load(dir).ok().flatten().unwrap_or_else(QuotaHistory::new);
    let _ = journal_seed_if_missing(dir, &history);
    let accepted: Vec<(String, QuotaReading)> = readings
        .iter()
        .filter(|r| history.record(r, source))
        .map(|r| (source.to_string(), r.clone()))
        .collect();
    for (agent, message) in failures {
        match message {
            Some(message) => history.fail(agent, source, message),
            None => {
                if let Some(map) = history.failures.get_mut(source) {
                    map.remove(agent);
                }
            }
        }
    }
    let _ = journal_append(dir, &accepted);
    save(dir, &history)?;
    Ok(history)
}

pub fn archive_mtime(dir: &Path) -> Option<f64> {
    fs::metadata(dir.join(ARCHIVE_FILE))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
}

// MARK: Collector

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorConfig {
    pub custom_path: String,
    pub codex_homes: String,
}

impl CollectorConfig {
    pub fn source(&self) -> String {
        format!("{}|{}", self.custom_path, self.codex_homes)
    }
}

pub fn save_config(dir: &Path, config: &CollectorConfig) -> std::io::Result<()> {
    storage::ensure_dir(dir)?;
    let data = serde_json::to_vec(config).map_err(std::io::Error::other)?;
    storage::write_atomic(&dir.join("quota-collector.json"), &data)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectedHarness {
    agent: String,
    observed_at: f64,
    window: QuotaWindow,
    session_window: Option<QuotaWindow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectedCursor {
    agent: String,
    observed_at: f64,
    window: Option<QuotaWindow>,
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

fn collect_harness(
    config: &CollectorConfig,
    agent: &str,
    env: &HashMap<String, String>,
) -> Result<Vec<QuotaReading>, ()> {
    let exe = cli::executable(&config.custom_path).map_err(|_| ())?;
    let data = cli::run(
        &exe,
        &["harness".into(), agent.into()],
        false,
        env,
        Duration::from_secs(45),
    )
    .map_err(|_| ())?;
    let collected: CollectedHarness = serde_json::from_slice(&data).map_err(|_| ())?;
    let reading = QuotaReading {
        agent: agent.to_string(),
        observed_at: collected.observed_at,
        window: collected.window,
    };
    if collected.agent != agent
        || !reading.observed_at.is_finite()
        || !reading.window.is_valid()
        || (now_ms() - reading.observed_at).abs() > 90_000.0
    {
        return Err(());
    }
    let mut readings = vec![reading];
    if agent == "claude" {
        if let Some(session) = collected.session_window.filter(|w| w.is_valid()) {
            readings.push(QuotaReading {
                agent: CLAUDE_SESSION_AGENT.into(),
                observed_at: collected.observed_at,
                window: session,
            });
        }
    }
    Ok(readings)
}

fn collect_cursor(
    config: &CollectorConfig,
    env: &HashMap<String, String>,
) -> Result<Vec<QuotaReading>, ()> {
    let exe = cli::executable(&config.custom_path).map_err(|_| ())?;
    let data = cli::run(
        &exe,
        &["summary".into(), "--value".into()],
        false,
        env,
        Duration::from_secs(45),
    )
    .map_err(|_| ())?;
    let collected: CollectedCursor = serde_json::from_slice(&data).map_err(|_| ())?;
    if collected.agent != "cursor"
        || !collected.observed_at.is_finite()
        || (now_ms() - collected.observed_at).abs() > 90_000.0
    {
        return Err(());
    }
    Ok(match collected.window.filter(|w| w.is_valid()) {
        Some(window) => vec![QuotaReading {
            agent: "cursor".into(),
            observed_at: collected.observed_at,
            window,
        }],
        None => vec![],
    })
}

/// One bounded collection. `force` waits for a running collection instead of
/// skipping, and has the CLI bypass shared readings.
pub fn collect(dir: &Path, force: bool) -> Result<(), String> {
    let config: CollectorConfig = fs::read(dir.join("quota-collector.json"))
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .ok_or("Quota collector is not configured")?;
    storage::ensure_dir(dir).map_err(|e| e.to_string())?;
    let lock = File::options()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("quota-collector.lock"))
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(if force { 60 } else { 0 });
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(_) => {
                if Instant::now() >= deadline {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    let _ = load(dir);
    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("CODEX_HOME".into(), config.codex_homes.clone());
    env.insert("AGENT_BURN_QUOTA_ONLY".into(), "1".into());
    if force {
        env.insert("AGENT_BURN_FORCE_REFRESH".into(), "1".into());
    }
    let (tx, rx) = mpsc::channel::<(String, Vec<QuotaReading>, Option<String>)>();
    for agent in ["codex", "claude"] {
        let tx = tx.clone();
        let config = config.clone();
        let env = env.clone();
        std::thread::spawn(move || {
            let result = match collect_harness(&config, agent, &env) {
                Ok(readings) => (agent.to_string(), readings, None),
                Err(()) => (
                    agent.to_string(),
                    vec![],
                    Some("Live quota could not be collected. The last reading is preserved.".into()),
                ),
            };
            let _ = tx.send(result);
        });
    }
    {
        let tx = tx.clone();
        let config = config.clone();
        let env = env.clone();
        std::thread::spawn(move || {
            let result = match collect_cursor(&config, &env) {
                Ok(readings) => ("cursor".to_string(), readings, None),
                Err(()) => (
                    "cursor".to_string(),
                    vec![],
                    Some(
                        "Live Cursor credits could not be collected. The last reading is preserved."
                            .into(),
                    ),
                ),
            };
            let _ = tx.send(result);
        });
    }
    drop(tx);
    let source = config.source();
    let mut save_error = None;
    for (agent, readings, error) in rx {
        let mut failures = HashMap::new();
        if error.is_some() || readings.is_empty() {
            failures.insert(agent, error);
        }
        // Persist each provider immediately, even if another hangs.
        if let Err(e) = commit(dir, &readings, &source, &failures) {
            save_error = Some(e.to_string());
        }
    }
    let _ = lock.unlock();
    match save_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}
