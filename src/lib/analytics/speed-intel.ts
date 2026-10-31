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

export function isHumanTouch(m: Msg, countAutomated: boolean): boolean {
  if (m.direction !== "outbound") return false;
  if (countAutomated) return true;
  return m.userId !== null && m.source === "app";
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

export type TouchRow = { locationId: string; contactId: string; leadAt: number; touchAt: number | null; userId: string | null };

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
