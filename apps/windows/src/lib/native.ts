// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import type { QuotaReading } from "./usage";
import type { QuotaHistoryData } from "./quotaHistory";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function runCli(
  args: string[],
  options: {
    env?: Record<string, string>;
    offline?: boolean;
    customPath?: string;
    timeoutSecs?: number;
  } = {},
): Promise<string> {
  return invoke<string>("run_cli", {
    args,
    env: options.env ?? {},
    offline: options.offline ?? false,
    customPath: options.customPath ?? "",
    timeoutSecs: options.timeoutSecs ?? null,
  });
}

export const cliAvailable = (customPath: string) =>
  invoke<boolean>("cli_available", { customPath });

export const defaultCodexHomes = () => invoke<string>("default_codex_homes");

export const dataDir = () => invoke<string>("data_dir");

export const dataRead = (name: string) => invoke<string | null>("data_read", { name });

export const dataWrite = (name: string, contents: string, backupPrevious = false) =>
  invoke<void>("data_write", { name, contents, backupPrevious });

export const dataMtime = (name: string) => invoke<number | null>("data_mtime", { name });

export const quotaLoad = (knownMtime: number | null) =>
  invoke<{ history: QuotaHistoryData | null; mtime: number | null } | null>("quota_load", {
    knownMtime,
  });

export const quotaCommit = (
  readings: QuotaReading[],
  source: string,
  failures: Record<string, string | null>,
) => invoke<QuotaHistoryData>("quota_commit", { readings, source, failures });

export const quotaCollect = (force: boolean) => invoke<void>("quota_collect", { force });

export const quotaConfigSave = (customPath: string, codexHomes: string) =>
  invoke<void>("quota_config_save", { customPath, codexHomes });

export type BackgroundStatus = "enabled" | "outdated" | "notRegistered";

export const backgroundStatus = () => invoke<BackgroundStatus>("background_status");

export const backgroundSet = (enabled: boolean) =>
  invoke<BackgroundStatus>("background_set", { enabled });

export const setTrayStatus = (text: string) => invoke<void>("set_tray_status", { text });

export const showDashboard = () => invoke<void>("show_dashboard");

export const showSettings = (tab?: string) => invoke<void>("show_settings", { tab: tab ?? null });

export const hidePopover = () => invoke<void>("hide_popover");

export const setMenuBarOnly = (enabled: boolean) =>
  invoke<void>("set_menu_bar_only", { enabled });

export const quitApp = () => invoke<void>("quit_app");

/** Reads `<name>`, then `<name>.bak` when the primary is missing or does not decode. */
export async function loadWithBackup<T>(
  name: string,
  decode: (text: string) => T,
): Promise<T | null> {
  let failure: unknown = null;
  for (const candidate of [name, `${name}.bak`]) {
    let text: string | null;
    try {
      text = await dataRead(candidate);
    } catch (error) {
      failure ??= error;
      continue;
    }
    if (text == null) continue;
    try {
      return decode(text);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return null;
}

/** Writes `<name>`, first copying the previous file to `.bak` when it still decodes. */
export async function saveWithBackup(
  name: string,
  contents: string,
  decode: (text: string) => unknown,
) {
  let previousValid = false;
  try {
    const previous = await dataRead(name);
    if (previous != null) {
      decode(previous);
      previousValid = true;
    }
  } catch {
    previousValid = false;
  }
  await dataWrite(name, contents, previousValid);
}

export const popoverResize = (height: number) => invoke<void>("popover_resize", { height });
