// Port of QuotaChart.swift. Swift Charts content is drawn by hand in SVG, with
// annotations as HTML overlays positioned in the same coordinate space.
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { T, alpha } from "../components/Theme";
import {
  fixed,
  fmtDateTime,
  fmtTime,
  fmtWeekdayDay,
  quotaChartAxisDates,
  quotaChartAxisLabel,
  quotaChartCursorLabel,
  quotaChartDayBands,
  quotaChartDeltaSegments,
  quotaChartDeltaText,
  quotaChartDrawnSamples,
  quotaChartGridDates,
  quotaChartIdealRemaining,
  quotaChartPercentLabel,
  quotaChartRangeLabel,
  quotaChartReading,
  quotaChartScale,
  quotaChartStep,
  quotaChartWindow,
  quotaRecordedSegments,
  readingPaceDelta,
  readingValue,
  type Forecast,
  type QuotaChartRange,
  type QuotaSample,
  type Range,
} from "../lib/usage";

const LOCALE = "en-US";

export function quotaChartRecordedStroke(ahead: boolean, color: string): string {
  return ahead ? color : T.behind;
}

// MARK: Chart helpers (shared with CodexLimitUsageChart)

/** Tracks an element's content size with a ResizeObserver. */
export function useChartSize<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (width: number, height: number) =>
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    update(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) update(rect.width, rect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

let measureContext: CanvasRenderingContext2D | null = null;

/** Width of a single line of text in the app font. */
export function chartTextWidth(text: string, size: number, weight = 400): number {
  if (typeof document === "undefined") return text.length * size * 0.6;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * size * 0.6;
  const family = getComputedStyle(document.body).fontFamily || "system-ui";
  measureContext.font = `${weight} ${size}px ${family}`;
  return measureContext.measureText(text).width;
}

export type ChartAnnotationPosition =
  | "top"
  | "bottom"
  | "bottomLeading"
  | "topLeading"
  | "topTrailing"
  | "overlay"
  | "leadingTop";

/**
 * A chart `.annotation`: `gap` is the spacing plus the mark's half size; `fit` keeps the
 * annotation inside the chart bounds (`overflowResolution: .fit(to: .chart)`).
 */
export function ChartAnnotation({
  x,
  y,
  position,
  gap = 0,
  fitX = false,
  fitY = false,
  bounds,
  children,
}: {
  x: number;
  y: number;
  position: ChartAnnotationPosition;
  gap?: number;
  fitX?: boolean;
  fitY?: boolean;
  bounds: { width: number; height: number };
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    if (!size || size.w !== w || size.h !== h) setSize({ w, h });
  });
  let left = x;
  let top = y;
  if (size) {
    const { w, h } = size;
    switch (position) {
      case "top":
        left = x - w / 2;
        top = y - gap - h;
        break;
      case "bottom":
        left = x - w / 2;
        top = y + gap;
        break;
      case "bottomLeading":
        left = x - gap - w;
        top = y + gap;
        break;
      case "topLeading":
        left = x - gap - w;
        top = y - gap - h;
        break;
      case "topTrailing":
        left = x + gap;
        top = y - gap - h;
        break;
      case "overlay":
        left = x - w / 2;
        top = y - h / 2;
        break;
      case "leadingTop":
        left = x - gap - w;
        top = y;
        break;
    }
    if (fitX) left = Math.max(0, Math.min(bounds.width - w, left));
    if (fitY) top = Math.max(0, Math.min(bounds.height - h, top));
  }
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left,
        top,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        visibility: size ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}

const containsDate = (range: Range, date: Date) => date >= range.lower && date <= range.upper;
const polyline = (points: [number, number][]) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");

// MARK: QuotaChart

export interface QuotaChartProps {
  forecast: Forecast;
  samples: QuotaSample[];
  color: string;
  compact?: boolean;
  range?: QuotaChartRange;
  now?: Date;
  resetLabel?: string;
  height?: number | null;
  /** Beside a full summary, the idle badge only repeats the hero numbers. */
  idleBadge?: boolean | null;
  /** Split Deck style: no header or day bands, edge-only axis labels, and in-chart
   *  labels for now, even pace, the reset outcome and any lockout before reset. */
  minimal?: boolean;
}

