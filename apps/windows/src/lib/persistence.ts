// Ports MetricsArchive.swift, ReportCache.swift, UsageJournal.swift and
// ClaudeAccountFile.swift onto the `%APPDATA%\Agent Burn` data files.
import { dataRead, dataWrite, loadWithBackup, saveWithBackup } from "./native";
import {
  periodArguments,
  periodDateBounds,
  type AgentUsage,
  type ClaudeAccount,
  type DailyUsage,
  type HarnessReport,
  type SummaryReport,
  type UsagePeriod,
} from "./usage";

// MARK: Metrics archive

export type MetricsIngestPolicy = "replaceReportedDays" | "fillMissingDays";

export function metricsIngestPolicy(cacheKey: string): MetricsIngestPolicy {
  const period = cacheKey.split(":")[0] ?? cacheKey;
  return period === "all" ? "replaceReportedDays" : "fillMissingDays";
}

/** Sort comparator matching `metricsIngestOrder`. Dates are ms. */
export function metricsIngestOrder(lhs: [string, number], rhs: [string, number]) {
  const left = metricsIngestPolicy(lhs[0]);
  const right = metricsIngestPolicy(rhs[0]);
  if (left !== right) return left === "replaceReportedDays" ? -1 : 1;
  if (left === "replaceReportedDays") return lhs[1] - rhs[1];
  return lhs[0] < rhs[0] ? -1 : lhs[0] > rhs[0] ? 1 : 0;
}

export interface MetricsArchiveData {
  version: number;
  agents: Record<string, Record<string, DailyUsage>>;
  savedAt?: number | null;
}

export class MetricsArchive {
  constructor(
    public data: MetricsArchiveData = { version: 1, agents: {} },
  ) {}

  get isEmpty() {
    return Object.keys(this.data.agents).length === 0;
  }

  ingest(report: SummaryReport, policy: MetricsIngestPolicy = "replaceReportedDays") {
    for (const agent of report.agents) {
      for (const day of agent.daily ?? []) {
        if (!Number.isFinite(day.cost) || day.cost < 0) continue;
        const days = (this.data.agents[agent.agent] ??= {});
        const old = days[day.date];
        if (old && policy === "fillMissingDays") continue;
        days[day.date] = {
          date: day.date,
          cost: day.cost,
          tokens: day.tokens ?? old?.tokens ?? null,
          cursorModelsCost: day.cursorModelsCost ?? old?.cursorModelsCost ?? null,
          cursorModelsTokens: day.cursorModelsTokens ?? old?.cursorModelsTokens ?? null,
        };
      }
    }
  }

  report(
    period: UsagePeriod,
    live: SummaryReport | null | undefined,
    now = new Date(),
    resetStart?: Date | null,
  ): SummaryReport {
    const [lower, upper] = periodDateBounds(period, now, resetStart);
    const usages: AgentUsage[] = [];
    for (const name of Object.keys(this.data.agents).sort()) {
      const days = Object.values(this.data.agents[name] ?? {})
        .filter((d) => (lower == null || d.date >= lower) && d.date <= upper)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      if (days.length === 0) continue;
      const current = live?.agents.find((a) => a.agent === name);
      usages.push({
        agent: name,
        totalCost: days.reduce((s, d) => s + d.cost, 0),
        totalTokens: days.reduce((s, d) => s + (d.tokens ?? 0), 0),
        models: current?.models ?? null,
        daily: days,
        tokenBreakdown: current?.tokenBreakdown ?? null,
      });
    }
    const grouped = new Map<string, DailyUsage[]>();
    for (const day of usages.flatMap((u) => u.daily ?? [])) {
      const bucket = grouped.get(day.date) ?? [];
      bucket.push(day);
      grouped.set(day.date, bucket);
    }
    const daily = [...grouped.keys()].sort().map((date) => {
      const bucket = grouped.get(date)!;
      const cursorCosts = bucket.map((d) => d.cursorModelsCost).filter((v): v is number => v != null);
      const cursorTokens = bucket
        .map((d) => d.cursorModelsTokens)
        .filter((v): v is number => v != null);
      return {
        date,
        cost: bucket.reduce((s, d) => s + d.cost, 0),
        tokens: bucket.reduce((s, d) => s + (d.tokens ?? 0), 0),
        cursorModelsCost: cursorCosts.length === 0 ? null : cursorCosts.reduce((a, b) => a + b, 0),
        cursorModelsTokens:
          cursorTokens.length === 0 ? null : cursorTokens.reduce((a, b) => a + b, 0),
      };
    });
    return {
      totals: {
        totalCost: usages.reduce((s, u) => s + u.totalCost, 0),
        totalTokens: usages.reduce((s, u) => s + u.totalTokens, 0),
      },
      agents: usages,
      models: live?.models ?? [],
      daily,
      subscription: live?.subscription ?? null,
      cursorAccount: live?.cursorAccount ?? null,
      claudeAccount: live?.claudeAccount ?? null,
    };
  }
}

