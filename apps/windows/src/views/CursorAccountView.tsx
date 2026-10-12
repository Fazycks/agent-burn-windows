// Port of the view in CursorAccountView.swift.
import { useState } from "react";
import { Card, CardHeader, ShareBar, T, agentColor } from "../components/Theme";
import {
  Forecast,
  currency,
  cursorHasPromotionalCredits,
  cursorMeterForecast,
  fixed,
  fmtFullDate,
  meterStyle,
  type CursorAccount,
  type CursorCreditGrant,
  type QuotaChartRange,
  type SubscriptionAgent,
} from "../lib/usage";
import { useStore } from "../store/UsageStore";
import { QuotaChart } from "./QuotaChart";
import { QuotaChartRangePicker, QuotaSummary } from "./UsageDetails";

const caption = { fontSize: 10, color: T.muted } as const;
const subheadlineMedium = { fontSize: 11, fontWeight: 500 } as const;

function VerticalDivider() {
  return <div aria-hidden style={{ width: 1, flex: "none", alignSelf: "stretch", background: T.grid }} />;
}

function Divider() {
  return <div aria-hidden style={{ height: 1, flex: "none", background: T.grid }} />;
}

export function CursorAccountView({
  account,
  plan,
}: {
  account: CursorAccount | null | undefined;
  plan: SubscriptionAgent | null | undefined;
}) {
  const store = useStore();
  const [range, setRange] = useState<QuotaChartRange>("rtd");
  const checkDate = new Date(store.quotaCheckDate);
  const promoForecast = cursorMeterForecast(account, checkDate, store.forecast("cursor"));

  const promoMeter = (forecast: Forecast, account: CursorAccount) => {
    const samples = store.samples("cursor", range, checkDate);
    const error = store.quotaError("cursor");
    return (
      <>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
          <div style={{ width: 236, flex: "none" }}>
            <QuotaSummary
              forecast={forecast}
              samples={samples}
              now={checkDate}
              stale={!forecast.isFresh(checkDate) || error != null}
              staleHelp={error ?? "Showing the last known reading. Update pending."}
              rates={store.blendRates("cursor")}
              style="promotionalCredits"
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <QuotaChart
              key={range}
              forecast={forecast}
              samples={samples}
              color={agentColor("cursor")}
              range={range}
              now={checkDate}
              resetLabel={meterStyle.chartResetLabel("promotionalCredits")}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={subheadlineMedium}>Promotional credits</span>
            <span style={caption}>
              {"Expires " + date(account.grants.find((g) => g.kind === "promo")?.expiresAtMs)}
            </span>
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span className="tabular" style={{ fontSize: 17, fontWeight: 600 }}>
              {account.activeRemainingUSD != null ? currency(account.activeRemainingUSD) : "Unavailable"}
            </span>
            <span style={caption}>
              {"remaining of " + (account.activeLimitUSD != null ? currency(account.activeLimitUSD) : "unknown")}
            </span>
          </div>
        </div>
        {unusedIncludedWhileCreditsRemain(account) && (
          <span style={caption}>Included allowance is unused while promotional credits remain.</span>
        )}
      </>
    );
  };

  const allowanceAndBilling = (account: CursorAccount) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 0", minWidth: 0 }}>
        <span style={subheadlineMedium}>Included allowance</span>
        <span className="rounded tabular" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>
          {account.includedRemainingUSD != null ? currency(account.includedRemainingUSD) : "Unavailable"}
        </span>
        <span style={caption}>
          {"remaining of " + (account.includedLimitUSD != null ? currency(account.includedLimitUSD) : "unknown")}
        </span>
        {account.includedPercentUsed != null && (
          <>
            <ShareBar value={account.includedPercentUsed / 100} tint={T.purple} height={6} />
            <span style={caption}>{fixed(account.includedPercentUsed, 1) + "% used · reported by Cursor"}</span>
          </>
        )}
      </div>
      <VerticalDivider />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 0", minWidth: 0 }}>
        <span style={subheadlineMedium}>Billing cycle</span>
        <span style={{ fontSize: 11 }}>{"Renews " + date(account.billingCycleEndMs)}</span>
        <span style={caption}>{"Started " + date(account.billingCycleStartMs)}</span>
        <span style={caption}>
          {"On-demand spend: " +
            (account.onDemandSpentUSD != null ? currency(account.onDemandSpentUSD) : "Not reported")}
        </span>
        <span style={caption}>
          {"On-demand limit: " +
            (account.onDemandLimitUSD != null ? currency(account.onDemandLimitUSD) : "Not reported")}
        </span>
      </div>
    </div>
  );

  const grantBars = (account: CursorAccount) =>
    account.grants.map((grant, offset) => {
      const used = grantUsedPercent(grant);
      return (
        <div key={offset} style={{ display: "contents" }}>
          <Divider />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
              <span style={subheadlineMedium}>
                {grant.kind === "promo" ? "Promotional credits" : "Account credits"}
              </span>
              <span style={caption}>{"Expires " + date(grant.expiresAtMs)}</span>
            </div>
            <span style={{ flex: 1, minWidth: 8 }} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 6,
                flex: used != null ? "1 1 0" : "none",
                minWidth: 0,
              }}
            >
              <span className="tabular" style={{ fontSize: 17, fontWeight: 600 }}>
                {grant.remainingUSD != null ? currency(grant.remainingUSD) : "Unavailable"}
              </span>
              <span style={caption}>
                {"remaining of " + (grant.totalUSD != null ? currency(grant.totalUSD) : "unknown")}
              </span>
              {used != null && (
                <>
                  <ShareBar value={used / 100} tint={T.purple} height={6} />
                  <span style={caption}>{fixed(used, 1) + "% used"}</span>
                </>
              )}
            </div>
          </div>
        </div>
      );
    });

  const showsPromo = promoForecast != null && account != null && cursorHasPromotionalCredits(account);

  return (
    <Card padding={18} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <CardHeader
        title={"Cursor " + (plan?.plan ?? "account")}
        symbol="creditcard.fill"
        tint={T.purple}
        trailing={
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {plan?.pricePerMonth != null && (
              <span className="tabular">{currency(plan.pricePerMonth) + " / month"}</span>
            )}
            {showsPromo && <QuotaChartRangePicker range={range} setRange={setRange} />}
          </span>
        }
      />
      {account ? (
        <>
          {promoForecast && showsPromo ? (
            promoMeter(promoForecast, account)
          ) : (
            <>
              {allowanceAndBilling(account)}
              {grantBars(account)}
            </>
          )}
          <span style={caption}>
            Plan allowance, promotional credits and API-equivalent usage are different balances. Missing billing
            amounts are not treated as zero.
          </span>
        </>
      ) : (
        <span style={caption}>
          Account balances unavailable. Refresh with live data enabled to retrieve Cursor’s allowance, credits and
          billing cycle.
        </span>
      )}
    </Card>
  );
}

function date(milliseconds: number | null | undefined) {
  if (milliseconds == null) return "Unavailable";
  return fmtFullDate(new Date(milliseconds));
}

function unusedIncludedWhileCreditsRemain(account: CursorAccount) {
  return (account.includedPercentUsed ?? 0) === 0 && account.grants.some((g) => (g.remainingUSD ?? 0) > 0);
}

function grantUsedPercent(grant: CursorCreditGrant): number | null {
  const remaining = grant.remainingUSD;
  const total = grant.totalUSD;
  if (remaining == null || total == null || !(total > 0)) return null;
  return Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
}
