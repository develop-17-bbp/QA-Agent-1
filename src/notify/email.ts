import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SitesConfig } from "../config/schema.js";
import type { RunSummary } from "../types.js";
import { buildHtmlSummary, buildTextSummary } from "../report/build-summary.js";

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * Recipients: QA_AGENT_NOTIFY_EMAILS (comma-separated) if set; else union of
 * defaultNotify.emails and each site's notify.emails.
 */
export function resolveNotifyEmails(config: SitesConfig): string[] {
  const fromEnv = getEnv("QA_AGENT_NOTIFY_EMAILS");
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
  }
  const set = new Set<string>();
  for (const e of config.defaultNotify?.emails ?? []) set.add(e);
  for (const site of config.sites) {
    for (const e of site.notify?.emails ?? []) set.add(e);
  }
  return [...set];
}

/**
 * Writes report files under artifactsRoot/runId and sends email when SMTP is configured.
 * SMTP (optional): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 */
export async function deliverReport(options: {
  summary: RunSummary;
  config: SitesConfig;
  artifactsRoot: string;
  /** When false, only writes report files (default: true) */
  sendEmail?: boolean;
}): Promise<{ reportDir: string; textPath: string; htmlPath: string; emailSent: boolean }> {
  const { summary, artifactsRoot } = options;
  const sendEmail = options.sendEmail !== false;
  const reportDir = path.resolve(artifactsRoot, summary.runId);
  const textPath = path.join(reportDir, "report.txt");
  const htmlPath = path.join(reportDir, "report.html");

  const text = buildTextSummary(summary);
  const html = buildHtmlSummary(summary);
  await writeFile(textPath, text, "utf8");
  await writeFile(htmlPath, html, "utf8");

  if (!sendEmail) {
    return { reportDir, textPath, htmlPath, emailSent: false };
  }

  const to = resolveNotifyEmails(options.config);
  const emailSent = await trySendSmtp({
    to,
    subject: `QA-Agent run ${summary.runId} — ${countFailed(summary)} failed`,
    text,
    html,
  });

  return { reportDir, textPath, htmlPath, emailSent };
}

function countFailed(summary: RunSummary): number {
  return summary.results.filter((r) => r.status === "failed").length;
}

async function trySendSmtp(msg: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  if (msg.to.length === 0) return false;

  const host = getEnv("SMTP_HOST");
  const port = getEnv("SMTP_PORT");
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS");
  const from = getEnv("EMAIL_FROM");

  if (!host || !port || !from) {
    console.warn(
      "[qa-agent] SMTP not fully configured (need SMTP_HOST, SMTP_PORT, EMAIL_FROM). Skipping email.",
    );
    return false;
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from,
      to: msg.to.join(", "),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return true;
  } catch (e) {
    console.warn("[qa-agent] Email send failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
