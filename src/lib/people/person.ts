// What the lead panel says about one person (stage PEOPLE). Pure: no database, no clock of its own (the time is passed in), so every rule is unit tested.
// The database side is src/lib/analytics/people-person-queries.ts. Nothing here is a new definition of a metric: "waiting", "no-show" and "stale" are the
// words of the existing rules (Speed to lead, Appointments, Today); this file only turns the facts of ONE person into one headline and one timeline.

const DAY = 86_400_000;

export const NO_SHOW_DAYS = 14;
/** A person with no activity for this long is "quiet" (the same figure the Leads page uses). */
export const QUIET_DAYS = 90;

// ---------------- the headline ----------------

export type PersonFacts = {
  nowMs: number;
  dnd: boolean;
  hasPhone: boolean;
  /** The customer wrote last in a conversation and nobody has answered: since when (ms), and whether nobody ever answered. */
  waiting: { sinceMs: number; never: boolean } | null;
  /** Their latest no-show, when they have not booked again since. */
  noShow: { atMs: number } | null;
  /** The next appointment that has not happened yet. */
  nextAppointmentMs: number | null;
  openDeals: { count: number; value: number; staleDays: number | null; stage: string | null };
  wonDeals: number;
  lastActivityMs: number | null;
  addedMs: number | null;
  /** A follow-up the team set for this person (a call logged with "follow up"), when its day has come. */
  followUpDueMs: number | null;
};

export type Headline = { tone: "stop" | "act" | "info"; line: string; next: string | null };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "3 min", "5 hours", "2 days": how long ago, in words a person would say. */
export function spanWords(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "under a minute";
  if (m < 60) return plural(m, "minute", "minutes");
  const h = Math.round(m / 60);
  if (h < 48) return plural(h, "hour", "hours");
  return plural(Math.round(h / 24), "day", "days");
}

const dayWords = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One sentence about this person and the one thing to do next, from the facts. The order is the order of what is most urgent and most certain:
 * somebody who asked not to be contacted (a stop), a customer waiting for an answer, a no-show to rebook, a follow-up due, a deal gone quiet,
 * a booking coming up, an open deal, a customer, somebody quiet, and finally "nothing recorded". It never invents: each line names only what a fact says.
 */
export function personHeadline(f: PersonFacts): Headline {
  if (f.dnd) return { tone: "stop", line: "Asked not to be contacted. Do not call or message this person.", next: "Open them in your CRM if you need to check their settings." };
  if (f.waiting) {
    const span = spanWords(f.nowMs - f.waiting.sinceMs);
    return { tone: "act", line: f.waiting.never ? `Never answered. Waiting ${span}.` : `Waiting for a reply for ${span}.`, next: f.hasPhone ? "Call now, or reply in your CRM." : "Reply in your CRM." };
  }
  if (f.noShow) {
    return { tone: "act", line: `Missed their appointment on ${dayWords(f.noShow.atMs)} and has not booked again.`, next: f.hasPhone ? "Call to rebook." : "Message them to rebook." };
  }
  if (f.followUpDueMs !== null) {
    return { tone: "act", line: `A follow-up was due ${f.nowMs - f.followUpDueMs < DAY ? "today" : `${spanWords(f.nowMs - f.followUpDueMs)} ago`}.`, next: f.hasPhone ? "Call back." : "Follow up in your CRM." };
  }
  if (f.openDeals.count > 0 && f.openDeals.staleDays !== null) {
    const what = f.openDeals.count === 1 ? "An open deal" : `${plural(f.openDeals.count, "open deal", "open deals")}`;
    return { tone: "act", line: `${what}${f.openDeals.value > 0 ? ` worth ${money(f.openDeals.value)}` : ""} has not moved in ${plural(f.openDeals.staleDays, "day", "days")}.`, next: f.hasPhone ? "Call to find out where it stands." : "Find out where it stands." };
  }
  if (f.nextAppointmentMs !== null && f.nextAppointmentMs > f.nowMs) {
    return { tone: "info", line: `Booked for ${dayWords(f.nextAppointmentMs)}.`, next: null };
  }
  if (f.openDeals.count > 0) {
    return { tone: "info", line: `${plural(f.openDeals.count, "open deal", "open deals")}${f.openDeals.value > 0 ? `, ${money(f.openDeals.value)}` : ""}${f.openDeals.stage ? `, in ${f.openDeals.stage}` : ""}.`, next: "Follow up when it suits them." };
  }
  const last = f.lastActivityMs ?? f.addedMs;
  const idle = last === null ? null : Math.max(0, Math.floor((f.nowMs - last) / DAY));
  if (f.wonDeals > 0) return { tone: "info", line: `A customer${idle !== null ? `. Last activity ${idle === 0 ? "today" : `${plural(idle, "day", "days")} ago`}` : ""}.`, next: idle !== null && idle >= 60 ? "A good moment to check in." : null };
  if (idle !== null && idle >= QUIET_DAYS) return { tone: "info", line: `No activity for ${plural(idle, "day", "days")}.`, next: "Worth one check-in, or leave them alone." };
  if (f.addedMs !== null && f.nowMs - f.addedMs < DAY) return { tone: "info", line: "A new contact from the last day.", next: null };
  return { tone: "info", line: idle === null ? "No activity recorded yet." : idle === 0 ? "Active today." : `Last activity ${plural(idle, "day", "days")} ago.`, next: null };
}

// ---------------- the timeline ----------------

export type TimelineKind = "contact" | "message" | "call" | "appointment" | "deal" | "tag" | "touch" | "note";
export type TimelineItem = { at: string; kind: TimelineKind; title: string; detail?: string };

