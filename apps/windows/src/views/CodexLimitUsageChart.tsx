// Port of CodexLimitUsageChart.swift. The stacked Swift Charts BarMark chart is drawn in SVG.
import { useState, type CSSProperties, type PointerEvent } from "react";
import { T, alpha } from "../components/Theme";
import {
  addDays,
  cmp,
  fixed,
  fmtMonthDay,
  quotaDayKey,
  startOfDay,
  usageDayDate,
  type LimitUsageDay,
} from "../lib/usage";
import { chartTextWidth, useChartSize } from "./QuotaChart";

export type { LimitUsageDay } from "../lib/usage";
export type LimitUsageModel = LimitUsageDay["models"][number];
export type LimitUsageSurface = LimitUsageDay["surfaces"][number];

export type LimitUsageGrouping = "surface" | "model";
export const limitUsageGroupings: LimitUsageGrouping[] = ["surface", "model"];
export const limitUsageGroupingLabel = (g: LimitUsageGrouping) =>
  g === "surface" ? "Surface" : "Model";

export interface LimitUsageSegment {
  date: Date;
  day: string;
  series: string;
  usedPercent: number;
}
export const limitUsageSegmentId = (s: LimitUsageSegment) => s.day + s.series;

const limitUsageSeriesLimit = 5;
export const limitUsageOtherSeries = "Other";

export function limitUsageSurfaceLabel(surface: string): string {
  switch (surface) {
    case "cli":
      return "CLI";
    case "exec":
      return "Exec";
    case "desktop_app":
      return "Desktop app";
    case "work_desktop":
      return "Desktop app (work)";
    case "vscode":
      return "IDE extension";
    case "jetbrains":
      return "JetBrains";
    case "web":
      return "Cloud";
    case "work_web":
      return "Cloud (work)";
    case "mobile":
      return "Mobile";
    case "work_mobile":
      return "Mobile (work)";
    case "github":
      return "GitHub";
    case "github_code_review":
      return "Code review";
    case "slack":
      return "Slack";
    case "linear":
      return "Linear";
    case "sdk":
      return "SDK";
    case "agent_identity":
      return "Agent identity";
    default:
      return limitUsageOtherSeries;
  }
}

export function limitUsageModelLabel(model: LimitUsageModel): string {
  return model.speed === "fast" ? model.model + " fast" : model.model;
}

/** Stacked segments per day, keeping the largest series over the period and
 *  folding the tail into "Other" so the legend stays readable. */
export function limitUsageSegments(
  days: LimitUsageDay[],
  grouping: LimitUsageGrouping,
): LimitUsageSegment[] {
  const perDay = days.map((day) => {
    const values: [string, number][] =
      grouping === "surface"
        ? day.surfaces.map((s) => [limitUsageSurfaceLabel(s.surface), s.usedPercent])
        : day.models.map((m) => [limitUsageModelLabel(m), m.usedPercent]);
    return { day, values };
  });
  const totals = new Map<string, number>();
  for (const { values } of perDay) {
    for (const [series, percent] of values) totals.set(series, (totals.get(series) ?? 0) + percent);
  }
  const kept = new Set(
    [...totals.entries()]
      .filter(([key]) => key !== limitUsageOtherSeries)
      .sort((a, b) => (a[1] === b[1] ? cmp(a[0], b[0]) : b[1] - a[1]))
      .slice(0, limitUsageSeriesLimit)
      .map(([key]) => key),
  );
  return perDay.flatMap(({ day, values }) => {
    const date = usageDayDate(day.date);
    if (!date) return [];
    const grouped = new Map<string, number>();
    for (const [series, percent] of values) {
      const key = kept.has(series) ? series : limitUsageOtherSeries;
      grouped.set(key, (grouped.get(key) ?? 0) + percent);
    }
    return [...grouped.entries()]
      .filter(([, value]) => value > 0)
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([series, usedPercent]) => ({ date, day: day.date, series, usedPercent }));
  });
}

