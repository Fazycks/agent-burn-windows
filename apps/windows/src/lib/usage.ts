// Port of Usage.swift: report types, quota forecast math, chart helpers and formatting.
// Dates are JS `Date`; formatting mirrors Foundation's en_US output.

export interface SummaryReport {
  totals: Totals;
  agents: AgentUsage[];
  models: ModelUsage[];
  daily?: DailyUsage[] | null;
  subscription?: SubscriptionReport | null;
  cursorAccount?: CursorAccount | null;
  claudeAccount?: ClaudeAccount | null;
  /** `signInExpired` when Claude Code's token lapsed and the meters cannot update. */
  claudeAccountStatus?: string | null;
}

export interface Totals {
  totalCost: number;
  totalTokens: number;
}

export interface AgentUsage {
  agent: string;
  totalCost: number;
  totalTokens: number;
  models?: ModelUsage[] | null;
  daily?: DailyUsage[] | null;
  tokenBreakdown?: Record<string, number> | null;
}

export interface ModelUsage {
  model: string;
  totalCost: number;
  totalTokens: number;
}

export interface HarnessReport {
  agent: string;
  plan?: string | null;
  liveLimits: boolean;
  window?: QuotaWindow | null;
  apiEquivalentPerMonth: number;
  daily: DailyUsage[];
  topModels: HarnessModel[];
  pricePerMonth?: number | null;
  economics?: Economics | null;
  estimate?: QuotaEstimate | null;
  spendMix?: SpendCategory[] | null;
  weeklyTrend?: WeeklyUsage[] | null;
  imageGenerations?: ImageUsage | null;
  resetCreditsAvailable?: number | null;
  limitUsageDaily?: LimitUsageDay[] | null;
}

export interface SubscriptionReport {
  agents: SubscriptionAgent[];
}

export interface SubscriptionAgent {
  agent: string;
  plan?: string | null;
  pricePerMonth?: number | null;
  periodUsage: number;
  liveLimits: boolean;
  shortWindow?: ShortWindow | null;
  resetCreditsAvailable?: number | null;
}

export interface ShortWindow {
  label: string;
  usedPercent: number;
}

export interface Economics {
  pricePerMonth: number;
  apiEquivalentPerMonth: number;
  subsidyPerMonth: number;
  valueMultiple: number;
  discountPercent: number;
}

export interface QuotaEstimate {
  fullQuotaValue: number;
  monthlyValue: number;
  projectedUsePercent: number;
  valueMultiple?: number | null;
}

export interface SpendCategory {
  key: string;
  label: string;
  tokens: number;
  tokenPercent: number;
  costUSD: number;
  costPercent: number;
}

export interface WeeklyUsage {
  weekStart: string;
  cost: number;
}

export interface ImageUsage {
  count: number;
  pricePerImageEstimate: number;
  estimatedCost: number;
}

export interface QuotaWindow {
  windowMinutes: number;
  usedPercent: number;
  elapsedPercent: number;
  apiEquivalentSpent: number;
}

export function windowIsValid(w: QuotaWindow | null | undefined): w is QuotaWindow {
  if (!w) return false;
  return (
    Number.isFinite(w.windowMinutes) &&
    w.windowMinutes > 0 &&
    Number.isFinite(w.usedPercent) &&
    Number.isFinite(w.elapsedPercent) &&
    w.elapsedPercent >= 0 &&
    w.elapsedPercent <= 100 &&
    w.usedPercent >= 0 &&
    w.usedPercent <= 100
  );
}

export interface DailyUsage {
  date: string;
  cost: number;
  tokens?: number | null;
  cursorModelsCost?: number | null;
  cursorModelsTokens?: number | null;
}

export interface HarnessModel {
  model: string;
  cost: number;
  tokens: number;
}

export interface LimitUsageDay {
  date: string;
  usedPercent: number;
  surfaces: { surface: string; usedPercent: number }[];
  models: { model: string; speed?: string | null; usedPercent: number }[];
}

export interface CursorAccount {
  billingCycleStartMs?: number | null;
  billingCycleEndMs?: number | null;
  includedLimitUSD?: number | null;
  includedRemainingUSD?: number | null;
  includedPercentUsed?: number | null;
  includedSpendUSD?: number | null;
  bonusSpendUSD?: number | null;
  planSpendUSD?: number | null;
  onDemandSpentUSD?: number | null;
  onDemandLimitUSD?: number | null;
  activeLimitUSD?: number | null;
  activeRemainingUSD?: number | null;
  activePercentUsed?: number | null;
  grants: CursorCreditGrant[];
}

export interface CursorCreditGrant {
  kind?: string | null;
  totalUSD?: number | null;
  remainingUSD?: number | null;
  expiresAtMs?: number | null;
}

export interface ClaudeAccount {
  sessionUsedPercent?: number | null;
  sessionResetsAtMs?: number | null;
  weeklyUsedPercent?: number | null;
  weeklyResetsAtMs?: number | null;
  scoped: ClaudeScopedLimit[];
  extraEnabled?: boolean | null;
  extraUsedUSD?: number | null;
  extraLimitUSD?: number | null;
  extraUsedPercent?: number | null;
  /** When Anthropic reported these meters; the CLI may serve a shared cached reading. */
  observedAtMs?: number | null;
}

export interface ClaudeScopedLimit {
  name: string;
  usedPercent?: number | null;
  resetsAtMs?: number | null;
}

export interface QuotaReading {
  agent: string;
  observedAt: number;
  window: QuotaWindow;
}

export const claudeSessionQuotaAgent = "claude-session";

export const readingDate = (r: QuotaReading) => new Date(r.observedAt);

// MARK: Enums

