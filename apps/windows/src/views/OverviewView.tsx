// Port of OverviewView.swift.
import type { CSSProperties } from "react";
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
} from "../components/Theme";
import {
  currency,
  harnessName,
  periodLabel,
  quotaChartPercentLabel,
  quotaSourceLabel,
  quotaSources,
  remainingQuota,
  tokens,
  type QuotaSource,
  type SummaryReport,
} from "../lib/usage";
import { useStore, type UsageStore } from "../store/UsageStore";
import { PeriodPicker } from "./UsageDetails";

const plainRowButton: CSSProperties = {
  border: "none",
  background: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  display: "block",
};

export function OverviewView() {
  const store = useStore();
  const report = store.summary;
  const error = store.errors["summary"];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "0 4px" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Overview</span>
        <span style={{ flex: 1 }} />
        <PeriodPicker width={130} />
      </div>
      {error != null && <ReportNotice message={error} />}
      {report ? (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <Card padding={12} radius={12} style={{ flex: 1, minWidth: 0 }}>
              <MetricTile
                title="Spend"
                value={currency(report.totals.totalCost)}
                detail={`API-equivalent · ${periodLabel(store.period)}`}
                symbol="dollarsign"
                compact
              />
            </Card>
            <Card padding={12} radius={12} style={{ flex: 1, minWidth: 0 }}>
              <MetricTile
                title="Tokens"
                value={tokens(report.totals.totalTokens)}
                detail={`${report.agents.length} agents`}
                symbol="square.stack.3d.up.fill"
                tint={T.blue}
                compact
              />
            </Card>
          </div>
          <QuotaGrid store={store} />
          <Busiest store={store} report={report} />
          {report.models.length > 0 && (
            <Card padding={12} radius={12}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <CardHeader
                  title="Top models"
                  symbol="cpu"
                  tint={T.purple}
                  trailing={<span>{report.models.length} models</span>}
                />
                {report.models.slice(0, 3).map((model) => (
                  <div
                    key={model.model}
                    className="tabular"
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}
                  >
                    <span className="ellipsis" title={model.model}>
                      {model.model}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: T.quotaMuted, flex: "none" }}>{tokens(model.totalTokens)}</span>
                    <span style={{ fontWeight: 500, minWidth: 72, textAlign: "right", flex: "none" }}>
                      {currency(model.totalCost)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 5,
              fontSize: 11,
              color: T.quotaMuted,
              padding: "0 4px",
            }}
          >
            <Sym name="info.circle" size={11} style={{ marginTop: 1 }} />
            <span>API-equivalent usage estimates token value, not your subscription bill.</span>
          </div>
        </>
      ) : (
        <Card>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: 10,
              minHeight: 220,
            }}
          >
            <IconBadge symbol="flame.fill" size={34} />
            <span style={{ fontSize: 17, fontWeight: 600 }}>
              {store.isLoading ? "Gathering your local usage…" : "Connect your usage"}
            </span>
            <span style={{ fontSize: 12, color: T.quotaMuted }}>
              Agent Burn reads the same local harness logs as the CLI. Choose the executable in Settings if it
              isn't detected automatically.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

function QuotaGrid({ store }: { store: UsageStore }) {
  const quotas = quotaSources.flatMap((source): [QuotaSource, number][] => {
    const remaining = remainingQuota(
      source,
      store.forecast(source),
      store.summary?.cursorAccount,
      store.summary?.claudeAccount,
    );
    return remaining == null ? [] : [[source, remaining]];
  });
  if (quotas.length === 0) return null;
  return (
    <Card padding={12} radius={12}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardHeader title="Quota remaining" symbol="gauge.with.dots.needle.67percent" tint={T.green} />
        <div style={{ display: "flex", gap: 8 }}>
          {quotas.map(([source, remaining]) => (
            <QuotaTile key={source} store={store} source={source} remaining={remaining} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function QuotaTile({
  store,
  source,
  remaining,
}: {
  store: UsageStore;
  source: QuotaSource;
  remaining: number;
}) {
  const tone = remaining < 15 ? T.behind : remaining < 35 ? T.orange : T.green;
  const label = quotaSourceLabel(source);
  return (
    <button
      style={{
        ...plainRowButton,
        flex: 1,
        minWidth: 0,
        padding: 9,
        borderRadius: 9,
        background: T.hover,
      }}
      title={`Open ${label}`}
      aria-label={`${label} ${quotaChartPercentLabel(remaining)} remaining`}
      onClick={() => void store.setSelection(source)}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <HarnessIcon agent={source} size={14} />
          <span style={{ fontSize: 11, fontWeight: 500, color: T.quotaMuted }}>{label}</span>
        </div>
        <span className="rounded tabular" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.15 }}>
          {quotaChartPercentLabel(remaining)}
        </span>
        <div style={{ width: "100%" }}>
          <ShareBar value={remaining / 100} tint={tone} height={4} />
        </div>
      </div>
    </button>
  );
}

function Busiest({ store, report }: { store: UsageStore; report: SummaryReport }) {
  const agents = [...report.agents].sort((a, b) => b.totalCost - a.totalCost).slice(0, 6);
  const top = Math.max(agents[0]?.totalCost ?? 0, 0.01);
  return (
    <Card padding={12} radius={12}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ paddingBottom: 4 }}>
          <CardHeader
            title="Busiest agents"
            symbol="flame.fill"
            trailing={<span>{periodLabel(store.period)}</span>}
          />
        </div>
        {agents.length === 0 && (
          <span style={{ fontSize: 12, color: T.quotaMuted }}>
            No local usage in this period. Run an agent session or choose a longer range.
          </span>
        )}
        {agents.map((agent) => (
          <button
            key={agent.agent}
            className="hover-row tabular"
            style={{ ...plainRowButton, margin: "0 -8px", width: "calc(100% + 16px)" }}
            aria-label={`${harnessName(agent.agent)}, ${currency(agent.totalCost)}, ${tokens(agent.totalTokens)} tokens`}
            onClick={() => void store.setSelection(agent.agent)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <HarnessIcon agent={agent.agent} size={22} />
              <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="ellipsis" style={{ fontSize: 12, fontWeight: 500 }}>
                    {harnessName(agent.agent)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: T.quotaMuted, flex: "none" }}>
                    {tokens(agent.totalTokens)}
                  </span>
                  <span
                    style={{ fontSize: 12, fontWeight: 600, minWidth: 72, textAlign: "right", flex: "none" }}
                  >
                    {currency(agent.totalCost)}
                  </span>
                </div>
                <ShareBar value={agent.totalCost / top} tint={agentColor(agent.agent)} height={4} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}
