// Speed to lead, sixth pass (stage SPEED6): the pure rules behind the control-room screens. No database, no network: every function here is unit tested
// (src/lib/__tests__/speed6.test.ts). A count shown on screen and the rows behind it come from the same function, so they cannot disagree.
import { isAfterHours } from "./speed-v3.ts";

const DAY = 86_400_000;

// ---------------------------------------------------------------- why a lead is waiting (delay reasons)
export type ReasonKey = "dnd" | "no_owner" | "owner_busy" | "after_hours" | "duplicate" | "no_phone";
export const REASONS: Record<ReasonKey, { label: string; tip: string; tone: "red" | "amber" | "violet" | "cyan" }> = {
  no_owner: { label: "No owner", tip: "Nobody is assigned to this lead, so nobody was told to reply.", tone: "red" },
  owner_busy: { label: "Owner busy", tip: "The owner is holding far more waiting leads than the rest of the team.", tone: "amber" },
  after_hours: { label: "After hours", tip: "The lead arrived outside the account's opening hours.", tone: "violet" },
  duplicate: { label: "Duplicate", tip: "An older record of the same person exists. Reply on the older record.", tone: "cyan" },
  no_phone: { label: "No phone", tip: "There is no phone number, so a call or text is not possible.", tone: "amber" },
  dnd: { label: "Do not contact", tip: "This person asked not to be contacted.", tone: "red" },
};
export type ReasonInput = { unassigned: boolean; leadAt?: number | null; timeZone?: string | null; phone: string | null; dnd: boolean; duplicate: boolean; ownerWaiting: number; busyAt: number };
/** The ONE main reason a lead is slow, first match wins. null when nothing in the data explains it. */
export function delayReason(i: ReasonInput): ReasonKey | null {
  if (i.dnd) return "dnd";
  if (i.unassigned) return "no_owner";
  if (i.ownerWaiting >= i.busyAt) return "owner_busy";
  if (i.leadAt != null && isAfterHours(i.leadAt, i.timeZone)) return "after_hours";
  if (i.duplicate) return "duplicate";
  if (!i.phone) return "no_phone";
  return null;
}
type ReasonRow = { locationId: string; contactId: string; status: "within" | "late" | "waiting"; unassigned: boolean; owner: { label: string } | null; leadAt?: number | null; timeZone?: string | null; phone: string | null; dnd: boolean; duplicateOf?: unknown };
export const rowId = (r: { locationId: string; contactId: string }) => `${r.locationId}:${r.contactId}`;
/** Reasons for a whole list: an owner is "busy" when they hold at least three waiting leads and one and a half times the average. Leads answered in time get none. */
export function delayReasons(rows: readonly ReasonRow[]): Map<string, ReasonKey | null> {
  const waiting = rows.filter((r) => r.status !== "within");
  const held = new Map<string, number>();
  for (const r of waiting) if (!r.unassigned && r.owner) held.set(r.owner.label, (held.get(r.owner.label) ?? 0) + 1);
  const avg = held.size ? [...held.values()].reduce((a, b) => a + b, 0) / held.size : 0;
  const busyAt = Math.max(3, Math.ceil(avg * 1.5));
  const out = new Map<string, ReasonKey | null>();
  for (const r of rows) out.set(rowId(r), r.status === "within" ? null : delayReason({ ...r, duplicate: !!r.duplicateOf, ownerWaiting: r.owner ? held.get(r.owner.label) ?? 0 : 0, busyAt }));
  return out;
}
/** The "main reason" bar group: how many waiting leads per reason, biggest first, plus the leads nothing explains. */
export function reasonBars(map: ReadonlyMap<string, ReasonKey | null>): Array<{ key: ReasonKey | "unclear"; label: string; n: number }> {
  const c = new Map<ReasonKey | "unclear", number>();
  for (const v of map.values()) { const k = v ?? "unclear"; c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c.entries()].map(([key, n]) => ({ key, label: key === "unclear" ? "No clear reason" : REASONS[key].label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------- the animated lead journey
export type FlowStep = { step: string; label: string; count: number };
export type Dot = { id: number; endIdx: number };
/** One dot stands for a share of the leads. A dot ends at the last step its lead reached; the dots that end early fall into a drop-off bucket. Every non-empty bucket keeps at least one dot. */
export function flowDots(steps: readonly FlowStep[], maxDots = 48): { dots: Dot[]; per: number; ends: number[]; buckets: Array<{ afterIdx: number; label: string; n: number }> } {
  const ends = steps.map((s, i) => Math.max(0, s.count - (steps[i + 1]?.count ?? 0)));
  const total = steps[0]?.count ?? 0;
  const per = Math.max(1, Math.ceil(total / maxDots));
  const dots: Dot[] = []; let id = 0;
  ends.forEach((n, i) => { const k = n === 0 ? 0 : Math.max(1, Math.round(n / per)); for (let j = 0; j < k; j++) dots.push({ id: id++, endIdx: i }); });
  const buckets = steps.slice(0, -1).map((s, i) => ({ afterIdx: i, label: `Dropped before ${steps[i + 1].label}`, n: ends[i] })).filter((b) => b.n > 0);
  return { dots, per, ends, buckets };
}

// ---------------------------------------------------------------- days, velocity, people
/** Counts per UTC day from `fromMs` up to (not including) `toMs`, zeros included, so a histogram has no gaps. */
export function dayCounts(stamps: readonly number[], fromMs: number, toMs: number): Array<{ day: string; n: number }> {
  const start = Math.floor(fromMs / DAY) * DAY; const out: Array<{ day: string; n: number }> = []; const idx = new Map<string, number>();
  for (let t = start; t < toMs && out.length < 120; t += DAY) { const day = new Date(t).toISOString().slice(0, 10); idx.set(day, out.length); out.push({ day, n: 0 }); }
  for (const s of stamps) { const i = idx.get(new Date(s).toISOString().slice(0, 10)); if (i !== undefined) out[i].n++; }
  return out;
}
const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Closing velocity: the median number of days from a lead arriving to its first booking. Needs 5 booked leads, otherwise null ("not enough data"). */
export function velocity(pairs: ReadonlyArray<{ leadAt: number; bookedAt: number | null }>, min = 5): { days: number | null; n: number } {
  const d = pairs.filter((p) => p.bookedAt !== null && p.bookedAt >= p.leadAt - 60_000).map((p) => Math.max(0, ((p.bookedAt as number) - p.leadAt) / DAY));
  const m = median(d);
  return { days: d.length >= min && m !== null ? Math.round(m * 10) / 10 : null, n: d.length };
}
export type PersonLead = { owner: string | null; ownerLabel: string | null; replied: boolean; booked: boolean; showed: boolean };
export type PersonLine = { key: string; name: string; leads: number; replied: number; booked: number; showed: number; rate: number | null; unassigned: boolean };
/** Leads, replied, booked, showed and the booking rate per person; leads nobody owns go in one "Unassigned" row (always last). A rate needs 5 leads. */
export function personTable(leads: readonly PersonLead[]): PersonLine[] {
  const by = new Map<string, PersonLine>();
  for (const l of leads) {
    const key = l.owner ?? "__none";
    const row = by.get(key) ?? { key, name: l.owner ? l.ownerLabel ?? "A team member" : "Unassigned", leads: 0, replied: 0, booked: 0, showed: 0, rate: null, unassigned: !l.owner };
    row.leads++; if (l.replied) row.replied++; if (l.booked) row.booked++; if (l.showed) row.showed++; by.set(key, row);
  }
  const rows = [...by.values()].map((r) => ({ ...r, rate: r.leads >= 5 ? Math.round((r.booked / r.leads) * 100) : null }));
  return rows.sort((a, b) => Number(a.unassigned) - Number(b.unassigned) || b.leads - a.leads || a.name.localeCompare(b.name));
}
/** "Ready to act now": waiting leads ranked by open money, then by days waiting. `nextStepNone` is true when nobody has touched the lead and no appointment exists. */
export type ReadyIn = { dollars: number; waitedMinutes: number; touched: boolean; booked: boolean };
export const readyScore = (i: Pick<ReadyIn, "dollars" | "waitedMinutes">) => Math.round((Math.log10(Math.max(0, i.dollars) + 1) * 10 + Math.min(40, (i.waitedMinutes / (60 * 24)) * 4)) * 10) / 10;
export const nextStepNone = (i: Pick<ReadyIn, "touched" | "booked">) => !i.touched && !i.booked;
export const daysWaiting = (minutes: number) => Math.floor(minutes / (60 * 24));

/** The one line that tells how many cards are held back for lack of data. */
export function moreCardsNote(hidden: number): string | null { return hidden <= 0 ? null : `${hidden} more ${hidden === 1 ? "card needs" : "cards need"} more data`; }

/** One shared date and time reading for Speed: "Mon 3 Nov, 1:00 pm WAT", in the account's own zone (UTC when unknown), with the zone abbreviation. */
export function fmtWhen(ms: number, tz: string | null | undefined): string {
  const zone = tz || "UTC";
  try {
    const d = new Date(ms);
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(d).replace(",", "");
    const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).format(d).replace(" PM", " pm").replace(" AM", " am");
    const abbr = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: zone }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? zone;
    return `${day}, ${time} ${abbr}`;
  } catch { return new Date(ms).toISOString(); }
}