export type CursorModelScope = "allModels" | "cursorModels";
export const cursorModelScopes: CursorModelScope[] = ["allModels", "cursorModels"];
export const cursorModelScopeLabel = (s: CursorModelScope) =>
  s === "allModels" ? "All models" : "Cursor models";

export type SpendGranularity = "daily" | "weekly" | "monthly";
export const spendGranularities: SpendGranularity[] = ["daily", "weekly", "monthly"];
export const spendGranularityLabel = (g: SpendGranularity) =>
  ({ daily: "Daily", weekly: "Weekly", monthly: "Monthly" })[g];
export const spendGranularityTitle = (g: SpendGranularity) =>
  ({ daily: "Daily spend", weekly: "Weekly spend", monthly: "Monthly spend" })[g];

export type UsagePeriod =
  | "today"
  | "yesterday"
  | "rtd"
  | "wtd"
  | "mtd"
  | "week"
  | "month"
  | "ytd"
  | "all";
export const usagePeriods: UsagePeriod[] = [
  "today",
  "yesterday",
  "rtd",
  "wtd",
  "mtd",
  "week",
  "month",
  "ytd",
  "all",
];
export const periodLabel = (p: UsagePeriod) =>
  ({
    today: "Today",
    all: "All time",
    yesterday: "Yesterday",
    rtd: "Reset to date",
    wtd: "Week to date",
    ytd: "Year to date",
    week: "Last 7 days",
    mtd: "This month",
    month: "Last 30 days",
  })[p];
export const periodArguments = (p: UsagePeriod) => [
  "summary",
  ...(p === "all" || p === "rtd" ? [] : [p]),
  "--value",
];

export type QuotaSource = "codex" | "claude" | "cursor";
export const quotaSources: QuotaSource[] = ["codex", "claude", "cursor"];
export const quotaSourceLabel = (s: QuotaSource) =>
  ({ codex: "Codex", claude: "Claude", cursor: "Cursor" })[s];

export type QuotaChartRange = "rte" | "rtd" | "today" | "week" | "month";
export const quotaChartRanges: QuotaChartRange[] = ["rte", "rtd", "today", "week", "month"];
export const quotaChartRangeLabel = (r: QuotaChartRange) =>
  ({
    rte: "Until reset",
    rtd: "Reset to today",
    today: "Today",
    week: "Last 7 days",
    month: "Last 30 days",
  })[r];

export type QuotaMeterStyle = "weekly" | "promotionalCredits";
export const meterStyle = {
  title: (s: QuotaMeterStyle) => (s === "weekly" ? "Weekly quota" : "Promotional credits"),
  remainingCaption: (s: QuotaMeterStyle) =>
    s === "weekly" ? "Weekly remaining" : "Credits remaining",
  resetTitle: (s: QuotaMeterStyle) => (s === "weekly" ? "Reset in" : "Expires in"),
  resetHelp: (s: QuotaMeterStyle) =>
    s === "weekly"
      ? "Time left in this weekly limit window."
      : "Time left before promotional credits expire.",
  usedHelp: (s: QuotaMeterStyle) =>
    s === "weekly"
      ? "The current weekly limit started at this time. Used percent is measured against that full limit."
      : "Used percent is measured against the promotional credit grant. The window runs until those credits expire.",
  chartResetLabel: (s: QuotaMeterStyle) => (s === "weekly" ? "Reset" : "Expires"),
};

// MARK: Calendar helpers (local time, ISO weeks starting Monday)

const DAY = 86_400_000;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -offset);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

