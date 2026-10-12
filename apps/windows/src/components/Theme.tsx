// Port of Theme.swift and QuotaFreshnessView.swift.
import {
  AppWindow,
  BookOpen,
  ChartColumn,
  ChartNoAxesColumn,
  ChevronRight,
  CircleAlert,
  CircleArrowDown,
  CircleCheck,
  Clock,
  ClockAlert,
  Code,
  Compass,
  Cpu,
  CreditCard,
  DollarSign,
  Flame,
  Gauge,
  HardDrive,
  History,
  Info,
  Layers,
  LayoutGrid,
  Power,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useStore, useNow } from "../store/UsageStore";
import { Forecast, harnessName } from "../lib/usage";

import amp from "../assets/brands/amp.png";
import claude from "../assets/brands/claude.png";
import codex from "../assets/brands/codex.png";
import cursor from "../assets/brands/cursor.png";
import droid from "../assets/brands/droid.png";
import gemini from "../assets/brands/gemini.png";
import kimi from "../assets/brands/kimi.png";
import openclaw from "../assets/brands/openclaw.png";
import opencode from "../assets/brands/opencode.png";
import pi from "../assets/brands/pi.png";
import qwen from "../assets/brands/qwen.png";


// MARK: Tokens

export const T = {
  background: "var(--background)",
  surface: "var(--surface)",
  elevated: "var(--elevated)",
  ink: "var(--ink)",
  muted: "var(--muted)",
  tertiary: "var(--tertiary)",
  accent: "var(--accent)",
  green: "var(--green)",
  line: "var(--line)",
  grid: "var(--grid)",
  flame: "var(--flame)",
  card: "var(--card)",
  cardStroke: "var(--card-stroke)",
  track: "var(--track)",
  hover: "var(--hover)",
  inset: "var(--inset)",
  ahead: "var(--ahead)",
  behind: "var(--behind)",
  quotaMuted: "var(--quota-muted)",
  orange: "var(--orange)",
  red: "var(--red)",
  blue: "var(--blue)",
  purple: "var(--purple)",
  indigo: "var(--indigo)",
  teal: "var(--teal)",
  yellow: "var(--yellow)",
  cyan: "var(--cyan)",
  pink: "var(--pink)",
  gray: "var(--gray)",
} as const;

export function quotaColor(agent: string) {
  return agent === "claude" ? "var(--quota-claude)" : "var(--quota-other)";
}

export function agentColor(agent: string) {
  switch (agent) {
    case "codex":
      return T.green;
    case "claude":
      return T.orange;
    case "cursor":
      return T.purple;
    case "opencode":
      return T.indigo;
    case "openclaw":
      return T.red;
    case "droid":
      return T.teal;
    case "gemini":
      return T.blue;
    case "pi":
      return T.yellow;
    case "kimi":
      return T.cyan;
    case "amp":
      return T.pink;
    default:
      return T.gray;
  }
}

