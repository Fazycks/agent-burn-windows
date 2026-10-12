// Port of NativeUsageView.swift (incl. private ModelUsageTable, ActivityChart, SpendSegment).
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Fragment,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Card,
  CardHeader,
  HarnessIcon,
  IconBadge,
  MetricTile,
  ReportNotice,
  ShareBar,
  Sym,
  T,
  agentColor,
  alpha,
} from "../components/Theme";
import {
  addDays,
  addMonths,
  bucketDailyUsage,
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
  percent,
  periodLabel,
  quotaDayKey,
  quotaTokensPerDollar,
  quotaTokensPerUnitLabel,
  spendBucketEnd,
  spendBucketStart,
  spendBucketTooltip,
  spendGranularities,
  spendGranularityAuto,
  spendGranularityLabel,
  spendGranularityTitle,
  spendSpanDays,
  startOfDay,
  startOfMonth,
  tokens,
  usageDayDate,
  type AgentUsage,
  type CursorModelScope,
  type DailyUsage,
  type ModelUsage,
  type QuotaMeterStyle,
  type Range,
  type SpendGranularity,
} from "../lib/usage";
import { useStore, type UsageStore } from "../store/UsageStore";
import { ClaudeAccountView } from "./ClaudeAccountView";
import { CodexLimitUsageChart } from "./CodexLimitUsageChart";
import { CursorAccountView } from "./CursorAccountView";
import { QuotaChart } from "./QuotaChart";
import { HarnessSpendDetails, QuotaChartRangePicker, QuotaSummary, SpendMetric } from "./UsageDetails";

const DAY = 86_400_000;

// MARK: Shared helpers

/** Width of an element, kept current with a ResizeObserver. */
function useWidth<E extends HTMLElement>(): [(node: E | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: E | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const next = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    next.observe(node);
    observer.current = next;
  }, []);
  return [ref, width];
}

/** macOS `DisclosureGroup`: a disclosure chevron plus label that reveals its content. */
export function DisclosureGroup({
  label,
  children,
  isExpanded,
  setIsExpanded,
  labelStyle,
  tint = T.muted,
}: {
  label: string;
  children: ReactNode;
  isExpanded?: boolean;
  setIsExpanded?: (value: boolean) => void;
  labelStyle?: CSSProperties;
  tint?: string;
}) {
  const [internal, setInternal] = useState(false);
  const expanded = isExpanded ?? internal;
  const toggle = () => (setIsExpanded ? setIsExpanded(!expanded) : setInternal(!expanded));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        className="plain-button"
        aria-expanded={expanded}
        onClick={toggle}
        style={{ gap: 6, width: "100%", justifyContent: "flex-start", textAlign: "left", ...labelStyle }}
      >
        <Sym
          name="chevron.right"
          size={11}
          weight={2.6}
          color={tint}
          style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}
        />
        <span>{label}</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  );
}

function Divider() {
  return <div aria-hidden style={{ width: 1, alignSelf: "stretch", flex: "none", background: T.grid }} />;
}

