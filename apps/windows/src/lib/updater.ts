// AppUpdater (Sparkle) twin: "Check for Updates…". The automatic check runs in
// Rust once per app launch (src-tauri/src/updater.rs) and installs silently.
import { ask, message } from "@tauri-apps/plugin-dialog";
import { updateCheck, updateInstall } from "./native";

let checking = false;

/** Always reports the result, and installs the update when accepted. */
export async function checkForUpdates() {
  if (checking) return;
  checking = true;
  try {
    const update = await updateCheck();
    if (!update) {
      await message(`Agent Burn ${__APP_VERSION__} is currently the newest version available.`, {
        title: "You’re up to date!",
        kind: "info",
      });
      return;
    }
    const accepted = await ask(
      `Agent Burn ${update.version} is now available—you have ${__APP_VERSION__}. Would you like to install it now? Agent Burn will restart.`,
      {
        title: "A new version of Agent Burn is available!",
        kind: "info",
        okLabel: "Install Update",
        cancelLabel: "Remind Me Later",
      },
    );
    if (accepted) await updateInstall();
  } catch (error) {
    await message(
      `An error occurred while updating. Please try again later.\n\n${error instanceof Error ? error.message : String(error)}`,
      { title: "Update Error!", kind: "error" },
    );
  } finally {
    checking = false;
  }
}
