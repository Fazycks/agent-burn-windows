// DashboardView, DashboardSidebar and QuotaSourceMenu (AppViews.swift).
import type { ReactNode } from "react";
import { MenuButton } from "../components/Menu";
import { HarnessIcon, IconBadge, RefreshFooter, Sym, T, alpha } from "../components/Theme";
import { TitleBar, WindowControls } from "../components/TitleBar";
import * as native from "../lib/native";
import {
  currency,
  harnessName,
  menuBarQuotaText,
  periodLabel,
  quotaSourceLabel,
  quotaSources,
  remainingQuota,
  type QuotaSource,
} from "../lib/usage";
import { useStore } from "../store/UsageStore";
import { NativeUsageView } from "./NativeUsageView";
import { PeriodPicker } from "./UsageDetails";

const TOOLBAR = 52;

export function DashboardView() {
  const store = useStore();
  const selection = store.selection;
  return (
    <div style={{ display: "flex", height: "100%", minWidth: 980, minHeight: 650 }}>
      <DashboardSidebar />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: T.background,
        }}
      >
        <TitleBar
          height={TOOLBAR}
          style={{ paddingLeft: 16, gap: 10, borderBottom: `1px solid ${T.line}` }}
          controls={<WindowControls />}
        >
          <QuotaSourceMenu />
          <div data-tauri-drag-region style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
            <span data-tauri-drag-region style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>
              {selection === "summary" ? "Overview" : harnessName(selection)}
            </span>
            <span data-tauri-drag-region style={{ fontSize: 11, color: T.muted, lineHeight: 1.3 }}>
              {periodLabel(store.period)}
            </span>
          </div>
          <span data-tauri-drag-region style={{ flex: 1, alignSelf: "stretch" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 8 }}>
            <span title="Spend period" style={{ marginRight: 4 }}>
              <PeriodPicker width={130} />
            </span>
            <button
              className="toolbar-button"
              title="Refresh usage and live quotas (Ctrl+R)"
              aria-label="Refresh"
              onClick={() => store.refreshAll()}
            >
              <Sym name="arrow.clockwise" size={15} />
            </button>
            <button
              className="toolbar-button"
              disabled={store.isCheckingQuotas}
              title="Check live usage now (Ctrl+Shift+R). Bypasses saved readings and renews an expired Claude sign-in."
              aria-label="Check live usage now"
              onClick={() => store.refreshAll(true)}
            >
              <Sym name="gauge.with.dots.needle.67percent" size={15} />
            </button>
            <button
              className="toolbar-button"
              title="Settings"
              aria-label="Settings"
              onClick={() => void native.showSettings()}
            >
              <Sym name="gearshape" size={15} />
            </button>
          </div>
        </TitleBar>
        <div className="scroll" style={{ flex: 1 }}>
          <div
            key={selection}
            className="appear"
            style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}
          >
            <NativeUsageView agent={selection === "summary" ? null : selection} />
          </div>
        </div>
        <div style={{ height: 1, background: T.grid, opacity: 0.6 }} />
        <div style={{ padding: "9px 20px" }}>
          <RefreshFooter source="summary" />
        </div>
      </div>
    </div>
  );
}

const subscriptions = ["codex", "claude", "cursor"];

function DashboardSidebar() {
  const store = useStore();
  const others = store.knownAgents.filter((agent) => !subscriptions.includes(agent));
  const spend = (value: number | null | undefined) =>
    value != null && (
      <span className="tabular" style={{ fontSize: 11, color: T.muted }}>
        {currency(value)}
      </span>
    );
  const row = (id: string, title: string, icon: ReactNode, trailing: ReactNode) => (
    <div
      key={id}
      role="option"
      aria-selected={store.selection === id}
      className={"sidebar-row" + (store.selection === id ? " selected" : "")}
      onClick={() => store.setSelection(id)}
    >
      {icon}
      <span className="ellipsis">{title}</span>
      <span style={{ flex: 1, minWidth: 6 }} />
      {trailing}
    </div>
  );
  return (
    <div
      role="listbox"
      style={{
        width: 224,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        background: "var(--sidebar)",
        borderRight: `1px solid ${T.line}`,
      }}
    >
      <div data-tauri-drag-region style={{ height: TOOLBAR, flex: "none" }} />
      <div className="scroll" style={{ flex: 1, paddingBottom: 12 }}>
        {row("summary", "Overview", <IconBadge symbol="flame.fill" size={20} />, spend(store.summary?.totals.totalCost))}
        <div className="sidebar-section">Subscriptions</div>
        {subscriptions.map((agent) =>
          row(agent, harnessName(agent), <HarnessIcon agent={agent} size={20} />, <QuotaBadge agent={agent} />),
        )}
        {others.length > 0 && (
          <>
            <div className="sidebar-section">Agents</div>
            {others.map((agent) =>
              row(
                agent,
                harnessName(agent),
                <HarnessIcon agent={agent} size={20} />,
                spend(store.summary?.agents.find((a) => a.agent === agent)?.totalCost),
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QuotaBadge({ agent }: { agent: string }) {
  const store = useStore();
  const source = agent as QuotaSource;
  const remaining = remainingQuota(
    source,
    store.forecast(agent),
    store.summary?.cursorAccount,
    store.summary?.claudeAccount,
  );
  if (remaining == null) return null;
  const tone = remaining < 15 ? T.behind : remaining < 35 ? T.orange : T.green;
  return (
    <span
      className="tabular"
      title={`${quotaSourceLabel(source)} quota remaining`}
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: tone,
        padding: "2px 6px",
        borderRadius: 999,
        background: alpha(tone, 0.14),
      }}
    >
      {menuBarQuotaText(remaining)}
    </span>
  );
}

export function QuotaSourceMenu() {
  const store = useStore();
  return (
    <MenuButton
      title="Quota shown in the system tray"
      style={{ color: T.ink, fontWeight: 500 }}
      label={
        <span className="tabular" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Sym name="flame.fill" size={13} color={T.flame} />
          {menuBarQuotaText(store.remainingPercent, store.quotaIsStale(new Date(store.quotaCheckDate)))}
        </span>
      }
      items={quotaSources.map((source) => {
        const remaining = remainingQuota(
          source,
          store.forecast(source),
          store.summary?.cursorAccount,
          store.summary?.claudeAccount,
        );
        return {
          id: source,
          label: quotaSourceLabel(source),
          checked: store.quotaSource === source,
          trailing: remaining != null ? menuBarQuotaText(remaining) : undefined,
          onSelect: () => store.setQuotaSource(source),
        };
      })}
    />
  );
}