/** Newest first, the same moment and words listed once, capped. Items with a time that cannot be read are left out (never a made-up date). */
export function mergeTimeline(parts: ReadonlyArray<ReadonlyArray<TimelineItem>>, cap = 80): TimelineItem[] {
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const it of parts.flat()) {
    if (!Number.isFinite(Date.parse(it.at))) continue;
    const key = `${new Date(it.at).toISOString()}|${it.kind}|${it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, at: new Date(it.at).toISOString() });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out.slice(0, cap);
}

/** The titles of what happened since the person last opened this one (never the "added" row, which is not news). Null when they have not opened it before. */
export function changedSince(items: readonly TimelineItem[], lastSeenIso: string | null): { count: number; titles: string[]; sinceMs: number } | null {
  if (!lastSeenIso) return null;
  const since = Date.parse(lastSeenIso);
  if (!Number.isFinite(since)) return null;
  const fresh = items.filter((i) => Date.parse(i.at) > since && i.kind !== "contact");
  return { count: fresh.length, titles: fresh.slice(0, 3).map((i) => i.title), sinceMs: since };
}

/** "Nothing new since you last looked, 3 days ago." / "2 things since you last looked, 3 days ago: A, B." */
export function changedLine(c: { count: number; titles: string[]; sinceMs: number }, nowMs: number): string {
  const when = `${spanWords(nowMs - c.sinceMs)} ago`;
  if (c.count === 0) return `Nothing new since you last looked, ${when}.`;
  return `${plural(c.count, "thing", "things")} since you last looked, ${when}: ${c.titles.join("; ")}${c.count > c.titles.length ? "; and more" : ""}.`;
}

// ---------------- text for the clipboard ----------------

export type CopyFields = { name: string; account?: string | null; phone?: string | null; email?: string | null; owner?: string | null; why?: string | null };

/** The details of a person on one tab-free block a colleague can paste: name, account, phone, email, owner, why. */
export function copyDetails(p: CopyFields): string {
  return [p.name + (p.account ? ` (${p.account})` : ""), p.phone ?? "", p.email ?? "", p.owner ? `Owner: ${p.owner}` : "", p.why ?? ""].filter(Boolean).join("\n");
}

/**
 * A note to paste into the CRM by hand. SubSync writes nothing to the CRM, so this only builds the text: the date, who it is about and what was typed.
 * Empty text gives null (nothing to copy).
 */
export function noteToSelf(p: { name: string; account?: string | null; text: string; now: Date }): string | null {
  const body = p.text.trim().slice(0, 2000);
  if (!body) return null;
  const day = p.now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${day}, ${p.name}${p.account ? ` (${p.account})` : ""}:\n${body}`;
}

// ---------------- the facts' small helpers (used by the database side, tested here) ----------------

/** The oldest of the moments the customer has been waiting since (a conversation they wrote last in, or a lead nobody touched). */
export function earliest(...times: Array<number | null>): number | null {
  const real = times.filter((t): t is number => t !== null && Number.isFinite(t));
  return real.length ? Math.min(...real) : null;
}

/** True when a no-show at `atMs` is still "to rebook": within the window and no later appointment that is not cancelled or itself missed. */
export function noShowToRebook(noShowMs: number, nowMs: number, later: ReadonlyArray<{ startMs: number; status: string | null }>): boolean {
  if (nowMs - noShowMs > NO_SHOW_DAYS * DAY || noShowMs > nowMs) return false;
  return !later.some((a) => a.startMs > noShowMs && !["cancelled", "invalid", "noshow"].includes(a.status ?? ""));
}

// ---------------- the timeline as it is drawn ----------------

/** "Today", "Yesterday" or "3 Nov 2026" for the heading above a day of the timeline (days are counted in UTC, like the rest of the timeline). */
export function dayHeading(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const day = (ms: number) => Math.floor(ms / DAY);
  const diff = day(nowMs) - day(t);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Groups a newest-first timeline by day, keeping the order. */
export function groupByDay(items: readonly TimelineItem[], nowMs: number): Array<{ heading: string; items: TimelineItem[] }> {
  const out: Array<{ heading: string; items: TimelineItem[] }> = [];
  for (const it of items) {
    const h = dayHeading(it.at, nowMs);
    const last = out[out.length - 1];
    if (last && last.heading === h) last.items.push(it); else out.push({ heading: h, items: [it] });
  }
  return out;
}

/** Live entries from the CRM (messages and calls of this person) joined to the timeline SubSync holds. When live messages exist they replace the one "last message" row. */
export function withLive(base: readonly TimelineItem[], live: { messages: ReadonlyArray<{ at: string; direction: string | null; channel: string; by: string | null }>; calls: ReadonlyArray<{ at: string; direction: string | null; result: string; by: string | null }> } | null): TimelineItem[] {
  if (!live || (live.messages.length === 0 && live.calls.length === 0)) return [...base];
  const kept = live.messages.length ? base.filter((i) => i.kind !== "message") : [...base];
  const msgs: TimelineItem[] = live.messages.map((m) => ({ at: m.at, kind: "message", title: `${m.channel} ${m.direction === "inbound" ? "from them" : m.direction === "outbound" ? "from your team" : ""}`.trim(), detail: m.by ? `by ${m.by}` : undefined }));
  const calls: TimelineItem[] = live.calls.map((c) => ({ at: c.at, kind: "call", title: `${c.direction === "inbound" ? "Incoming" : "Outgoing"} call: ${c.result}`, detail: `from your CRM${c.by ? ` · ${c.by}` : ""}` }));
  return mergeTimeline([kept, msgs, calls]);
}
