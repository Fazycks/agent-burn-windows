// SettingsView and its tabs (AppViews.swift).
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";
import { appVersionText, Sym, T } from "../components/Theme";
import { TitleBar, WindowControls } from "../components/TitleBar";
import * as native from "../lib/native";
import { checkForUpdates } from "../lib/updater";
import { menuBarQuotaText, quotaSourceLabel, quotaSources, remainingQuota, type QuotaSource } from "../lib/usage";
import { useStore } from "../store/UsageStore";
import logo from "../assets/logo.png";

const SOURCE_URL = "https://github.com/Fazycks/agent-burn-windows";

const tabs = [
  { id: "general", label: "General", symbol: "gearshape" },
  { id: "data", label: "Data", symbol: "externaldrive" },
  { id: "background", label: "Background", symbol: "clock.arrow.circlepath" },
  { id: "updates", label: "Updates", symbol: "arrow.down.circle" },
  { id: "about", label: "About", symbol: "flame" },
] as const;

type TabId = (typeof tabs)[number]["id"];
const isTab = (value: unknown): value is TabId => tabs.some((tab) => tab.id === value);

export function SettingsView() {
  const [tab, setTab] = useState<TabId>(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    return isTab(param) ? param : "general";
  });
  useEffect(() => {
    if (!native.isTauri()) return;
    const pending = listen<string>("settings:tab", (event) => {
      if (isTab(event.payload)) setTab(event.payload);
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);
  const title = tabs.find((t) => t.id === tab)?.label ?? "Settings";
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.background }}>
      <TitleBar
        height={80}
        style={{ flexDirection: "column", alignItems: "stretch", borderBottom: `1px solid ${T.line}`, position: "relative" }}
      >
        <div data-tauri-drag-region style={{ height: 30, display: "grid", placeItems: "center" }}>
          <span data-tauri-drag-region style={{ fontSize: 13, fontWeight: 600 }}>
            {title}
          </span>
        </div>
        <div style={{ position: "absolute", top: 0, right: 0, height: 30 }}>
          <WindowControls minimize={false} maximize={false} />
        </div>
        <div role="tablist" style={{ display: "flex", justifyContent: "center", gap: 2 }}>
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={"settings-tab no-drag" + (tab === item.id ? " selected" : "")}
              onClick={() => setTab(item.id)}
            >
              <Sym name={item.symbol} size={20} weight={1.6} />
              {item.label}
            </button>
          ))}
        </div>
      </TitleBar>
      <div className="scroll" style={{ flex: 1 }}>
        <div key={tab} className="appear">
          {tab === "general" && (
            <Form>
              <LoginItemSettings />
              <AppearanceSettings />
              <QuotaSourceSettings />
            </Form>
          )}
          {tab === "data" && <DataSettings />}
          {tab === "background" && <BackgroundSettings />}
          {tab === "updates" && <UpdateSettings />}
          {tab === "about" && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}

// MARK: Form building blocks

function Form({ children }: { children: ReactNode }) {
  return <div className="form">{children}</div>;
}

function Section({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="form-section-title">{title}</h3>
      <div className="form-section">{children}</div>
      {footer && <div style={{ padding: "6px 10px 0" }}>{footer}</div>}
    </section>
  );
}

function Row({ label, children }: { label?: ReactNode; children?: ReactNode }) {
  return (
    <div className="form-row">
      {label != null && <span style={{ flex: 1 }}>{label}</span>}
      {children}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={"toggle" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
    />
  );
}

const Caption = ({ children }: { children: ReactNode }) => <p className="form-caption">{children}</p>;
const ErrorText = ({ children }: { children: ReactNode }) => (
  <p className="form-caption" style={{ color: T.red }}>
    {children}
  </p>
);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// MARK: General

function LoginItemSettings() {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!native.isTauri()) return;
    native
      .startupStatus()
      .then(setEnabled)
      .catch(() => setEnabled(false));
    // The tray menu has the same switch.
    const pending = listen<boolean>("startup:changed", (event) => setEnabled(event.payload));
    return () => void pending.then((unlisten) => unlisten());
  }, []);
  const change = async (value: boolean) => {
    try {
      setEnabled(await native.startupSet(value));
      setError(null);
    } catch (e) {
      setError(`Could not change login behavior: ${errorText(e)}`);
      setEnabled(await native.startupStatus().catch(() => false));
    }
  };
  return (
    <Section
      title="Startup"
      footer={
        <>
          <Caption>Open Agent Burn in the system tray when you sign in to Windows.</Caption>
          {error && <ErrorText>{error}</ErrorText>}
        </>
      }
    >
      <Row label="Launch at login">
        <Toggle label="Launch at login" on={enabled} onChange={(value) => void change(value)} />
      </Row>
    </Section>
  );
}

