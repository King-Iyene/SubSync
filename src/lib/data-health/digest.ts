// The weekly data hygiene digest and the Proof page. Pure. Words only, no tracking, no images, the unsubscribe link in the footer.
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

export type DigestAccount = { name: string; score: number | null; weekAgo: number | null; top: Array<{ label: string; count: number }> };
/** Top 5 things to do across the accounts: the largest counts first, with the account named. */
export function topThings(accounts: DigestAccount[], n = 5): Array<{ account: string; label: string; count: number }> {
  return accounts.flatMap((a) => a.top.map((t) => ({ account: a.name, ...t }))).sort((x, y) => y.count - x.count).slice(0, n);
}
export function digestMail(p: { brand: string; accounts: DigestAccount[]; appUrl: string; stopUrl: string }) {
  const scored = p.accounts.filter((a) => a.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + (a.score as number), 0) / scored.length) : null;
  const moved = scored.filter((a) => a.weekAgo !== null).map((a) => ({ a, d: (a.score as number) - (a.weekAgo as number) }));
  const up = moved.filter((m) => m.d > 0).length, down = moved.filter((m) => m.d < 0).length;
  const things = topThings(p.accounts);
  const subject = avg === null ? `${p.brand}: your data health this week` : `${p.brand}: data health ${avg} out of 100 this week`;
  const lines = [avg === null ? "Not enough contacts yet for a score." : `Average data health ${avg} out of 100. ${up} account${up === 1 ? "" : "s"} improved, ${down} got worse.`, ...things.map((t, i) => `${i + 1}. ${t.account}: ${t.label} (${t.count})`)];
  const text = `${lines.join("\n")}\n\nSee the full page: ${p.appUrl}\n\nStop these emails: ${p.stopUrl}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px"><h2 style="margin:0 0 8px">Your data health this week</h2>`
    + `<p>${esc(lines[0])}</p>${things.length ? `<ol>${things.map((t) => `<li>${esc(t.account)}: ${esc(t.label)} (${t.count})</li>`).join("")}</ol>` : "<p>Nothing needs attention.</p>"}`
    + `<p><a href="${esc(p.appUrl)}">See the full page</a></p><p style="color:#666;font-size:12px"><a href="${esc(p.stopUrl)}">Stop these emails</a></p></div>`;
  return { subject, text, html };
}