export function startOfHour(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isSameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

export const isToday = (date: Date) => isSameDay(date, new Date());

export function spendGranularityAuto(spanDays: number): SpendGranularity {
  if (spanDays > 182) return "monthly";
  if (spanDays > 62) return "weekly";
  return "daily";
}

export function spendSpanDays(lower: Date, upper: Date): number {
  return Math.max(1, Math.round((upper.getTime() - lower.getTime()) / DAY) + 1);
}

export function spendBucketStart(date: Date, granularity: SpendGranularity): Date {
  switch (granularity) {
    case "daily":
      return startOfDay(date);
    case "weekly":
      return startOfWeek(date);
    case "monthly":
      return startOfMonth(date);
  }
}

export function spendBucketEnd(start: Date, granularity: SpendGranularity): Date {
  switch (granularity) {
    case "daily":
      return new Date(addDays(start, 1).getTime() - 1000);
    case "weekly":
      return new Date(addDays(start, 7).getTime() - 1000);
    case "monthly":
      return new Date(addMonths(start, 1).getTime() - 1000);
  }
}

export function bucketDailyUsage(days: DailyUsage[], granularity: SpendGranularity): DailyUsage[] {
  if (granularity === "daily") return [...days].sort((a, b) => cmp(a.date, b.date));
  const cost = new Map<string, number>();
  const tokens = new Map<string, number>();
  const cursorCost = new Map<string, number>();
  const cursorTokens = new Map<string, number>();
  let hasCursorCost = false;
  let hasCursorTokens = false;
  for (const day of days) {
    const date = usageDayDate(day.date);
    if (!date) continue;
    const key = quotaDayKey(spendBucketStart(date, granularity));
    cost.set(key, (cost.get(key) ?? 0) + day.cost);
    tokens.set(key, (tokens.get(key) ?? 0) + (day.tokens ?? 0));
    if (day.cursorModelsCost != null) {
      cursorCost.set(key, (cursorCost.get(key) ?? 0) + day.cursorModelsCost);
      hasCursorCost = true;
    }
    if (day.cursorModelsTokens != null) {
      cursorTokens.set(key, (cursorTokens.get(key) ?? 0) + day.cursorModelsTokens);
      hasCursorTokens = true;
    }
  }
  return [...cost.keys()].sort().map((key) => ({
    date: key,
    cost: cost.get(key) ?? 0,
    tokens: tokens.get(key) ?? 0,
    cursorModelsCost: hasCursorCost ? cursorCost.get(key) ?? null : null,
    cursorModelsTokens: hasCursorTokens ? cursorTokens.get(key) ?? null : null,
  }));
}

export function spendBucketTooltip(start: Date, granularity: SpendGranularity, cost: number) {
  switch (granularity) {
    case "daily":
      return quotaDayKey(start) + " · " + currency(cost);
    case "weekly": {
      const end = addDays(start, 6);
      return fmtMonthDay(start) + " – " + fmtMonthDay(end) + " · " + currency(cost);
    }
    case "monthly":
      return fmtMonthYear(start) + " · " + currency(cost);
  }
}

// MARK: Forecast

export class Forecast {
  constructor(
    readonly window: QuotaWindow,
    readonly observedAt: Date,
    readonly isLive = false,
  ) {}

  isFresh(date: Date): boolean {
    const age = (date.getTime() - this.observedAt.getTime()) / 1000;
    return (
      this.isLive && windowIsValid(this.window) && age >= 0 && age <= 90 && date < this.reset
    );
  }

  freshnessLabel(date: Date, failed = false): string {
    if (failed) return "Update failed · retrying";
    if (!this.isLive) return "Saved reading";
    return this.isFresh(date) ? "Live · every minute" : "Stale · waiting for update";
  }

  get remaining() {
    return Math.max(0, Math.min(100, 100 - this.window.usedPercent));
  }
  /** Seconds. */
  get duration() {
    return Math.max(1, this.window.windowMinutes * 60);
  }
  get elapsed() {
    return Math.max(0, Math.min(1, this.window.elapsedPercent / 100));
  }
  get start() {
    return new Date(this.observedAt.getTime() - this.duration * this.elapsed * 1000);
  }
  get reset() {
    return new Date(this.start.getTime() + this.duration * 1000);
  }
  get projectedUse(): number | null {
    if (!(this.elapsed > 0) || !(this.window.usedPercent > 0)) return null;
    return this.window.usedPercent / this.elapsed;
  }
  get daysEarly() {
    const p = this.projectedUse;
    if (p == null || p <= 100) return 0;
    return (this.duration * (1 - 100 / p)) / 86400;
  }
  get dailyAllowance() {
    return this.remaining / Math.max(1 / 1440, (this.duration * (1 - this.elapsed)) / 86400);
  }
  get projectedEnd() {
    const p = this.projectedUse;
    if (p == null || p <= 100) return this.reset;
    return new Date(this.start.getTime() + ((this.duration * 100) / p) * 1000);
  }
  get projectedRemaining() {
    return Math.max(0, 100 - (this.projectedUse ?? 0));
  }
}

export interface QuotaSample {
  date: Date;
  remaining: number;
}

export interface Range {
  lower: Date;
  upper: Date;
}

const maxDate = (a: Date, b: Date) => (a > b ? a : b);
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000);
const secondsBetween = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 1000;

export function quotaChartWindow(range: QuotaChartRange, forecast: Forecast, now: Date): Range {
  const cursor = minDate(now, forecast.observedAt);
  let start: Date;
  let end: Date;
  switch (range) {
    case "rte":
      start = forecast.start;
      end = maxDate(now, forecast.reset);
      break;
    case "rtd":
      start = forecast.start;
      end = maxDate(cursor, forecast.observedAt);
      break;
    case "today":
      start = startOfDay(cursor);
      end = maxDate(cursor, forecast.observedAt);
      break;
    case "week":
      start = plus(cursor, -7 * 86_400);
      end = maxDate(cursor, forecast.observedAt);
      break;
    case "month":
      start = plus(cursor, -30 * 86_400);
      end = maxDate(cursor, forecast.observedAt);
      break;
  }
  return { lower: start, upper: maxDate(plus(start, 1), end) };
}

export function quotaChartSamples(
  samples: QuotaSample[],
  range: QuotaChartRange,
  forecast: Forecast,
  now: Date,
): QuotaSample[] {
  const window = quotaChartWindow(range, forecast, now);
  const inWindow = samples
    .filter((s) => s.date >= window.lower && s.date <= window.upper)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (range === "rte" || range === "rtd") {
    return quotaChartSamplesFromLimit(cycleSamples(inWindow, plus(window.lower, -60)), forecast);
  }
  return inWindow;
}

export function quotaChartSamplesFromLimit(samples: QuotaSample[], forecast: Forecast) {
  const anchor = { date: forecast.start, remaining: 100 };
  const first = samples[0];
  if (!first) return [anchor];
  if (first.date <= plus(forecast.start, 90)) return samples;
  return [anchor, ...samples];
}

type StepComponent = "hour" | "day" | "month";

function stepStart(date: Date, component: StepComponent) {
  if (component === "hour") return startOfHour(date);
  if (component === "day") return startOfDay(date);
  return startOfMonth(date);
}

function stepNext(date: Date, component: StepComponent) {
  if (component === "hour") return new Date(date.getTime() + 3_600_000);
  if (component === "day") return addDays(date, 1);
  return addMonths(date, 1);
}

export function quotaChartSteppedDates(window: Range, component: StepComponent): Date[] {
  let cursor = stepStart(window.lower, component);
  const dates: Date[] = [];
  while (cursor <= window.upper) {
    dates.push(cursor);
    const next = stepNext(cursor, component);
    if (!(next > cursor)) break;
    cursor = next;
  }
  return dates;
}

export function quotaChartStepComponent(range: QuotaChartRange, window: Range): StepComponent {
  const days = secondsBetween(window.upper, window.lower) / 86_400;
  if (range === "today" || days <= 1) return "hour";
  return days > 45 ? "month" : "day";
}

