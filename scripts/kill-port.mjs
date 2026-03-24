#!/usr/bin/env node
/**
 * Free a TCP port on the local machine (macOS/Linux: uses lsof + kill).
 * Usage: node scripts/kill-port.mjs 3333
 */
import { execSync } from "node:child_process";

const port = process.argv[2] ?? "3333";
if (!/^\d+$/.test(port)) {
  console.error("Usage: node scripts/kill-port.mjs <port>");
  process.exit(1);
}

try {
  const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
  if (!out) {
    console.log(`Port ${port}: nothing listening.`);
    process.exit(0);
  }
  const pids = [...new Set(out.split(/\s+/).filter(Boolean))];
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`Port ${port}: sent SIGTERM to PID ${pid}`);
    } catch {
      /* ignore */
    }
  }
} catch {
  console.log(`Port ${port}: nothing listening (or lsof unavailable).`);
}