export function QuotaChart(props: QuotaChartProps) {
  const range = props.range ?? "rte";
  const now = props.now ?? new Date();
  const domain = quotaChartWindow(range, props.forecast, now);
  // `.id(...)` resets the selection when the range or its window changes.
  const key = range + fmtDateTime(domain.lower) + fmtDateTime(domain.upper);
  return <QuotaChartBody key={key} {...props} range={range} now={now} />;
}

function QuotaChartBody({
  forecast,
  samples,
  color,
  compact = false,
  range = "rte",
  now = new Date(),
  resetLabel = "Reset",
  height = null,
  idleBadge = null,
  minimal = false,
}: QuotaChartProps) {
  const [selected, setSelected] = useState<Date | null>(null);
  const muted = compact || minimal ? T.quotaMuted : T.muted;
  const showsBadge = selected != null || (idleBadge ?? compact);
  const domain = quotaChartWindow(range, forecast, now);
  const scale = minimal ? domain : quotaChartScale(range, forecast, now);
  const showsForecast = range === "rte" && forecast.projectedUse != null;
  const runsOut = showsForecast && forecast.projectedEnd < forecast.reset;
  const gridDates = quotaChartGridDates(range, forecast, now);
  const showsIdeal = range === "rte" || range === "rtd";
  const cursor = selected ?? forecast.observedAt;
  const drawnSamples = quotaChartDrawnSamples(samples);
  const reading = quotaChartReading(cursor, drawnSamples, forecast, range);
  const value = readingValue(reading);
  const paceDelta = readingPaceDelta(reading);

  const cursorStroke =
    minimal && !reading.projected
      ? color
      : quotaChartRecordedStroke((paceDelta ?? 0) >= 0, color);
  const forecastStroke = minimal
    ? runsOut
      ? T.behind
      : color
    : quotaChartRecordedStroke(
        forecast.remaining >= quotaChartIdealRemaining(forecast.observedAt, forecast),
        color,
      );

  const accessibilityValue = (() => {
    const parts = [
      `${quotaChartPercentLabel(value)} remaining at ${quotaChartCursorLabel(cursor, range)}`,
    ];
    const delta = quotaChartDeltaText(paceDelta);
    if (delta) parts.push(delta + " pace");
    if (reading.projected) parts.push("Projected");
    parts.push(quotaChartRangeLabel(range));
    return parts.join(". ") + ".";
  })();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? true
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? false
          : null;
    if (forward == null) return;
    event.preventDefault();
    setSelected(quotaChartStep(cursor, forward, gridDates, domain));
  };

  // MARK: Header

  const series = (title: string, seriesValue: number | null, stroke: string, dashed: boolean) => (
    <span
      key={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <svg width={12} height={2} style={{ overflow: "visible", flexShrink: 0 }}>
        <line
          x1={0}
          y1={1}
          x2={12}
          y2={1}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={dashed ? "3 3" : undefined}
        />
      </svg>
      <span style={{ color: muted }}>{title}</span>
      <span className="tabular" style={{ color: T.ink }}>
        {quotaChartPercentLabel(seriesValue)}
      </span>
    </span>
  );

  const headerSeries = (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 12, flexShrink: 0 }}>
      {series("Recorded", reading.recorded, cursorStroke, false)}
      {showsForecast && series("Forecast", reading.forecast, forecastStroke, true)}
      {showsIdeal && series("Pace", reading.ideal, muted, true)}
    </span>
  );

  const cursorDate = quotaChartCursorLabel(cursor, range);
  const prefix = reading.projected ? "Projected · " : selected == null ? "Latest · " : "";
  const short =
    range === "today"
      ? cursorDate
      : new Intl.DateTimeFormat(LOCALE, { month: "numeric", day: "numeric", hour: "numeric" })
          .format(cursor);

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: compact ? 0 : 12,
        width: "100%",
        minWidth: 0,
      }}
    >
      {!compact && headerSeries}
      <CursorLabel
        candidates={[prefix + cursorDate, cursorDate, short]}
        color={muted}
        alignEnd={!compact}
      />
    </div>
  );

  // MARK: Layout

  const [containerRef, size] = useChartSize<HTMLDivElement>();
  const hatchId = "quota-hatch-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const chartHeight = height ?? (compact ? 176 : 214);
  const width = size.width;
  const yValues = minimal ? [0, 100] : compact ? [0, 50, 100] : [0, 25, 50, 75, 100];
  const yLabelWidth = Math.ceil(Math.max(...yValues.map((v) => chartTextWidth(`${v}%`, 10))));
  const plotX0 = yLabelWidth + 5;
  const plotY0 = minimal ? 0 : 6;
  const plotW = Math.max(0, width - plotX0);
  const plotH = Math.max(0, chartHeight - plotY0 - (minimal ? 15 : 19));
  const plotBottom = plotY0 + plotH;
  const endPadding = minimal ? 0 : compact ? 12 : 26;
  const xSpan = Math.max(1, scale.upper.getTime() - scale.lower.getTime());
  const xWidth = Math.max(0, plotW - endPadding);
  const xOf = (date: Date) =>
    plotX0 + ((date.getTime() - scale.lower.getTime()) / xSpan) * xWidth;
  const yTop = plotY0 + (minimal ? 16 : 0);
  const yOf = (remaining: number) => yTop + (1 - remaining / 100) * (plotBottom - yTop);
  const bounds = { width, height: chartHeight };

  const selectAt = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(plotW, event.clientX - rect.left - plotX0));
    if (xWidth <= 0) return;
    setSelected(new Date(scale.lower.getTime() + (x / xWidth) * xSpan));
  };

  const axisDates = minimal
    ? [domain.lower, domain.upper]
    : quotaChartAxisDates(range, forecast, now);
  const deltaSegments = showsIdeal ? quotaChartDeltaSegments(drawnSamples, forecast) : [];

  // MARK: Marks

  const marks: ReactNode[] = [];
  const annotations: ReactNode[] = [];

  if (!minimal) {
    quotaChartDayBands(range, forecast, now).forEach((band, index) => {
      if (!band.isCurrent) return;
      marks.push(
        <rect
          key={`band-${index}`}
          x={xOf(band.start)}
          y={yOf(100)}
          width={Math.max(0, xOf(band.end) - xOf(band.start))}
          height={Math.max(0, yOf(0) - yOf(100))}
          fill={alpha(color, 0.07)}
        />,
      );
    });
  }

  if (minimal && runsOut) {
    const x0 = xOf(forecast.projectedEnd);
    const x1 = xOf(forecast.reset);
    marks.push(
      <rect
        key="lockout"
        x={x0}
        y={yOf(100)}
        width={Math.max(0, x1 - x0)}
        height={Math.max(0, yOf(0) - yOf(100))}
        fill={`url(#${hatchId})`}
      />,
    );
    annotations.push(
      <ChartAnnotation
        key="lockout"
        x={(x0 + x1) / 2}
        y={(yOf(0) + yOf(100)) / 2}
        position="overlay"
        bounds={bounds}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            color: T.behind,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, lineHeight: "13px" }}>Locked out</span>
          <span className="tabular" style={{ fontSize: 10.5, lineHeight: "13px" }}>
            {quotaDurationLabel(
              (forecast.reset.getTime() - forecast.projectedEnd.getTime()) / 1000,
            )}
          </span>
        </div>
      </ChartAnnotation>,
    );
  }

  if (showsIdeal) {
    deltaSegments.forEach((segment, index) => {
      const top = segment.points.map((p) => [xOf(p.date), yOf(p.recorded)] as [number, number]);
      const bottom = [...segment.points]
        .reverse()
        .map((p) => [xOf(p.date), yOf(p.ideal)] as [number, number]);
      marks.push(
        <path
          key={`pace-delta-${index}`}
          d={polyline([...top, ...bottom]) + " Z"}
          fill={alpha(segment.ahead ? T.ahead : T.behind, minimal ? 0.2 : 0.28)}
        />,
      );
    });
  } else if (drawnSamples.length > 0) {
    const top = drawnSamples.map((s) => [xOf(s.date), yOf(s.remaining)] as [number, number]);
    const first = drawnSamples[0]!;
    const last = drawnSamples[drawnSamples.length - 1]!;
    marks.push(
      <path
        key="recorded-area"
        d={polyline([...top, [xOf(last.date), yOf(0)], [xOf(first.date), yOf(0)]]) + " Z"}
        fill={alpha(color, 0.12)}
      />,
    );
  }

  if (showsIdeal) {
    const end = domain.upper < forecast.reset ? domain.upper : forecast.reset;
    marks.push(
      <path
        key="pace"
        d={polyline([
          [xOf(domain.lower), yOf(quotaChartIdealRemaining(domain.lower, forecast))],
          [xOf(end), yOf(quotaChartIdealRemaining(end, forecast))],
        ])}
        fill="none"
        stroke={muted}
        strokeWidth={minimal ? 1.25 : 1.5}
        strokeDasharray={minimal ? "3 4" : "4 4"}
      />,
    );
  }

  if (minimal && showsIdeal) {
    const date = quotaChartPaceLabelDate(forecast);
    const ahead = forecast.remaining >= quotaChartIdealRemaining(forecast.observedAt, forecast);
    annotations.push(
      <ChartAnnotation
        key="pace-label"
        x={xOf(date)}
        y={yOf(quotaChartIdealRemaining(date, forecast))}
        position={ahead ? "bottomLeading" : "topTrailing"}
        gap={2}
        fitX
        fitY
        bounds={bounds}
      >
        <span style={{ fontSize: 10, lineHeight: "12px", color: muted }}>even pace</span>
      </ChartAnnotation>,
    );
  }

  if (showsIdeal) {
    deltaSegments.forEach((segment, index) => {
      marks.push(
        <path
          key={`recorded-${index}`}
          d={polyline(segment.points.map((p) => [xOf(p.date), yOf(p.recorded)]))}
          fill="none"
          stroke={minimal ? color : quotaChartRecordedStroke(segment.ahead, color)}
          strokeWidth={minimal ? 2.25 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
      );
    });
  } else {
    // Until-reset ranges always connect collector gaps (`connectsRecordedGaps`).
    quotaRecordedSegments(drawnSamples, true).forEach((segment, index) => {
      marks.push(
        <path
          key={`recorded-${index}`}
          d={polyline(segment.map((s) => [xOf(s.date), yOf(s.remaining)]))}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
        />,
      );
      if (segment.length === 1) {
        const sample = segment[0]!;
        marks.push(
          <circle
            key={`recorded-point-${index}`}
            cx={xOf(sample.date)}
            cy={yOf(sample.remaining)}
            r={Math.sqrt(18) / 2}
            fill={color}
          />,
        );
      }
    });
  }

  if (showsForecast) {
    marks.push(
      <path
        key="forecast"
        d={polyline([
          [xOf(forecast.observedAt), yOf(forecast.remaining)],
          [xOf(forecast.projectedEnd), yOf(forecast.projectedRemaining)],
        ])}
        fill="none"
        stroke={alpha(forecastStroke, minimal ? 0.85 : 0.8)}
        strokeWidth={minimal ? 1.75 : 2}
        strokeDasharray={minimal ? "5 4" : "6 5"}
      />,
    );
  }

  if (minimal && showsForecast) {
    const stroke = runsOut ? T.behind : color;
    const x = xOf(forecast.projectedEnd);
    const y = yOf(forecast.projectedRemaining);
    marks.push(
      <circle
        key="forecast-end"
        cx={x}
        cy={y}
        r={2.75}
        fill={T.background}
        stroke={stroke}
        strokeWidth={1.5}
      />,
    );
    annotations.push(
      <ChartAnnotation
        key="forecast-end"
        x={x}
        y={y}
        position={
          runsOut ? "topTrailing" : forecast.projectedRemaining >= 15 ? "bottomLeading" : "topLeading"
        }
        gap={4 + 3.5}
        fitX
        fitY
        bounds={bounds}
      >
        <span
          className="tabular"
          style={{ fontSize: 11, fontWeight: 600, lineHeight: "13px", color: stroke }}
        >
          {runsOut
            ? "Empty " + quotaChartRunOutLabel(forecast)
            : "~" + quotaPercentText(forecast.projectedRemaining) + " at reset"}
        </span>
      </ChartAnnotation>,
    );
  }

  if (showsIdeal && range === "rte" && containsDate(domain, forecast.reset)) {
    const x = xOf(forecast.reset);
    marks.push(
      <line
        key="reset"
        x1={x}
        y1={plotY0}
        x2={x}
        y2={plotBottom}
        stroke={alpha(muted, 0.55)}
        strokeWidth={1}
        strokeDasharray="3 3"
      />,
    );
    if (!minimal) {
      annotations.push(
        <ChartAnnotation key="reset" x={x} y={plotY0} position="leadingTop" gap={4} bounds={bounds}>
          <span style={{ fontSize: 10, fontWeight: 500, lineHeight: "12px", color: muted }}>
            {resetLabel}
          </span>
        </ChartAnnotation>,
      );
    }
  }

  if (containsDate(domain, cursor)) {
    const x = xOf(cursor);
    if (minimal && selected == null) {
      marks.push(
        <line
          key="cursor"
          x1={x}
          y1={yOf(0)}
          x2={x}
          y2={yOf(100)}
          stroke={alpha(color, 0.5)}
          strokeWidth={1}
        />,
      );
      annotations.push(
        <ChartAnnotation key="now" x={x} y={yOf(100)} position="top" gap={3} fitX bounds={bounds}>
          <span style={{ fontSize: 10, fontWeight: 600, lineHeight: "12px", color }}>Now</span>
        </ChartAnnotation>,
      );
    } else {
      marks.push(
        <line
          key="cursor"
          x1={x}
          y1={plotY0}
          x2={x}
          y2={plotBottom}
          stroke={alpha(color, selected == null ? 0.35 : 0.5)}
          strokeWidth={1}
        />,
      );
    }
    if (value != null) {
      const radius = Math.sqrt(reading.projected ? 30 : 48) / 2;
      marks.push(
        <circle
          key="cursor-point"
          cx={x}
          cy={yOf(value)}
          r={radius}
          fill={reading.projected ? alpha(cursorStroke, 0.6) : cursorStroke}
        />,
      );
      if (showsBadge) {
        annotations.push(
          <ChartAnnotation
            key="badge"
            x={x}
            y={yOf(value)}
            position="top"
            gap={(compact ? 4 : 8) + radius}
            fitX
            fitY
            bounds={bounds}
          >
            <DeltaBadge
              value={value}
              delta={paceDelta}
              compact={compact}
              muted={muted}
            />
          </ChartAnnotation>,
        );
      }
    }
  }

  // MARK: Axes

  const gridLines = (
    <g>
      {gridDates.map((date) => {
        const x = xOf(date);
        return (
          <line
            key={`x-grid-${date.getTime()}`}
            x1={x}
            y1={plotY0}
            x2={x}
            y2={plotBottom}
            stroke={minimal ? T.line : T.grid}
            strokeWidth={minimal ? 0.5 : 1}
          />
        );
      })}
      {yValues.map((v) => {
        const isBaseline = minimal && v === 0;
        const y = yOf(v);
        return (
          <line
            key={`y-grid-${v}`}
            x1={plotX0}
            y1={y}
            x2={plotX0 + plotW}
            y2={y}
            stroke={isBaseline ? T.grid : T.line}
            strokeWidth={isBaseline ? 1 : 0.5}
            strokeDasharray={isBaseline ? undefined : "3 5"}
          />
        );
      })}
      {!minimal &&
        axisDates.map((date) => {
          const x = xOf(date);
          return (
            <line
              key={`x-tick-${date.getTime()}`}
              x1={x}
              y1={plotBottom}
              x2={x}
              y2={plotBottom + 4}
              stroke={T.grid}
              strokeWidth={1}
            />
          );
        })}
    </g>
  );

  const axisLabelStyle: CSSProperties = {
    position: "absolute",
    fontSize: 10,
    lineHeight: "12px",
    color: muted,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };

  const axisLabels = (
    <>
      {yValues.map((v) => (
        <span
          key={`y-label-${v}`}
          className="tabular"
          style={{ ...axisLabelStyle, right: width - yLabelWidth, top: yOf(v) - 6 }}
        >
          {`${v}%`}
        </span>
      ))}
      {axisDates.map((date, index) => {
        const x = xOf(date);
        if (minimal) {
          const isStart = index === 0;
          return (
            <span
              key={`x-label-${index}`}
              className="tabular"
              style={{
                ...axisLabelStyle,
                top: plotBottom + 2,
                ...(isStart ? { left: x } : { right: width - x }),
              }}
            >
              {quotaChartEdgeLabel(date, isStart, forecast)}
            </span>
          );
        }
        return (
          <span
            key={`x-label-${index}`}
            className="tabular"
            style={{
              ...axisLabelStyle,
              top: plotBottom + 6,
              left: x,
              transform: "translateX(-50%)",
            }}
          >
            {quotaChartAxisLabel(date, range, axisDates, compact)}
          </span>
        );
      })}
    </>
  );

  const chart = (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: chartHeight, flexShrink: 0 }}
    >
      {width > 0 && (
        <>
          <svg
            width={width}
            height={chartHeight}
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
            <defs>
              <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse">
                {[-6, 0, 6].map((offset) => (
                  <line
                    key={offset}
                    x1={offset - 1}
                    y1={7}
                    x2={offset + 7}
                    y2={-1}
                    stroke={alpha(T.red, 0.3)}
                    strokeWidth={1.6}
                  />
                ))}
              </pattern>
            </defs>
            {gridLines}
            {marks}
          </svg>
          {axisLabels}
          {annotations}
        </>
      )}
    </div>
  );

  return (
    <div
      tabIndex={0}
      role="slider"
      aria-label="Quota forecast"
      aria-valuetext={accessibilityValue}
      aria-description="Adjust to move the cursor one day at a time."
      onKeyDown={onKeyDown}
      title="Drag across the chart to read remaining quota at any time. Recorded holds until the next live reading, then steps with each drop. Missing collector gaps stay connected. Pace spreads the weekly limit evenly until reset. Forecast projects observed usage until the next reset. The recorded line and fill stay green while remaining is ahead of pace, and turn red where remaining falls behind."
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: compact ? 8 : 10,
        outline: "none",
        minWidth: 0,
      }}
    >
      {!minimal && header}
      {chart}
    </div>
  );
}