function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  ariaLabel,
  style,
}: {
  options: V[];
  value: V;
  onChange: (value: V) => void;
  label: (value: V) => string;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel} style={{ flex: "none", ...style }}>
      {options.map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={option === value}
          className={option === value ? "selected" : undefined}
          style={{ flex: 1 }}
          onClick={() => onChange(option)}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

// MARK: NativeUsageView

export function NativeUsageView({ agent }: { agent: string | null }) {
  const store = useStore();
  const [modelSearch, setModelSearch] = useState("");
  const [cursorScope, setCursorScope] = useState<CursorModelScope>("allModels");
  const summary = store.summary;
  const own = summary?.agents.find((a) => a.agent === agent);
  const hasCursorCredits = cursorHasPromotionalCredits(summary?.cursorAccount);
  const scoped = agent === "cursor" && !hasCursorCredits;
  const allModels = agent == null ? summary?.models ?? [] : own?.models ?? [];
  const models = scoped ? modelUsage(allModels, cursorScope) : allModels;
  const allDays = agent == null ? summary?.daily ?? [] : own?.daily ?? [];
  const days = scoped ? dailyUsage(allDays, cursorScope) : allDays;
  const cost = agent == null ? summary?.totals.totalCost ?? 0 : own?.totalCost ?? 0;
  const tokenCount = agent == null ? summary?.totals.totalTokens ?? 0 : own?.totalTokens ?? 0;
  const planInAccountHeader =
    agent === "claude" || agent === "cursor" ? true : agent === "codex" ? store.forecast("codex") != null : false;
  const domain = store.chartDomain;
  const recovered = store.recoveredCursor;
  const recoveredModels = recovered?.models;
  const report = agent != null ? store.reports[agent] : undefined;
  const subscriptions = summary?.subscription?.agents.filter((s) => agent == null || s.agent === agent);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 14 }}>
      {summary == null && store.errors["summary"] != null && <ReportNotice message={store.errors["summary"]} />}
      {summary != null ? (
        <>
          <Meters store={store} agent={agent} />
          <StatStrip
            store={store}
            agent={agent}
            cost={cost}
            tokenCount={tokenCount}
            modelCount={models.length}
          />
          <div style={{ display: "flex", alignItems: "stretch", gap: 14 }}>
            <Card style={{ flex: 1, minWidth: 0, width: "auto" }}>
              <ActivityChart
                days={days}
                color={agent != null ? agentColor(agent) : T.flame}
                domain={domain}
                scope={scoped ? cursorScope : undefined}
                setScope={scoped ? setCursorScope : undefined}
                series={agent == null ? summary.agents : []}
              />
            </Card>
            {agent == null && <HarnessList store={store} />}
          </div>
          {store.hasPeriodDetails && (
            <ModelSection
              models={models}
              modelSearch={modelSearch}
              setModelSearch={setModelSearch}
              total={scoped && cursorScope === "cursorModels" ? models.reduce((s, m) => s + m.totalCost, 0) : cost}
            />
          )}
          {agent === "cursor" && store.period === "all" && recovered != null && recoveredModels != null && (
            <Card>
              <DisclosureGroup
                label={`Recovered model history · ${recoveredModels.length} models`}
                labelStyle={{ fontSize: 13, fontWeight: 600 }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12 }}>
                  <span style={{ fontSize: 10, color: T.muted }}>
                    Snapshot: {recovered.daily?.[0]?.date ?? ""} – {recovered.daily?.[recovered.daily.length - 1]?.date ?? ""}
                    . Current-cycle model data is shown above.
                  </span>
                  <div style={{ height: 280 }}>
                    <ModelUsageTable models={recoveredModels} total={recovered.totalCost} />
                  </div>
                </div>
              </DisclosureGroup>
            </Card>
          )}
          {own?.tokenBreakdown != null && <TokenBreakdown breakdown={own.tokenBreakdown} />}
          {agent != null && report != null && (
            <Card>
              <DisclosureGroup
                label="Subscription economics, token costs and weekly trends"
                labelStyle={{ fontSize: 13, fontWeight: 600 }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 18 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <SpendMetric title="Past 30 days" value={currency(report.apiEquivalentPerMonth)} />
                    <SpendMetric
                      title="Monthly plan"
                      value={report.pricePerMonth != null ? currency(report.pricePerMonth) : "Unavailable"}
                    />
                    <SpendMetric
                      title="Subscription value"
                      value={report.economics != null ? fixed(report.economics.valueMultiple, 2) + "×" : "Unavailable"}
                    />
                  </div>
                  <HarnessSpendDetails report={report} />
                </div>
              </DisclosureGroup>
            </Card>
          )}
          {!planInAccountHeader && subscriptions != null && subscriptions.length > 0 && (
            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <CardHeader
                  title="Subscriptions"
                  symbol="creditcard.fill"
                  tint={T.purple}
                  trailing={<span>Monthly plan prices</span>}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  {subscriptions.map((subscription) => (
                    <div
                      key={subscription.agent}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: 10,
                        flex: 1,
                        minWidth: 0,
                        borderRadius: 10,
                        background: T.hover,
                      }}
                    >
                      <HarnessIcon agent={subscription.agent} size={24} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span className="ellipsis" style={{ fontSize: 12, fontWeight: 500 }}>
                          {harnessName(subscription.agent)}
                        </span>
                        <span className="ellipsis" style={{ fontSize: 11, color: T.muted }}>
                          {subscription.plan ?? "Unknown plan"}
                        </span>
                      </div>
                      <span style={{ flex: 1, minWidth: 8 }} />
                      <span className="tabular" style={{ fontSize: 12, fontWeight: 600, flex: "none" }}>
                        {(subscription.pricePerMonth != null ? currency(subscription.pricePerMonth) : "—") + "/mo"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: T.muted }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Sym name="info.circle" size={10} />
              Spend is API-equivalent usage, not your subscription bill.
            </span>
            <span style={{ flex: 1 }} />
            {domain != null && (
              <span>
                {quotaDayKey(domain.lower)} – {quotaDayKey(domain.upper)}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          {agent != null && (agent === "codex" || agent === "claude") && (
            <QuotaSection store={store} agent={agent} />
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              minHeight: 380,
              textAlign: "center",
            }}
          >
            <Sym name="chart.bar.xaxis" size={40} color={T.muted} />
            <span style={{ fontSize: 17, fontWeight: 600 }}>
              {store.isLoading ? "Loading usage history" : "No report available"}
            </span>
            <span style={{ fontSize: 13, color: T.muted }}>Your usage will appear here when it is ready.</span>
          </div>
        </>
      )}
    </div>
  );
}

function StatStrip({
  store,
  agent,
  cost,
  tokenCount,
  modelCount,
}: {
  store: UsageStore;
  agent: string | null;
  cost: number;
  tokenCount: number;
  modelCount: number;
}) {
  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <MetricTile title="Total spend" value={currency(cost)} detail="API-equivalent value" symbol="dollarsign" />
        <Divider />
        <MetricTile
          title="Tokens"
          value={tokens(tokenCount)}
          detail="Input, output and cache"
          symbol="square.stack.3d.up.fill"
          tint={T.blue}
        />
        <Divider />
        <MetricTile
          title="Avg tokens / $"
          value={quotaTokensPerUnitLabel(quotaTokensPerDollar(tokenCount, cost), "$") ?? "—"}
          detail={periodLabel(store.period)}
          symbol="gauge.with.dots.needle.33percent"
          tint={T.green}
        />
        <Divider />
        <MetricTile
          title="Models"
          value={store.hasPeriodDetails ? number(modelCount) : "—"}
          detail={agent != null ? harnessName(agent) : "Across all harnesses"}
          symbol="cpu"
          tint={T.purple}
        />
      </div>
    </Card>
  );
}

function TokenBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const parts: { key: string; label: string; color: string }[] = [
    { key: "input", label: "Input", color: T.blue },
    { key: "output", label: "Output", color: T.flame },
    { key: "cacheWrite", label: "Cache write", color: T.purple },
    { key: "cacheRead", label: "Cache read", color: T.teal },
  ];
  const total = Math.max(
    1,
    parts.reduce((sum, part) => sum + (breakdown[part.key] ?? 0), 0),
  );
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <CardHeader
          title="Token breakdown"
          symbol="square.stack.3d.up.fill"
          tint={T.blue}
          trailing={<span>Available source data</span>}
        />
        <div
          aria-hidden
          style={{ display: "flex", gap: 2, height: 8, borderRadius: 999, overflow: "hidden" }}
        >
          {parts.map((part) => {
            const share = (breakdown[part.key] ?? 0) / total;
            if (!(share > 0)) return null;
            return (
              <div
                key={part.key}
                style={{
                  flex: "none",
                  width: `max(2px, calc(${share * 100}% - 2px))`,
                  background: `linear-gradient(to bottom, color-mix(in srgb, ${part.color} 85%, white), ${part.color})`,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {parts.map((part) => {
            const value = breakdown[part.key] ?? 0;
            return (
              <div
                key={part.key}
                className="tabular"
                style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: part.color, flex: "none" }} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: T.muted }}>{part.label}</span>
                </div>
                <span className="rounded" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>
                  {tokens(value)}
                </span>
                <span style={{ fontSize: 11, color: T.muted }}>{percent(value / total, 1)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function HarnessList({ store }: { store: UsageStore }) {
  const agents = [...(store.summary?.agents ?? [])].sort((a, b) => b.totalCost - a.totalCost);
  const top = Math.max(agents[0]?.totalCost ?? 0, 0.01);
  return (
    <Card style={{ width: 280, flex: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardHeader title="By harness" symbol="flame.fill" trailing={<span>{agents.length} active</span>} />
        <div
          className="scroll"
          style={{ maxHeight: 214, margin: "0 -8px", scrollbarWidth: "none" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {agents.map((usage) => (
              <button
                key={usage.agent}
                className="hover-row tabular"
                title={`Open ${harnessName(usage.agent)}`}
                onClick={() => void store.setSelection(usage.agent)}
                style={{
                  border: "none",
                  background: undefined,
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                }}
              >
                <HarnessIcon agent={usage.agent} size={26} />
                <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="ellipsis" style={{ fontSize: 12, fontWeight: 500 }}>
                      {harnessName(usage.agent)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, flex: "none" }}>{currency(usage.totalCost)}</span>
                  </div>
                  <ShareBar value={usage.totalCost / top} tint={agentColor(usage.agent)} height={4} />
                  <span style={{ fontSize: 10, color: T.muted }}>{tokens(usage.totalTokens) + " tokens"}</span>
                </div>
                <Sym name="chevron.right" size={9} weight={2.6} color={T.tertiary} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Meters({ store, agent }: { store: UsageStore; agent: string | null }) {
  const summary = store.summary;
  if (agent === "cursor") {
    return (
      <CursorAccountView
        account={summary?.cursorAccount ?? null}
        plan={summary?.subscription?.agents.find((a) => a.agent === "cursor") ?? null}
      />
    );
  }
  if (agent === "claude") {
    return (
      <ClaudeAccountView
        account={summary?.claudeAccount ?? null}
        plan={summary?.subscription?.agents.find((a) => a.agent === "claude") ?? null}
      />
    );
  }
  if (agent === "codex") {
    const limitDays = store.reports["codex"]?.limitUsageDaily;
    return (
      <>
        <QuotaSection store={store} agent="codex" />
        {limitDays != null && limitDays.some((d) => d.usedPercent > 0) && (
          <Card>
            <CodexLimitUsageChart days={limitDays} />
          </Card>
        )}
      </>
    );
  }
  return null;
}

function ModelSection({
  models,
  modelSearch,
  setModelSearch,
  total,
}: {
  models: ModelUsage[];
  modelSearch: string;
  setModelSearch: (value: string) => void;
  total: number;
}) {
  const query = modelSearch.toLocaleLowerCase();
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHeader
          title="Models"
          symbol="cpu"
          tint={T.purple}
          trailing={
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>{models.length} · available source data</span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 9px",
                  width: 200,
                  borderRadius: 7,
                  background: T.track,
                }}
              >
                <Sym name="magnifyingglass" size={11} color={T.tertiary} />
                <input
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="Filter models"
                  aria-label="Filter models"
                  spellCheck={false}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    padding: 0,
                    font: "inherit",
                    fontSize: 12,
                    color: T.ink,
                    userSelect: "text",
                  }}
                />
              </span>
            </span>
          }
        />
        {models.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minHeight: 60,
              fontSize: 12,
              color: T.muted,
            }}
          >
            <Sym name="cpu" size={12} />
            No model usage recorded in this period.
          </div>
        ) : (
          <div
            style={{
              height: Math.min(9, Math.max(3, models.length)) * 24 + 36,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <ModelUsageTable
              models={models.filter((m) => query === "" || m.model.toLocaleLowerCase().includes(query))}
              total={total}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

function QuotaSection({
  store,
  agent,
  style = "weekly",
}: {
  store: UsageStore;
  agent: string;
  style?: QuotaMeterStyle;
}) {
  const range = store.chartRange(agent);
  const now = new Date(store.quotaCheckDate);
  const error = store.errors[agent];
  const serviceError = store.errors["quotaService"];
  const forecast = store.forecast(agent);
  const notices = (
    <>
      {error != null && <ReportNotice message={error} />}
      {serviceError != null && <ReportNotice message={serviceError} />}
    </>
  );
  if (!forecast) {
    return (
      <>
        {notices}
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.muted }}>
          <Sym name="info.circle" size={10} />
          Quota unavailable. Spend and token history are still shown above.
        </span>
      </>
    );
  }
  const plan = store.summary?.subscription?.agents.find((a) => a.agent === agent);
  const samples = store.samples(agent, range, now);
  const quotaError = store.quotaError(agent);
  return (
    <>
      {notices}
      <Card padding={18}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CardHeader
            title={harnessName(agent) + " " + (plan?.plan ?? "account")}
            symbol="gauge.with.dots.needle.33percent"
            tint={agentColor(agent)}
            trailing={
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {plan?.pricePerMonth != null && (
                  <span className="tabular">{currency(plan.pricePerMonth) + " / month"}</span>
                )}
                <QuotaChartRangePicker range={range} setRange={(value) => void store.setChartRange(agent, value)} />
              </span>
            }
          />
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
            <div style={{ width: 236, flex: "none" }}>
              <QuotaSummary
                forecast={forecast}
                samples={samples}
                now={now}
                stale={!forecast.isFresh(now) || quotaError != null}
                staleHelp={quotaError ?? "Showing the last known reading. Update pending."}
                availableResets={style === "weekly" ? store.reports[agent]?.resetCreditsAvailable ?? undefined : undefined}
                rates={store.blendRates(agent) ?? undefined}
                style={style}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <QuotaChart
                key={range}
                forecast={forecast}
                samples={samples}
                color={agentColor(agent)}
                range={range}
                now={now}
                resetLabel={meterStyle.chartResetLabel(style)}
              />
            </div>
          </div>
        </div>
      </Card>
      {style === "promotionalCredits" && (store.summary?.cursorAccount?.includedPercentUsed ?? 0) === 0 && (
        <span style={{ fontSize: 10, color: T.muted }}>
          Included allowance is unused while promotional credits remain.
        </span>
      )}
    </>
  );
}

// MARK: ModelUsageTable

type SortKey = "model" | "totalTokens" | "totalCost";

function ModelUsageTable({ models, total }: { models: ModelUsage[]; total: number }) {
  const [order, setOrder] = useState<{ key: SortKey; reverse: boolean }>({ key: "totalCost", reverse: true });
  const sorted = [...models].sort((a, b) => {
    const result =
      order.key === "model"
        ? a.model.localeCompare(b.model, undefined, { numeric: true, sensitivity: "base" })
        : a[order.key] - b[order.key];
    return order.reverse ? -result : result;
  });
  const columns = "minmax(0, 1fr) 100px 100px 120px";
  const sortBy = (key: SortKey) =>
    setOrder((current) => (current.key === key ? { key, reverse: !current.reverse } : { key, reverse: false }));
  const header = (title: string, key?: SortKey) => {
    const active = key != null && order.key === key;
    const Arrow = order.reverse ? ChevronDown : ChevronUp;
    return (
      <button
        className="plain-button"
        disabled={key == null}
        onClick={key != null ? () => sortBy(key) : undefined}
        style={{
          height: "100%",
          padding: "0 6px",
          justifyContent: "space-between",
          gap: 4,
          fontSize: 11,
          fontWeight: active ? 600 : 400,
          color: active ? T.ink : T.muted,
          borderRight: `1px solid ${T.line}`,
          minWidth: 0,
          opacity: 1,
          cursor: key != null ? "pointer" : "default",
        }}
      >
        <span className="ellipsis">{title}</span>
        {active && <Arrow size={10} strokeWidth={2.4} style={{ flex: "none" }} aria-hidden />}
      </button>
    );
  };
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: T.surface,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns,
          height: 28,
          flex: "none",
          padding: "0 10px",
          borderBottom: `1px solid ${T.line}`,
        }}
      >
        {header("Model", "model")}
        {header("Tokens", "totalTokens")}
        {header("Spend", "totalCost")}
        {header("Share")}
      </div>
      <div className="scroll" style={{ flex: 1, padding: "4px 10px" }}>
        {sorted.map((model, index) => {
          const share = total > 0 ? Math.max(0, Math.min(1, model.totalCost / total)) : 0;
          return (
            <div
              key={model.model}
              style={{
                display: "grid",
                gridTemplateColumns: columns,
                alignItems: "center",
                height: 24,
                borderRadius: 5,
                background: index % 2 === 1 ? T.inset : "transparent",
              }}
            >
              <span className="ellipsis" title={model.model} style={{ padding: "0 6px" }}>
                {model.model}
              </span>
              <span className="tabular ellipsis" style={{ padding: "0 6px", color: T.muted }}>
                {tokens(model.totalTokens)}
              </span>
              <span className="tabular ellipsis" style={{ padding: "0 6px" }}>
                {currency(model.totalCost)}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 6px" }}>
                <span
                  aria-hidden
                  style={{
                    position: "relative",
                    width: 44,
                    height: 4,
                    flex: "none",
                    borderRadius: 999,
                    background: T.track,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: 4,
                      width: Math.max(2, 44 * share),
                      borderRadius: 999,
                      background: T.flame,
                    }}
                  />
                </span>
                <span className="tabular" style={{ color: T.muted }}>
                  {total > 0 ? percent(share, 1) : "—"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// MARK: ActivityChart

interface SpendSegment {
  date: Date;
  agent: string;
  cost: number;
  id: string;
}

interface Bucket {
  date: Date;
  end: Date;
  usage: DailyUsage;
}

const CHART_HEIGHT = 182;
const PLOT_TOP = 6;
const X_AXIS_HEIGHT = 20;

function niceTicks(max: number, desired = 5): number[] {
  const top = max > 0 && Number.isFinite(max) ? max : 1;
  const raw = top / Math.max(1, desired - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = nice * magnitude;
  const count = Math.max(1, Math.ceil(top / step - 1e-9));
  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)));
}

/** Swift Charts `.automatic(desiredCount: 5)` for a date axis. */
function dateTicks(lower: Date, upper: Date): Date[] {
  const days = (upper.getTime() - lower.getTime()) / DAY;
  for (const stride of [1, 2, 3, 7, 14]) {
    if (days / stride > 6.5) continue;
    const ticks: Date[] = [];
    let day = startOfDay(lower);
    if (day < lower) day = addDays(day, 1);
    for (; day <= upper; day = addDays(day, 1)) {
      if (stride >= 7) {
        if ((day.getDay() + 6) % 7 !== 0) continue;
        if (stride === 14 && Math.floor(day.getTime() / (7 * DAY)) % 2 !== 0) continue;
      } else if ((day.getDate() - 1) % stride !== 0) continue;
      ticks.push(day);
    }
    return ticks;
  }
  const months = days / 30.44;
  const stride = [1, 2, 3, 6, 12].find((s) => months / s <= 6.5) ?? Math.ceil(months / 5 / 12) * 12;
  const ticks: Date[] = [];
  let month = startOfMonth(lower);
  if (month < lower) month = addMonths(month, 1);
  for (; month <= upper; month = addMonths(month, 1)) {
    if (stride >= 12 ? month.getMonth() === 0 && month.getFullYear() % (stride / 12) === 0 : month.getMonth() % stride === 0) {
      ticks.push(month);
    }
  }
  return ticks;
}

function bucketsFor(days: DailyUsage[], granularity: SpendGranularity): Bucket[] {
  return bucketDailyUsage(days, granularity).flatMap((usage) => {
    const start = usageDayDate(usage.date);
    if (!start) return [];
    return [{ date: start, end: spendBucketEnd(start, granularity), usage }];
  });
}

function ActivityChart({
  days,
  color,
  domain = null,
  scope,
  setScope,
  series = [],
}: {
  days: DailyUsage[];
  color: string;
  domain?: Range | null;
  scope?: CursorModelScope;
  setScope?: (value: CursorModelScope) => void;
  series?: AgentUsage[];
}) {
  const [selected, setSelected] = useState<Date | null>(null);
  const [granularityOverride, setGranularityOverride] = useState<SpendGranularity | null>(null);
  const [chartRef, width] = useWidth<HTMLDivElement>();
  const gradientId = useId().replace(/:/g, "");

  const points = days.flatMap((usage) => {
    const date = usageDayDate(usage.date);
    return date ? [{ date, usage }] : [];
  });
  let scale: Range;
  if (domain) scale = domain;
  else {
    const first = points[0]?.date;
    const last = points[points.length - 1]?.date;
    if (first && last && first <= last) scale = { lower: first, upper: last };
    else {
      const today = startOfDay(new Date());
      scale = { lower: today, upper: today };
    }
  }
  const effective = granularityOverride ?? spendGranularityAuto(spendSpanDays(scale.lower, scale.upper));
  const buckets = bucketsFor(days, effective);
  const selectedBucket = selected
    ? buckets.find((b) => selected >= b.date && selected <= b.end) ?? null
    : null;
  // Largest harness first so it sits at the bottom of every stacked bar.
  const stacked: SpendSegment[] = [...series]
    .sort((a, b) => b.totalCost - a.totalCost)
    .flatMap((agent) =>
      bucketDailyUsage(agent.daily ?? [], effective).flatMap((usage) => {
        const date = usageDayDate(usage.date);
        if (!(usage.cost > 0) || !date) return [];
        return [{ date, agent: agent.agent, cost: usage.cost, id: agent.agent + "|" + date.getTime() / 1000 }];
      }),
    );

  // Plot geometry. Bars span their whole unit, so the domain covers the first and last buckets.
  const domainLower = new Date(
    Math.min(scale.lower.getTime(), spendBucketStart(scale.lower, effective).getTime(), buckets[0]?.date.getTime() ?? Infinity),
  );
  const lastEnd = buckets[buckets.length - 1]?.end.getTime() ?? 0;
  const domainUpper = new Date(Math.max(addDays(startOfDay(scale.upper), 1).getTime(), lastEnd + 1000));
  const stackTotals = new Map<number, number>();
  for (const segment of stacked) {
    stackTotals.set(segment.date.getTime(), (stackTotals.get(segment.date.getTime()) ?? 0) + segment.cost);
  }
  const maxValue = stacked.length
    ? Math.max(0, ...stackTotals.values())
    : Math.max(0, ...buckets.map((b) => b.usage.cost));
  const yTicks = niceTicks(maxValue);
  const yMax = yTicks[yTicks.length - 1] ?? 1;
  const yLabels = yTicks.map((tick) => number(tick));
  const labelWidth = Math.max(...yLabels.map((label) => label.length * 5.6), 6);
  const plotLeft = Math.ceil(labelWidth + 6);
  const plotRight = Math.max(plotLeft + 1, width);
  const plotBottom = CHART_HEIGHT - X_AXIS_HEIGHT;
  const plotWidth = plotRight - plotLeft;
  const span = Math.max(1, domainUpper.getTime() - domainLower.getTime());
  const x = (date: Date) => plotLeft + ((date.getTime() - domainLower.getTime()) / span) * plotWidth;
  const y = (value: number) => plotBottom - (value / yMax) * (plotBottom - PLOT_TOP);
  const bucketFrame = (start: Date) => {
    const left = x(start);
    const right = x(new Date(spendBucketEnd(start, effective).getTime() + 1000));
    const unit = right - left;
    const inset = Math.min(unit * 0.12, 6);
    const barWidth = Math.max(1, unit - inset * 2);
    return { left: left + (unit - barWidth) / 2, width: barWidth, center: left + unit / 2 };
  };
  const xTicks = dateTicks(domainLower, domainUpper);
  const tickLabel = (date: Date) => (effective === "monthly" ? fmtMonthYear(date) : fmtMonthDay(date));
  const gradientFor = (fill: string) => `${gradientId}-${fill.replace(/[^a-z0-9]/gi, "")}`;
  const fills = stacked.length
    ? [...new Set(stacked.map((s) => agentColor(s.agent)))]
    : [color];
  const empty = buckets.every((b) => b.usage.cost <= 0);

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setSelected(new Date(domainLower.getTime() + fraction * span));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <IconBadge symbol="chart.bar.fill" tint={color} />
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{spendGranularityTitle(effective)}</span>
        <Segmented
          options={spendGranularities}
          value={effective}
          onChange={(value) => setGranularityOverride(value)}
          label={spendGranularityLabel}
          ariaLabel="Spend granularity"
          style={{ width: 220 }}
        />
        {scope != null && setScope != null && (
          <Segmented
            options={cursorModelScopes}
            value={scope}
            onChange={setScope}
            label={cursorModelScopeLabel}
            ariaLabel="Daily spend models"
            style={{ maxWidth: 260, flex: "0 1 260px" }}
          />
        )}
        <span style={{ flex: 1 }} />
        <span className="ellipsis" style={{ fontSize: 10, color: T.muted }}>
          {selectedBucket
            ? spendBucketTooltip(selectedBucket.date, effective, selectedBucket.usage.cost)
            : "USD"}
        </span>
      </div>
      <div ref={chartRef} style={{ position: "relative", height: CHART_HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={CHART_HEIGHT} style={{ display: "block", overflow: "visible" }}>
            <defs>
              {fills.map((fill) => (
                <linearGradient key={fill} id={gradientFor(fill)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${fill} 85%, white)` }} />
                  <stop offset="1" style={{ stopColor: fill }} />
                </linearGradient>
              ))}
            </defs>
            {yTicks.map((tick, index) => (
              <g key={tick}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y(tick)}
                  y2={y(tick)}
                  style={{ stroke: T.grid }}
                  strokeWidth={0.5}
                />
                <text
                  x={plotLeft - 6}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="tabular"
                  style={{ fill: T.muted, fontSize: 10 }}
                >
                  {yLabels[index]}
                </text>
              </g>
            ))}
            {xTicks.map((tick) => {
              const left = x(tick);
              const label = tickLabel(tick);
              if (left + label.length * 5.4 > plotRight + 2) return null;
              return (
                <text
                  key={tick.getTime()}
                  x={left + 2}
                  y={plotBottom + 14}
                  textAnchor="start"
                  style={{ fill: T.muted, fontSize: 10 }}
                >
                  {label}
                </text>
              );
            })}
            {stacked.length === 0
              ? buckets.map((bucket) => {
                  if (!(bucket.usage.cost > 0)) return null;
                  const frame = bucketFrame(bucket.date);
                  const top = y(bucket.usage.cost);
                  const height = Math.max(0, plotBottom - top);
                  return (
                    <rect
                      key={bucket.usage.date}
                      x={frame.left}
                      y={top}
                      width={frame.width}
                      height={height}
                      rx={Math.min(3, frame.width / 2, height / 2)}
                      fill={`url(#${gradientFor(color)})`}
                      opacity={selectedBucket == null || selectedBucket.usage.date === bucket.usage.date ? 1 : 0.35}
                      style={{ transition: "opacity 0.15s ease-out" }}
                    >
                      <title>{`${bucket.usage.date}: ${currency(bucket.usage.cost)}`}</title>
                    </rect>
                  );
                })
              : (() => {
                  const base = new Map<number, number>();
                  return stacked.map((segment) => {
                    const key = segment.date.getTime();
                    const below = base.get(key) ?? 0;
                    base.set(key, below + segment.cost);
                    const frame = bucketFrame(segment.date);
                    const top = y(below + segment.cost);
                    const bottom = y(below);
                    return (
                      <rect
                        key={segment.id}
                        x={frame.left}
                        y={top}
                        width={frame.width}
                        height={Math.max(0, bottom - top)}
                        fill={`url(#${gradientFor(agentColor(segment.agent))})`}
                        opacity={selectedBucket == null || selectedBucket.date.getTime() === key ? 1 : 0.35}
                        style={{ transition: "opacity 0.15s ease-out" }}
                      >
                        <title>{`${harnessName(segment.agent)} ${quotaDayKey(segment.date)}: ${currency(segment.cost)}`}</title>
                      </rect>
                    );
                  });
                })()}
            {selectedBucket && (
              <line
                x1={bucketFrame(selectedBucket.date).center}
                x2={bucketFrame(selectedBucket.date).center}
                y1={PLOT_TOP}
                y2={plotBottom}
                style={{ stroke: alpha(color, 0.25) }}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
            <rect
              x={plotLeft}
              y={0}
              width={plotWidth}
              height={plotBottom}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setSelected(null)}
            />
          </svg>
        )}
        {selectedBucket && width > 0 && (
          <SelectionAnnotation
            bucket={selectedBucket}
            parts={stacked
              .filter((s) => s.date.getTime() === selectedBucket.date.getTime())
              .sort((a, b) => b.cost - a.cost)}
            center={bucketFrame(selectedBucket.date).center}
            chartWidth={width}
          />
        )}
        {empty && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "12px 16px",
                borderRadius: 12,
                background: "var(--popover)",
                backdropFilter: "blur(20px)",
                textAlign: "center",
              }}
            >
              <Sym name="chart.bar.xaxis" size={22} color={T.tertiary} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>No spend in this period</span>
              <span style={{ fontSize: 11, color: T.muted }}>
                Choose a longer range or run a session with this agent.
              </span>
            </div>
          </div>
        )}
      </div>
      {stacked.length > 0 && <Legend series={series} />}
    </div>
  );
}

function SelectionAnnotation({
  bucket,
  parts,
  center,
  chartWidth,
}: {
  bucket: Bucket;
  parts: SpendSegment[];
  center: number;
  chartWidth: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(parts.length ? 190 : 70);
  useLayoutEffect(() => {
    const measured = ref.current?.offsetWidth;
    if (measured && measured !== size) setSize(measured);
  });
  const left = Math.max(0, Math.min(chartWidth - size, center - size / 2));
  const material: CSSProperties = {
    background: "var(--popover)",
    backdropFilter: "blur(20px)",
    border: `1px solid ${T.cardStroke}`,
  };
  return (
    <div
      ref={ref}
      className="tabular"
      style={{
        position: "absolute",
        left,
        bottom: CHART_HEIGHT - PLOT_TOP + 4,
        pointerEvents: "none",
        zIndex: 2,
        whiteSpace: "nowrap",
        ...(parts.length === 0
          ? { ...material, padding: "4px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 }
          : { ...material, padding: 9, width: 188, borderRadius: 9 }),
      }}
    >
      {parts.length === 0 ? (
        currency(bucket.usage.cost)
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{currency(bucket.usage.cost)}</span>
          {parts.slice(0, 4).map((part) => (
            <div key={part.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
              <span
                style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: agentColor(part.agent) }}
              />
              <span className="ellipsis" style={{ color: T.muted }}>
                {harnessName(part.agent)}
              </span>
              <span style={{ flex: 1, minWidth: 10 }} />
              <span>{currency(part.cost)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ series }: { series: AgentUsage[] }) {
  const agents = series
    .filter((a) => a.totalCost > 0 && (a.daily ?? []).length > 0)
    .sort((a, b) => b.totalCost - a.totalCost);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, color: T.muted, overflow: "hidden" }}>
      {agents.slice(0, 5).map((agent) => (
        <Fragment key={agent.agent}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, flex: "none", whiteSpace: "nowrap" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: agentColor(agent.agent) }} />
            {harnessName(agent.agent)}
          </span>
        </Fragment>
      ))}
      {agents.length > 5 && (
        <span
          style={{ flex: "none" }}
          title={agents
            .slice(5)
            .map((a) => harnessName(a.agent))
            .join(", ")}
        >
          +{agents.length - 5}
        </span>
      )}
    </div>
  );
}
