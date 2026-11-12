// Call mode (stage DIAL): a power dialer WITHOUT telephony. The call itself is placed in the customer's own CRM phone; SubSync orders the queue, shows the lead and logs the outcome.
// Everything here is pure (no database, no network), so the rules are unit tested.
/** True when `now` is outside 08:00 to 21:00 in the zone (null when the zone is unknown). Same rule as the lead panel's quiet-hours warning. */
export function outsideCallingHours(timeZone: string | null, now: Date): boolean | null {
  if (!timeZone) return null;
  try {
    const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(now).replace(/\D/g, ""));
    return Number.isNaN(h) || !(h >= 8 && h < 21);
  } catch { return null; }
}

export const OUTCOME_KEYS = ["no_answer", "voicemail", "spoke", "booked", "wrong_number", "call_back", "dnc"] as const;
export type DialOutcome = (typeof OUTCOME_KEYS)[number];

/** `local` is the word call-outcomes already keeps (so the lead leaves the call lists); `note` is the line written to the CRM; `reached` counts as a contact in the summary. */
export const OUTCOMES: ReadonlyArray<{ key: DialOutcome; label: string; hot: string; local: "no_answer" | "voicemail" | "answered" | "booked" | "wrong_number" | "follow_up" | "not_interested"; note: string; reached: boolean }> = [
  { key: "no_answer", label: "No answer", hot: "1", local: "no_answer", note: "no answer", reached: false },
  { key: "voicemail", label: "Left voicemail", hot: "2", local: "voicemail", note: "left a voicemail", reached: false },
  { key: "spoke", label: "Spoke", hot: "3", local: "answered", note: "spoke with the person", reached: true },
  { key: "booked", label: "Booked", hot: "4", local: "booked", note: "booked an appointment", reached: true },
  { key: "wrong_number", label: "Wrong number", hot: "5", local: "wrong_number", note: "wrong number", reached: false },
  { key: "call_back", label: "Call back later", hot: "6", local: "follow_up", note: "asked for a call back", reached: true },
  { key: "dnc", label: "Not interested / do not call", hot: "7", local: "not_interested", note: "not interested, asked not to be called again", reached: true },
];
export const isDialOutcome = (v: unknown): v is DialOutcome => typeof v === "string" && (OUTCOME_KEYS as readonly string[]).includes(v);
export const outcomeOf = (k: DialOutcome) => OUTCOMES.find((o) => o.key === k)!;

/** The note written to the person's record in the CRM. Metadata words only. */
export function noteFor(k: DialOutcome, callbackAt?: string | null): string {
  const o = outcomeOf(k);
  const when = k === "call_back" && callbackAt && !Number.isNaN(Date.parse(callbackAt)) ? ` (around ${new Date(callbackAt).toISOString().slice(0, 16).replace("T", " ")} UTC)` : "";
  return `Call from SubSync: ${o.note}${when}.`;
}

/** Only "call back later" creates a task: due at the time the person chose, a day ahead when none was chosen. */
export function taskFor(k: DialOutcome, name: string, callbackAt: string | null | undefined, now: Date): { title: string; dueDate: string } | null {
  if (k !== "call_back") return null;
  const t = callbackAt ? Date.parse(callbackAt) : NaN;
  const due = Number.isNaN(t) || t < now.getTime() ? new Date(now.getTime() + 86_400_000) : new Date(t);
  return { title: `Call ${name} back`, dueDate: due.toISOString() };
}

/** Days until the callback, for the call list's own follow-up (at least 0, at most 365). */
export function followUpDays(callbackAt: string | null | undefined, now: Date): number {
  const t = callbackAt ? Date.parse(callbackAt) : NaN;
  if (Number.isNaN(t)) return 1;
  return Math.min(365, Math.max(0, Math.round((t - now.getTime()) / 86_400_000)));
}

export type QueueItem = {
  contactId: string; locationId: string; locationName: string | null; name: string; phone: string | null; dnd: boolean; timeZone: string | null;
  openValue: number; /** hours since the thing that makes them worth calling (the missed call, the new lead, the last touch). */ ageHours: number | null;
  priority: number; reasons: string[]; url: string; /** Where the lead came from (the script can differ by source). */ source?: string | null;
  /** True when SubSync has no contact record for this caller yet (a missed call from a number it has not synced): no name and no number here, but the CRM has them. */ noRecord?: boolean;
};

/** Money (log scale, up to 40) plus decay (a lead freshly in is worth a call sooner: 20 inside an hour down to 2 after a week) plus the list's own priority (up to 30). */
export function rankScore(i: Pick<QueueItem, "openValue" | "ageHours" | "priority">): number {
  const money = Math.min(40, Math.log10(Math.max(0, i.openValue) + 1) * 8);
  const h = i.ageHours;
  const decay = h === null ? 4 : h <= 1 ? 20 : h <= 24 ? 16 : h <= 72 ? 10 : h <= 168 ? 5 : 2;
  return Math.round((money + decay + Math.min(100, Math.max(0, i.priority)) * 0.3) * 10) / 10;
}
export function rankQueue<T extends Pick<QueueItem, "openValue" | "ageHours" | "priority" | "contactId" | "locationId">>(items: readonly T[]): T[] {
  return items.map((i) => ({ i, s: rankScore(i) })).sort((a, b) => b.s - a.s || a.i.locationId.localeCompare(b.i.locationId) || a.i.contactId.localeCompare(b.i.contactId)).map((x) => x.i);
}