/** `ViewThatFits` over the cursor label variants, then a 0.8 minimum scale. */
function CursorLabel({
  candidates,
  color,
  alignEnd,
}: {
  candidates: string[];
  color: string;
  alignEnd: boolean;
}) {
  const [ref, size] = useChartSize<HTMLDivElement>();
  const available = size.width;
  let text = candidates[candidates.length - 1] ?? "";
  let fontSize = 12;
  const fitting = candidates.find((c) => chartTextWidth(c, 12) <= available + 0.5);
  if (fitting != null) {
    text = fitting;
  } else if (available > 0) {
    fontSize = Math.max(9.6, Math.min(12, (12 * available) / chartTextWidth(text, 12)));
  }
  return (
    <div
      ref={ref}
      className="tabular"
      style={{
        flex: "1 1 0",
        minWidth: 0,
        fontSize,
        lineHeight: "15px",
        color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: alignEnd ? "right" : "left",
        marginLeft: alignEnd ? 4 : 0,
      }}
    >
      {text}
    </div>
  );
}

function DeltaBadge({
  value,
  delta,
  compact,
  muted,
}: {
  value: number | null;
  delta: number | null;
  compact: boolean;
  muted: string;
}) {
  const tone = delta == null ? muted : delta < -0.05 ? T.behind : T.ahead;
  const text = (() => {
    if (delta == null) return null;
    if (compact) {
      if (Math.abs(delta) < 0.05) return "pace";
      const magnitude = fixed(Math.abs(delta), 1);
      return delta > 0 ? `+${magnitude}%` : `−${magnitude}%`;
    }
    return quotaChartDeltaText(delta);
  })();
  const fontSize = compact ? 9.5 : 11;
  return (
    <div
      className="tabular"
      style={{
        position: "relative",
        isolation: "isolate",
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 3 : 6,
        fontSize,
        fontWeight: 500,
        lineHeight: `${Math.round(fontSize * 1.2)}px`,
        padding: compact ? "2.5px 6px" : "4px 8px",
        borderRadius: 999,
        boxShadow: `inset 0 0 0 0.5px rgba(255, 255, 255, ${compact ? 0.1 : 0.16})`,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: "var(--popover)",
          backdropFilter: "blur(12px) saturate(1.6)",
          opacity: compact ? 0.58 : 0.86,
          zIndex: -1,
        }}
      />
      <span style={{ color: alpha(T.ink, compact ? 0.88 : 0.94) }}>
        {quotaChartPercentLabel(value)}
      </span>
      {text != null && (
        <>
          <span style={{ color: alpha(muted, 0.55) }}>·</span>
          <span style={{ color: alpha(tone, 0.88) }}>{text}</span>
        </>
      )}
    </div>
  );
}