/** Swift Charts' default categorical palette. */
const seriesPalette = [T.blue, T.green, T.orange, T.purple, T.red, T.cyan, T.yellow, T.pink];

function percentLabel(value: number) {
  return fixed(value, value < 10 ? 1 : 0) + "%";
}

/** Automatic axis values: a "nice" step giving about five ticks from zero. */
function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const dayMs = 86_400_000;

export function CodexLimitUsageChart({ days }: { days: LimitUsageDay[] }) {
  const [grouping, setGrouping] = useState<LimitUsageGrouping>("surface");
  const [selected, setSelected] = useState<Date | null>(null);
  const [plotRef, size] = useChartSize<HTMLDivElement>();

  const segments = limitUsageSegments(days, grouping);
  const seriesOrder = (() => {
    const totals = new Map<string, number>();
    for (const s of segments) totals.set(s.series, (totals.get(s.series) ?? 0) + s.usedPercent);
    return [...totals.entries()]
      .sort((lhs, rhs) => {
        if (lhs[0] === limitUsageOtherSeries) return 1;
        if (rhs[0] === limitUsageOtherSeries) return -1;
        return rhs[1] - lhs[1];
      })
      .map(([key]) => key);
  })();
  const seriesColor = (series: string) =>
    seriesPalette[Math.max(0, seriesOrder.indexOf(series)) % seriesPalette.length]!;
  const selectedDay = selected ? days.find((d) => d.date === quotaDayKey(selected)) : undefined;
  const total = days.reduce((sum, d) => sum + d.usedPercent, 0);

  const tooltip = (day: LimitUsageDay) => {
    const parts =
      grouping === "surface"
        ? day.surfaces
            .slice(0, 3)
            .map((s) => `${limitUsageSurfaceLabel(s.surface)} ${percentLabel(s.usedPercent)}`)
        : day.models
            .slice(0, 3)
            .map((m) => `${limitUsageModelLabel(m)} ${percentLabel(m.usedPercent)}`);
    return [day.date + " · " + percentLabel(day.usedPercent), ...parts].join(" · ");
  };

  // MARK: Scales

  const dates = segments.map((s) => s.date.getTime());
  const first = dates.length ? startOfDay(new Date(Math.min(...dates))) : startOfDay(new Date());
  const lastDay = dates.length ? startOfDay(new Date(Math.max(...dates))) : first;
  const xLower = first.getTime();
  const xUpper = addDays(lastDay, 1).getTime();
  const dayCount = Math.max(1, Math.round((xUpper - xLower) / dayMs));

  const stacks = new Map<number, number>();
  for (const s of segments) {
    const key = s.date.getTime();
    stacks.set(key, (stacks.get(key) ?? 0) + s.usedPercent);
  }
  const yTicks = niceTicks(Math.max(0, ...stacks.values()));
  const yMax = yTicks[yTicks.length - 1] || 1;

  const width = size.width;
  const height = size.height;
  const yLabelWidth = Math.ceil(Math.max(...yTicks.map((v) => chartTextWidth(percentLabel(v), 10))));
  const plotX0 = yLabelWidth + 5;
  const plotY0 = 6;
  const plotW = Math.max(0, width - plotX0);
  const plotBottom = Math.max(plotY0, height - 17);
  const xOf = (time: number) => plotX0 + ((time - xLower) / (xUpper - xLower)) * plotW;
  const yOf = (value: number) => plotBottom - (value / yMax) * (plotBottom - plotY0);
  const dayWidth = plotW / dayCount;
  const barWidth = Math.max(1, dayWidth * 0.8);

  const stride = [1, 2, 3, 7, 14, 30, 60].find((s) => dayCount / s <= 6) ?? 90;
  const xTicks: Date[] = [];
  for (let date = first; date.getTime() < xUpper; date = addDays(date, stride)) xTicks.push(date);

  const selectAt = (event: PointerEvent<SVGSVGElement>) => {
    if (!(plotW > 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(plotW - 0.01, event.clientX - rect.left - plotX0));
    setSelected(new Date(xLower + (x / plotW) * (xUpper - xLower)));
  };

  const bars: { key: string; x: number; y: number; h: number; fill: string; title: string }[] = [];
  const offsets = new Map<number, number>();
  for (const s of segments) {
    const key = s.date.getTime();
    const base = offsets.get(key) ?? 0;
    offsets.set(key, base + s.usedPercent);
    const center = xOf(key + dayMs / 2);
    bars.push({
      key: s.day + s.series,
      x: center - barWidth / 2,
      y: yOf(base + s.usedPercent),
      h: Math.max(0, yOf(base) - yOf(base + s.usedPercent)),
      fill: seriesColor(s.series),
      title: `${s.day} ${s.series}: ${percentLabel(s.usedPercent)}`,
    });
  }

  const labelStyle: CSSProperties = {
    position: "absolute",
    fontSize: 10,
    lineHeight: "12px",
    color: T.muted,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
          Weekly limit used per day
        </span>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Group weekly limit usage by"
          style={{ width: 160, flexShrink: 0 }}
        >
          {limitUsageGroupings.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={grouping === g}
              className={grouping === g ? "selected" : undefined}
              style={{ flex: 1 }}
              onClick={() => setGrouping(g)}
            >
              {limitUsageGroupingLabel(g)}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span
          className="ellipsis"
          style={{
            fontSize: 10,
            color: T.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {selectedDay ? tooltip(selectedDay) : `${percentLabel(total)} over ${days.length} days`}
        </span>
      </div>

      <div style={{ height: 210, display: "flex", flexDirection: "column", gap: 8 }}>
        <div ref={plotRef} style={{ position: "relative", flex: 1, minHeight: 0 }}>
          {width > 0 && height > 0 && (
            <>
              <svg
                width={width}
                height={height}
                style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  selectAt(event);
                }}
                onPointerMove={(event) => {
                  if (event.buttons & 1) selectAt(event);
                }}
                onPointerUp={() => setSelected(null)}
                onPointerCancel={() => setSelected(null)}
              >
                {yTicks.map((v) => (
                  <line
                    key={`grid-${v}`}
                    x1={plotX0}
                    y1={yOf(v)}
                    x2={plotX0 + plotW}
                    y2={yOf(v)}
                    stroke={T.grid}
                    strokeWidth={0.5}
                  />
                ))}
                {bars.map((bar) => (
                  <rect
                    key={bar.key}
                    x={bar.x}
                    y={bar.y}
                    width={barWidth}
                    height={bar.h}
                    fill={bar.fill}
                  >
                    <title>{bar.title}</title>
                  </rect>
                ))}
                {selected && (
                  <line
                    x1={xOf(startOfDay(selected).getTime() + dayMs / 2)}
                    y1={plotY0}
                    x2={xOf(startOfDay(selected).getTime() + dayMs / 2)}
                    y2={plotBottom}
                    stroke={alpha(T.muted, 0.4)}
                    strokeWidth={1}
                  />
                )}
              </svg>
              {yTicks.map((v) => (
                <span
                  key={`y-${v}`}
                  className="tabular"
                  style={{ ...labelStyle, right: width - yLabelWidth, top: yOf(v) - 6 }}
                >
                  {percentLabel(v)}
                </span>
              ))}
              {xTicks.map((date) => (
                <span
                  key={`x-${date.getTime()}`}
                  style={{ ...labelStyle, left: xOf(date.getTime()), top: plotBottom + 4 }}
                >
                  {fmtMonthDay(date)}
                </span>
              ))}
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            columnGap: 12,
            rowGap: 4,
            fontSize: 10,
            lineHeight: "12px",
            color: T.muted,
          }}
        >
          {seriesOrder.map((series) => (
            <span key={series} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: seriesColor(series),
                  flexShrink: 0,
                }}
              />
              {series}
            </span>
          ))}
        </div>
      </div>

      <span style={{ fontSize: 10, color: T.muted }}>
        Share of the weekly limit consumed each day, as reported by ChatGPT’s Codex usage
        dashboard.
      </span>
    </div>
  );
}
