// The weekly Proof as an email: what was caught, what cleared, what is still open. Pure. Words only, no tracking, no images, the unsubscribe link in the footer.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export type ProofMail = { brand: string; caught: number; cleared: number; open: number; openTitles: string[]; appUrl: string; stopUrl: string };
export function proofEmail(p: ProofMail): { subject: string; text: string; html: string } {
  const subject = p.open > 0 ? `${p.brand}: ${p.open} workflow or campaign problem${p.open === 1 ? "" : "s"} still open this week` : `${p.brand}: your workflows and campaigns this week`;
  const lines = [`This week SubSync caught ${p.caught}, ${p.cleared} cleared, ${p.open} still open.`, ...p.openTitles.slice(0, 8).map((t) => `Open: ${t}`)];
  const text = `${lines.join("\n")}\n\nSee the full page: ${p.appUrl}\n\nStop these emails: ${p.stopUrl}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px"><h2 style="margin:0 0 8px">Your workflows and campaigns this week</h2>`
    + `<p>Caught <b>${p.caught}</b> &middot; cleared <b>${p.cleared}</b> &middot; still open <b>${p.open}</b></p>`
    + (p.openTitles.length ? `<ul>${p.openTitles.slice(0, 8).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "<p>Nothing is open.</p>")
    + `<p><a href="${esc(p.appUrl)}">See the full page</a></p><p style="color:#666;font-size:12px"><a href="${esc(p.stopUrl)}">Stop these emails</a></p></div>`;
  return { subject, text, html };
}

/** A weekly send goes out on Monday between 7 and 9 in the company's own time zone, once a week. */
export function dueToday(now: Date, zone: string, lastSentDay: string | null): { due: boolean; day: string } {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); } catch { return { due: false, day: "" }; }
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  return { due: get("weekday") === "Mon" && hour >= 7 && hour < 9 && lastSentDay !== day, day };
}