export function quotaChartScale(range: QuotaChartRange, forecast: Forecast, now: Date): Range {
  const window = quotaChartWindow(range, forecast, now);
  const grid = quotaChartGridDates(range, forecast, now);
  const start = minDate(grid[0] ?? window.lower, window.lower);
  const last = grid[grid.length - 1];
  if (quotaChartStepComponent(range, window) === "hour" || !last) {
    return { lower: start, upper: window.upper };
  }
  // Leave room after the last midday label so it is never clipped at the trailing edge.
  return { lower: start, upper: maxDate(window.upper, plus(last, 21 * 3600)) };
}

export function quotaChartThinnedDates(dates: Date[], limit = 6): Date[] {
  if (dates.length <= limit || limit < 2) return dates;
  const last = dates.length - 1;
  const picked: Date[] = [];
  for (let index = 0; index < limit; index++) {
    const date = dates[Math.round((index * last) / (limit - 1))]!;
    if (picked[picked.length - 1]?.getTime() !== date.getTime()) picked.push(date);
  }
  return picked;
}

export function quotaChartGridDates(range: QuotaChartRange, forecast: Forecast, now: Date) {
  const window = quotaChartWindow(range, forecast, now);
  return quotaChartSteppedDates(window, quotaChartStepComponent(range, window));
}

export function quotaChartAxisDates(range: QuotaChartRange, forecast: Forecast, now: Date) {
  const window = quotaChartWindow(range, forecast, now);
  const grid = quotaChartGridDates(range, forecast, now);
  if (quotaChartStepComponent(range, window) === "hour") {
    const stride = grid.length > 8 ? 3 : 1;
    return grid.filter((_, offset) => offset % stride === 0 || offset === grid.length - 1);
  }
  const scale = quotaChartScale(range, forecast, now);
  const marks = grid.map((date) => {
    const midday = new Date(date);
    midday.setHours(12, 0, 0, 0);
    return minDate(maxDate(midday, scale.lower), scale.upper);
  });
  const days = secondsBetween(window.upper, window.lower) / 86_400;
  if (days > 45) return quotaChartThinnedDates(marks);
  const stride = days > 12 ? Math.ceil(marks.length / 8) : 1;
  const spaced: Date[] = [];
  marks.forEach((mark, offset) => {
    if (offset % stride !== 0) return;
    // Edge marks are clamped to the scale and can land right next to their neighbour.
    const previous = spaced[spaced.length - 1];
    if (previous && secondsBetween(mark, previous) < 0.95 * 86_400) return;
    spaced.push(mark);
  });
  return spaced;
}

export interface QuotaChartBand {
  start: Date;
  end: Date;
  isCurrent: boolean;
}

export function quotaChartDayBands(
  range: QuotaChartRange,
  forecast: Forecast,
  now: Date,
): QuotaChartBand[] {
  const window = quotaChartWindow(range, forecast, now);
  if (quotaChartStepComponent(range, window) === "hour") return [];
  const grid = quotaChartGridDates(range, forecast, now);
  const scale = quotaChartScale(range, forecast, now);
  return grid.map((start, index) => ({
    start,
    end: index + 1 < grid.length ? grid[index + 1]! : scale.upper,
    isCurrent: isSameDay(start, now),
  }));
}

export function quotaChartIdealRemaining(date: Date, forecast: Forecast) {
  return Math.max(
    0,
    Math.min(100, 100 * (1 - secondsBetween(date, forecast.start) / forecast.duration)),
  );
}

export function quotaChartRecordedRemaining(date: Date, samples: QuotaSample[]): number | null {
  const sorted = [...samples].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0];
  if (!first) return null;
  if (date <= first.date) return first.remaining;
  const last = sorted[sorted.length - 1]!;
  if (date >= last.date) return last.remaining;
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const next = sorted[i]!;
    if (date > next.date) continue;
    const span = secondsBetween(next.date, previous.date);
    if (!(span > 0)) return next.remaining;
    const progress = secondsBetween(date, previous.date) / span;
    return previous.remaining + (next.remaining - previous.remaining) * progress;
  }
  return null;
}

export function quotaChartForecastRemaining(date: Date, forecast: Forecast): number | null {
  if (forecast.projectedUse == null) return null;
  if (date < forecast.observedAt) return null;
  if (date >= forecast.projectedEnd) return forecast.projectedRemaining;
  const span = secondsBetween(forecast.projectedEnd, forecast.observedAt);
  if (!(span > 0)) return forecast.projectedRemaining;
  const progress = secondsBetween(date, forecast.observedAt) / span;
  return forecast.remaining + (forecast.projectedRemaining - forecast.remaining) * progress;
}

export interface QuotaChartReading {
  date: Date;
  recorded: number | null;
  ideal: number | null;
  forecast: number | null;
  projected: boolean;
}

export const readingValue = (r: QuotaChartReading) =>
  r.projected ? r.forecast ?? r.recorded : r.recorded;

export function readingPaceDelta(r: QuotaChartReading): number | null {
  const value = readingValue(r);
  if (r.ideal == null || value == null) return null;
  return value - r.ideal;
}

export function quotaChartReading(
  date: Date,
  samples: QuotaSample[],
  forecast: Forecast,
  range: QuotaChartRange,
): QuotaChartReading {
  return {
    date,
    recorded: quotaChartRecordedRemaining(date, samples),
    ideal: range === "rte" || range === "rtd" ? quotaChartIdealRemaining(date, forecast) : null,
    forecast: range === "rte" ? quotaChartForecastRemaining(date, forecast) : null,
    projected: date > forecast.observedAt,
  };
}

