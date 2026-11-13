// The weekly email: pure composition, no database or network, so it is unit tested.
import { inSendWindow } from "../sync/schedule.ts";
import { emailLogoHtml } from "../brand-logo.ts";
import type { DomainSource } from "../links.ts";
import { resolveTarget, linkHtml, linkText, wordsLink } from "../notifications/crm-links.ts";

export type WeeklyInput = {
  who: string;
  /** The sender's logo web address, shown at the top of the email. */
  logoUrl?: string | null;
  headlines: Array<{ label: string; money: boolean; today: number; vsAvg: number | null }>;
  /** `locationId` lets the line open that account in the CRM; without it the line opens the CRM start page. */
  attention: Array<{ name: string; title: string; locationId?: string | null }>;
  fine: number;
  /** Not used any more: emails open the CRM, never SubSync. Kept so older callers still compile. */
  appUrl?: string;
  /** The company's CRM domain (settings.appDomain / white-label); the default host is used only when none is known. */
  crmDomain?: DomainSource;
  /** The one-click "stop these emails" address, added to the foot of the email when given. */
  stopUrl?: string;
  /** Plain facts about the week, already worded (for example "9 of 12 new leads were answered inside 15 minutes"). */
  facts?: string[];
};

// The week's facts, worded once so the email and any future screen say the same thing. Only what can be counted is stated.
export function weekFacts(i: {
  leads: number; withinTarget: number; targetMinutes: number; neverAnswered: number;
  noShowsToRecover: number | null; unmarked: number | null;
}): string[] {
  const out: string[] = [];
  if (i.leads >= 5) out.push(`${i.withinTarget} of ${i.leads} new leads (last 14 days) were answered by a person inside ${i.targetMinutes} minutes (${Math.round((i.withinTarget / i.leads) * 100)}%).`);
  else if (i.leads > 0) out.push(`${i.leads} new lead${i.leads === 1 ? "" : "s"} in the last 14 days, too few to give a reply-speed percentage.`);
  if (i.neverAnswered > 0) out.push(`${i.neverAnswered} lead${i.neverAnswered === 1 ? " has" : "s have"} never been answered (waiting more than 3 days).`);
  if (i.noShowsToRecover) out.push(`${i.noShowsToRecover} no-show${i.noShowsToRecover === 1 ? " is" : "s are"} still waiting to be rebooked.`);
  if (i.unmarked) out.push(`${i.unmarked} past appointment${i.unmarked === 1 ? " has" : "s have"} no outcome marked, so show rate is understated.`);
  return out;
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const validEmail = (s: string) => s.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s);

