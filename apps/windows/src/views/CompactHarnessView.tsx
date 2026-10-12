// Port of CompactHarnessView.swift.
import { useState } from "react";
import { Card, HarnessIcon, ReportNotice, T, quotaColor } from "../components/Theme";
import {
  currency,
  fixed,
  harnessName,
  quotaDollarsPerPercentLabel,
  quotaTokensPerUnitLabel,
} from "../lib/usage";
import { useStore } from "../store/UsageStore";
import { DisclosureGroup } from "./NativeUsageView";
import { QuotaChart } from "./QuotaChart";
import { QuotaSummary } from "./UsageDetails";

export function CompactHarnessView({ agent }: { agent: string }) {
  const store = useStore();
  const [showsDetails, setShowsDetails] = useState(false);
  const forecast = store.forecast(agent);
  const report = store.reports[agent];
  const errors = [store.errors[agent], store.errors["quotaService"], store.errors["history"]];
  const short = store.summary?.subscription?.agents.find((a) => a.agent === agent)?.shortWindow;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <HarnessIcon agent={agent} size={22} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{harnessName(agent)}</span>
      <span style={{ flex: 1 }} />
      <span
        className="ellipsis"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: T.quotaMuted,
          padding: "3px 8px",
          borderRadius: 999,
          background: T.track,
          minWidth: 0,
        }}
      >
        {report?.plan ?? "Subscription"}
      </span>
    </div>
  );

  let quota;
  if (forecast) {
    const range = store.chartRange(agent);
    const now = new Date(store.quotaCheckDate);
    const samples = store.samples(agent, range, now);
    const quotaError = store.quotaError(agent);
    quota = (
      <Card padding={14} radius={12}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {header}
          <QuotaSummary
            forecast={forecast}
            samples={samples}
            now={now}
            stale={!forecast.isFresh(now) || quotaError != null}
            staleHelp={quotaError ?? "Showing the last known reading. Update pending."}
            compact
            availableResets={report?.resetCreditsAvailable ?? null}
            rates={store.blendRates(agent)}
          />
          <QuotaChart
            forecast={forecast}
            samples={samples}
            color={quotaColor(agent)}
            compact
            range={range}
            now={now}
          />
          {short != null && (
            <Detail title={`${short.label} limit`} value={`${fixed(Math.max(0, 100 - short.usedPercent), 0)}% remaining`} />
          )}
        </div>
      </Card>
    );
  } else {
    quota = (
      <Card padding={14} radius={12}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, minHeight: 150 }}>
          {header}
          <span style={{ flex: 1, minHeight: 4 }} />
          <span style={{ fontSize: 20, fontWeight: 600 }}>{store.isLoading ? "Reading usage…" : "Quota unavailable"}</span>
          <span style={{ fontSize: 12, color: T.quotaMuted }}>
            {store.isLoading
              ? "Loading your subscription limits."
              : `Sign in to ${harnessName(agent)} and run a session, then refresh.`}
          </span>
        </div>
      </Card>
    );
  }

  const rates = report != null ? store.blendRates(agent) : null;
  const dollars = quotaDollarsPerPercentLabel(rates?.dollarsPerPercent);
  const tokensPer = quotaTokensPerUnitLabel(rates?.tokensPerDollar, "$");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      {quota}
      {errors.map((message, index) => (message != null ? <ReportNotice key={index} message={message} /> : null))}
      {report != null && (
        <Card padding={12} radius={12}>
          <DisclosureGroup
            label="Usage details"
            isExpanded={showsDetails}
            setIsExpanded={setShowsDetails}
            labelStyle={{ fontSize: 12, fontWeight: 500 }}
            tint={T.quotaMuted}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
              <Detail title="API-equivalent · 30 days" value={currency(report.apiEquivalentPerMonth)} />
              {report.pricePerMonth != null && <Detail title="Monthly plan" value={currency(report.pricePerMonth)} />}
              {forecast && (
                <Detail title="Suggested daily pace" value={`${fixed(forecast.dailyAllowance, 1)}% / day`} />
              )}
              {dollars != null && <Detail title="Avg $ / %" value={dollars} />}
              {tokensPer != null && <Detail title="Avg tokens / $" value={tokensPer} />}
              {report.topModels.slice(0, 2).map((model) => (
                <Detail key={model.model} title={model.model} value={currency(model.cost)} />
              ))}
            </div>
          </DisclosureGroup>
        </Card>
      )}
    </div>
  );
}

function Detail({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", fontSize: 12 }}>
      <span className="ellipsis" style={{ color: T.quotaMuted, minWidth: 0 }}>
        {title}
      </span>
      <span style={{ flex: 1, minWidth: 12 }} />
      <span className="tabular" style={{ whiteSpace: "nowrap", flex: "none" }}>
        {value}
      </span>
    </div>
  );
}