export interface QuotaDeltaPoint {
  date: Date;
  recorded: number;
  ideal: number;
}

const deltaOf = (p: QuotaDeltaPoint) => p.recorded - p.ideal;

export interface QuotaDeltaSegment {
  ahead: boolean;
  points: QuotaDeltaPoint[];
}

export function quotaChartDeltaSegments(
  samples: QuotaSample[],
  forecast: Forecast,
): QuotaDeltaSegment[] {
  const points = quotaChartDeltaPoints(samples, forecast);
  if (points.length <= 1) return [];
  const segments: QuotaDeltaSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const next = points[i]!;
    const ahead = deltaOf(previous) + deltaOf(next) >= 0;
    const last = segments[segments.length - 1];
    if (last && last.ahead === ahead) last.points.push(next);
    else segments.push({ ahead, points: [previous, next] });
  }
  return segments;
}

function quotaChartDeltaPoints(samples: QuotaSample[], forecast: Forecast): QuotaDeltaPoint[] {
  const sorted = [...samples].sort((a, b) => a.date.getTime() - b.date.getTime());
  const points: QuotaDeltaPoint[] = [];
  for (const sample of sorted) {
    const point = {
      date: sample.date,
      recorded: sample.remaining,
      ideal: quotaChartIdealRemaining(sample.date, forecast),
    };
    const previous = points[points.length - 1];
    if (previous && deltaOf(previous) * deltaOf(point) < 0) {
      // Pace is linear and recorded is linear between samples, so the crossing is exact.
      const progress = deltaOf(previous) / (deltaOf(previous) - deltaOf(point));
      const date = plus(previous.date, progress * secondsBetween(point.date, previous.date));
      const value = quotaChartIdealRemaining(date, forecast);
      points.push({ date, recorded: value, ideal: value });
    }
    points.push(point);
  }
  return points;
}

export function quotaChartDeltaText(delta: number | null | undefined): string | null {
  if (delta == null) return null;
  if (Math.abs(delta) < 0.05) return "On pace";
  const magnitude = fixed(Math.abs(delta), 1);
  return delta > 0 ? `+${magnitude}% ahead` : `−${magnitude}% behind`;
}

export function quotaChartStep(date: Date, forward: boolean, marks: Date[], domain: Range): Date {
  const sorted = [...marks].sort((a, b) => a.getTime() - b.getTime());
  if (forward) return minDate(domain.upper, sorted.find((m) => m > date) ?? domain.upper);
  const before = sorted.filter((m) => m < date);
  return maxDate(domain.lower, before[before.length - 1] ?? domain.lower);
}

export function quotaChartCursorLabel(date: Date, range: QuotaChartRange) {
  if (range === "today") return fmtTime(date);
  return fmtDateTime(date);
}

export function quotaChartPercentLabel(value: number | null | undefined) {
  return value == null ? "—" : `${fixed(value, 1)}%`;
}

export function quotaChartAxisLabel(
  date: Date,
  range: QuotaChartRange,
  marks: Date[],
  compact = false,
): string {
  if (range === "today") return fmtHour(date);
  const first = marks[0];
  const last = marks[marks.length - 1];
  if (first && last && secondsBetween(last, first) < 86_400) return fmtHour(date);
  if (first && last && secondsBetween(last, first) > 45 * 86_400) return fmtMonth(date);
  const spansWeeks = (last ? secondsBetween(last, first ?? date) : 0) > 10 * 86_400;
  const short = compact || marks.length > 10 || spansWeeks;
  const isMonthStart = date.getDate() === 1;
  const index = marks.findIndex((m) => m.getTime() === date.getTime());
  const previous = index > 0 ? marks[index - 1] : undefined;
  const monthChanged = previous ? !isSameMonth(previous, date) : undefined;
  if (short) {
    if ((first && date.getTime() === first.getTime()) || isMonthStart || monthChanged === true) {
      return fmtMonthDay(date);
    }
    return String(date.getDate());
  }
  return fmtWeekdayDay(date);
}

export function quotaDateText(date: Date) {
  return fmtDateTime(date);
}
export function quotaDayLabel(date: Date) {
  return fmtMonthDay(date);
}
export function quotaTimeLabel(date: Date) {
  return fmtTime(date);
}
export function quotaDateCompact(date: Date) {
  return `${quotaDayLabel(date)} · ${quotaTimeLabel(date)}`;
}

export function quotaUsedPercent(forecast: Forecast) {
  return Math.max(0, Math.min(100, forecast.window.usedPercent));
}

export function quotaLimitSummary(forecast: Forecast) {
  return `Limit: ${quotaDateText(forecast.start)} · ${fixed(quotaUsedPercent(forecast), 0)}% used`;
}

export function quotaTimeLeft(forecast: Forecast, now: Date) {
  const seconds = Math.max(0, secondsBetween(forecast.reset, minDate(now, forecast.reset)));
  const days = Math.trunc(seconds / 86_400);
  const hours = Math.trunc((seconds - days * 86_400) / 3_600);
  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return "<1h";
}

export function quotaTimeRemaining(forecast: Forecast, now: Date) {
  const left = quotaTimeLeft(forecast, now);
  return left === "<1h" ? "Less than 1h left" : `${left} left`;
}

export function quotaChartDrawnSamples(samples: QuotaSample[], stepGap = 2 * 3_600) {
  const points = quotaChartCollapsedSamples(samples);
  let previous = points[0];
  if (!previous) return [];
  const result = [previous];
  for (const sample of points.slice(1)) {
    if (
      secondsBetween(sample.date, previous.date) <= stepGap &&
      Math.abs(sample.remaining - previous.remaining) >= 0.05
    ) {
      result.push({ date: sample.date, remaining: previous.remaining });
    }
    result.push(sample);
    previous = sample;
  }
  return result;
}

