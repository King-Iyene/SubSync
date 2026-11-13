// The weekly data hygiene digest and the Proof page. Pure. Words only, no tracking, no images, the unsubscribe link in the footer.
import type { DomainSource } from "../links.ts";
import { resolveTarget, wordsLink, linkText, linkHtml } from "../notifications/crm-links.ts";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export type Since = { since: string; first: number; now: number; found: number; fixed: number } | null;
export type Outcomes = { raised: number; fixed: number; avgHoursToFix: number | null };

export function proofLines(p: { account: string; since: Since; score: number | null; outcomes: Outcomes; open: Array<{ label: string; count: number }> }): string[] {
  const out: string[] = [];
  if (p.score === null) out.push(`${p.account}: not enough contacts yet for a score.`);
  else out.push(`${p.account}: data health ${p.score} out of 100.`);
  if (p.since) out.push(`Since ${p.since.since}: ${p.since.found} problems found, ${p.since.fixed} fixed, score ${p.since.first} to ${p.since.now}.`);
  if (p.outcomes.raised) out.push(`${p.outcomes.raised} alerts raised, ${p.outcomes.fixed} resolved${p.outcomes.avgHoursToFix !== null ? `, on average ${p.outcomes.avgHoursToFix} hours to fix` : ""}.`);
  for (const o of p.open.slice(0, 5)) out.push(`To do: ${o.label} (${o.count})`);
  return out;
}

export type DigestAccount = { name: string; /** Lets the line open that account's contacts in the CRM. */ locationId?: string | null; score: number | null; weekAgo: number | null; top: Array<{ label: string; count: number }> };
/** Top 5 things to do across the accounts: the largest counts first, with the account named. */
export function topThings(accounts: DigestAccount[], n = 5): Array<{ account: string; locationId: string | null; label: string; count: number }> {
  return accounts.flatMap((a) => a.top.map((t) => ({ account: a.name, locationId: a.locationId ?? null, ...t }))).sort((x, y) => y.count - x.count).slice(0, n);
}
export function digestMail(p: { brand: string; accounts: DigestAccount[]; /** The company's CRM domain (settings.appDomain / white-label); the default host is used only when none is known. */ crmDomain?: DomainSource; stopUrl: string }) {
  const scored = p.accounts.filter((a) => a.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + (a.score as number), 0) / scored.length) : null;
  const moved = scored.filter((a) => a.weekAgo !== null).map((a) => ({ a, d: (a.score as number) - (a.weekAgo as number) }));
  const up = moved.filter((m) => m.d > 0).length, down = moved.filter((m) => m.d < 0).length;
  const things = topThings(p.accounts);
  const subject = avg === null ? `${p.brand}: your data health this week` : `${p.brand}: data health ${avg} out of 100 this week`;
  const lines = [avg === null ? "Not enough contacts yet for a score." : `Average data health ${avg} out of 100. ${up} account${up === 1 ? "" : "s"} improved, ${down} got worse.`, ...things.map((t, i) => `${i + 1}. ${t.account}: ${t.label} (${t.count})`)];
  // Each line opens its own account's contacts in the CRM; the data health page itself exists only in SubSync, so the page link is the CRM start page plus words.
  const open = (t: { locationId: string | null }) => resolveTarget(p.crmDomain, { view: "data-health", locationId: t.locationId }, "Open the contacts");
  const page = wordsLink(p.crmDomain, "SubSync > Clean-up > Data health");
  const text = `${[lines[0], ...things.flatMap((t, i) => [lines[i + 1], ...(t.locationId ? [`   ${linkText(open(t))}`] : [])])].join("\n")}\n\n${linkText(page)}\n\nStop these emails: ${p.stopUrl}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px"><h2 style="margin:0 0 8px">Your data health this week</h2>`
    + `<p>${esc(lines[0])}</p>${things.length ? `<ol>${things.map((t) => `<li>${esc(t.account)}: ${esc(t.label)} (${t.count})${t.locationId ? `<br>${linkHtml(open(t))}` : ""}</li>`).join("")}</ol>` : "<p>Nothing needs attention.</p>"}`
    + `<p>${linkHtml(page)}</p><p style="color:#666;font-size:12px"><a href="${esc(p.stopUrl)}">Stop these emails</a></p></div>`;
  return { subject, text, html };
}
