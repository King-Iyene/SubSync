// The weekly email: pure composition, no database or network, so it is unit tested.
export type WeeklyInput = {
  who: string;
  headlines: Array<{ label: string; money: boolean; today: number; vsAvg: number | null }>;
  attention: Array<{ name: string; title: string }>;
  fine: number;
  appUrl: string;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const validEmail = (s: string) => s.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s);

export function weeklyEmail(i: WeeklyInput): { subject: string; text: string; html: string } {
  const count = i.attention.length;
  const subject = count === 0 ? `${i.who}: a quiet week, nothing needs you` : `${i.who}: ${count} account${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you this week`;
  const bits = i.headlines.map((h) => `${h.label}: ${h.money ? money(h.today) : Math.round(h.today)}${h.vsAvg === null ? "" : ` (${h.vsAvg > 0 ? "+" : ""}${h.vsAvg}% vs the last 7 days)`}`);
  const top = i.attention.slice(0, 8);
  const link = `${i.appUrl}/app#today`;
  const text = [
    subject, "", ...bits, "",
    count === 0 ? "Every account is within its own normal range." : "Needs attention:",
    ...top.map((a) => `- ${a.name}: ${a.title}`),
    ...(count > top.length ? [`...and ${count - top.length} more in the app`] : []),
    ...(i.fine > 0 ? ["", `${i.fine} account${i.fine === 1 ? " is" : "s are"} fine.`] : []),
    "", `Open it: ${link}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">
<h2 style="margin:0 0 12px">${esc(subject)}</h2>
<ul style="padding-left:18px;color:#444">${bits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
<h3 style="margin:20px 0 6px">${count === 0 ? "Nothing needs you" : "Needs attention"}</h3>
<ul style="padding-left:18px">${top.map((a) => `<li><strong>${esc(a.name)}</strong>: ${esc(a.title)}</li>`).join("")}</ul>
${count > top.length ? `<p>...and ${count - top.length} more in the app.</p>` : ""}
<p><a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open it</a></p>
</div>`;
  return { subject, text, html };
}

// Monday morning in the account's own zone, once per week: true from the chosen hour on, so a late run still sends.
export function weeklyDue(local: { hour: number; date: string; weekday: string } | null, hour: number, lastSentOn: string | null): boolean {
  return Boolean(local) && local!.weekday === "Mon" && local!.hour >= hour && lastSentOn !== local!.date;
}