/** `color.opacity(alpha)` for CSS colors and variables. */
export function alpha(color: string, opacity: number) {
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 1000) / 10}%, transparent)`;
}

export const appVersionText = () => `v${__APP_VERSION__}`;

/** SwiftUI `Text(date, style: .relative)`: "2 min, 5 sec". */
export function relativeStyle(date: Date, now: Date) {
  let seconds = Math.max(0, Math.round(Math.abs(now.getTime() - date.getTime()) / 1000));
  const units: [string, string, number][] = [
    ["day", "days", 86_400],
    ["hr", "hr", 3_600],
    ["min", "min", 60],
    ["sec", "sec", 1],
  ];
  const parts: string[] = [];
  for (const [one, many, size] of units) {
    const count = Math.floor(seconds / size);
    if (count > 0 || (size === 1 && parts.length === 0)) {
      parts.push(`${count} ${count === 1 ? one : many}`);
      seconds -= count * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(", ");
}

// MARK: Symbols

const symbols: Record<string, LucideIcon> = {
  flame: Flame,
  "flame.fill": Flame,
  "square.stack.3d.up.fill": Layers,
  "square.stack.3d.up": Layers,
  dollarsign: DollarSign,
  "dollarsign.circle": DollarSign,
  "creditcard.fill": CreditCard,
  creditcard: CreditCard,
  cpu: Cpu,
  "clock.badge.exclamationmark": ClockAlert,
  "info.circle": Info,
  gearshape: Settings,
  "gauge.with.dots.needle.67percent": Gauge,
  "gauge.with.dots.needle.33percent": Gauge,
  "gauge.medium": Gauge,
  gauge: Gauge,
  speedometer: Gauge,
  "square.grid.2x2": LayoutGrid,
  magnifyingglass: Search,
  "chevron.right": ChevronRight,
  "chart.bar.xaxis": ChartColumn,
  "chart.bar.fill": ChartNoAxesColumn,
  safari: Compass,
  power: Power,
  macwindow: AppWindow,
  externaldrive: HardDrive,
  "exclamationmark.circle": CircleAlert,
  "clock.arrow.circlepath": History,
  clock: Clock,
  "chevron.left.forwardslash.chevron.right": Code,
  book: BookOpen,
  "arrow.down.circle": CircleArrowDown,
  "arrow.counterclockwise": RotateCcw,
  "arrow.clockwise": RotateCw,
  "checkmark.circle": CircleCheck,
  "checkmark.circle.fill": CircleCheck,
  "exclamationmark.triangle.fill": TriangleAlert,
};

/** Renders an SF Symbol name with the closest Lucide glyph. */
export function Sym({
  name,
  size = 13,
  weight = 2,
  color,
  className,
  style,
}: {
  name: string;
  size?: number;
  weight?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = symbols[name] ?? Info;
  const filled = name.endsWith(".fill") && (name.startsWith("flame") || name.startsWith("checkmark"));
  return (
    <Icon
      size={size}
      strokeWidth={weight}
      color={color ?? "currentColor"}
      fill={filled && name.startsWith("flame") ? "currentColor" : "none"}
      className={className}
      style={{ flex: "none", ...style }}
      aria-hidden
    />
  );
}

// MARK: Components

const brands: Record<string, string> = {
  amp,
  claude,
  codex,
  cursor,
  droid,
  gemini,
  kimi,
  openclaw,
  opencode,
  pi,
  qwen,
};

export function HarnessIcon({ agent, size = 32 }: { agent: string; size?: number }) {
  const image = brands[agent];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        display: "inline-grid",
        placeItems: "center",
      }}
    >
      {image ? (
        <img src={image} alt="" draggable={false} style={{ width: size, height: size, objectFit: "contain" }} />
      ) : (
        <span style={{ fontSize: size * 0.4, fontWeight: 600, color: T.muted }}>
          {harnessName(agent).slice(0, 2)}
        </span>
      )}
    </span>
  );
}

export function StatusBadge({ text, color = T.green }: { text: string; color?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 9px",
        borderRadius: 999,
        background: alpha(color, 0.09),
        color,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
        flex: "none",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {text}
    </span>
  );
}

export function SectionLabel({ title, detail = "" }: { title: string; detail?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      <span style={{ flex: 1 }} />
      {detail && <span style={{ fontSize: 11, color: T.muted }}>{detail}</span>}
    </div>
  );
}

export function RefreshFooter({ source, compact = false }: { source: string; compact?: boolean }) {
  const store = useStore();
  const now = useNow(1000);
  const updated = store.updated[source];
  const failed = store.errors[source] != null;
  let status: ReactNode;
  if (updated != null) {
    status = (
      <span>
        {failed ? "Last successful update" : "Updated"} {relativeStyle(new Date(updated), now)} ago
      </span>
    );
  } else if (source === "summary" && store.summary != null) {
    status = <span>Saved usage</span>;
  } else if (store.isLoading) {
    status = <span>Updating usage…</span>;
  } else {
    status = <span>Waiting for usage</span>;
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 11,
        color: compact ? T.quotaMuted : T.muted,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          flex: "none",
          background: failed ? T.accent : T.green,
        }}
      />
      {status}
      <span style={{ flex: 1 }} />
      <span className="tabular" aria-label="App version">
        {appVersionText()}
      </span>
      <QuotaCheckButton />
      <button
        className="plain-button"
        disabled={store.isLoading}
        title="Refresh usage and live quotas (Ctrl+R)"
        aria-label="Refresh usage"
        onClick={() => store.refreshAll()}
      >
        <Sym name="arrow.clockwise" size={12} className={store.isLoading ? "pulsing" : undefined} />
      </button>
    </div>
  );
}

/** Hard refresh: re-reads every live quota now instead of waiting for the next background collection. */
export function QuotaCheckButton({ label = false }: { label?: boolean }) {
  const store = useStore();
  return (
    <button
      className="plain-button"
      disabled={store.isCheckingQuotas}
      title="Check live usage now (Ctrl+Shift+R). Bypasses saved readings and renews an expired Claude sign-in."
      aria-label="Check live usage now"
      onClick={() => store.refreshAll(true)}
    >
      <Sym
        name="gauge.with.dots.needle.67percent"
        size={12}
        className={store.isCheckingQuotas ? "pulsing" : undefined}
      />
      {label && <span>Check now</span>}
    </button>
  );
}

export function ReportNotice({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        width: "100%",
        padding: 12,
        borderRadius: 10,
        fontSize: 12,
        color: T.flame,
        background: alpha(T.flame, 0.08),
        userSelect: "text",
      }}
    >
      <Sym name="exclamationmark.circle" size={13} style={{ marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}

/** `.burnCard(padding:radius:)` */
export function Card({
  children,
  padding = 16,
  radius = 14,
  style,
  className,
}: {
  children: ReactNode;
  padding?: number;
  radius?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={"burn-card" + (className ? " " + className : "")}
      style={{ padding, borderRadius: radius, ...style }}
    >
      {children}
    </div>
  );
}

export function IconBadge({
  symbol,
  tint = T.flame,
  size = 22,
}: {
  symbol: string;
  tint?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        display: "inline-grid",
        placeItems: "center",
        borderRadius: size * 0.3,
        background: alpha(tint, 0.14),
        color: tint,
      }}
    >
      <Sym name={symbol} size={size * 0.5} weight={2.4} />
    </span>
  );
}

export function CardHeader({
  title,
  symbol,
  tint = T.flame,
  trailing,
}: {
  title: string;
  symbol?: string;
  tint?: string;
  trailing?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {symbol && <IconBadge symbol={symbol} tint={tint} />}
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      <span style={{ flex: 1, minWidth: 0 }} />
      {trailing != null && (
        <span
          style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

export function MetricTile({
  title,
  value,
  detail = "",
  symbol,
  tint = T.flame,
  compact = false,
}: {
  title: string;
  value: string;
  detail?: string;
  symbol?: string;
  tint?: string;
  compact?: boolean;
}) {
  const secondary = compact ? T.quotaMuted : T.muted;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 8,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {symbol && <IconBadge symbol={symbol} tint={tint} size={compact ? 18 : 20} />}
        <span className="ellipsis" style={{ fontSize: compact ? 11 : 12, fontWeight: 500, color: secondary }}>
          {title}
        </span>
      </div>
      <span
        className="rounded tabular ellipsis"
        style={{ fontSize: compact ? 21 : 24, fontWeight: 600, lineHeight: 1.15 }}
      >
        {value}
      </span>
      {detail && (
        <span className="ellipsis" style={{ fontSize: compact ? 10 : 11, color: secondary }}>
          {detail}
        </span>
      )}
    </div>
  );
}

export function ShareBar({
  value,
  tint = T.flame,
  height = 5,
}: {
  value: number;
  tint?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="share-bar" style={{ height }} aria-hidden>
      <div
        style={{
          width: `max(${height}px, ${clamped * 100}%)`,
          opacity: clamped > 0 ? 1 : 0,
          background: `linear-gradient(to bottom, color-mix(in srgb, ${tint} 85%, white), ${tint})`,
        }}
      />
    </div>
  );
}

export function HoverRow({
  children,
  style,
  onClick,
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div className="hover-row" style={style} onClick={onClick}>
      {children}
    </div>
  );
}

const measuredFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function QuotaFreshnessView({
  forecast,
  error = null,
  compact = false,
}: {
  forecast: Forecast;
  error?: string | null;
  compact?: boolean;
}) {
  const now = useNow(15_000);
  const fresh = forecast.isFresh(now);
  const ok = fresh && error == null;
  const secondary = compact ? T.quotaMuted : T.muted;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10 }}>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: compact ? T.quotaMuted : ok ? T.green : T.orange,
        }}
      >
        <Sym name={ok ? "checkmark.circle.fill" : "clock.badge.exclamationmark"} size={11} />
        {forecast.freshnessLabel(now, error != null)}
      </span>
      {(!compact || !fresh || error != null) && (
        <span style={{ color: secondary }}>Measured {measuredFormat.format(forecast.observedAt)}</span>
      )}
      {error != null && <span style={{ color: secondary, userSelect: "text" }}>{error}</span>}
    </div>
  );
}
