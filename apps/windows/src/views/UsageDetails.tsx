// Port of UsageDetails.swift.
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  Card,
  HarnessIcon,
  MetricTile,
  ReportNotice,
  SectionLabel,
  ShareBar,
  StatusBadge,
  Sym,
  T,
  agentColor,
  alpha,
  quotaColor,
} from "../components/Theme";
import {
  Forecast,
  bucketDailyUsage,
  capitalized,
  currency,
  cursorHasPromotionalCredits,
  cursorModelScopeLabel,
  cursorModelScopes,
  dailyUsage,
  fixed,
  fmtMonthDay,
  fmtMonthYear,
  harnessName,
  meterStyle,
  modelUsage,
  number,
  periodLabel,
  quotaChartDeltaText,
  quotaChartPercentLabel,
  quotaChartRangeLabel,
  quotaChartRanges,
  quotaChartReading,
  quotaDateCompact,
  quotaDateText,
  quotaDayLabel,
  quotaDollarsPerPercentLabel,
  quotaTimeLeft,
  quotaTokensPerUnitLabel,
  quotaUsedPercent,
  readingPaceDelta,
  spendBucketEnd,
  spendBucketStart,
  spendGranularities,
  spendGranularityAuto,
  spendGranularityLabel,
  spendGranularityTitle,
  spendSpanDays,
  startOfDay,
  tokens,
  usageDayDate,
  usagePeriods,
  type CursorModelScope,
  type DailyUsage,
  type HarnessReport,
  type QuotaBlendRates,
  type QuotaChartRange,
  type QuotaMeterStyle,
  type QuotaSample,
  type Range,
  type SpendGranularity,
  type UsagePeriod,
} from "../lib/usage";
import { useStore } from "../store/UsageStore";
import { ClaudeAccountView } from "./ClaudeAccountView";
import { CursorAccountView } from "./CursorAccountView";
import { QuotaChart } from "./QuotaChart";

// MARK: Shared helpers

function useMeasuredWidth<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

let measureContext: CanvasRenderingContext2D | null = null;
function textWidth(text: string, size: number) {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * size * 0.55;
  measureContext.font = `${size}px "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`;
  return measureContext.measureText(text).width;
}

const updatedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const weekdayTimeFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

// MARK: SpendMetric

export function SpendMetric({ title, value, detail = "" }: { title: string; value: string; detail?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1, minWidth: 0, width: "100%" }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: T.muted }}>{title}</span>
      <span className="rounded tabular ellipsis" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>
        {value}
      </span>
      {detail !== "" && <span style={{ fontSize: 11, color: T.muted }}>{detail}</span>}
    </div>
  );
}

// MARK: QuotaSummary