export function weeklyEmail(i: WeeklyInput): { subject: string; text: string; html: string } {
  const count = i.attention.length;
  const subject = count === 0 ? `${i.who}: a quiet week, nothing needs you` : `${i.who}: ${count} account${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you this week`;
  const bits = i.headlines.map((h) => `${h.label}: ${h.money ? money(h.today) : Math.round(h.today)}${h.vsAvg === null ? "" : ` (${h.vsAvg > 0 ? "+" : ""}${h.vsAvg}% vs the last 7 days)`}`);
  const top = i.attention.slice(0, 8);
  const open = (a: { locationId?: string | null }) => resolveTarget(i.crmDomain, { view: "today", locationId: a.locationId ?? null }, "Open the account");
  const home = wordsLink(i.crmDomain, "SubSync > Today");
  const facts = i.facts ?? [];
  const text = [
    subject, "", ...bits, "",
    ...(facts.length ? ["The last 14 days:", ...facts.map((f) => `- ${f}`), ""] : []),
    count === 0 ? "Every account is within its own normal range." : "Needs attention:",
    ...top.flatMap((a) => [`- ${a.name}: ${a.title}`, `  ${linkText(open(a))}`]),
    ...(count > top.length ? [`...and ${count - top.length} more.`] : []),
    ...(i.fine > 0 ? ["", `${i.fine} account${i.fine === 1 ? " is" : "s are"} fine.`] : []),
    "", linkText(home),
    ...(i.stopUrl ? ["", `Stop these emails: ${i.stopUrl}`] : []),
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111111">
${emailLogoHtml(i.logoUrl, i.who)}<h2 style="margin:0 0 12px">${esc(subject)}</h2>
<ul style="padding-left:18px;color:#444444">${bits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
${facts.length ? `<h3 style="margin:20px 0 6px">The last 14 days</h3><ul style="padding-left:18px">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
<h3 style="margin:20px 0 6px">${count === 0 ? "Nothing needs you" : "Needs attention"}</h3>
<ul style="padding-left:18px">${top.map((a) => `<li><strong>${esc(a.name)}</strong>: ${esc(a.title)}<br>${linkHtml(open(a))}</li>`).join("")}</ul>
${count > top.length ? `<p>...and ${count - top.length} more.</p>` : ""}
<p>${linkHtml(home, "display:inline-block;background:#47443e;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none")}</p>
${i.stopUrl ? `<p style="font-size:12px;color:#666666"><a href="${esc(i.stopUrl)}" style="color:#666666">Stop these emails</a></p>` : ""}
</div>`;
  return { subject, text, html };
}

// An email for newly raised alerts, so the problem reaches the agency without opening the app.
export function alertEmail(who: string, alerts: Array<{ severity: string; title: string; locationId?: string | null; view?: string | null }>, crm: DomainSource, stopUrl?: string, logoUrl?: string | null): { subject: string; text: string; html: string } {
  const n = alerts.length;
  const subject = `${who}: ${n} new alert${n === 1 ? "" : "s"}${alerts.some((a) => a.severity === "critical") ? " (one is critical)" : ""}`;
  const top = alerts.slice(0, 10);
  const open = (a: { locationId?: string | null; view?: string | null }) => resolveTarget(crm, { view: a.view ?? "alerts", locationId: a.locationId ?? null });
  const home = wordsLink(crm, "SubSync > Today");
  const text = [subject, "", ...top.flatMap((a) => [`- ${a.title}`, `  ${linkText(open(a))}`]), ...(n > top.length ? [`...and ${n - top.length} more.`] : []), "", linkText(home), ...(stopUrl ? ["", `Stop these emails: ${stopUrl}`] : [])].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111111">${emailLogoHtml(logoUrl, who)}<h2>${esc(subject)}</h2><ul style="padding-left:18px">${top.map((a) => `<li>${esc(a.title)}<br>${linkHtml(open(a))}</li>`).join("")}</ul>${n > top.length ? `<p>...and ${n - top.length} more.</p>` : ""}<p>${linkHtml(home)}</p>${stopUrl ? `<p style="font-size:12px;color:#666666"><a href="${esc(stopUrl)}" style="color:#666666">Stop these emails</a></p>` : ""}</div>`;
  return { subject, text, html };
}

// Quiet hours: from 21:00 to 07:00 local time a warning waits for the morning; a critical alert is always sent at once.
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 7;
export const isQuietHour = (hour: number) => hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
/** Which of the waiting alerts may be emailed now. Criticals always; the rest only outside quiet hours (or with quiet hours switched off). */
export function alertsToSendNow<T extends { severity: string }>(alerts: T[], localHour: number | null, quietHoursOn: boolean): T[] {
  if (!quietHoursOn || localHour === null || !isQuietHour(localHour)) return alerts;
  return alerts.filter((a) => a.severity === "critical");
}

// Monday morning in the account's own zone, once per week: true from the chosen hour until SEND_CATCHUP_HOURS later, so a late run still sends.
export function weeklyDue(local: { hour: number; date: string; weekday: string } | null, hour: number, lastSentOn: string | null): boolean {
  return Boolean(local) && local!.weekday === "Mon" && inSendWindow(local!.hour, hour) && lastSentOn !== local!.date;
}
