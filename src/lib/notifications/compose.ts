// Turns the words of one or more notifications into an email, a Slack message or an in-app item. Pure. Every dynamic piece has already been cleaned by
// `copy.ts` (no angle brackets, one line), and is escaped again here for the place it lands, so nothing a customer typed can become markup or a mention.

import type { Severity } from "./catalog.ts";
import { emailLogoHtml } from "../brand-logo.ts";

export type Link = { view: string | null; locationId: string | null };

/** The words of one notification, already rendered. This is what is stored in the delivery ledger and shown in the bell. */
export type Item = { title: string; body: string; details: string[]; severity: Severity; link: Link };

export const MAX_ITEMS_SHOWN = 10;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slackEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The part after # in a link into the app: a page name, or account=<id> for one client account. */
export function hashFor(link: Link): string {
  if (!link.view) return "today";
  return link.view === "account" && link.locationId ? `account=${encodeURIComponent(link.locationId)}` : link.view;
}
export const appLink = (appUrl: string, link: Link) => `${appUrl.replace(/\/+$/, "")}/app#${hashFor(link)}`;

const severityRank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
export const worst = (items: Pick<Item, "severity">[]): Severity => items.reduce<Severity>((w, i) => (severityRank[i.severity] < severityRank[w] ? i.severity : w), "info");
const sorted = (items: Item[]) => [...items].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

export type Mail = { subject: string; text: string; html: string };
export type MailOptions = { company: string; logoUrl?: string | null; appUrl: string; stopUrl: string | null; test?: boolean };

export function composeEmail(input: Item[], o: MailOptions): Mail {
  const items = sorted(input);
  const n = items.length;
  const critical = items.filter((i) => i.severity === "critical").length;
  const base = n === 1 ? items[0].title : `${o.company}: ${n} new alerts${critical ? ` (${critical} critical)` : ""}`;
  const subject = o.test ? `[TEST] ${base}` : base;
  const shown = items.slice(0, MAX_ITEMS_SHOWN);
  const more = n - shown.length;
  const openUrl = appLink(o.appUrl, items[0]?.link ?? { view: null, locationId: null });
  const lines: string[] = [];
  if (o.test) lines.push("This is a test. Nothing is wrong.", "");
  if (n === 1) {
    lines.push(items[0].title);
    if (items[0].body) lines.push("", items[0].body);
    if (items[0].details.length) lines.push("", ...items[0].details);
  } else {
    for (const i of shown) lines.push(`- ${i.title}`);
    if (more > 0) lines.push(`...and ${more} more in the app`);
  }
  lines.push("", `Open it: ${openUrl}`);
  if (o.stopUrl) lines.push("", `Stop these emails: ${o.stopUrl}`);
  const body = n === 1
    ? `<h2 style="margin:0 0 12px">${esc(items[0].title)}</h2>${items[0].body ? `<p>${esc(items[0].body)}</p>` : ""}${items[0].details.length ? `<ul style="padding-left:18px">${items[0].details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}`
    : `<h2 style="margin:0 0 12px">${esc(base)}</h2><ul style="padding-left:18px">${shown.map((i) => `<li>${esc(i.title)}</li>`).join("")}</ul>${more > 0 ? `<p>...and ${more} more in the app.</p>` : ""}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">${emailLogoHtml(o.logoUrl, o.company)}${o.test ? '<p style="color:#666;font-size:13px">This is a test. Nothing is wrong.</p>' : ""}${body}<p><a href="${esc(openUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open it</a></p>${o.stopUrl ? `<p style="font-size:12px;color:#666"><a href="${esc(o.stopUrl)}" style="color:#666">Stop these emails</a></p>` : ""}</div>`;
  return { subject, text: lines.join("\n"), html };
}

export type SlackOptions = { company: string; appUrl: string; test?: boolean };

/** One Slack message. Only the characters Slack treats specially (& < >) are escaped, so a name can never become a mention or a link. */
export function composeSlack(input: Item[], o: SlackOptions): string {
  const items = sorted(input);
  const n = items.length;
  const out: string[] = [];
  if (o.test) out.push("_This is a test. Nothing is wrong._");
  if (n === 1) {
    const i = items[0];
    out.push(`${i.severity === "critical" ? ":red_circle: " : i.severity === "warning" ? ":large_orange_circle: " : ""}*${slackEsc(i.title)}*`);
    if (i.body) out.push(slackEsc(i.body));
    for (const d of i.details.slice(0, 16)) out.push(`• ${slackEsc(d)}`);
  } else {
    out.push(`*${slackEsc(o.company)}: ${n} new alerts*`);
    for (const i of items.slice(0, MAX_ITEMS_SHOWN)) out.push(`• ${i.severity === "critical" ? ":red_circle:" : ":large_orange_circle:"} ${slackEsc(i.title)}`);
    if (n > MAX_ITEMS_SHOWN) out.push(`...and ${n - MAX_ITEMS_SHOWN} more`);
  }
  out.push(`<${appLink(o.appUrl, items[0]?.link ?? { view: null, locationId: null })}|Open it>`);
  return out.join("\n");
}