export function QuotaSummary({
  forecast,
  samples,
  now,
  stale = false,
  staleHelp = null,
  compact = false,
  availableResets = null,
  rates = null,
  style = "weekly",
}: {
  forecast: Forecast;
  samples: QuotaSample[];
  now: Date;
  stale?: boolean;
  staleHelp?: string | null;
  compact?: boolean;
  availableResets?: number | null;
  rates?: QuotaBlendRates | null;
  style?: QuotaMeterStyle;
}) {
  const muted = compact ? T.quotaMuted : T.muted;
  const reading = quotaChartReading(forecast.observedAt, samples, forecast, "rte");
  const paceDelta = readingPaceDelta(reading);
  const paceText = quotaChartDeltaText(paceDelta);
  const paceColor = paceDelta != null ? (paceDelta < -0.05 ? T.behind : T.ahead) : muted;
  const badgeHelp = "Recorded remaining minus even pace at the latest reading.";

  const staleMark = (size: number) => (
    <span
      title={staleHelp ?? "Showing the last known reading. Update pending."}
      aria-label="Last known quota; update pending"
      style={{ display: "inline-flex", flex: "none" }}
    >
      <Sym name="clock.badge.exclamationmark" size={size} color={T.orange} />
    </span>
  );

  const badge = paceText != null && (
    <span title={badgeHelp} style={{ display: "inline-flex", alignSelf: compact ? "flex-end" : "flex-start" }}>
      <StatusBadge text={paceText} color={paceColor} />
    </span>
  );

  const remainingLabel = (
    <div
      title={"Updated " + updatedFormat.format(forecast.observedAt)}
      aria-label="Remaining quota"
      style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
    >
      {compact && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="ellipsis" style={{ fontSize: 12, color: muted }}>
            {meterStyle.remainingCaption(style)}
          </span>
          {stale && staleMark(12)}
        </span>
      )}
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
        <span
          className="rounded tabular"
          style={{ fontSize: compact ? 44 : 38, fontWeight: 600, color: T.ink, lineHeight: 1.15 }}
        >
          {quotaChartPercentLabel(forecast.remaining)}
        </span>
        {!compact && <span style={{ fontSize: 13, color: muted, flex: "none" }}>remaining</span>}
      </span>
    </div>
  );

  const remainingBar = <ShareBar value={forecast.remaining / 100} tint={paceColor} height={5} />;

  // Weekday reads faster than a date inside one window; beyond six days it would be ambiguous.
  const resetDetail =
    (forecast.reset.getTime() - now.getTime()) / 1000 < 6 * 86_400
      ? weekdayTimeFormat.format(forecast.reset).replace(",", "")
      : quotaDayLabel(forecast.reset);

  const row = (title: string, value: string, help: string, detail: string | null = null) => (
    <div
      key={title}
      title={help}
      aria-label={title}
      style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12 }}
    >
      <span style={{ color: muted, whiteSpace: "nowrap", flex: "none" }}>{title}</span>
      <span style={{ flex: 1, minWidth: 0 }} />
      <span className="rounded tabular" style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flex: "none" }}>
        {value}
      </span>
      {detail != null && (
        <span className="tabular ellipsis" style={{ fontSize: 11, color: muted, flex: "0 1 auto" }}>
          {detail}
        </span>
      )}
    </div>
  );

  const dollars = quotaDollarsPerPercentLabel(rates?.dollarsPerPercent);
  const tokensPer = quotaTokensPerUnitLabel(rates?.tokensPerDollar, "$");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", minWidth: 0 }}>
      {!compact && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
            {meterStyle.title(style)}
          </span>
          {stale && staleMark(13)}
        </span>
      )}
      {compact ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {remainingLabel}
            <span style={{ flex: 1, minWidth: 8 }} />
            <div
              aria-label={meterStyle.resetTitle(style)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}
            >
              {badge}
              <span style={{ fontSize: 12, color: muted, whiteSpace: "nowrap" }}>
                {`${meterStyle.resetTitle(style)} ${quotaTimeLeft(forecast, now)}`}
              </span>
              <span
                className="tabular"
                title={meterStyle.resetHelp(style)}
                style={{ fontSize: 12, color: muted, whiteSpace: "nowrap" }}
              >
                {quotaDateCompact(forecast.reset)}
              </span>
              {availableResets != null && (
                <span
                  title="Codex rate-limit resets you can redeem now."
                  style={{ fontSize: 12, fontWeight: 500, color: T.ink, whiteSpace: "nowrap" }}
                >
                  {availableResets === 1 ? "1 reset" : `${availableResets} resets`}
                </span>
              )}
            </div>
          </div>
          {remainingBar}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {remainingLabel}
          {badge}
          {remainingBar}
        </div>
      )}
      {!compact && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "9px 10px",
            borderRadius: 8,
            background: T.hover,
          }}
        >
          {row(
            meterStyle.resetTitle(style),
            quotaTimeLeft(forecast, now),
            `${meterStyle.resetHelp(style)} ${quotaDateText(forecast.reset)}.`,
            resetDetail,
          )}
          {row(
            "Used",
            `${fixed(quotaUsedPercent(forecast), 1)}%`,
            meterStyle.usedHelp(style),
            `since ${quotaDayLabel(forecast.start)}`,
          )}
          {row(
            "Daily",
            `${fixed(forecast.dailyAllowance, 1)}% / day`,
            "Remaining quota divided by the time until reset.",
          )}
          {dollars != null
            ? row(
                "Avg $ / %",
                dollars,
                "API-equivalent spend this cycle divided by used quota percent. Tokens / $ uses logged tokens for the same days, or the last 30 days of model usage when cycle tokens are missing.",
                tokensPer,
              )
            : tokensPer != null
              ? row("Avg tokens / $", tokensPer, "Logged tokens divided by API-equivalent spend.")
              : null}
          {availableResets != null &&
            row("Resets", `${availableResets}`, "Codex rate-limit resets you can redeem now.", "banked")}
        </div>
      )}
    </div>
  );
}

