// Port of HarnessView.swift.
import type { ReactNode } from "react";
import { HarnessIcon, ReportNotice, SectionLabel, StatusBadge, Sym, T, agentColor } from "../components/Theme";
import { currency, fixed, fmtDateTime, harnessName, resetSummary, tokens, type Forecast } from "../lib/usage";
import { useStore, type UsageStore } from "../store/UsageStore";
import { CompactHarnessView } from "./CompactHarnessView";
import { QuotaChart } from "./QuotaChart";
import { HarnessSpendDetails, SpendMetric } from "./UsageDetails";

export function HarnessView({ agent, compact = false }: { agent: string; compact?: boolean }) {
  if (compact) return <CompactHarnessView agent={agent} />;
  return <ExpandedHarness agent={agent} />;
}

function ExpandedHarness({ agent }: { agent: string }) {
  const store = useStore();
  const color = agentColor(agent);
  const error = store.errors[agent];
  const serviceError = store.errors["quotaService"];
  const historyError = store.errors["history"];
  const report = store.reports[agent];
  const forecast = store.forecast(agent);
  const short = store.summary?.subscription?.agents.find((a) => a.agent === agent)?.shortWindow;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <HarnessIcon agent={agent} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{harnessName(agent)}</span>
          <span style={{ fontSize: 11, color: T.muted }}>{report?.plan ?? "Subscription usage"}</span>
        </div>
        <span style={{ flex: 1 }} />
        <StatusBadge
          text={error != null ? "Needs attention" : store.offline ? "Cached" : "CLI snapshot"}
          color={error != null ? T.accent : color}
        />
      </div>
      {error != null && <ReportNotice message={error} />}
      {serviceError != null && <ReportNotice message={serviceError} />}
      {report != null && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <SpendMetric
              title="Total spend"
              value={currency(report.apiEquivalentPerMonth)}
              detail="Past 30 days · API-equivalent"
            />
            {report.pricePerMonth != null && (
              <SpendMetric title="Monthly plan" value={currency(report.pricePerMonth)} detail={report.plan ?? ""} />
            )}
            {report.economics != null && (
              <SpendMetric
                title="Subscription value"
                value={`${fixed(report.economics.valueMultiple, 2)}×`}
                detail="Usage / monthly price"
              />
            )}
          </div>
          {report.economics != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: T.muted }}>
              <span>API-equivalent minus plan: {currency(report.economics.subsidyPerMonth)}</span>
              <span style={{ flex: 1 }} />
              <span>API pricing discount: {fixed(report.economics.discountPercent, 1)}%</span>
            </div>
          )}
        </>
      )}
      {forecast ? (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 36, padding: "10px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 280, flex: "none" }}>
              <span style={{ fontSize: 12, color: T.muted }}>Weekly limit</span>
              <QuotaHeader forecast={forecast} />
              {!forecast.isLive && (
                <span style={{ fontSize: 12, color: T.muted }}>
                  {currency(forecast.window.apiEquivalentSpent)} used this cycle
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <QuotaChart forecast={forecast} samples={store.samples(agent)} color={color} />
            </div>
          </div>
          <ResetDetails store={store} agent={agent} forecast={forecast} color={color} />
          {short != null && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 12 }}>
              <span style={{ color: T.muted }}>{short.label} limit</span>
              <span style={{ flex: 1 }} />
              <span>{fixed(Math.max(0, 100 - short.usedPercent), 0)}% remaining</span>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 10,
            minHeight: 150,
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 600 }}>
            {store.isLoading ? "Reading your usage…" : "Quota unavailable"}
          </span>
          <span style={{ fontSize: 13, color: T.muted }}>
            {store.isLoading
              ? "Loading local logs and subscription limits. This can take a moment."
              : "Sign in to this harness and run a session to record limits. Your available spend data appears below."}
          </span>
        </div>
      )}
      {report != null && report.topModels.length > 0 && (
        <>
          <div style={{ height: 1, background: T.line }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SectionLabel title="Model usage" detail="API-equivalent · past 30 days" />
            {report.topModels.slice(0, 6).map((model) => (
              <div key={model.model} className="tabular" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span className="ellipsis" title={model.model}>
                  {model.model}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: T.muted, flex: "none" }}>{tokens(model.tokens)}</span>
                <span style={{ width: 80, textAlign: "right", flex: "none" }}>{currency(model.cost)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {report != null && <HarnessSpendDetails report={report} />}
      {historyError != null && <ReportNotice message={historyError} />}
    </div>
  );
}

function QuotaHeader({ forecast }: { forecast: Forecast }) {
  const ahead = forecast.daysEarly > 0.1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="rounded tabular" style={{ fontSize: 64, fontWeight: 500, lineHeight: 1 }}>
          {fixed(forecast.remaining, 0)}
        </span>
        <span style={{ fontSize: 16, color: T.muted }}>% remaining</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
            color: ahead ? T.accent : T.green,
          }}
        >
          <Sym name={ahead ? "gauge.with.dots.needle.67percent" : "checkmark.circle"} size={13} />
          {forecast.remaining === 0 ? "Limit reached" : ahead ? "A little ahead of pace" : "Room to keep building"}
        </span>
        <span style={{ fontSize: 12, color: T.muted }}>
          {forecast.projectedUse == null
            ? "A forecast will appear once this cycle has recorded usage."
            : ahead
              ? `At this pace, your quota may run out ${fixed(forecast.daysEarly, 1)} days early.`
              : "Your current pace should carry you through the reset."}
        </span>
      </div>
    </div>
  );
}

function ResetRow({ symbol, label, children, help }: { symbol: string; label: string; children: ReactNode; help?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={help}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: T.muted }}>
        <Sym name={symbol} size={12} />
        {label}
      </span>
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}

function ResetDetails({
  store,
  agent,
  forecast,
  color,
}: {
  store: UsageStore;
  agent: string;
  forecast: Forecast;
  color: string;
}) {
  return (
    <div
      className="tabular"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontSize: 12,
        padding: 14,
        borderRadius: 10,
        background: T.surface,
      }}
    >
      <ResetRow symbol="clock" label="Resets around">
        <span>{fmtDateTime(forecast.reset)}</span>
      </ResetRow>
      <ResetRow
        symbol="arrow.counterclockwise"
        label="Recorded resets"
        help="Scheduled resets happen near the cycle end. A possible reset is a remaining jump mid-cycle, which can be a manual reset or a provider correction."
      >
        <span>{resetSummary(store.resets(agent))}</span>
      </ResetRow>
      <ResetRow symbol="speedometer" label="Suggested pace">
        <span style={{ color }}>{fixed(forecast.dailyAllowance, 1)}% / day</span>
      </ResetRow>
    </div>
  );
}
