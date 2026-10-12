import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/theme.css";
import * as native from "./lib/native";
import { automaticUpdateCheck } from "./lib/updater";
import { createStore } from "./store/UsageStore";
import { DashboardView } from "./views/DashboardView";
import { MenuPopover } from "./views/MenuPopover";
import { SettingsView } from "./views/SettingsView";

type WindowKind = "main" | "popover" | "settings";

const param = new URLSearchParams(window.location.search).get("window");
const kind: WindowKind = param === "popover" || param === "settings" ? param : "main";
if (kind === "popover") document.body.classList.add("popover-window");

const store = createStore(kind === "main" ? "leader" : "follower");

// App commands (AgentBurnApp.swift `.commands`), plus browser defaults that
// make no sense in a desktop window.
window.addEventListener("keydown", (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === "F5" || (ctrl && key === "r")) {
    event.preventDefault();
    void store.refreshAll(event.shiftKey);
  } else if (ctrl && event.key === ",") {
    event.preventDefault();
    void native.showSettings();
  } else if (ctrl && (key === "p" || key === "f" || key === "u" || key === "g")) {
    event.preventDefault();
  }
});
window.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest("input, textarea")) event.preventDefault();
});

const Root = kind === "popover" ? MenuPopover : kind === "settings" ? SettingsView : DashboardView;

async function boot() {
  if (native.isTauri()) {
    try {
      await store.init();
    } catch (error) {
      console.error("Agent Burn could not load its data", error);
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
  if (kind === "main" && native.isTauri()) {
    await store.start();
    // automaticUpdateCheck keeps a one-day gap itself, like Sparkle's schedule.
    const check = () => {
      if (store.prefs.automaticallyCheckForUpdates) void automaticUpdateCheck();
    };
    setTimeout(check, 10_000);
    setInterval(check, 3_600_000);
  }
}

void boot();