function AppearanceSettings() {
  const store = useStore();
  const on = store.prefs.menuBarOnly;
  return (
    <Section
      title="Appearance"
      footer={
        <Caption>
          Hide Agent Burn from the taskbar and Alt+Tab. The flame in the system tray still opens the dashboard and
          Settings.
        </Caption>
      }
    >
      <Row label="System tray only">
        <Toggle
          label="System tray only"
          on={on}
          onChange={(value) => {
            void store.setPrefs({ menuBarOnly: value });
            void native.setMenuBarOnly(value).catch(() => {});
          }}
        />
      </Row>
    </Section>
  );
}

function QuotaSourceSettings() {
  const store = useStore();
  return (
    <Section
      title="Tray quota"
      footer={
        <Caption>
          The flame in the system tray and the window toolbar show this remaining percentage. Codex uses the live weekly
          account meter, Claude uses its weekly limit, and Cursor uses promotional credits while those remain, otherwise
          the included allowance.
        </Caption>
      }
    >
      <Row label="Show remaining">
        <select
          className="menu-select"
          aria-label="Show remaining"
          value={store.quotaSource}
          onChange={(event) => void store.setQuotaSource(event.target.value as QuotaSource)}
        >
          {quotaSources.map((source) => {
            const remaining = remainingQuota(
              source,
              store.forecast(source),
              store.summary?.cursorAccount,
              store.summary?.claudeAccount,
            );
            return (
              <option key={source} value={source}>
                {quotaSourceLabel(source)}
                {remaining != null ? `  ${menuBarQuotaText(remaining)}` : ""}
              </option>
            );
          })}
        </select>
      </Row>
    </Section>
  );
}

// MARK: Data

const refreshChoices = [
  { minutes: 1, label: "Every minute" },
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
];

function DataSettings() {
  const store = useStore();
  const [customPath, setCustomPath] = useState(store.prefs.customPath);
  const [codexHomes, setCodexHomes] = useState(store.prefs.codexHomes);
  const choose = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Choose the agent-burn executable",
      filters: [{ name: "Executable", extensions: ["exe"] }],
    });
    if (typeof picked === "string") setCustomPath(picked);
  };
  const apply = async () => {
    await store.setPrefs({ customPath: customPath.trim(), codexHomes });
    await native.quotaConfigSave(customPath.trim(), codexHomes).catch(() => {});
    await store.dispatch({ type: "reconfigure" });
    await store.refreshAll();
  };
  return (
    <Form>
      <Section
        title="Data source"
        footer={
          <Caption>
            Cached mode skips live subscription requests. Otherwise, the CLI may contact pricing and harness providers.
          </Caption>
        }
      >
        <Row>
          <span style={{ flex: "none" }}>CLI executable</span>
          <input
            className="text-field"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Bundled agent-burn"
            title="Absolute path to the native agent-burn executable"
            value={customPath}
            spellCheck={false}
            onChange={(event) => setCustomPath(event.target.value)}
          />
        </Row>
        <Row>
          <span style={{ flex: 1 }} />
          <button className="bordered-button small" onClick={() => void choose()}>
            Choose executable…
          </button>
        </Row>
        <Row label="Use cached pricing and limits">
          <Toggle
            label="Use cached pricing and limits"
            on={store.prefs.offline}
            onChange={(value) => void store.setPrefs({ offline: value })}
          />
        </Row>
      </Section>
      <Section
        title="Log folders"
        footer={
          <Caption>
            Comma-separated Codex folders. The normal %USERPROFILE%\.codex folder is included alongside CODEX_HOME.
            Sessions and archived sessions are read by the CLI.
          </Caption>
        }
      >
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <span>Codex homes</span>
          <textarea
            className="text-field"
            rows={3}
            spellCheck={false}
            aria-label="Codex homes"
            style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 12, resize: "vertical" }}
            value={codexHomes}
            onChange={(event) => setCodexHomes(event.target.value)}
          />
        </div>
      </Section>
      <Section title="Refresh">
        <Row label="Automatically refresh">
          <select
            className="menu-select"
            aria-label="Automatically refresh"
            value={store.prefs.refreshMinutes}
            onChange={(event) => void store.setPrefs({ refreshMinutes: Number(event.target.value) })}
          >
            {refreshChoices.map((choice) => (
              <option key={choice.minutes} value={choice.minutes}>
                {choice.label}
              </option>
            ))}
          </select>
        </Row>
        <Row>
          <span style={{ flex: 1 }} />
          <button className="bordered-button small" disabled={store.isLoading} onClick={() => void apply()}>
            {store.isLoading ? "Refreshing…" : "Apply and refresh"}
          </button>
        </Row>
      </Section>
    </Form>
  );
}

