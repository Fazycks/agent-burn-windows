// Port of UsageStore.swift + QuotaFreshness.swift.
//
// macOS shares one `@Observable` store between the dashboard, the menu bar
// popover and Settings. Here every window is its own webview, so the main
// window is the *leader*: it owns the CLI, the caches and the collection loop
// and broadcasts a `store:state` snapshot. The popover and Settings are
// *followers*: they mirror that snapshot, read the large quota/metrics archives
// from disk themselves, and forward user actions back as `store:action`.
import { emit, listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import * as native from "../lib/native";
import {
  defaultPreferences,
  latestClaudeAccount,
  loadClaudeAccount,
  loadLegacyQuotaHistory,
  loadMetricsArchive,
  loadPreferences,
  loadReportCache,
  MetricsArchive,
  metricsIngestOrder,
  metricsIngestPolicy,
  queryArguments,
  queryCacheKey,
  saveClaudeAccount,
  saveMetricsArchive,
  savePreferences,
  saveReportCache,
  cacheAgentNames,
  type CachedReport,
  type Preferences,
  type ReportCache,
  type SummaryQuery,
} from "../lib/persistence";
import { QuotaHistory } from "../lib/quotaHistory";
import {
  activityChartDomain,
  claudeSessionReading,
  claudeWeeklyReading,
  cursorHasPromotionalCredits,
  cursorMeterForecast,
  cursorQuotaReading,
  Forecast,
  isToday,
  menuBarQuotaText,
  quotaBlendRates,
  quotaChartSamples,
  remainingQuota,
  windowIsValid,
  type AgentUsage,
  type ClaudeAccount,
  type DailyUsage,
  type HarnessReport,
  type QuotaBlendRates,
  type QuotaChartRange,
  type QuotaReading,
  type QuotaReset,
  type QuotaSample,
  type QuotaSource,
  type Range,
  type SummaryReport,
  type UsagePeriod,
} from "../lib/usage";

export type Role = "leader" | "follower";

export type StoreAction =
  | { type: "refreshAll"; hard?: boolean }
  | { type: "refresh" }
  | { type: "setPeriod"; period: UsagePeriod }
  | { type: "setSelection"; selection: string }
  | { type: "setPrefs"; patch: Partial<Preferences> }
  | { type: "setCursorQuotaChartRange"; range: QuotaChartRange }
  | { type: "reconfigure" }
  | { type: "setBackground"; enabled: boolean };

interface Snapshot {
  summary?: SummaryReport | null;
  summaryRev: number;
  reports: Record<string, HarnessReport>;
  updated: Record<string, number>;
  errors: Record<string, string>;
  period: UsagePeriod;
  selection: string;
  prefs: Preferences;
  cursorQuotaChartRange: QuotaChartRange;
  quotaCheckDate: number;
  isLoading: boolean;
  isCheckingQuotas: boolean;
  hasPeriodDetails: boolean;
  knownAgents: string[];
  recoveredCursor: AgentUsage | null;
  archiveSavedAt: number | null;
  quotaFileMtime: number | null;
  backgroundStatus: native.BackgroundStatus;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : String(error);

export class UsageStore {
  // Observable state shared by every window.
  summary: SummaryReport | null = null;
  reports: Record<string, HarnessReport> = {};
  /** ms epoch per key: `summary` or an agent. */
  updated: Record<string, number> = {};
  errors: Record<string, string> = {};
  period: UsagePeriod = "all";
  selection = "summary";
  prefs: Preferences = { ...defaultPreferences };
  cursorQuotaChartRange: QuotaChartRange = "rtd";
  quotaCheckDate = Date.now();
  isLoading = false;
  isCheckingQuotas = false;
  hasPeriodDetails = false;
  knownAgents: string[] = [];
  recoveredCursor: AgentUsage | null = null;
  backgroundStatus: native.BackgroundStatus = "notRegistered";
  ready = false;

  private quotaHistory = new QuotaHistory();
  private legacyHistory: Record<string, QuotaSample[]> = {};
  private archive = new MetricsArchive();
  private archiveSavedAt: number | null = null;
  private quotaFileMtime: number | null = null;

  // Leader-only state.
  private cache: ReportCache | null = null;
  private storedClaudeAccount: ClaudeAccount | null = null;
  private archiveWritable = true;
  private summaryErrors: Record<string, string> = {};
  private isRefreshing = false;
  private summaryTask: Promise<void> | null = null;
  private pendingSummary: { query: SummaryQuery; force: boolean } | null = null;
  private pendingHistory: SummaryQuery | null = null;
  private configuredQuotaSource: string | null = null;
  private collectedQuotaSource: string | null = null;
  private quotaCollectionDate = 0;
  private pendingForcedCollection = false;
  private started = false;
  private summaryRev = 0;
  private emittedSummaryRev = -1;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTrayText = "";

  // Subscription plumbing.
  version = 0;
  private listeners = new Set<() => void>();
  private notifyQueued = false;

  constructor(readonly role: Role) {}

  // MARK: Derived preferences

  get customPath() {
    return this.prefs.customPath;
  }
  get codexHomes() {
    return this.prefs.codexHomes;
  }
  get offline() {
    return this.prefs.offline;
  }
  get refreshMinutes() {
    return Math.max(1, Math.trunc(Number(this.prefs.refreshMinutes) || 1));
  }
  get quotaSource(): QuotaSource {
    const value = this.prefs.quotaSource;
    return value === "claude" || value === "cursor" ? value : "codex";
  }
  get quotaChartRange(): QuotaChartRange {
    const value = this.prefs.quotaChartRange as QuotaChartRange;
    return ["rte", "rtd", "today", "week", "month"].includes(value) ? value : "rte";
  }
  get backgroundQuotas() {
    return this.prefs.backgroundQuotas !== false;
  }
  private get quotaSourceKey() {
    return this.prefs.customPath + "|" + this.prefs.codexHomes;
  }
  private get sourceKey() {
    return this.prefs.customPath + "|" + this.prefs.codexHomes + "|" + String(this.prefs.offline);
  }
  private get currentQuery(): SummaryQuery {
    return {
      period: this.period === "rtd" ? "all" : this.period,
      agent: this.selection === "summary" ? null : this.selection,
    };
  }

  // MARK: Subscription

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  private changed() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      if (this.role === "leader") this.syncDerived();
      this.version++;
      for (const listener of this.listeners) listener();
      if (this.role === "leader") void this.broadcast();
    });
  }

  // MARK: Boot

  async init() {
    this.legacyHistory = Object.fromEntries(
      Object.entries(await loadLegacyQuotaHistory()).map(([agent, samples]) => [
        agent,
        (Array.isArray(samples) ? samples : []).map((s) => ({
          date: new Date(s.date),
          remaining: s.remaining,
        })),
      ]),
    );
    if (this.role === "leader") await this.initLeader();
    else await this.initFollower();
    this.ready = true;
    this.changed();
  }

  private async initLeader() {
    this.prefs = await loadPreferences();
    if (!this.prefs.codexHomes) {
      try {
        this.prefs.codexHomes = await native.defaultCodexHomes();
      } catch {
        this.prefs.codexHomes = "";
      }
      void savePreferences(this.prefs).catch(() => {});
    }
    try {
      const decoded = await loadReportCache(this.sourceKey);
      if (decoded) {
        this.cache = decoded;
        const saved = decoded.summaries[this.period] ?? decoded.summaries["all"];
        this.summary = saved?.report ?? null;
        if (saved) this.updated["summary"] = saved.date;
        for (const [agent, cached] of Object.entries(decoded.harnesses)) {
          this.reports[agent] = cached.report;
          this.updated[agent] = cached.date;
        }
      }
    } catch {
      this.cache = null;
    }
    this.storedClaudeAccount = await loadClaudeAccount();
    await this.rememberClaudeAccount(
      latestClaudeAccount(Object.values(this.cache?.summaries ?? {}).map((s) => s.report.claudeAccount)),
    );
    try {
      this.archive = (await loadMetricsArchive()) ?? new MetricsArchive();
      const entries = Object.entries(this.cache?.summaries ?? {}).sort((lhs, rhs) =>
        metricsIngestOrder([lhs[0], lhs[1].date], [rhs[0], rhs[1].date]),
      );
      for (const [key, saved] of entries) {
        this.archive.ingest(saved.report, metricsIngestPolicy(key));
      }
      if (!this.archive.isEmpty) {
        await saveMetricsArchive(this.archive);
        this.archiveSavedAt = Date.now();
      }
    } catch {
      this.archiveWritable = false;
      this.errors["archive"] =
        "Metrics history could not be read or saved. Existing files have been preserved.";
    }
    await this.reloadQuotas();
    this.publishSummary();

    await listen<StoreAction>("store:action", (event) => void this.perform(event.payload));
    await listen("store:hello", () => {
      this.emittedSummaryRev = -1;
      void this.broadcast();
    });
  }

  private async initFollower() {
    this.prefs = await loadPreferences();
    try {
      this.archive = (await loadMetricsArchive()) ?? new MetricsArchive();
    } catch {
      this.archive = new MetricsArchive();
    }
    await this.reloadQuotas();
    await listen<Snapshot>("store:state", (event) => void this.apply(event.payload));
    await emit("store:hello");
  }

  private async apply(snapshot: Snapshot) {
    if (snapshot.summary !== undefined) this.summary = snapshot.summary;
    this.reports = snapshot.reports;
    this.updated = snapshot.updated;
    this.errors = snapshot.errors;
    this.period = snapshot.period;
    this.selection = snapshot.selection;
    this.prefs = snapshot.prefs;
    this.cursorQuotaChartRange = snapshot.cursorQuotaChartRange;
    this.quotaCheckDate = snapshot.quotaCheckDate;
    this.isLoading = snapshot.isLoading;
    this.isCheckingQuotas = snapshot.isCheckingQuotas;
    this.hasPeriodDetails = snapshot.hasPeriodDetails;
    this.knownAgents = snapshot.knownAgents;
    this.recoveredCursor = snapshot.recoveredCursor;
    this.backgroundStatus = snapshot.backgroundStatus;
    if (snapshot.archiveSavedAt !== this.archiveSavedAt) {
      this.archiveSavedAt = snapshot.archiveSavedAt;
      try {
        this.archive = (await loadMetricsArchive()) ?? new MetricsArchive();
      } catch {
        // Keep the previous copy.
      }
    }
    if (snapshot.quotaFileMtime !== this.quotaFileMtime) await this.reloadQuotas();
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private async broadcast() {
    const includeSummary = this.emittedSummaryRev !== this.summaryRev;
    this.emittedSummaryRev = this.summaryRev;
    const snapshot: Snapshot = {
      ...(includeSummary ? { summary: this.summary } : {}),
      summaryRev: this.summaryRev,
      reports: this.reports,
      updated: this.updated,
      errors: this.errors,
      period: this.period,
      selection: this.selection,
      prefs: this.prefs,
      cursorQuotaChartRange: this.cursorQuotaChartRange,
      quotaCheckDate: this.quotaCheckDate,
      isLoading: this.isLoading,
      isCheckingQuotas: this.isCheckingQuotas,
      hasPeriodDetails: this.hasPeriodDetails,
      knownAgents: this.knownAgents,
      recoveredCursor: this.recoveredCursor,
      archiveSavedAt: this.archiveSavedAt,
      quotaFileMtime: this.quotaFileMtime,
      backgroundStatus: this.backgroundStatus,
    };
    try {
      await emit("store:state", snapshot);
    } catch {
      // Followers resync with `store:hello`.
    }
    const text = menuBarQuotaText(this.remainingPercent, this.quotaIsStale(new Date(this.quotaCheckDate)));
    if (text !== this.lastTrayText) {
      this.lastTrayText = text;
      void native.setTrayStatus(text).catch(() => {});
    }
  }

  private syncDerived() {
    this.isLoading = this.isRefreshing || this.summaryTask != null;
    this.hasPeriodDetails = this.savedSummary(this.currentQuery) != null;
    this.recoveredCursor =
      this.cache?.summaries["cursor-recovered"]?.report.agents.find((a) => a.agent === "cursor") ??
      null;
    this.knownAgents = [
      ...new Set([
        ...(this.summary?.agents.map((a) => a.agent) ?? []),
        ...(this.cache ? cacheAgentNames(this.cache) : []),
        ...Object.keys(this.archive.data.agents),
      ]),
    ].sort();
  }

  // MARK: Actions (any window)

  /** Runs on the leader; followers forward to it. */
  dispatch(action: StoreAction): Promise<void> {
    if (this.role === "leader") return this.perform(action);
    this.applyOptimistic(action);
    return emit("store:action", action);
  }

  private applyOptimistic(action: StoreAction) {
    switch (action.type) {
      case "setPeriod":
        this.period = action.period;
        break;
      case "setSelection":
        this.selection = action.selection;
        break;
      case "setPrefs":
        this.prefs = { ...this.prefs, ...action.patch };
        break;
      case "setCursorQuotaChartRange":
        this.cursorQuotaChartRange = action.range;
        break;
      default:
        return;
    }
    this.version++;
    for (const listener of this.listeners) listener();
  }

  refreshAll(hard = false) {
    return this.dispatch({ type: "refreshAll", hard });
  }
  setPeriod(period: UsagePeriod) {
    return this.dispatch({ type: "setPeriod", period });
  }
  setSelection(selection: string) {
    return this.dispatch({ type: "setSelection", selection });
  }
  setPrefs(patch: Partial<Preferences>) {
    return this.dispatch({ type: "setPrefs", patch });
  }
  setQuotaSource(source: QuotaSource) {
    return this.setPrefs({ quotaSource: source });
  }
  setChartRange(agent: string, range: QuotaChartRange) {
    if (agent === "cursor") return this.dispatch({ type: "setCursorQuotaChartRange", range });
    return this.setPrefs({ quotaChartRange: range });
  }

  private async perform(action: StoreAction): Promise<void> {
    switch (action.type) {
      case "refreshAll":
        return this.leaderRefreshAll(action.hard ?? false);
      case "refresh":
        return this.refresh();
      case "setPeriod":
        if (this.period === action.period) return;
        this.period = action.period;
        return this.changePeriod();
      case "setSelection":
        if (this.selection === action.selection) return;
        this.selection = action.selection;
        return this.changePeriod();
      case "setCursorQuotaChartRange":
        this.cursorQuotaChartRange = action.range;
        this.changed();
        return;
      case "setPrefs": {
        const before = this.prefs;
        this.prefs = { ...this.prefs, ...action.patch };
        try {
          await savePreferences(this.prefs);
        } catch {
          // Preferences are best effort, like UserDefaults.
        }
        if (before.refreshMinutes !== this.prefs.refreshMinutes) this.scheduleRefresh();
        if (before.backgroundQuotas !== this.prefs.backgroundQuotas) {
          await this.setBackground(this.backgroundQuotas);
        }
        this.changed();
        return;
      }
      case "reconfigure":
        this.configureQuotaCollector();
        return;
      case "setBackground":
        // Like the Swift toggle: always (re)register, even when the pref is unchanged.
        if (this.prefs.backgroundQuotas !== action.enabled) {
          this.prefs = { ...this.prefs, backgroundQuotas: action.enabled };
          await savePreferences(this.prefs).catch(() => {});
        }
        await this.setBackground(action.enabled);
        return;
    }
  }

  // MARK: Leader lifecycle

  async start() {
    if (this.role !== "leader" || this.started) return;
    this.started = true;
    await this.configureQuotaCollector();
    if (this.backgroundQuotas) {
      try {
        this.backgroundStatus = await native.backgroundStatus();
        if (this.backgroundStatus !== "enabled") {
          this.backgroundStatus = await native.backgroundSet(true);
        }
      } catch {
        this.errors["quotaService"] =
          "Background collection could not start. Enable it in Settings → Background quota history.";
      }
    }
    void this.watchQuotas();
    void this.refreshReports();
  }

  /** Mirrors the Settings toggle: registers or removes the scheduled task. */
  async setBackground(enabled: boolean) {
    try {
      this.backgroundStatus = await native.backgroundSet(enabled);
      delete this.errors["backgroundToggle"];
    } catch (error) {
      this.errors["backgroundToggle"] = `Could not change background collection: ${message(error)}`;
      try {
        this.backgroundStatus = await native.backgroundStatus();
      } catch {
        // Keep the last status.
      }
    }
    this.changed();
  }

  private async configureQuotaCollector() {
    if (this.configuredQuotaSource === this.quotaSourceKey) return;
    try {
      await native.quotaConfigSave(this.customPath, this.codexHomes);
      this.configuredQuotaSource = this.quotaSourceKey;
      delete this.errors["quotaConfig"];
    } catch {
      this.errors["quotaConfig"] = "Background quota settings could not be saved.";
    }
    this.changed();
  }

  async reloadQuotas() {
    try {
      const loaded = await native.quotaLoad(this.quotaFileMtime);
      if (loaded == null) return;
      if (loaded.history) this.quotaHistory = new QuotaHistory(loaded.history);
      this.quotaFileMtime = loaded.mtime;
      delete this.errors["quotaHistory"];
    } catch {
      this.errors["quotaHistory"] =
        "Quota history could not be read. The last available readings are preserved.";
    }
    if (this.role === "leader") this.changed();
  }

  private async watchQuotas() {
    for (;;) {
      this.quotaCheckDate = Date.now();
      await this.configureQuotaCollector();
      await this.reloadQuotas();
      try {
        this.backgroundStatus = await native.backgroundStatus();
      } catch {
        this.backgroundStatus = "notRegistered";
      }
      if (this.backgroundStatus === "enabled" || !this.backgroundQuotas) {
        delete this.errors["quotaService"];
      } else {
        this.errors["quotaService"] =
          "Background collection is unavailable. Enable it in Settings to continue collecting after quitting.";
      }
      this.changed();
      await this.refreshQuotasIfNeeded(this.backgroundStatus === "enabled");
      await sleep(5000);
    }
  }

  async refreshQuotasIfNeeded(backgroundAvailable: boolean, now = Date.now()) {
    await this.reloadQuotas();
    const sourceChanged = this.collectedQuotaSource !== this.quotaSourceKey;
    const retryDue = now - this.quotaCollectionDate >= 60_000;
    // Registration is not evidence of successful collection: the scheduled task
    // can stay enabled after a launch failure. Recover before readings go stale.
    const agents = ["codex", "claude"];
    if (cursorHasPromotionalCredits(this.summary?.cursorAccount)) agents.push("cursor");
    const overdue = agents.some((agent) => {
      const reading = this.quotaHistory.latest(agent, this.quotaSourceKey);
      if (!reading) return true;
      return now - reading.observedAt >= 60_000 || this.quotaError(agent) != null;
    });
    if (sourceChanged || (retryDue && (!backgroundAvailable || overdue))) {
      await this.collectQuotasNow();
    }
  }

  /** `force` is a hard refresh; one requested mid-collection runs right after. */
  async collectQuotasNow(force = false) {
    if (this.isCheckingQuotas) {
      if (force) this.pendingForcedCollection = true;
      return;
    }
    this.isCheckingQuotas = true;
    this.changed();
    try {
      let pass = force;
      do {
        this.pendingForcedCollection = false;
        await this.configureQuotaCollector();
        this.collectedQuotaSource = this.quotaSourceKey;
        this.quotaCollectionDate = Date.now();
        try {
          await native.quotaCollect(pass);
          delete this.errors["quotaCollector"];
        } catch {
          this.errors["quotaCollector"] =
            "Quota collection could not save its readings. Existing history is preserved.";
        }
        await this.reloadQuotas();
        this.quotaCheckDate = Date.now();
        pass = this.pendingForcedCollection;
      } while (pass);
    } finally {
      this.isCheckingQuotas = false;
      this.changed();
    }
  }

  private async refreshReports() {
    await this.refresh();
    this.scheduleRefresh();
  }

  private scheduleRefresh() {
    if (!this.started) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      await this.refresh();
      this.scheduleRefresh();
    }, this.refreshMinutes * 60_000);
  }

  quotaError(agent: string): string | null {
    return (
      this.errors["quotaHistory"] ??
      this.errors["quotaConfig"] ??
      this.errors["quotaCollector"] ??
      this.quotaHistory.failure(agent, this.quotaSourceKey) ??
      null
    );
  }

  private async leaderRefreshAll(hard: boolean) {
    await Promise.all([this.collectQuotasNow(hard), this.refresh()]);
  }

  async refresh(): Promise<void> {
    if (this.role !== "leader") return this.dispatch({ type: "refresh" });
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    this.changed();
    try {
      this.queueSummary(true, true);
      const summaries = this.summaryTask;
      const selectedAgent = this.currentQuery.agent;
      // Quota collection is independent; these reports provide spend details.
      await Promise.all(
        ["codex", "claude"]
          .filter((agent) => selectedAgent == null || selectedAgent === agent)
          .map((agent) => this.loadHarness(agent)),
      );
      await summaries;
    } finally {
      this.isRefreshing = false;
      this.changed();
    }
  }

  private savedSummary(query: SummaryQuery): CachedReport<SummaryReport> | null {
    if (this.cache?.source !== this.sourceKey) return null;
    // An all-harness report can satisfy a focused request, never the reverse.
    const candidates = [this.cache.summaries[queryCacheKey(query)], this.cache.summaries[query.period]]
      .filter((c): c is CachedReport<SummaryReport> => c != null);
    return candidates.reduce<CachedReport<SummaryReport> | null>(
      (best, next) => (!best || next.date > best.date ? next : best),
      null,
    );
  }

  private isFresh(query: SummaryQuery, intervalSeconds?: number) {
    const saved = this.savedSummary(query);
    if (!saved) return false;
    return (
      isToday(new Date(saved.date)) &&
      Date.now() - saved.date < (intervalSeconds ?? this.refreshMinutes * 60) * 1000
    );
  }

  private publishSummary() {
    const saved = this.savedSummary(this.currentQuery);
    const base = this.archive.isEmpty
      ? saved?.report ?? null
      : this.archive.report(this.period, saved?.report, new Date(), this.resetStartDate);
    const summary: SummaryReport | null = base ? { ...base } : null;
    const cached = Object.values(this.cache?.summaries ?? {}).sort((a, b) => b.date - a.date);
    if (summary) {
      // Account allowance is independent of the selected historical date range.
      summary.cursorAccount = cached.map((c) => c.report.cursorAccount).find((a) => a != null) ?? null;
      const claudeReports = cached
        .map((c) => c.report)
        .filter((r) => r.claudeAccount != null || r.claudeAccountStatus != null);
      summary.claudeAccount = latestClaudeAccount([
        ...claudeReports.map((r) => r.claudeAccount),
        this.storedClaudeAccount,
      ]);
      summary.claudeAccountStatus = claudeReports[0]?.claudeAccountStatus ?? null;
    }
    this.summary = summary;
    this.summaryRev++;
    if (saved) this.updated["summary"] = saved.date;
    else delete this.updated["summary"];
    const error = this.summaryErrors[queryCacheKey(this.currentQuery)];
    if (error) this.errors["summary"] = error;
    else delete this.errors["summary"];
    this.changed();
  }

  private queueSummary(force = false, includeHistory = false) {
    if (this.cache?.source !== this.sourceKey) {
      this.cache = { source: this.sourceKey, summaries: {}, harnesses: {} };
      this.reports = {};
      this.updated = {};
      this.summaryErrors = {};
      this.publishSummary();
    }
    const query = this.currentQuery;
    this.pendingSummary = force || !this.isFresh(query) ? { query, force } : null;
    if (this.pendingHistory?.agent !== query.agent) this.pendingHistory = null;
    if (includeHistory && query.period !== "all") {
      const history: SummaryQuery = { period: "all", agent: query.agent };
      // Historic days need a daily backfill, not a rescan on every picker change.
      if (!this.isFresh(history, 86_400)) this.pendingHistory = history;
    }
    if (this.summaryTask || (this.pendingSummary == null && this.pendingHistory == null)) return;
    this.summaryTask = (async () => {
      try {
        while (this.pendingSummary != null || this.pendingHistory != null) {
          // Coalesce quick selections before starting another expensive process.
          await sleep(200);
          const pending = this.pendingSummary;
          if (pending) {
            this.pendingSummary = null;
            if (pending.force || !this.isFresh(pending.query)) await this.loadSummary(pending.query);
          } else if (this.pendingHistory) {
            const history = this.pendingHistory;
            this.pendingHistory = null;
            if (!this.isFresh(history, 86_400)) await this.loadSummary(history);
          }
        }
      } finally {
        this.summaryTask = null;
        this.changed();
      }
    })();
    this.changed();
  }

  private cliEnv() {
    return { CODEX_HOME: this.codexHomes };
  }

  private async loadSummary(query: SummaryQuery) {
    const source = this.sourceKey;
    const key = queryCacheKey(query);
    try {
      const text = await native.runCli(queryArguments(query), {
        env: this.cliEnv(),
        offline: this.offline,
        customPath: this.customPath,
      });
      const report = parseReport<SummaryReport>(text);
      if (source !== this.sourceKey || !this.cache) return;
      this.cache.summaries[key] = { report, date: Date.now() };
      await this.saveCache();
      await this.rememberClaudeAccount(report.claudeAccount ?? null);
      await this.recordAccountQuotas(report);
      this.archive.ingest(report, metricsIngestPolicy(key));
      if (this.archiveWritable) {
        try {
          await saveMetricsArchive(this.archive);
          this.archiveSavedAt = Date.now();
          delete this.errors["archive"];
        } catch {
          this.errors["archive"] = "Daily metrics could not be saved. Check the history file location.";
        }
      }
      delete this.summaryErrors[key];
      this.publishSummary();
    } catch (error) {
      if (source !== this.sourceKey) return;
      this.summaryErrors[key] = message(error);
      if (key === queryCacheKey(this.currentQuery)) this.errors["summary"] = message(error);
      this.changed();
    }
  }

  private async loadHarness(agent: string) {
    const source = this.sourceKey;
    try {
      const text = await native.runCli(["harness", agent], {
        env: this.cliEnv(),
        offline: this.offline,
        customPath: this.customPath,
      });
      const report = parseReport<HarnessReport>(text);
      if (source !== this.sourceKey || !this.cache) return;
      const date = Date.now();
      this.cache.harnesses[agent] = { report, date };
      await this.saveCache();
      this.reports = { ...this.reports, [agent]: report };
      this.updated[agent] = date;
      delete this.errors[agent];
    } catch (error) {
      this.errors[agent] = message(error);
    }
    this.changed();
  }

  private changePeriod() {
    this.publishSummary();
    this.queueSummary();
  }

  private async saveCache() {
    try {
      if (this.cache) await saveReportCache(this.cache);
      delete this.errors["cache"];
    } catch {
      this.errors["cache"] = "Unable to save report history on this PC.";
    }
  }

  private async recordAccountQuotas(report: SummaryReport) {
    const readings = [
      report.cursorAccount ? cursorQuotaReading(report.cursorAccount) : null,
      report.claudeAccount ? claudeSessionReading(report.claudeAccount) : null,
      report.claudeAccount ? claudeWeeklyReading(report.claudeAccount) : null,
    ].filter((r): r is QuotaReading => r != null);
    if (readings.length === 0) return;
    try {
      this.quotaHistory = new QuotaHistory(
        await native.quotaCommit(readings, this.quotaSourceKey, {}),
      );
      this.quotaFileMtime = null;
      await this.reloadQuotas();
      delete this.errors["quotaHistory"];
    } catch {
      this.errors["quotaHistory"] = "Quota history could not be saved. Existing readings are preserved.";
    }
  }

  private async rememberClaudeAccount(account: ClaudeAccount | null) {
    if (!account || (account.observedAtMs ?? 0) < (this.storedClaudeAccount?.observedAtMs ?? 0)) {
      return;
    }
    this.storedClaudeAccount = account;
    try {
      await saveClaudeAccount(account);
      delete this.errors["claudeAccount"];
    } catch {
      this.errors["claudeAccount"] =
        "Claude account meters could not be saved. The last saved reading is preserved.";
    }
  }

  // MARK: Read accessors (every window)

  get chartDomain(): Range | null {
    const dates = new Set(this.summary?.daily?.map((d) => d.date) ?? []);
    for (const name of this.knownAgents) {
      for (const day of this.archivedDaily(name)) dates.add(day.date);
    }
    return activityChartDomain(this.period, [...dates], new Date(), this.resetStartDate);
  }

  get remainingPercent(): number | null {
    return remainingQuota(
      this.quotaSource,
      this.forecast(this.quotaSource),
      this.summary?.cursorAccount,
      this.summary?.claudeAccount,
    );
  }

  archivedDaily(agent: string): DailyUsage[] {
    return Object.values(this.archive.data.agents[agent] ?? {}).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
  }

  blendRates(agent: string): QuotaBlendRates | null {
    const forecast = this.forecast(agent);
    if (!forecast) return null;
    return quotaBlendRates(forecast, this.reports[agent], this.archivedDaily(agent));
  }

  forecast(agent: string): Forecast | null {
    if (agent === "cursor") return this.cursorForecast();
    const reading = this.quotaHistory.current(agent, this.quotaSourceKey);
    if (reading) return new Forecast(reading.window, new Date(reading.observedAt), true);
    const window = this.reports[agent]?.window;
    const date = this.updated[agent];
    if (!windowIsValid(window) || date == null) return null;
    return new Forecast(window, new Date(date));
  }

  private cursorForecast(): Forecast | null {
    const stored = this.quotaHistory.current("cursor", this.quotaSourceKey);
    return cursorMeterForecast(
      this.summary?.cursorAccount,
      new Date(this.quotaCheckDate),
      stored ? new Forecast(stored.window, new Date(stored.observedAt), true) : null,
    );
  }

  archivedSamples(agent: string): QuotaSample[] {
    return this.quotaHistory.latest(agent, this.quotaSourceKey) == null
      ? this.legacyHistory[agent] ?? []
      : this.quotaHistory.samples(agent, this.quotaSourceKey);
  }

  chartRange(agent: string): QuotaChartRange {
    return agent === "cursor" ? this.cursorQuotaChartRange : this.quotaChartRange;
  }

  samples(agent: string, range: QuotaChartRange = "rte", now = new Date()): QuotaSample[] {
    const forecast = this.forecast(agent);
    if (!forecast) return [];
    return quotaChartSamples(this.archivedSamples(agent), range, forecast, now);
  }

  resets(agent: string): QuotaReset[] {
    return this.quotaHistory.resets(agent, this.quotaSourceKey);
  }

  get resetStartDate(): Date | null {
    const agent = this.selection === "summary" ? this.quotaSource : this.selection;
    const resets = this.resets(agent);
    return resets[resets.length - 1]?.date ?? this.forecast(agent)?.start ?? null;
  }

  quotaIsStale(date: Date): boolean {
    if (this.remainingPercent == null) return false;
    if (this.quotaSource === "cursor") {
      const forecast = this.forecast("cursor");
      if (forecast?.isLive) return !forecast.isFresh(date) || this.quotaError("cursor") != null;
      const updated = this.updated["summary"];
      if (updated == null) return true;
      return date.getTime() - updated > 90_000 || this.errors["summary"] != null;
    }
    return (
      this.forecast(this.quotaSource)?.isFresh(date) !== true ||
      this.quotaError(this.quotaSource) != null
    );
  }

  updatedDate(key: string): Date | null {
    const value = this.updated[key];
    return value == null ? null : new Date(value);
  }
}

function parseReport<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "The CLI returned an unsupported report. Rebuild the app with the current Agent Burn CLI.",
    );
  }
}

// MARK: React binding

let shared: UsageStore | null = null;

export function createStore(role: Role) {
  shared = new UsageStore(role);
  return shared;
}

export function useStore(): UsageStore {
  const store = shared;
  if (!store) throw new Error("UsageStore has not been created");
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Re-renders on a timer, like SwiftUI's `TimelineView(.periodic)`. */
export { useNow } from "./useNow";
