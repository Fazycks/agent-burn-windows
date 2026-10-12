// MenuPopover (AppViews.swift): the tray window.
import { useEffect, useLayoutEffect, useRef } from "react";
import { HarnessIcon, RefreshFooter, Sym, T } from "../components/Theme";
import * as native from "../lib/native";
import { menuBarQuotaText, quotaSourceLabel } from "../lib/usage";
import { useStore } from "../store/UsageStore";
import { HarnessView } from "./HarnessView";
import { OverviewView } from "./OverviewView";
import { SourceUsageView } from "./UsageDetails";
import logo from "../assets/logo.png";

const tabs: { id: string; label: string }[] = [
  { id: "summary", label: "General" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
];

export function MenuPopover() {
  const store = useStore();
  const tab = store.selection;
  const harness = tab === "codex" || tab === "claude";
  const root = useRef<HTMLDivElement>(null);

  // The popover window follows its content height, like a MenuBarExtra window.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !native.isTauri()) return;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height !== last) {
        last = height;
        void native.popoverResize(height).catch(() => {});
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void native.hidePopover();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  return (
    <div
      ref={root}
      style={{
        width: 440,
        display: "flex",
        flexDirection: "column",
        background: "var(--popover)",
        color: T.ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 14px" }}>
        <img src={logo} alt="" width={26} height={26} draggable={false} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Agent Burn</span>
          <span className="tabular" style={{ fontSize: 11, color: T.quotaMuted }}>
            {quotaSourceLabel(store.quotaSource) + " " + menuBarQuotaText(store.remainingPercent)}
          </span>
        </div>
        <span style={{ flex: 1 }} />
        {store.isLoading && <div className="spinner" aria-label="Updating usage" />}
      </div>
      <div style={{ padding: "0 14px 14px" }}>
        <div
          role="tablist"
          aria-label="Harness"
          style={{ display: "flex", gap: 2, padding: 3, borderRadius: 10, background: T.track }}
        >
          {tabs.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                className={"popover-tab" + (active ? " selected" : "")}
                style={{ fontWeight: active ? 600 : 500, color: active ? T.ink : T.quotaMuted }}
                onClick={() => store.setSelection(item.id)}
              >
                {item.id === "summary" ? (
                  <Sym name="square.grid.2x2" size={10} weight={2.6} />
                ) : (
                  <HarnessIcon agent={item.id} size={13} />
                )}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="scroll no-scrollbar" style={{ height: harness ? 460 : 520 }}>
        <div key={tab} className="appear" style={{ padding: "0 14px 16px" }}>
          {tab === "summary" ? (
            <OverviewView />
          ) : harness ? (
            <HarnessView agent={tab} compact />
          ) : (
            <SourceUsageView agent={tab} compact />
          )}
        </div>
      </div>
      <div style={{ height: 1, background: T.line }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px" }}>
        <RefreshFooter source={harness ? tab : "summary"} compact />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="popover-pill"
            style={{ flex: 1 }}
            onClick={() => {
              store.setSelection(tab);
              void native.showDashboard();
            }}
          >
            <Sym name="macwindow" size={12} />
            Open dashboard
          </button>
          <button
            className="popover-pill square"
            title="Settings"
            aria-label="Settings"
            onClick={() => void native.showSettings()}
          >
            <Sym name="gearshape" size={13} />
          </button>
          <button
            className="popover-pill"
            title="Quit Agent Burn"
            aria-label="Quit Agent Burn"
            onClick={() => void native.quitApp()}
          >
            <Sym name="power" size={12} />
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