const sameSample = (a?: QuotaSample, b?: QuotaSample) =>
  !!a && !!b && a.date.getTime() === b.date.getTime() && a.remaining === b.remaining;

function quotaChartCollapsedSamples(samples: QuotaSample[]) {
  const sorted = [...samples].sort((a, b) => a.date.getTime() - b.date.getTime());
  let previous = sorted[0];
  if (!previous) return [];
  const result = [previous];
  for (const sample of sorted.slice(1)) {
    if (Math.abs(sample.remaining - previous.remaining) >= 0.05) {
      if (!sameSample(result[result.length - 1], previous)) result.push(previous);
      result.push(sample);
    }
    previous = sample;
  }
  const last = sorted[sorted.length - 1];
  if (last && !sameSample(result[result.length - 1], last)) result.push(last);
  return result;
}

export function quotaRecordedSegments(samples: QuotaSample[], connectGaps: boolean) {
  const sorted = [...samples].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (connectGaps) return sorted.length === 0 ? [] : [sorted];
  return quotaSampleSegments(sorted);
}

export function quotaSampleSegments(samples: QuotaSample[]): QuotaSample[][] {
  const segments: QuotaSample[][] = [];
  for (const sample of [...samples].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const lastSegment = segments[segments.length - 1];
    const previous = lastSegment?.[lastSegment.length - 1];
    if (lastSegment && previous && secondsBetween(sample.date, previous.date) <= 90) {
      lastSegment.push(sample);
    } else {
      segments.push([sample]);
    }
  }
  return segments;
}

export function cycleSamples(samples: QuotaSample[], since: Date): QuotaSample[] {
  const sorted = samples
    .filter((s) => s.date >= since)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  let result: QuotaSample[] = [];
  for (const sample of sorted) {
    // A quota increase indicates a reset or a provider correction.
    const previous = result[result.length - 1];
    if (previous && sample.remaining > previous.remaining + 1) result = [];
    result.push(sample);
  }
  return result;
}

export interface QuotaReset {
  date: Date;
  scheduled: boolean;
}

export interface QuotaResetCounts {
  recorded: number;
  scheduled: number;
  possible: number;
}

export function quotaResetCounts(resets: QuotaReset[]): QuotaResetCounts {
  const recorded = resets.length;
  const scheduled = resets.filter((r) => r.scheduled).length;
  return { recorded, scheduled, possible: recorded - scheduled };
}

export function quotaAvailableResetsLabel(count: number | null | undefined) {
  if (count == null) return null;
  return count === 1 ? "1 reset available" : `${count} resets available`;
}

export function quotaCompactStats(forecast: Forecast, availableResets?: number | null) {
  const used = `${fixed(quotaUsedPercent(forecast), 1)}% used`;
  const daily = `${fixed(forecast.dailyAllowance, 1)}% / day`;
  const resets = quotaAvailableResetsLabel(availableResets);
  if (!resets) return `${used} · ${daily}`;
  return `${used} · ${daily} · ${resets}`;
}

export function quotaResetDetail(counts: QuotaResetCounts) {
  if (counts.recorded === 0) return "None this cycle";
  if (counts.scheduled === 0) return `${counts.possible} possible`;
  if (counts.possible === 0) return `${counts.scheduled} scheduled`;
  return `${counts.scheduled} scheduled · ${counts.possible} possible`;
}

export function resetSummary(resets: QuotaReset[]) {
  const counts = quotaResetCounts(resets);
  if (counts.recorded === 0) return "No quota resets recorded";
  return `${counts.recorded} recorded · ${counts.scheduled} scheduled, ${counts.possible} possible`;
}

export function remainingQuota(
  source: QuotaSource,
  forecast: Forecast | null,
  cursorAccount: CursorAccount | null | undefined,
  claudeAccount?: ClaudeAccount | null,
): number | null {
  const clamp = (v: number) => Math.max(0, Math.min(100, 100 - v));
  switch (source) {
    case "codex":
      return forecast?.remaining ?? null;
    case "claude":
      if (forecast) return forecast.remaining;
      return claudeAccount?.weeklyUsedPercent != null ? clamp(claudeAccount.weeklyUsedPercent) : null;
    case "cursor": {
      if (forecast) return forecast.remaining;
      const used = cursorAccount?.activePercentUsed ?? cursorAccount?.includedPercentUsed;
      return used != null ? clamp(used) : null;
    }
  }
}

export function cursorHasPromotionalCredits(account: CursorAccount | null | undefined) {
  return account?.grants.some((g) => g.kind === "promo" && (g.remainingUSD ?? 0) > 0) ?? false;
}

export function isCursorModel(name: string) {
  const model = name.toLowerCase();
  return (
    model.includes("composer") ||
    model.includes("cursor") ||
    model === "auto" ||
    model.startsWith("auto-")
  );
}

export function dailyUsage(days: DailyUsage[], scope: CursorModelScope): DailyUsage[] {
  if (scope !== "cursorModels") return days;
  if (!days.some((d) => d.cursorModelsCost != null)) return days;
  return days.map((d) => ({
    date: d.date,
    cost: d.cursorModelsCost ?? 0,
    tokens: d.cursorModelsTokens ?? d.tokens,
  }));
}

export function modelUsage(models: ModelUsage[], scope: CursorModelScope) {
  return scope === "cursorModels" ? models.filter((m) => isCursorModel(m.model)) : models;
}

export function cursorMeterForecast(
  account: CursorAccount | null | undefined,
  now: Date,
  stored: Forecast | null,
): Forecast | null {
  if (stored) return stored;
  if (!account) return null;
  const reading = cursorQuotaReading(account, now);
  if (!reading) return null;
  return new Forecast(reading.window, readingDate(reading), true);
}