const METRICS_FILE = "metrics-history.json";

function decodeMetrics(text: string): MetricsArchiveData {
  const data = JSON.parse(text) as MetricsArchiveData;
  if (!data || data.version !== 1 || typeof data.agents !== "object") {
    throw new Error("Metrics history is corrupt");
  }
  return data;
}

export async function loadMetricsArchive(): Promise<MetricsArchive | null> {
  const data = await loadWithBackup(METRICS_FILE, decodeMetrics);
  return data ? new MetricsArchive(data) : null;
}

export async function saveMetricsArchive(archive: MetricsArchive) {
  const saved = { ...archive.data, savedAt: Date.now() };
  await saveWithBackup(METRICS_FILE, JSON.stringify(saved), decodeMetrics);
}

// MARK: Report cache

export interface SummaryQuery {
  period: UsagePeriod;
  agent: string | null;
}

export const queryCacheKey = (q: SummaryQuery) => q.period + (q.agent ? ":" + q.agent : "");
export const queryArguments = (q: SummaryQuery) => [
  ...periodArguments(q.period),
  ...(q.agent ? ["--agents", q.agent] : []),
];

export interface CachedReport<T> {
  report: T;
  /** ms epoch */
  date: number;
}

export interface ReportCache {
  source: string;
  summaries: Record<string, CachedReport<SummaryReport>>;
  harnesses: Record<string, CachedReport<HarnessReport>>;
}

export function cacheAgentNames(cache: ReportCache) {
  return [
    ...new Set(Object.values(cache.summaries).flatMap((s) => s.report.agents.map((a) => a.agent))),
  ].sort();
}

const CACHE_FILE = "report-cache.json";
const JOURNAL_FILE = "usage-journal.json";

function decodeCache(text: string): ReportCache {
  const cache = JSON.parse(text) as ReportCache;
  if (!cache || typeof cache.source !== "string" || typeof cache.summaries !== "object") {
    throw new Error("Report cache is corrupt");
  }
  cache.harnesses ??= {};
  return cache;
}

interface UsageSnapshot {
  date: number;
  source: string;
  /** JSON-encoded SummaryReport with sorted keys. */
  payload: string;
}

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

async function journalRecords(): Promise<UsageSnapshot[]> {
  const text = await dataRead(JOURNAL_FILE);
  if (text == null) return [];
  const records = JSON.parse(text);
  if (!Array.isArray(records)) throw new Error("Usage journal is corrupt");
  return records as UsageSnapshot[];
}

async function journalRecord(cache: ReportCache) {
  const saved =
    cache.summaries["all"] ??
    Object.values(cache.summaries).reduce<CachedReport<SummaryReport> | undefined>(
      (best, next) => (!best || next.date > best.date ? next : best),
      undefined,
    );
  if (!saved) return;
  const snapshot: UsageSnapshot = {
    date: saved.date,
    source: cache.source,
    payload: sortedJson(saved.report),
  };
  let snapshots: UsageSnapshot[] = [];
  try {
    snapshots = await journalRecords();
  } catch {
    snapshots = [];
  }
  const last = snapshots[snapshots.length - 1];
  if (last && last.source === snapshot.source && last.payload === snapshot.payload) return;
  snapshots.push(snapshot);
  await dataWrite(JOURNAL_FILE, JSON.stringify(snapshots));
}

