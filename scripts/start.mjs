#!/usr/bin/env node
/**
 * Cross-platform QA-Agent startup: installs deps if needed, builds, ensures
 * Playwright Chromium is present, and launches the health dashboard.
 *
 * Replaces scripts/start.sh (bash-only) so `npm start` works on Windows
 * PowerShell / CMD without WSL.
 *
 * Usage:
 *   npm start
 *   npm start -- --urls config/urls.txt
 *   SKIP_PLAYWRIGHT=1 npm start        # skip Chromium install
 *   SKIP_INSTALL=1 npm start           # skip `npm install` (already done)
 *   SKIP_BUILD=1 npm start             # skip build (already built)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

function log(msg) { console.log(`==> ${msg}`); }
function warn(msg) { console.warn(`Warning: ${msg}`); }

/**
 * Spawn wrapper that works for `.cmd`/`.bat` on Windows without triggering
 * the DEP0190 warning (which fires when you combine `shell: true` with
 * separate args). We route through `cmd.exe /c` directly instead.
 */
function toPlatform(cmd, args) {
  if (!isWindows) return { cmd, args };
  return { cmd: "cmd.exe", args: ["/c", cmd, ...args] };
}

function run(cmd, args, { optional = false, cwd = ROOT } = {}) {
  const p = toPlatform(cmd, args);
  const r = spawnSync(p.cmd, p.args, { stdio: "inherit", cwd });
  if (r.status !== 0 && !optional) {
    console.error(`\nError: \`${cmd} ${args.join(" ")}\` exited with code ${r.status}.`);
    process.exit(r.status ?? 1);
  }
  return r.status === 0;
}

// 1. Node version check
const major = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isFinite(major) || major < 20) {
  console.error(`Error: Node.js 20+ is required. Found ${process.version}`);
  process.exit(1);
}

// 2. npm install (skip if flagged)
if (process.env.SKIP_INSTALL !== "1") {
  log("npm install (root)");
  run(npmCmd, ["install", "--no-audit", "--no-fund"]);
  if (existsSync(path.join(ROOT, "web", "package.json"))) {
    log("npm install (web/)");
    run(npmCmd, ["install", "--no-audit", "--no-fund"], { cwd: path.join(ROOT, "web") });
  }
}

// 3. Build (skip if flagged)
if (process.env.SKIP_BUILD !== "1") {
  log("npm run build:all");
  run(npmCmd, ["run", "build:all"]);
  if (!existsSync(path.join(ROOT, "dist", "index.js"))) {
    console.error("Error: Build did not produce dist/index.js");
    process.exit(1);
  }
}

// 4. Playwright Chromium
if (process.env.SKIP_PLAYWRIGHT === "1") {
  log("Skipping Playwright Chromium (SKIP_PLAYWRIGHT=1)");
} else {
  log("playwright install chromium (for PDF / screenshots / form tests)");
  const ok = run(npmCmd, ["run", "setup-browsers"], { optional: true });
  if (!ok) {
    warn("Playwright Chromium install failed — PDF export / screenshots / form tests may not work. Retry with `npm run setup-browsers`.");
  }
}

// 5. Launch the dashboard (replace this process so Ctrl+C is clean)
const port = process.env.QA_AGENT_PORT ?? "3847";
log(`Starting dashboard at http://127.0.0.1:${port}/  (Ctrl+C to stop)`);
log("Extra args are passed to: health --serve …");

// Strip a leading "--" that npm injects so user args reach the health command.
const userArgs = process.argv.slice(2).filter((a, i, arr) => !(i === 0 && a === "--"));
const args = ["run", "health", "--", "--serve", ...userArgs];

const launch = toPlatform(npmCmd, args);
const child = spawn(launch.cmd, launch.args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
// Forward Ctrl+C to the child so it shuts down cleanly
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
