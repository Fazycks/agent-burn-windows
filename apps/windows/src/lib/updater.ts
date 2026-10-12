// AppUpdater (Sparkle) twin: checks the GitHub releases of the Windows port.
import { ask, message } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { dataRead, dataWrite } from "./native";


export const RELEASES_REPO = "Fazycks/agent-burn-windows";
const LAST_CHECK_FILE = "update-check.json";
const DAY = 86_400_000;

interface Release {
  tag_name: string;
  html_url: string;
  assets?: { name: string; browser_download_url: string }[];
}

function parse(version: string) {
  return version
    .replace(/^v/i, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewer(candidate: string, current: string) {
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function latestRelease(): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub responded with ${response.status}`);
  return (await response.json()) as Release;
}

let checking = false;

/** `interactive` mirrors "Check for Updates…": it always reports the result. */
export async function checkForUpdates(interactive: boolean) {
  if (checking) return;
  checking = true;
  try {
    const release = await latestRelease();
    void dataWrite(LAST_CHECK_FILE, JSON.stringify({ date: Date.now() })).catch(() => {});
    if (!isNewer(release.tag_name, __APP_VERSION__)) {
      if (interactive) {
        await message(`Agent Burn ${__APP_VERSION__} is currently the newest version available.`, {
          title: "You’re up to date!",
          kind: "info",
        });
      }
      return;
    }
    const installer = release.assets?.find((a) => /setup\.exe$/i.test(a.name));
    const version = release.tag_name.replace(/^v/i, "");
    const accepted = await ask(
      `Agent Burn ${version} is now available—you have ${__APP_VERSION__}. Would you like to download it now?`,
      {
        title: "A new version of Agent Burn is available!",
        kind: "info",
        okLabel: "Install Update",
        cancelLabel: "Remind Me Later",
      },
    );
    if (accepted) await openUrl(installer?.browser_download_url ?? release.html_url);
  } catch (error) {
    if (interactive) {
      await message(
        `An error occurred in retrieving update information. Please try again later.\n\n${error instanceof Error ? error.message : String(error)}`,
        { title: "Update Error!", kind: "error" },
      );
    }
  } finally {
    checking = false;
  }
}

/** Background check, at most once a day, like Sparkle's default interval. */
export async function automaticUpdateCheck() {
  try {
    const text = await dataRead(LAST_CHECK_FILE);
    const last = text ? (JSON.parse(text) as { date?: number }).date ?? 0 : 0;
    if (Date.now() - last < DAY) return;
  } catch {
    // Check anyway.
  }
  await checkForUpdates(false);
}
