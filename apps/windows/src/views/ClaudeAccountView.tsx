// Port of the views in ClaudeAccountView.swift.
import type { ReactNode } from "react";
import {
  Card,
  CardHeader,
  QuotaCheckButton,
  ShareBar,
  Sym,
  T,
  agentColor,
  alpha,
} from "../components/Theme";
import {
  Forecast,
  claudeSessionQuotaAgent,
  currency,
  quotaChartReading,
  quotaDateCompact,
  fmtTime,
  readingPaceDelta,
  type ClaudeAccount,
  type QuotaSample,
  type SubscriptionAgent,
} from "../lib/usage";
import { useStore } from "../store/UsageStore";
import { QuotaChart, quotaChartEdgeLabel, quotaDurationLabel, quotaPercentText } from "./QuotaChart";

const upToOneDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function Divider() {
  return <div aria-hidden style={{ height: 1, flex: "none", background: T.grid }} />;
}

/// Split Deck: a one-line verdict, then the 5-hour session and weekly limits side by
/// side with their until-reset charts, then slim rows for model-scoped limits and extra usage.
export function ClaudeAccountView({
  account,
  plan,
}: {
  account: ClaudeAccount | null | undefined;
  plan: SubscriptionAgent | null | undefined;
}) {
  const store = useStore();
  const now = new Date(store.quotaCheckDate);
  const tint = agentColor("claude");
  const weekly = store.forecast("claude");
  // The newest saved session reading, kept after its window resets for the reset time.
  const lastSession = store.forecast(claudeSessionQuotaAgent);
  const session = lastSession && lastSession.reset > now ? lastSession : null;
  // The report's status is only as new as the report; a live reading collected
  // since then proves Claude Code renewed its sign-in.
  const signInExpired =
    store.summary?.claudeAccountStatus === "signInExpired" && !(weekly?.isFresh(now) ?? false);
  const sessionResetCandidates = [claudeDate(account?.sessionResetsAtMs), lastSession?.reset].filter(
    (d): d is Date => d != null,
  );
  const sessionReset =
    sessionResetCandidates.length > 0
      ? new Date(Math.max(...sessionResetCandidates.map((d) => d.getTime())))
      : null;

  const freshness = (forecast: Forecast) => {
    const error = store.quotaError("claude");
    const fresh = forecast.isFresh(now) && error == null;
    return (
      <span
        style={{ display: "flex", alignItems: "center", gap: 6 }}
        title={
          fresh
            ? "Live reading · updates every minute"
            : error ?? "Showing the last known reading. Update pending."
        }
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flex: "none",
            background: fresh ? T.ahead : T.orange,
          }}
        />
        <span className="tabular">{fmtTime(forecast.observedAt)}</span>
      </span>
    );
  };

  const secondaryMeters = (account: ClaudeAccount) => {
    const count = account.scoped.length + (showsExtra(account) ? 1 : 0);
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(2, count)}, minmax(0, 1fr))`,
          columnGap: 28,
          rowGap: 14,
          alignItems: "start",
        }}
      >
        {account.scoped.map((window) => (
          <ClaudeMeterRow
            key={window.name}
            title={window.name + " · weekly"}
            used={window.usedPercent ?? null}
            tint={tint}
          />
        ))}
        {showsExtra(account) && (
          <ClaudeMeterRow
            title="Extra usage"
            used={extraUsedPercent(account)}
            tint={tint}
            value={account.extraUsedUSD != null ? extraRemaining(account, account.extraUsedUSD) : null}
            detail={account.extraLimitUSD != null ? "of " + currency(account.extraLimitUSD) + " limit" : null}
          />
        )}
      </div>
    );
  };

  const latest = weekly ?? session;
  const verdict = signInExpired
    ? claudeSignInExpiredVerdict
    : claudeVerdict(session, weekly, now);

  return (
    <Card padding={18} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CardHeader
        title={"Claude " + (plan?.plan ?? "account")}
        symbol="gauge.with.dots.needle.33percent"
        tint={tint}
        trailing={
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {plan?.pricePerMonth != null && (
              <span className="tabular">{currency(plan.pricePerMonth) + " / month"}</span>
            )}
            {latest && freshness(latest)}
            <QuotaCheckButton label />
          </span>
        }
      />
      {verdict && <ClaudeVerdictBanner verdict={verdict} />}
      {(account != null || weekly != null || lastSession != null) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <ClaudeLimitPanel
            title="5-hour session"
            forecast={session}
            samples={store.samples(claudeSessionQuotaAgent, "rte", now)}
            now={now}
            tint={tint}
            used={account?.sessionUsedPercent ?? null}
            resetsAt={sessionReset}
            stale={signInExpired}
          />
          <ClaudeLimitPanel
            title="Weekly"
            forecast={weekly}
            samples={store.samples("claude", "rte", now)}
            now={now}
            tint={tint}
            used={account?.weeklyUsedPercent ?? null}
            resetsAt={claudeDate(account?.weeklyResetsAtMs)}
            stale={signInExpired}
          />
        </div>
      )}
      {account != null && (account.scoped.length > 0 || showsExtra(account)) && (
        <>
          <Divider />
          {secondaryMeters(account)}
        </>
      )}
      {account == null && !signInExpired && (
        <span style={{ fontSize: 10, color: T.muted }}>
          Live account limits are unavailable. Use Check now with live data enabled to load Claude’s meters.
        </span>
      )}
    </Card>
  );
}

/// The single sentence that says whether both limits last until they reset.
export interface ClaudeVerdict {
  atRisk: boolean;
  headline: string;
  detail: string;
}

/// The CLI renews an expired Claude Code token itself; this verdict means
/// Anthropic refused the refresh token, so only `/login` in `claude` recovers.
export const claudeSignInExpiredVerdict: ClaudeVerdict = {
  atRisk: true,
  headline: "Claude Code sign-in expired.",
  detail:
    "Anthropic refused to renew the sign-in. Run claude in Terminal and use /login. Showing the last saved readings.",
};

/// Session run-outs come first because they lock you out soonest.
export function claudeVerdict(
  session: Forecast | null | undefined,
  weekly: Forecast | null | undefined,
  now: Date,
): ClaudeVerdict | null {
  if (session) {
    const verdict = claudeRunOutVerdict(session, "Session", now);
    if (verdict) return verdict;
  }
  if (weekly) {
    const verdict = claudeRunOutVerdict(weekly, "Weekly limit", now);
    if (verdict) return verdict;
  }
  if (!session && !weekly) return null;
  return {
    atRisk: false,
    headline: "On track.",
    detail:
      session && weekly
        ? "At this pace both limits last until they reset."
        : "At this pace the limit lasts until it resets.",
  };
}

function claudeRunOutVerdict(forecast: Forecast, name: string, now: Date): ClaudeVerdict | null {
  const reset = quotaChartEdgeLabel(forecast.reset, false, forecast);
  if (forecast.remaining <= 0) {
    return { atRisk: true, headline: `${name} reached.`, detail: `It resets ${reset}.` };
  }
  if (!(forecast.projectedEnd < forecast.reset)) return null;
  const empty = quotaChartEdgeLabel(forecast.projectedEnd, false, forecast);
  const from = now > forecast.observedAt ? now : forecast.observedAt;
  const left = Math.max(60, (forecast.reset.getTime() - from.getTime()) / 1000);
  const pace =
    forecast.duration <= 86_400
      ? `Slow to ${quotaRateText(forecast.remaining / (left / 3_600))}/h`
      : `Keep under ${quotaRateText(forecast.remaining / (left / 86_400))}/day`;
  return {
    atRisk: true,
    headline: `${name} runs out ≈ ${empty}.`,
    detail: `${pace} to last until the ${reset} reset.`,
  };
}

function quotaRateText(value: number) {
  return upToOneDecimal.format(value) + "%";
}

export function ClaudeVerdictBanner({ verdict }: { verdict: ClaudeVerdict }) {
  const tone = verdict.atRisk ? T.behind : T.ahead;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 14px",
        borderRadius: 10,
        background: alpha(tone, 0.09),
      }}
    >
      <Sym
        name={verdict.atRisk ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
        size={14}
        color={tone}
      />
      <span
        className="tabular"
        style={{
          fontSize: 13,
          flex: 1,
          minWidth: 0,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        <span style={{ fontWeight: 600, color: verdict.atRisk ? tone : T.ink }}>{verdict.headline}</span>
        <span style={{ color: T.muted }}>{" " + verdict.detail}</span>
      </span>
    </div>
  );
}

/// One limit: remaining share, pace delta, reset countdown and an until-reset chart.
/// Without a collected reading it falls back to the account meter and a plain bar.
export function ClaudeLimitPanel({
  title,
  forecast,
  samples,
  now,
  tint,
  used = null,
  resetsAt = null,
  stale = false,
}: {
  title: string;
  forecast: Forecast | null | undefined;
  samples: QuotaSample[];
  now: Date;
  tint: string;
  used?: number | null;
  resetsAt?: Date | null;
  /** The readings cannot update, so even a recent one is only the last known value. */
  stale?: boolean;
}) {
  const reset = forecast?.reset ?? resetsAt ?? null;
  const hasReset = reset != null && reset <= now;
  const remaining = forecast
    ? forecast.remaining
    : hasReset
      ? 100
      : used != null
        ? Math.max(0, Math.min(100, 100 - used))
        : null;
  const paceDelta = forecast
    ? readingPaceDelta(quotaChartReading(forecast.observedAt, samples, forecast, "rte"))
    : null;
  const atRisk = forecast ? forecast.remaining <= 0 || forecast.projectedEnd < forecast.reset : false;

  let resetText: ReactNode = null;
  if (reset) {
    resetText = (
      <span
        className="tabular"
        style={{ fontSize: 12, color: T.muted, whiteSpace: "nowrap", flex: "none" }}
        title={"Resets " + quotaDateCompact(reset)}
      >
        {hasReset ? (
          "Reset"
        ) : (
          <>
            {"Resets in "}
            <span style={{ fontWeight: 600, color: T.ink }}>
              {quotaDurationLabel((reset.getTime() - now.getTime()) / 1000)}
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 16,
        flex: "1 1 0",
        minWidth: 0,
        alignSelf: "flex-start",
        background: T.inset,
        borderRadius: 12,
        border: `1px solid ${atRisk ? alpha(T.behind, 0.28) : T.cardStroke}`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, color: T.muted }}>
            {title.toUpperCase()}
          </span>
          {(stale || (forecast != null && !forecast.isFresh(now))) && (
            <span
              title="Showing the last known reading. Update pending."
              aria-label="Last known reading; update pending"
              style={{ display: "inline-flex" }}
            >
              <Sym name="clock.badge.exclamationmark" size={11} color={T.orange} />
            </span>
          )}
          <span style={{ flex: 1, minWidth: 8 }} />
          {resetText}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-label={`${title} remaining`}
            style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap", minWidth: 0 }}
          >
            <span className="rounded tabular" style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.15 }}>
              {remaining != null ? quotaPercentText(remaining) : "—"}
            </span>
            <span style={{ fontSize: 14, color: T.muted }}>left</span>
          </span>
          <span style={{ flex: 1, minWidth: 8 }} />
          {paceDelta != null && <ClaudePaceBadge delta={paceDelta} />}
        </div>
      </div>
      {forecast ? (
        <QuotaChart
          forecast={forecast}
          samples={samples}
          color={tint}
          range="rte"
          now={now}
          height={150}
          idleBadge={false}
          minimal
        />
      ) : (
        <div
          style={{
            height: 150,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 10,
          }}
        >
          {remaining != null && <ShareBar value={remaining / 100} tint={tint} height={6} />}
          <span style={{ fontSize: 11, color: T.muted }}>
            {hasReset
              ? "Limit reset. A new window starts with your next request."
              : "The chart appears after the next live reading."}
          </span>
        </div>
      )}
    </div>
  );
}

/// "+10 pts ahead" / "−18 pts behind": remaining minus even pace, in percentage points.
export function ClaudePaceBadge({ delta }: { delta: number }) {
  const tone = delta < -0.05 ? T.behind : T.ahead;
  return (
    <span
      className="tabular"
      title="Remaining now minus an even pace until reset."
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: tone,
        padding: "4px 8px",
        borderRadius: 6,
        background: alpha(tone, 0.14),
        whiteSpace: "nowrap",
        flex: "none",
      }}
    >
      {claudePaceText(delta)}
    </span>
  );
}

export function claudePaceText(delta: number) {
  if (Math.abs(delta) < 0.05) return "On pace";
  const magnitude = upToOneDecimal.format(Math.abs(delta));
  return delta > 0 ? `+${magnitude} pts ahead` : `−${magnitude} pts behind`;
}

/// Model-scoped limits and extra usage: title, optional detail, a thin bar and the value.
export function ClaudeMeterRow({
  title,
  used,
  tint = T.flame,
  value = null,
  detail = null,
}: {
  title: string;
  used: number | null | undefined;
  tint?: string;
  value?: string | null;
  detail?: string | null;
}) {
  const remaining = used != null ? Math.max(0, Math.min(100, 100 - used)) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", flex: "none" }}>{title}</span>
      {detail != null && (
        <span className="ellipsis" style={{ fontSize: 11, color: T.muted, flex: "0 1 auto" }}>
          {detail}
        </span>
      )}
      <div style={{ flex: "1 1 0", minWidth: 48 }}>
        {remaining != null && (
          <ShareBar value={remaining / 100} tint={remaining < 15 ? T.behind : tint} height={6} />
        )}
      </div>
      <span className="tabular" style={{ fontSize: 13, whiteSpace: "nowrap", flex: "none" }}>
        {value != null ? (
          <span style={{ fontWeight: 600, color: T.ink }}>{value}</span>
        ) : (
          <>
            <span style={{ fontWeight: 600, color: T.ink }}>
              {remaining != null ? quotaPercentText(remaining) : "—"}
            </span>
            <span style={{ color: T.muted }}> left</span>
          </>
        )}
      </span>
    </div>
  );
}

export function claudeDate(milliseconds: number | null | undefined): Date | null {
  return milliseconds != null ? new Date(milliseconds) : null;
}

/// Extra usage is noise until it is switched on or has actually been spent.
export function showsExtra(account: ClaudeAccount) {
  return account.extraEnabled === true || (account.extraUsedUSD ?? 0) > 0;
}

export function extraUsedPercent(account: ClaudeAccount): number | null {
  if (account.extraUsedPercent != null) return Math.max(0, Math.min(100, account.extraUsedPercent));
  const used = account.extraUsedUSD;
  const limit = account.extraLimitUSD;
  if (used == null || limit == null || !(limit > 0)) return null;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

export function extraRemaining(account: ClaudeAccount, used: number) {
  return account.extraLimitUSD != null
    ? currency(Math.max(0, account.extraLimitUSD - used)) + " left"
    : currency(used) + " used";
}