export function claudeSessionReading(account: ClaudeAccount, now = new Date()) {
  return claudeAccountReading(
    account,
    claudeSessionQuotaAgent,
    account.sessionUsedPercent,
    account.sessionResetsAtMs,
    300,
    now,
  );
}

export function claudeWeeklyReading(account: ClaudeAccount, now = new Date()) {
  return claudeAccountReading(
    account,
    "claude",
    account.weeklyUsedPercent,
    account.weeklyResetsAtMs,
    10080,
    now,
  );
}

function claudeAccountReading(
  account: ClaudeAccount,
  agent: string,
  used: number | null | undefined,
  resetMs: number | null | undefined,
  minutes: number,
  current: Date,
): QuotaReading | null {
  if (used == null || !Number.isFinite(used) || used < 0 || used > 100 || resetMs == null) {
    return null;
  }
  const now = account.observedAtMs != null ? new Date(account.observedAtMs) : current;
  const duration = minutes * 60;
  const reset = new Date(resetMs);
  const elapsed = ((duration - secondsBetween(reset, now)) / duration) * 100;
  if (!(reset > now) || elapsed < 0 || elapsed > 100) return null;
  return {
    agent,
    observedAt: now.getTime(),
    window: { windowMinutes: minutes, usedPercent: used, elapsedPercent: elapsed, apiEquivalentSpent: 0 },
  };
}

export function cursorQuotaReading(account: CursorAccount, now = new Date()): QuotaReading | null {
  if (!cursorHasPromotionalCredits(account)) return null;
  const used = account.activePercentUsed ?? cursorGrantUsedPercent(account);
  if (used == null || !Number.isFinite(used) || used < 0 || used > 100) return null;
  const expiries = account.grants
    .filter((g) => g.kind === "promo" && (g.remainingUSD ?? 0) > 0 && g.expiresAtMs != null)
    .map((g) => g.expiresAtMs!);
  const reset =
    expiries.length > 0
      ? new Date(Math.min(...expiries))
      : account.billingCycleEndMs != null
        ? new Date(account.billingCycleEndMs)
        : null;
  if (!reset || !(reset > now)) return null;
  const year = 365 * 86_400;
  const start = minDate(now, plus(reset, -year));
  const minutes = secondsBetween(reset, start) / 60;
  if (!(minutes > 0)) return null;
  const elapsed = (secondsBetween(now, start) / secondsBetween(reset, start)) * 100;
  const spent = account.grants
    .filter((g) => g.kind === "promo" && g.totalUSD != null && g.remainingUSD != null)
    .reduce((sum, g) => sum + Math.max(0, g.totalUSD! - g.remainingUSD!), 0);
  const window = { windowMinutes: minutes, usedPercent: used, elapsedPercent: elapsed, apiEquivalentSpent: spent };
  if (!windowIsValid(window)) return null;
  return { agent: "cursor", observedAt: now.getTime(), window };
}

function cursorGrantUsedPercent(account: CursorAccount): number | null {
  const promo = account.grants.filter((g) => g.kind === "promo" && (g.remainingUSD ?? 0) > 0);
  const remaining = promo.reduce((s, g) => s + (g.remainingUSD ?? 0), 0);
  const total = promo.reduce((s, g) => s + (g.totalUSD ?? 0), 0);
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
}

export function menuBarQuotaText(remaining: number | null | undefined, stale = false) {
  return remaining != null ? `${Math.trunc(remaining)}%` + (stale ? " · stale" : "") : "Burn";
}

export function appVersionText(short: string, build = "") {
  return build === "" ? `v${short}` : `v${short} (${build})`;
}

export function harnessName(key: string) {
  switch (key) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    default:
      return capitalized(key);
  }
}

/** Foundation's `capitalized`: first letter of each word upper-cased, the rest lower-cased. */
export function capitalized(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export interface QuotaBlendRates {
  dollarsPerPercent: number | null;
  tokensPerDollar: number | null;
  tokensPerPercent: number | null;
}

export function usageDayDate(value: string): Date | null {
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y!, m! - 1, d!);
}

export function activityChartDomain(
  period: UsagePeriod,
  knownDates: string[],
  now = new Date(),
  resetStart?: Date | null,
): Range | null {
  const [startBound, endBound] = periodDateBounds(period, now, resetStart);
  const end = usageDayDate(endBound);
  if (!end) return null;
  if (startBound) {
    const start = usageDayDate(startBound);
    if (start && start <= end) return { lower: start, upper: end };
  }
  if (period !== "all") return null;
  const dates = knownDates.map(usageDayDate).filter((d): d is Date => d != null);
  if (dates.length === 0) return null;
  const start = new Date(Math.min(...dates.map((d) => d.getTime())));
  if (start > end) return null;
  return { lower: start, upper: end };
}

/** Port of `UsagePeriod.dateBounds` from MetricsArchive.swift. */
export function periodDateBounds(
  period: UsagePeriod,
  now: Date,
  resetStart?: Date | null,
): [string | null, string] {
  const today = startOfDay(now);
  const end = period === "yesterday" ? addDays(today, -1) : today;
  let start: Date | null;
  switch (period) {
    case "all":
      start = null;
      break;
    case "rtd":
      start = resetStart ? startOfDay(resetStart) : today;
      break;
    case "today":
    case "yesterday":
      start = end;
      break;
    case "wtd":
      start = startOfWeek(now);
      break;
    case "mtd":
      start = startOfMonth(now);
      break;
    case "ytd":
      start = startOfYear(now);
      break;
    case "week":
      start = addDays(today, -6);
      break;
    case "month":
      start = addDays(today, -29);
      break;
  }
  return [start ? quotaDayKey(start) : null, quotaDayKey(end)];
}