// MARK: Free functions

/** Edge labels for a minimal until-reset chart: clock times for short windows,
 *  weekday and day at the start of longer windows, weekday and time at the reset. */
export function quotaChartEdgeLabel(date: Date, isStart: boolean, forecast: Forecast): string {
  if (forecast.duration <= 86_400) return fmtTime(date);
  return isStart
    ? fmtWeekdayDay(date)
    : new Intl.DateTimeFormat(LOCALE, { weekday: "short", hour: "numeric", minute: "2-digit" })
        .format(date);
}

/** Short run-out label for the chart: the time within a day, the weekday otherwise. */
export function quotaChartRunOutLabel(forecast: Forecast): string {
  return forecast.duration <= 86_400
    ? fmtTime(forecast.projectedEnd)
    : new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(forecast.projectedEnd);
}

/** Places the "even pace" label ahead of now, before any run-out, or behind now
 *  when too little of the window is left to fit it. */
export function quotaChartPaceLabelDate(forecast: Forecast): Date {
  const end =
    (forecast.projectedEnd.getTime() - forecast.start.getTime()) / 1000 / forecast.duration;
  const fraction =
    end - forecast.elapsed >= 0.25
      ? forecast.elapsed + (end - forecast.elapsed) * 0.5
      : forecast.elapsed * 0.5;
  return new Date(forecast.start.getTime() + forecast.duration * fraction * 1000);
}

const percentTextFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** Whole percentages stay whole ("90%"); anything else keeps one decimal ("96.5%"). */
export function quotaPercentText(value: number): string {
  return percentTextFormat.format(value) + "%";
}

/** "2h 22m", "45m", or "1d 4h" for spans longer than a day. */
export function quotaDurationLabel(seconds: number): string {
  const minutes = Math.trunc(Math.max(0, seconds) / 60);
  const days = Math.trunc(minutes / 1_440);
  const hours = Math.trunc((minutes % 1_440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${minutes}m`;
}
