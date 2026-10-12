// Builds the native agent-burn CLI and copies it next to the Tauri app as a
// bundled resource (the Windows twin of apps/macos/build.sh's CLI step).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const manifest = join(root, "rust", "Cargo.toml");
const target = join(here, "..", "src-tauri", "binaries");

const prebuilt = process.env.AGENT_BURN_CLI;
let cli = prebuilt ? resolve(prebuilt) : join(root, "rust", "target", "release", "agent-burn.exe");

if (!prebuilt) {
  const cargo = existsSync(join(homedir(), ".cargo", "bin", "cargo.exe"))
    ? join(homedir(), ".cargo", "bin", "cargo.exe")
    : "cargo";
  execFileSync(cargo, ["build", "--manifest-path", manifest, "--release", "--bin", "agent-burn"], {
    stdio: "inherit",
  });
}

if (!existsSync(cli)) {
  console.error(`agent-burn CLI not found at ${cli}`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
copyFileSync(cli, join(target, "agent-burn.exe"));
console.log(`Bundled ${cli} -> ${join(target, "agent-burn.exe")}`);
