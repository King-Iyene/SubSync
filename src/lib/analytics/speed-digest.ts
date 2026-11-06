// The Speed summary message (stage SPEED6): who gets it, where, when, and what it says. Pure rules, no database, no network: unit tested (speed-digest.test.ts). The message is built from the SAME numbers the
// screen shows (waiting leads, typical first reply, answered in time) and never contains a lead's message text.
export type LineKey = "waiting" | "typical" | "inTime" | "leaked" | "noOwner";
export const LINES: ReadonlyArray<{ key: LineKey; label: string }> = [
  { key: "waiting", label: "Leads waiting for a first reply" }, { key: "typical", label: "Typical first reply" }, { key: "inTime", label: "Answered in time" },
  { key: "leaked", label: "Leads with no reply or a slow one" }, { key: "noOwner", label: "Leads nobody owns" },
];
export type Schedule = { cadence: "daily" | "weekly"; hour: number; weekday: number; tz: string };
export type DigestSettings = { enabled: boolean; email: boolean; slack: boolean; recipients: string[]; schedule: Schedule; intro: string; outro: string; lines: LineKey[] };
export const DEFAULT_DIGEST: DigestSettings = {
  enabled: false, email: true, slack: false, recipients: [], schedule: { cadence: "daily", hour: 8, weekday: 1, tz: "UTC" },
  intro: "Here is how first replies are going.", outro: "Open SubSync to reply to the leads that are waiting.", lines: ["waiting", "typical", "inTime"],
};
export type Numbers = { who: string; waiting: number; typicalSeconds: number | null; inTimePct: number | null; leaked: number; noOwner: number };

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const validZone = (z: unknown): z is string => { if (typeof z !== "string" || !z) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
const text = (v: unknown, max: number, d: string) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max) : d);

/** A saved or posted settings object, made safe: unknown keys dropped, hours and days in range, a real time zone, valid distinct addresses (at most 10), text capped. */
export function sanitizeDigest(raw: unknown): DigestSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (r.schedule && typeof r.schedule === "object" ? r.schedule : {}) as Record<string, unknown>;
  const hour = Number(s.hour); const wd = Number(s.weekday);
  const emails = Array.isArray(r.recipients) ? [...new Set(r.recipients.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e) && e.length <= 120))].slice(0, 10) : [];
  const lines = Array.isArray(r.lines) ? LINES.map((l) => l.key).filter((k) => (r.lines as unknown[]).includes(k)) : DEFAULT_DIGEST.lines;
  return {
    enabled: r.enabled === true, email: r.email !== false, slack: r.slack === true, recipients: emails,
    schedule: { cadence: s.cadence === "weekly" ? "weekly" : "daily", hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8, weekday: Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 1, tz: validZone(s.tz) ? s.tz : "UTC" },
    intro: text(r.intro, 500, DEFAULT_DIGEST.intro), outro: text(r.outro, 500, DEFAULT_DIGEST.outro), lines,
  };
}

const dur = (s: number) => (s < 90 ? `${s} seconds` : s < 5400 ? `${Math.round(s / 60)} minutes` : `${Math.round(s / 360) / 10} hours`);
/** The exact message: subject, the lines the person chose (numbers only), the editable intro and sign-off. "not enough data" where a figure has too few leads. */
export function buildMessage(s: DigestSettings, n: Numbers): { subject: string; lines: string[]; text: string } {
  const body: string[] = [];
  for (const k of s.lines) {
    if (k === "waiting") body.push(n.waiting === 0 ? "No lead is waiting for a first reply." : `${n.waiting} ${n.waiting === 1 ? "lead is" : "leads are"} waiting for a first reply.`);
    if (k === "typical") body.push(n.typicalSeconds === null ? "Typical first reply: not enough data yet." : `Typical first reply: ${dur(n.typicalSeconds)}.`);
    if (k === "inTime") body.push(n.inTimePct === null ? "Answered in time: not enough data yet." : `Answered in time: ${n.inTimePct}%.`);
    if (k === "leaked") body.push(`${n.leaked} ${n.leaked === 1 ? "lead got" : "leads got"} no reply from a person, or a slow one.`);
    if (k === "noOwner") body.push(`${n.noOwner} ${n.noOwner === 1 ? "lead has" : "leads have"} no owner.`);
  }
  const subject = `${n.who}: ${s.schedule.cadence === "weekly" ? "weekly" : "daily"} speed to lead summary`;
  const parts = [s.intro.trim(), body.map((l) => `- ${l}`).join("\n"), s.outro.trim()].filter(Boolean);
  return { subject, lines: body, text: parts.join("\n\n") };
}

// ---------------------------------------------------------------- schedule, in the account's own zone
export function localDay(ms: number, tz: string): { ymd: string; weekday: number; hour: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), hour: Number(g("hour")) % 24 };
}
/** One key per send: the local date for a daily message, the local date of the chosen weekday for a weekly one. The same key is never sent twice. */
export const scheduleKey = (now: number, sch: Schedule) => `${sch.cadence === "weekly" ? "w" : "d"}:${localDay(now, sch.tz).ymd}`;
/** Due when it is the chosen time or later (so a late cron still delivers), on the chosen weekday for a weekly message, and this key has not been sent. */
export function isDue(now: number, sch: Schedule, lastKey: string | null): boolean {
  const l = localDay(now, sch.tz);
  if (l.hour < sch.hour) return false;
  if (sch.cadence === "weekly" && l.weekday !== sch.weekday) return false;
  return lastKey !== scheduleKey(now, sch);
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** One plain sentence about where it goes and whether anything is sent. */
export function destination(s: DigestSettings, live: { email: boolean; slack: boolean }): string {
  const when = `${s.schedule.hour}:00 ${s.schedule.cadence === "weekly" ? `every ${DAYS[s.schedule.weekday]}` : "every day"} (${s.schedule.tz})`;
  const to: string[] = [];
  if (s.email) to.push(s.recipients.length ? `${s.recipients.join(", ")} by email` : "nobody by email (add an address)");
  if (s.slack) to.push("the Slack channel");
  if (to.length === 0) return "It goes nowhere: choose email or Slack.";
  const off = [s.email && !live.email ? "email" : null, s.slack && !live.slack ? "Slack" : null].filter(Boolean);
  return `Goes to ${to.join(" and ")} at ${when}.${s.enabled ? "" : " This summary is switched off."}${off.length ? ` Sending ${off.join(" and ")} is off until it is enabled: nothing is sent yet.` : ""}`;
}
/** What a send does given the switches: never a real send unless that channel's switch is on (the outward gate is the real guard; this is the rule the tests pin). */
export const mayReallySend = (channel: "email" | "slack", live: { email: boolean; slack: boolean }) => (channel === "email" ? live.email : live.slack);
