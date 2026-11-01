// Speed to lead: how long a new lead waits for the first human reply. Pure (no database, no network), so
// it is unit tested. The definition lives in docs/METRICS.md and this file is its only implementation.
//
// A lead is a new contact that has a conversation. Its start is the earlier of the contact being created
// and its first inbound message. Its first touch is the first outbound message that a person sent from the
// app (an outbound message with a user and the source "app"). Messages from workflows, campaigns, bulk
// actions or the API are automation and do not count unless the account chose to count them.

export type Msg = { at: number; direction: "inbound" | "outbound" | null; userId: string | null; source: string | null; type: string | null };

const str = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// One message from the platform's list, or null if it has no usable time.
export function mapMessage(raw: unknown): Msg | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = o.dateAdded ?? o.createdAt ?? o.date;
  const at = typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : typeof t === "string" ? Date.parse(t) : NaN;
  if (!Number.isFinite(at)) return null;
  const d = str(o.direction)?.toLowerCase();
  return { at, direction: d === "inbound" || d === "outbound" ? d : null, userId: str(o.userId), source: str(o.source)?.toLowerCase() ?? null, type: str(o.messageType ?? o.type) };
}

// A phone call a person placed from the platform is a touch too (the platform records calls as messages of type TYPE_CALL), whether or
// not it was picked up: the lead was reached for, which is what the clock measures. Calls with no person attached are automation.
export const isCall = (m: Pick<Msg, "type">) => /call/i.test(m.type ?? "");

export function isHumanTouch(m: Msg, countAutomated: boolean): boolean {
  if (m.direction !== "outbound") return false;
  if (countAutomated) return true;
  return m.userId !== null && (m.source === "app" || isCall(m));
}

export type Lead = { leadAt: number; touchAt: number | null; touchUserId: string | null };

// Null when there is nothing to measure (no contact time and no messages).
export function leadFromMessages(msgs: Msg[], contactCreatedAt: number | null, countAutomated = false): Lead | null {
  const sorted = [...msgs].sort((a, b) => a.at - b.at);
  const firstInbound = sorted.find((m) => m.direction === "inbound")?.at ?? null;
  const starts = [contactCreatedAt, firstInbound].filter((x): x is number => x !== null && Number.isFinite(x));
  if (starts.length === 0) return null;
  const leadAt = Math.min(...starts);
  const touch = sorted.find((m) => m.at >= leadAt && isHumanTouch(m, countAutomated));
  return { leadAt, touchAt: touch?.at ?? null, touchUserId: touch?.userId ?? null };
}

export const responseSeconds = (l: Pick<Lead, "leadAt" | "touchAt">): number | null => (l.touchAt === null ? null : Math.max(0, Math.round((l.touchAt - l.leadAt) / 1000)));

export type TouchRow = { locationId: string; contactId: string; leadAt: number; touchAt: number | null; userId: string | null; source?: string | null; assigned?: boolean };

// Where a lead came from decides how fast it must be answered. Portal and phone leads go cold in minutes, web forms a little
// slower, social messages slower still. The windows are common practice in real estate and are shown as targets, not facts.
// Week by week: how many leads, and what share was answered inside the target. Facts only: it shows whether the team is getting
// faster, and says nothing about why. A week with fewer than 5 judged leads shows no percentage rather than a noisy one.
export type TrendWeek = { weekStart: number; leads: number; withinTarget: number; hitRate: number | null };
export function weeklyTrend(rows: TouchRow[], targetMinutes: number, now: number, weeks = 8): TrendWeek[] {
  const WEEK = 7 * 86_400_000;
  const out: TrendWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * WEEK, start = end - WEEK;
    const mine = rows.filter((r) => r.leadAt > start && r.leadAt <= end);
    const s = summarise(mine, targetMinutes, now);
    const judged = s.withinTarget + s.answeredLate + s.stillWaiting;
    out.push({ weekStart: start, leads: judged, withinTarget: s.withinTarget, hitRate: judged >= 5 ? s.withinTarget / judged : null });
  }
  return out;
}

// A lead nobody has answered for this long is not "waiting" any more: it was missed. Showing it as waiting makes the screen
// look broken, and hides the real message ("these were never answered").
export const NEVER_ANSWERED_MINUTES = 3 * 24 * 60;
export const isNeverAnswered = (waitingMinutes: number) => waitingMinutes > NEVER_ANSWERED_MINUTES;