async function journalLatest(source: string): Promise<ReportCache | null> {
  const records = await journalRecords();
  for (let i = records.length - 1; i >= 0; i--) {
    const snapshot = records[i]!;
    if (snapshot.source !== source) continue;
    const report = JSON.parse(snapshot.payload) as SummaryReport;
    return {
      source,
      summaries: { all: { report, date: snapshot.date } },
      harnesses: {},
    };
  }
  return null;
}

export async function loadReportCache(source: string): Promise<ReportCache | null> {
  let cache: ReportCache | null = null;
  try {
    cache = await loadWithBackup(CACHE_FILE, decodeCache);
  } catch {
    cache = null;
  }
  if (cache && cache.source === source) return cache;
  return journalLatest(source);
}

export async function saveReportCache(cache: ReportCache) {
  await saveWithBackup(CACHE_FILE, JSON.stringify(cache), decodeCache);
  await journalRecord(cache);
}

// MARK: Claude account

const CLAUDE_FILE = "claude-account.json";

function decodeClaude(text: string): ClaudeAccount {
  const account = JSON.parse(text) as ClaudeAccount;
  if (!account || typeof account !== "object") throw new Error("Claude account is corrupt");
  account.scoped ??= [];
  return account;
}

export async function loadClaudeAccount(): Promise<ClaudeAccount | null> {
  for (const name of [CLAUDE_FILE, `${CLAUDE_FILE}.bak`]) {
    try {
      const text = await dataRead(name);
      if (text != null) return decodeClaude(text);
    } catch {
      // Fall through to the backup.
    }
  }
  return null;
}

export async function saveClaudeAccount(account: ClaudeAccount) {
  await saveWithBackup(CLAUDE_FILE, JSON.stringify(account), decodeClaude);
}

/** The account Anthropic reported most recently; ties keep the earlier candidate. */
export function latestClaudeAccount(accounts: (ClaudeAccount | null | undefined)[]) {
  let best: ClaudeAccount | null = null;
  for (const next of accounts) {
    if (!next) continue;
    if (!best || (next.observedAtMs ?? 0) > (best.observedAtMs ?? 0)) best = next;
  }
  return best;
}

// MARK: Legacy quota history (`{agent: [QuotaSample]}` with ms dates)

export async function loadLegacyQuotaHistory(): Promise<
  Record<string, { date: number; remaining: number }[]>
> {
  try {
    const text = await dataRead("quota-history.json");
    if (text == null) return {};
    const data = JSON.parse(text);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

// MARK: Preferences (UserDefaults twin)

export interface Preferences {
  /** UserDefaults `cliPath`. */
  customPath: string;
  /** Empty until first launch fills in `~/.codex` plus `CODEX_HOME`. */
  codexHomes: string;
  offline: boolean;
  refreshMinutes: number;
  backgroundQuotas: boolean;
  menuBarOnly: boolean;
  quotaSource: string;
  quotaChartRange: string;
  automaticallyCheckForUpdates: boolean;
  [key: string]: unknown;
}

export const defaultPreferences: Preferences = {
  customPath: "",
  codexHomes: "",
  offline: false,
  refreshMinutes: 1,
  backgroundQuotas: true,
  menuBarOnly: false,
  quotaSource: "codex",
  quotaChartRange: "rte",
  automaticallyCheckForUpdates: true,
};

export async function loadPreferences(): Promise<Preferences> {
  try {
    const text = await dataRead("preferences.json");
    if (text == null) return { ...defaultPreferences };
    return { ...defaultPreferences, ...JSON.parse(text) };
  } catch {
    return { ...defaultPreferences };
  }
}

export async function savePreferences(prefs: Preferences) {
  await dataWrite("preferences.json", JSON.stringify(prefs, null, 2));
}