// MARK: Background

function BackgroundSettings() {
  const store = useStore();
  const error = store.errors["backgroundToggle"];
  return (
    <Form>
      <Section
        title="Background quota history"
        footer={
          <>
            <Caption>
              A scheduled task records live quota readings every minute, even while Agent Burn is closed, so the quota
              charts have no gaps.
            </Caption>
            {error && <ErrorText>{error}</ErrorText>}
          </>
        }
      >
        <Row label="Collect quotas every minute">
          <Toggle
            label="Collect quotas every minute"
            on={store.backgroundStatus === "enabled"}
            onChange={(value) => void store.dispatch({ type: "setBackground", enabled: value })}
          />
        </Row>
      </Section>
    </Form>
  );
}

// MARK: Updates

function UpdateSettings() {
  const store = useStore();
  return (
    <Form>
      <Section
        title="App updates"
        footer={
          <Caption>
            Checked each time Agent Burn starts, then installed in the background from the open-source GitHub
            releases. Agent Burn restarts by itself.
          </Caption>
        }
      >
        <Row label="Automatically install updates">
          <Toggle
            label="Automatically install updates"
            on={store.prefs.automaticallyCheckForUpdates}
            onChange={(value) => void store.setPrefs({ automaticallyCheckForUpdates: value })}
          />
        </Row>
        <Row>
          <span style={{ flex: 1 }} />
          <button className="bordered-button small" onClick={() => void checkForUpdates()}>
            Check for Updates…
          </button>
        </Row>
      </Section>
    </Form>
  );
}

// MARK: About

function AboutSettings() {
  const link = (label: string, symbol: string, url: string) => (
    <button className="bordered-button" onClick={() => void openUrl(url)}>
      <Sym name={symbol} size={12} />
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "36px 24px" }}>
      <img
        src={logo}
        alt=""
        width={96}
        height={96}
        draggable={false}
        style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.18))" }}
      />
      <div className="rounded" style={{ fontSize: 22, fontWeight: 700 }}>
        Agent Burn
      </div>
      <div style={{ fontSize: 12, color: T.muted }}>Version {appVersionText()}</div>
      <p style={{ maxWidth: 380, textAlign: "center", fontSize: 13, lineHeight: 1.4, margin: "4px 0 8px" }}>
        Spend, tokens and subscription limits for your coding agents. Usage is read from local logs and never sent to an
        Agent Burn service.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {link("Website", "safari", "https://agent-burn.melvynx.dev")}
        {link("Source code", "chevron.left.forwardslash.chevron.right", SOURCE_URL)}
        {link("Docs", "book", "https://agent-burn.melvynx.dev/docs")}
      </div>
      <div style={{ fontSize: 11, color: T.tertiary, marginTop: 14 }}>MIT licensed · Based on ccusage</div>
    </div>
  );
}