export function quotaDayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function usageTotals(days: DailyUsage[], since: string) {
  return days.reduce(
    (totals, day) =>
      day.date >= since
        ? { cost: totals.cost + day.cost, tokens: totals.tokens + (day.tokens ?? 0) }
        : totals,
    { cost: 0, tokens: 0 },
  );
}

export function quotaCycleSpend(windowSpent: number, days: DailyUsage[], since: string) {
  return windowSpent > 0 ? windowSpent : usageTotals(days, since).cost;
}

export function quotaCycleTokens(days: DailyUsage[], since: string) {
  return usageTotals(days, since).tokens;
}

export function quotaTokensPerDollar(tokens: number, cost: number) {
  return tokens > 0 && cost > 0 ? tokens / cost : null;
}

export function quotaBlendRatesFrom(usedPercent: number, spent: number, tokens: number): QuotaBlendRates {
  return {
    dollarsPerPercent: usedPercent > 0 && spent > 0 ? spent / usedPercent : null,
    tokensPerDollar: quotaTokensPerDollar(tokens, spent),
    tokensPerPercent: tokens > 0 && usedPercent > 0 ? tokens / usedPercent : null,
  };
}

export function quotaBlendRates(
  forecast: Forecast,
  report: HarnessReport | null | undefined,
  daily: DailyUsage[] = [],
): QuotaBlendRates {
  const start = quotaDayKey(forecast.start);
  const days = daily.length === 0 ? report?.daily ?? [] : daily;
  const spent = quotaCycleSpend(
    report?.window?.apiEquivalentSpent ?? forecast.window.apiEquivalentSpent,
    days,
    start,
  );
  const rates = quotaBlendRatesFrom(quotaUsedPercent(forecast), spent, quotaCycleTokens(days, start));
  if (rates.tokensPerDollar != null) return rates;
  const modelTokens = report?.topModels.reduce((s, m) => s + m.tokens, 0) ?? 0;
  return {
    dollarsPerPercent: rates.dollarsPerPercent,
    tokensPerDollar: quotaTokensPerDollar(modelTokens, report?.apiEquivalentPerMonth ?? 0),
    tokensPerPercent: rates.tokensPerPercent,
  };
}

export function quotaDollarsPerPercentLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return `${currency(value)} / %`;
}

export function quotaTokensPerUnitLabel(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return `${tokens(Math.round(value))} / ${unit}`;
}

// MARK: Formatting (Foundation en_US)

const LOCALE = "en-US";
const currencyFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const fixedFormats = new Map<number, Intl.NumberFormat>();

export function currency(value: number) {
  return currencyFormat.format(value);
}

/** `value.formatted(.number.precision(.fractionLength(n)))` */
export function fixed(value: number, digits: number) {
  let format = fixedFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    fixedFormats.set(digits, format);
  }
  return format.format(value);
}

/** `value.formatted()` for numbers: grouping, up to 3 fraction digits. */
export function number(value: number) {
  return Number.isInteger(value)
    ? integerFormat.format(value)
    : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 }).format(value);
}

export function tokens(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return integerFormat.format(value);
}

/** `.percent.precision(.fractionLength(n))` with a 0…1 input. */
export function percent(fraction: number, digits = 0) {
  return `${fixed(fraction * 100, digits)}%`;
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, options);
const monthDay = fmt({ month: "short", day: "numeric" });
const monthYear = fmt({ month: "short", year: "numeric" });
const monthOnly = fmt({ month: "short" });
const timeOnly = fmt({ hour: "numeric", minute: "2-digit" });
const hourOnly = fmt({ hour: "numeric" });
const dateTime = fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const weekdayDay = fmt({ weekday: "short", day: "numeric" });
const weekdayOnly = fmt({ weekday: "short" });
const fullDate = fmt({ month: "short", day: "numeric", year: "numeric" });

/** "Oct 12" */
export const fmtMonthDay = (d: Date) => monthDay.format(d);
/** "Oct 2026" */
export const fmtMonthYear = (d: Date) => monthYear.format(d);
/** "Oct" */
export const fmtMonth = (d: Date) => monthOnly.format(d);
/** "3:45 PM" */
export const fmtTime = (d: Date) => timeOnly.format(d);
/** "3 PM" */
export const fmtHour = (d: Date) => hourOnly.format(d);
/** "Oct 12, 3:45 PM" */
export const fmtDateTime = (d: Date) => dateTime.format(d);
/** "12 Sun" (Foundation order for weekday + day) */
export const fmtWeekdayDay = (d: Date) => {
  const parts = weekdayDay.formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? String(d.getDate());
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? weekdayOnly.format(d);
  return `${weekday} ${day}`;
};
/** "Sun" */
export const fmtWeekday = (d: Date) => weekdayOnly.format(d);
/** "Oct 12, 2026" (`date: .abbreviated`) */
export const fmtFullDate = (d: Date) => fullDate.format(d);

/** `Text(date, style: .relative)` / RelativeDateTimeFormatter, e.g. "2 min ago". */
export function relativeTime(date: Date, now = new Date()) {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? " ago" : "";
  const prefix = seconds >= 0 ? "" : "in ";
  if (abs < 60) return `${prefix}${abs} sec.${suffix}`;
  if (abs < 3600) return `${prefix}${Math.floor(abs / 60)} min.${suffix}`;
  if (abs < 86400) return `${prefix}${Math.floor(abs / 3600)} hr.${suffix}`;
  const days = Math.floor(abs / 86400);
  return `${prefix}${days} ${days === 1 ? "day" : "days"}${suffix}`;
}

export function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