// "meta" is a lead who filled in a Facebook or Instagram lead form: they asked for contact, so they are timed like a web form but
// tighter, because the form is one tap. "social" is a person who messaged first (direct message, Messenger, WhatsApp).
export type SourceClass = "portal" | "meta" | "form" | "social" | "other";
export const SOURCE_TARGET_MINUTES: Record<Exclude<SourceClass, "other">, number> = { portal: 5, meta: 10, form: 15, social: 60 };
export function classifySource(source: string | null | undefined): SourceClass {
  const s = (source ?? "").toLowerCase();
  if (/zillow|realtor|trulia|redfin|homes\.com|rightmove|zoopla|portal|open house|call|phone|sign/.test(s)) return "portal";
  // Order matters: a message to a page ("Instagram DM") is social, a Facebook or Instagram form is meta, and only then is a plain
  // form a web form ("Facebook Lead Form" must not be filed as a web form).
  if (/\b(dm|dms|messenger|whatsapp|tiktok|linkedin|direct message|social)\b/.test(s)) return "social";
  if (/facebook|instagram|\bfb\b|\big\b|\bmeta\b|lead ad/.test(s)) return "meta";
  if (/form|website|web|landing|funnel|ppc|google|chat|widget|email/.test(s)) return "form";
  return "other";
}

// Reply speed per source class, each judged against its own target (other leads use the account target).
export function bySource(rows: TouchRow[], accountTarget: number, now: number): Array<{ cls: SourceClass; targetMinutes: number } & Summary> {
  const out: Array<{ cls: SourceClass; targetMinutes: number } & Summary> = [];
  for (const cls of ["portal", "meta", "form", "social", "other"] as SourceClass[]) {
    const mine = rows.filter((r) => classifySource(r.source) === cls);
    if (mine.length === 0) continue;
    const targetMinutes = cls === "other" ? accountTarget : SOURCE_TARGET_MINUTES[cls];
    out.push({ cls, targetMinutes, ...summarise(mine, targetMinutes, now) });
  }
  return out;
}

const MIN_FOR_MEDIAN = 5;
const MIN_PER_PERSON = 3;

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

export type Summary = {
  leads: number; answered: number; withinTarget: number; answeredLate: number; stillWaiting: number;
  /** Share of leads that got a reply inside the target, counting those still waiting past it as misses. */
  hitRate: number | null; medianSeconds: number | null; p90Seconds: number | null;
};

// Leads that are still inside their target window are not counted either way yet.
export function summarise(rows: TouchRow[], targetMinutes: number, now: number): Summary {
  const target = targetMinutes * 60;
  let withinTarget = 0, answeredLate = 0, stillWaiting = 0, pending = 0;
  const times: number[] = [];
  for (const r of rows) {
    const s = responseSeconds(r);
    if (s !== null) {
      times.push(s);
      if (s <= target) withinTarget += 1; else answeredLate += 1;
    } else if ((now - r.leadAt) / 1000 > target) stillWaiting += 1;
    else pending += 1;
  }
  const judged = withinTarget + answeredLate + stillWaiting;
  times.sort((a, b) => a - b);
  return {
    leads: rows.length - pending, answered: times.length, withinTarget, answeredLate, stillWaiting,
    hitRate: judged >= MIN_FOR_MEDIAN ? withinTarget / judged : null,
    medianSeconds: times.length >= MIN_FOR_MEDIAN ? percentile(times, 0.5) : null,
    p90Seconds: times.length >= MIN_FOR_MEDIAN ? percentile(times, 0.9) : null,
  };
}

// Who answers fastest. Only people with enough replies are ranked, so one lucky reply is not a ranking.
export function rankPeople(rows: TouchRow[]): Array<{ userId: string; replies: number; medianSeconds: number }> {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const s = responseSeconds(r);
    if (s === null || !r.userId) continue;
    by.set(r.userId, [...(by.get(r.userId) ?? []), s]);
  }
  return [...by.entries()]
    .filter(([, t]) => t.length >= MIN_PER_PERSON)
    .map(([userId, t]) => ({ userId, replies: t.length, medianSeconds: percentile([...t].sort((a, b) => a - b), 0.5) }))
    .sort((a, b) => a.medianSeconds - b.medianSeconds);
}

export function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "none";
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d` : `${d} d ${h % 24} h`;
}