export type Block = { kind: "dnd" | "no_phone" | "done"; text: string };
/** A lead who must be skipped (never shown as the current card). Quiet hours are a warning, not a skip (see quietWarning). */
export function skipReason(i: Pick<QueueItem, "dnd" | "phone" | "name"> & { noRecord?: boolean }, doneKeys?: ReadonlySet<string>, key?: string): Block | null {
  if (i.dnd) return { kind: "dnd", text: `${i.name} asked not to be contacted. Skipped.` };
  if (!i.phone) return { kind: "no_phone", text: i.noRecord ? "SubSync has no record of this caller yet, so no number to show. Open them in your CRM to call. Skipped." : `${i.name} has no phone number. Skipped.` };
  if (key && doneKeys?.has(key)) return { kind: "done", text: "Already handled in this session." };
  return null;
}
export const quietWarning = (timeZone: string | null, now: Date): string | null =>
  outsideCallingHours(timeZone, now) === true ? "It is outside 8am to 9pm where this person is. Many places restrict calls at these hours. Call only if you are allowed to." : null;

/** How a caller is named on every screen (Coverage and Call mode): the name, else the email, else the number, else "Unknown caller". One rule so both screens read the same. */
export const callerLabel = (c: { name: string | null; email: string | null; phone: string | null }): string => c.name || c.email || c.phone || "Unknown caller";

export const keyOf = (i: Pick<QueueItem, "locationId" | "contactId">) => `${i.locationId}:${i.contactId}`;
/** The next index after `from` that is not skipped, or -1 at the end. */
export function nextIndex(items: readonly QueueItem[], from: number, done: ReadonlySet<string>): number {
  for (let n = from + 1; n < items.length; n++) if (!skipReason(items[n], done, keyOf(items[n]))) return n;
  return -1;
}

export type Logged = { outcome: DialOutcome; at: number };
/** The end-of-session summary. Minutes saved is a plain estimate: a lead worked from one list costs about 40 seconds less than finding and opening each one by hand. */
export function sessionSummary(logged: readonly Logged[], skipped: number) {
  const reached = logged.filter((l) => outcomeOf(l.outcome).reached).length;
  const booked = logged.filter((l) => l.outcome === "booked").length;
  const calls = logged.length;
  const minutesSaved = Math.round((calls * 40) / 60);
  const span = calls > 1 ? Math.max(...logged.map((l) => l.at)) - Math.min(...logged.map((l) => l.at)) : 0;
  const perHour = span >= 60_000 ? Math.round(((calls - 1) / (span / 3_600_000)) * 10) / 10 : null;
  return { calls, reached, booked, skipped, minutesSaved, perHour, reachRate: calls ? Math.round((reached / calls) * 100) : null };
}

export const DEFAULT_SCRIPT = "Hi {name}, this is {me} from {business}. I saw you reached out and wanted to help. Is now a good time for a quick chat?";
export const SCRIPT_MAX = 1000;
export function fillScript(script: string, v: { name: string; me?: string | null; business?: string | null }): string {
  const first = (v.name || "there").split(/\s+/)[0] || "there";
  return script.replaceAll("{name}", first).replaceAll("{me}", v.me?.trim() || "your team").replaceAll("{business}", v.business?.trim() || "our business");
}

/** Source lists. The first three and no-shows come from the call lists already in SubSync; `missed` from recorded missed calls; `saved:<id>` is a saved filter. */
export const DIAL_LISTS = [
  { id: "missed", label: "Missed calls, no callback", help: "People who called and nobody has called or texted back yet." },
  { id: "new_unanswered", label: "New leads not yet reached", help: "Came in recently and nobody has messaged them." },
  { id: "hot_uncontacted", label: "Hot leads untouched for 3 days", help: "Open deal, quiet for 3 days or more." },
  { id: "noshow_recovery", label: "No-show saver", help: "Missed an appointment in the last 14 days and not rebooked." },
  { id: "redial", label: "Redial list", help: "Called through Call mode, nobody picked up. Another try is due on the redial plan." },
] as const;
export const isListId = (v: string) => DIAL_LISTS.some((l) => l.id === v) || /^saved:[0-9a-fA-F-]{36}$/.test(v);

/** Calls per hour and outcome counts per person, from recorded call events (no text anywhere). */
export function statsByUser(rows: ReadonlyArray<{ userId: string | null; outcome: string | null; at: number }>) {
  const by = new Map<string, { calls: number; first: number; last: number; outcomes: Record<string, number> }>();
  for (const r of rows) {
    const k = r.userId ?? "unknown";
    const s = by.get(k) ?? { calls: 0, first: r.at, last: r.at, outcomes: {} };
    s.calls++; s.first = Math.min(s.first, r.at); s.last = Math.max(s.last, r.at);
    const o = r.outcome ?? "other"; s.outcomes[o] = (s.outcomes[o] ?? 0) + 1;
    by.set(k, s);
  }
  return [...by.entries()].map(([userId, s]) => ({ userId, calls: s.calls, outcomes: s.outcomes, perHour: s.calls > 1 && s.last - s.first >= 60_000 ? Math.round(((s.calls - 1) / ((s.last - s.first) / 3_600_000)) * 10) / 10 : null })).sort((a, b) => b.calls - a.calls);
}
