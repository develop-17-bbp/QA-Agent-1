#!/usr/bin/env node
/**
 * Free a TCP port on the local machine. Works on Windows, macOS, and Linux.
 *   Windows → uses PowerShell's Get-NetTCPConnection + Stop-Process.
 *   Unix    → uses lsof + SIGTERM.
 *
 * Usage: node scripts/kill-port.mjs 3847
 */
import { execSync } from "node:child_process";

const port = process.argv[2] ?? "3333";
if (!/^\d+$/.test(port)) {
  console.error("Usage: node scripts/kill-port.mjs <port>");
  process.exit(1);
}

const isWindows = process.platform === "win32";

function killWindows(p) {
  const ps = `$c = Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue;` +
    ` if ($c) { $c | Select-Object -ExpandProperty OwningProcess -Unique |` +
    ` ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Output \"killed $_\" } catch { Write-Output \"skip $_\" } } }` +
    ` else { Write-Output \"none\" }`;
  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      encoding: "utf8",
    }).trim();
    if (out === "none" || !out) {
      console.log(`Port ${p}: nothing listening.`);
      return;
    }
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/killed (\d+)/);
      if (m) console.log(`Port ${p}: killed PID ${m[1]}`);
      else if (/^skip /.test(line)) console.log(`Port ${p}: could not stop ${line.slice(5)} (may already be gone)`);
    }
  } catch (e) {
    console.log(`Port ${p}: PowerShell unavailable or blocked (${e.message?.split("\n")[0] ?? "error"}).`);
  }
}

function killUnix(p) {
  try {
    const out = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    if (!out) {
      console.log(`Port ${p}: nothing listening.`);
      return;
    }
    const pids = [...new Set(out.split(/\s+/).filter(Boolean))];
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`Port ${p}: sent SIGTERM to PID ${pid}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    console.log(`Port ${p}: nothing listening (or lsof unavailable).`);
  }
}

if (isWindows) {
  killWindows(port);
} else {
  killUnix(port);
}