// MARK: DailySpendChart

const DAY_MS = 86_400_000;

function addDaysLocal(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonthsLocal(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Swift Charts `.automatic(desiredCount: 5)` for a date axis: calendar-aligned steps. */
function dateAxisTicks(lower: Date, upper: Date, granularity: SpendGranularity): Date[] {
  const spanDays = Math.max(1, (upper.getTime() - lower.getTime()) / DAY_MS);
  const desired = 5;
  const dayCounts = granularity === "monthly" ? [] : [1, 2, 3, 7, 14];
  for (const step of dayCounts) {
    if (spanDays / step > desired + 1) continue;
    const ticks: Date[] = [];
    let cursor = startOfDay(lower);
    if (step === 7 || step === 14) {
      cursor = addDaysLocal(cursor, -cursor.getDay());
      if (cursor < lower) cursor = addDaysLocal(cursor, 7);
    } else if (step > 1) {
      while ((cursor.getDate() - 1) % step !== 0) cursor = addDaysLocal(cursor, 1);
    }
    if (cursor < lower) cursor = addDaysLocal(cursor, 1);
    while (cursor <= upper) {
      ticks.push(cursor);
      const next = addDaysLocal(cursor, step);
      // Odd steps restart at each month start, like Calendar-aligned axis marks.
      cursor =
        step > 1 && step < 7 && next.getMonth() !== cursor.getMonth()
          ? new Date(next.getFullYear(), next.getMonth(), 1)
          : next;
    }
    return ticks;
  }
  const spanMonths = spanDays / 30.4;
  for (const step of [1, 2, 3, 6, 12, 24, 60]) {
    if (spanMonths / step > desired + 1 && step !== 60) continue;
    let cursor = new Date(lower.getFullYear(), lower.getMonth(), 1);
    if (cursor < lower) cursor = addMonthsLocal(cursor, 1);
    while (cursor.getMonth() % Math.min(step, 12) !== 0) cursor = addMonthsLocal(cursor, 1);
    const ticks: Date[] = [];
    while (cursor <= upper) {
      ticks.push(cursor);
      cursor = addMonthsLocal(cursor, step);
    }
    return ticks;
  }
  return [];
}

/** Swift Charts automatic linear y scale: zero-based, nice 1/2/2.5/5 steps. */
function niceValueTicks(maxValue: number): number[] {
  const top = maxValue > 0 && Number.isFinite(maxValue) ? maxValue : 1;
  const rough = top / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const count = Math.ceil(top / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

export function DailySpendChart({
  title,
  days,
  color = T.accent,
  scope,
  setScope,
  domain = null,
  showsGranularity = true,
}: {
  title: string;
  days: DailyUsage[];
  color?: string;
  scope?: CursorModelScope | null;
  setScope?: ((v: CursorModelScope) => void) | null;
  domain?: Range | null;
  showsGranularity?: boolean;
}) {
  const [granularityOverride, setGranularityOverride] = useState<SpendGranularity | null>(null);
  const points = days
    .map((usage) => ({ date: usageDayDate(usage.date), usage }))
    .filter((p): p is { date: Date; usage: DailyUsage } => p.date != null);
  let scale: Range;
  if (domain) {
    scale = domain;
  } else {
    const first = points[0]?.date;
    const last = points[points.length - 1]?.date;
    if (first && last && first <= last) {
      scale = { lower: first, upper: last };
    } else {
      const today = startOfDay(new Date());
      scale = { lower: today, upper: today };
    }
  }
  const spanDays = spendSpanDays(scale.lower, scale.upper);
  const effective: SpendGranularity = showsGranularity
    ? granularityOverride ?? spendGranularityAuto(spanDays)
    : "daily";
  const headerTitle = showsGranularity ? spendGranularityTitle(effective) : title;
  const chartKey = `${showsGranularity}-${effective}-${scale.lower.getTime()}-${scale.upper.getTime()}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel title={headerTitle} detail="API-equivalent USD" />
        </div>
        {showsGranularity && (
          <div className="segmented" role="radiogroup" aria-label="Spend granularity" style={{ width: 220 }}>
            {spendGranularities.map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={option === effective}
                className={option === effective ? "selected" : undefined}
                style={{ flex: 1 }}
                onClick={() => setGranularityOverride(option)}
              >
                {spendGranularityLabel(option)}
              </button>
            ))}
          </div>
        )}
        {scope != null && setScope != null && (
          <div
            className="segmented"
            role="radiogroup"
            aria-label="Daily spend models"
            style={{ maxWidth: 240 }}
          >
            {cursorModelScopes.map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={option === scope}
                className={option === scope ? "selected" : undefined}
                style={{ flex: 1 }}
                onClick={() => setScope(option)}
              >
                {cursorModelScopeLabel(option)}
              </button>
            ))}
          </div>
        )}
      </div>
      <SpendBars key={chartKey} days={days} color={color} scale={scale} granularity={effective} />
    </div>
  );
}

function SpendBars({
  days,
  color,
  scale,
  granularity,
}: {
  days: DailyUsage[];
  color: string;
  scale: Range;
  granularity: SpendGranularity;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<Date | null>(null);
  const height = 150;
  const labelSize = 10;
  const xAxisHeight = 18;
  const plotHeight = height - xAxisHeight;

  const buckets = bucketDailyUsage(days, granularity).flatMap((usage) => {
    const start = usageDayDate(usage.date);
    if (!start) return [];
    return [{ date: start, end: spendBucketEnd(start, granularity), usage }];
  });

  // The unit-based bars span their whole bucket, so the scale covers the last bucket too.
  const lower = scale.lower;
  const upper = new Date(spendBucketEnd(spendBucketStart(scale.upper, granularity), granularity).getTime() + 1000);
  const span = Math.max(1, upper.getTime() - lower.getTime());

  const valueTicks = niceValueTicks(Math.max(0, ...buckets.map((b) => b.usage.cost)));
  const top = valueTicks[valueTicks.length - 1] ?? 1;
  const valueLabels = valueTicks.map((v) => number(v));
  const yAxisWidth = Math.ceil(Math.max(0, ...valueLabels.map((l) => textWidth(l, labelSize)))) + 6;
  const plotLeft = yAxisWidth;
  const plotWidth = Math.max(1, width - plotLeft);

  const x = (date: Date) => plotLeft + ((date.getTime() - lower.getTime()) / span) * plotWidth;
  const y = (value: number) => (1 - value / top) * plotHeight;

  const ticks = dateAxisTicks(lower, upper, granularity);
  const axisLabels: { x: number; text: string }[] = [];
  let lastEnd = -Infinity;
  for (const tick of ticks) {
    const text = granularity === "monthly" ? fmtMonthYear(tick) : fmtMonthDay(tick);
    const left = x(tick);
    const labelWidth = textWidth(text, labelSize);
    if (left < plotLeft - 0.5 || left + labelWidth > width + 0.5 || left < lastEnd + 4) continue;
    axisLabels.push({ x: left, text });
    lastEnd = left + labelWidth;
  }

  const select = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    setSelected(new Date(lower.getTime() + fraction * span));
  };

  const clipId = useRef(`spend-clip-${Math.random().toString(36).slice(2)}`).current;

  return (
    <div ref={ref} style={{ height, width: "100%", position: "relative" }}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <clipPath id={clipId}>
              <rect x={plotLeft} y={-1} width={plotWidth} height={plotHeight + 1} />
            </clipPath>
          </defs>
          {valueTicks.map((value, index) => (
            <g key={value}>
              <line
                x1={plotLeft}
                x2={plotLeft + plotWidth}
                y1={y(value)}
                y2={y(value)}
                stroke={T.line}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={plotLeft - 6}
                y={y(value)}
                dy="0.35em"
                textAnchor="end"
                fontSize={labelSize}
                fill={T.muted}
                className="tabular"
              >
                {valueLabels[index]}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {buckets.map((bucket) => {
              const left = x(bucket.date);
              const right = x(new Date(bucket.end.getTime() + 1000));
              const bandwidth = Math.max(0, right - left);
              const inset = Math.max(0.5, Math.min(6, bandwidth * 0.075));
              const barWidth = Math.max(1, bandwidth - inset * 2);
              const barTop = y(Math.max(0, bucket.usage.cost));
              const barHeight = Math.max(0, plotHeight - barTop);
              return (
                <rect
                  key={bucket.usage.date}
                  x={left + (bandwidth - barWidth) / 2}
                  y={barTop}
                  width={barWidth}
                  height={barHeight}
                  rx={Math.min(3, barWidth / 2, barHeight / 2)}
                  fill={color}
                  aria-label={`${bucket.usage.date}, ${currency(bucket.usage.cost)}`}
                />
              );
            })}
          </g>
          {selected && (
            <line
              x1={x(selected)}
              x2={x(selected)}
              y1={0}
              y2={plotHeight}
              stroke={alpha(T.muted, 0.4)}
              strokeWidth={1}
            />
          )}
          {axisLabels.map((label) => (
            <text
              key={label.text + label.x}
              x={label.x}
              y={plotHeight + 4}
              dy="0.8em"
              fontSize={labelSize}
              fill={T.muted}
            >
              {label.text}
            </text>
          ))}
          <rect
            x={plotLeft}
            y={0}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              select(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) select(event);
            }}
            onPointerUp={() => setSelected(null)}
            onPointerCancel={() => setSelected(null)}
          />
        </svg>
      )}
    </div>
  );
}

// MARK: HarnessSpendDetails

function DetailRow({ title, value }: { title: string; value: string }) {
  return (
    <div className="tabular" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ color: T.muted }}>{title}</span>
      <span style={{ flex: 1 }} />
      <span>{value}</span>
    </div>
  );
}

const column = (gap: number): CSSProperties => ({ display: "flex", flexDirection: "column", gap });

export function HarnessSpendDetails({ report }: { report: HarnessReport }) {
  const mix = report.spendMix;
  const trend = report.weeklyTrend;
  const estimate = report.estimate;
  const images = report.imageGenerations;
  const averageDollars = estimate ? quotaDollarsPerPercentLabel(estimate.fullQuotaValue / 100) : null;
  return (
    <div style={column(26)}>
      {report.daily.length > 0 && (
        <DailySpendChart
          title="Daily usage · current cycle"
          days={report.daily}
          color={agentColor(report.agent)}
        />
      )}
      {mix != null && mix.length > 0 && (
        <div style={column(14)}>
          <SectionLabel title="Spend by token type" detail="Past 30 days" />
          {mix.map((category) => (
            <div
              key={category.key}
              className="tabular"
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{capitalized(category.label)}</span>
              <span style={{ color: T.muted, width: 85, textAlign: "right", flex: "none" }}>
                {tokens(category.tokens)}
              </span>
              <span style={{ color: T.muted, width: 60, textAlign: "right", flex: "none" }}>
                {`${fixed(category.costPercent, 1)}%`}
              </span>
              <span style={{ width: 90, textAlign: "right", flex: "none" }}>{currency(category.costUSD)}</span>
            </div>
          ))}
        </div>
      )}
      {trend != null && trend.length > 0 && (
        <DailySpendChart
          title="Weekly trend"
          days={trend.map((week) => ({ date: week.weekStart, cost: week.cost }))}
          color={agentColor(report.agent)}
          showsGranularity={false}
        />
      )}
      {estimate != null && (
        <div style={column(14)}>
          <SectionLabel title="Quota value estimate" detail="Based on current cycle" />
          <DetailRow title="Full quota value" value={currency(estimate.fullQuotaValue)} />
          {averageDollars != null && <DetailRow title="Average $ / %" value={averageDollars} />}
          <DetailRow title="Monthly quota value" value={currency(estimate.monthlyValue)} />
          <DetailRow title="Projected quota consumption" value={`${fixed(estimate.projectedUsePercent, 0)}%`} />
          {estimate.valueMultiple != null && (
            <DetailRow title="Quota value / plan price" value={`${fixed(estimate.valueMultiple, 1)}×`} />
          )}
        </div>
      )}
      {images != null && report.agent === "codex" && (
        <div style={column(14)}>
          <SectionLabel title="Image generations" detail="Past 30 days" />
          <DetailRow title="Generated images" value={number(images.count)} />
          <DetailRow title="Estimated image cost" value={currency(images.estimatedCost)} />
          <span style={{ fontSize: 11, color: T.muted }}>
            {`${currency(images.pricePerImageEstimate)} per image estimate. Separate from token usage.`}
          </span>
        </div>
      )}
    </div>
  );
}

// MARK: SourceUsageView

export function SourceUsageView({ agent, compact = false }: { agent: string; compact?: boolean }) {
  const store = useStore();
  const [cursorScope, setCursorScope] = useState<CursorModelScope>("allModels");
  const usage = store.summary?.agents.find((a) => a.agent === agent) ?? null;
  const subscription = store.summary?.subscription?.agents.find((a) => a.agent === agent) ?? null;
  const checkDate = new Date(store.quotaCheckDate);
  const hasPromo = cursorHasPromotionalCredits(store.summary?.cursorAccount);
  const summaryError = store.errors["summary"];
  const cursorForecast = agent === "cursor" && hasPromo ? store.forecast("cursor") : null;
  const scoped = agent === "cursor" && !hasPromo;

  let body: ReactNode;
  if (usage) {
    const daily = usage.daily;
    const models = usage.models;
    const breakdown = usage.tokenBreakdown;
    const shown = models ? (scoped ? modelUsage(models, cursorScope) : models) : [];
    let account: ReactNode = null;
    if (cursorForecast) {
      const error = store.quotaError("cursor");
      const samples = store.samples("cursor", store.cursorQuotaChartRange, checkDate);
      account = (
        <Card padding={14} radius={12} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <QuotaSummary
            forecast={cursorForecast}
            samples={samples}
            now={checkDate}
            stale={!cursorForecast.isFresh(checkDate) || error != null}
            staleHelp={error ?? "Showing the last known reading. Update pending."}
            compact={compact}
            rates={store.blendRates("cursor")}
            style="promotionalCredits"
          />
          <QuotaChart
            forecast={cursorForecast}
            samples={samples}
            color={compact ? quotaColor("cursor") : agentColor("cursor")}
            compact={compact}
            range={store.cursorQuotaChartRange}
            now={checkDate}
            resetLabel={meterStyle.chartResetLabel("promotionalCredits")}
          />
        </Card>
      );
    } else if (agent === "cursor") {
      account = <CursorAccountView account={store.summary?.cursorAccount} plan={subscription} />;
    } else if (agent === "claude") {
      account = <ClaudeAccountView account={store.summary?.claudeAccount} plan={subscription} />;
    }
    const tileCard = { flex: "1 1 0", minWidth: 0 } as const;
    body = (
      <>
        {account}
        <div style={{ display: "flex", gap: 10 }}>
          <Card padding={12} radius={12} style={tileCard}>
            <MetricTile
              title="Spend"
              value={currency(usage.totalCost)}
              detail={periodLabel(store.period) + " · API-equivalent"}
              symbol="dollarsign"
              compact
            />
          </Card>
          <Card padding={12} radius={12} style={tileCard}>
            <MetricTile
              title="Tokens"
              value={tokens(usage.totalTokens)}
              detail="Input, output and cache"
              symbol="square.stack.3d.up.fill"
              tint={T.blue}
              compact
            />
          </Card>
          {!compact && subscription?.pricePerMonth != null && (
            <Card padding={12} radius={12} style={tileCard}>
              <MetricTile
                title="Monthly plan"
                value={currency(subscription.pricePerMonth)}
                detail={subscription.plan ?? ""}
                symbol="creditcard.fill"
                tint={T.purple}
                compact
              />
            </Card>
          )}
        </div>
        {daily != null && daily.length > 0 && !(compact && hasPromo) && (
          <Card padding={14} radius={12}>
            <DailySpendChart
              title="Daily usage"
              days={scoped ? dailyUsage(daily, cursorScope) : daily}
              color={agentColor(agent)}
              scope={scoped ? cursorScope : null}
              setScope={scoped ? setCursorScope : null}
              domain={store.chartDomain}
            />
          </Card>
        )}
        {models != null && models.length > 0 && (
          <Card padding={14} radius={12} style={column(14)}>
            <SectionLabel title="Model breakdown" detail={periodLabel(store.period)} />
            {shown.slice(0, compact ? 3 : shown.length).map((model) => (
              <div
                key={model.model}
                className="tabular"
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
              >
                <span className="ellipsis" title={model.model}>
                  {model.model}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: T.muted, flex: "none" }}>{tokens(model.totalTokens)}</span>
                <span style={{ width: 90, textAlign: "right", flex: "none" }}>{currency(model.totalCost)}</span>
              </div>
            ))}
          </Card>
        )}
        {!compact && breakdown != null && (
          <Card padding={14} radius={12} style={column(14)}>
            <SectionLabel title="Token breakdown" detail={periodLabel(store.period)} />
            {(
              [
                ["input", "Input"],
                ["output", "Output"],
                ["cacheWrite", "Cache write"],
                ["cacheRead", "Cache read"],
              ] as const
            ).map(([key, label]) => (
              <DetailRow key={key} title={label} value={tokens(breakdown[key] ?? 0)} />
            ))}
          </Card>
        )}
      </>
    );
  } else {
    body = (
      <ReportNotice
        message={
          store.isLoading
            ? "Reading harness usage…"
            : agent === "cursor" && store.offline
              ? "Cursor usage requires its dashboard connection. Turn off cached mode in Settings to load it."
              : "No usage found for this period. Choose a longer range and check that the harness is signed in."
        }
      />
    );
  }

  return (
    <div style={column(12)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
        <HarnessIcon agent={agent} size={28} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{harnessName(agent)}</span>
          <span style={{ fontSize: 11, color: T.quotaMuted }}>{subscription?.plan ?? "Harness usage"}</span>
        </div>
        <span style={{ flex: 1 }} />
        <PeriodPicker width={130} />
      </div>
      {summaryError != null && <ReportNotice message={summaryError} />}
      {body}
    </div>
  );
}

// MARK: Pickers

export function PeriodPicker({ width = 160 }: { width?: number }) {
  const store = useStore();
  return (
    <select
      className="menu-select"
      aria-label="Period"
      value={store.period}
      style={{ width }}
      onChange={(event) => store.setPeriod(event.target.value as UsagePeriod)}
    >
      {usagePeriods.map((period) => (
        <option key={period} value={period}>
          {periodLabel(period)}
        </option>
      ))}
    </select>
  );
}

export function QuotaChartRangePicker({
  range,
  setRange,
  width = 132,
}: {
  range: QuotaChartRange;
  setRange: (v: QuotaChartRange) => void;
  width?: number;
}) {
  return (
    <select
      className="menu-select"
      aria-label="Quota chart range"
      title="Changes only the weekly quota chart. Spend period stays independent."
      value={range}
      style={{ width }}
      onChange={(event) => setRange(event.target.value as QuotaChartRange)}
    >
      {quotaChartRanges.map((option) => (
        <option key={option} value={option}>
          {quotaChartRangeLabel(option)}
        </option>
      ))}
    </select>
  );
}
