// CRM call queue (stage DIALQ): the pure rules for filling the customer's own CRM call queue. SubSync cannot start a call itself; it ranks leads and puts them where the CRM's
// own dialer finds them: a tag a customer-built workflow listens for (the main route), or an enrolment in a workflow with a "Manual Action: Call" step. No database, no network.
// Unit tested (src/lib/__tests__/callqueue.test.ts) with no client at all: these functions only decide, the runner writes.
import { rankScore } from "./dial.ts";
import { callWindow, DEFAULT_WINDOW, type Window } from "./dial6.ts";

export const DEFAULT_TAG = "subsync-call-now";
export const TAG_RE = /^[a-z0-9][a-z0-9 _-]{1,48}$/i;
export const cleanQueueTag = (v: unknown): string => (typeof v === "string" && TAG_RE.test(v.trim()) ? v.trim().toLowerCase() : DEFAULT_TAG);
export const WORKFLOW_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const BATCH_MAX = 50; // one manual send
export const RUN_MAX = 25; // default per automatic run
export const DAY_MAX = 100; // default per day
export const WRITES_PER_MIN = 30; // the per-company write limit this feature stays under
export const REPEAT_HOURS = 24;
const H = 3_600_000;

export type Cand = { key: string; contactId: string; locationId: string; name?: string; phone: string | null; dnd: boolean; timeZone: string | null; openValue: number; ageHours: number | null; priority: number; list: string };
export type Cfg = { maxPerRun: number; maxPerDay: number; window: Window; addedToday: number; writeBudget: number };
export type Skips = { dnd: number; noPhone: number; outsideHours: number; recent: number; cap: number };
export type Plan = { add: Cand[]; remove: string[]; skipped: Skips; sendNote: string };

export const clampCfg = (c: Partial<{ maxPerRun: number; maxPerDay: number; windowStart: number; windowEnd: number }>) => ({
  maxPerRun: Math.min(BATCH_MAX, Math.max(1, Math.round(c.maxPerRun ?? RUN_MAX))),
  maxPerDay: Math.min(500, Math.max(1, Math.round(c.maxPerDay ?? DAY_MAX))),
  window: { start: Math.min(23, Math.max(0, Math.round(c.windowStart ?? DEFAULT_WINDOW.start))), end: Math.min(24, Math.max(1, Math.round(c.windowEnd ?? DEFAULT_WINDOW.end))) } as Window,
});

/**
 * Who to add and who to take out. `tagged` = keys that carry the tag now. `lastAdded` = when SubSync last queued each key (ms).
 * A lead already tagged is never added again. A lead SubSync queued in the last 24 h is not re-queued, except a redial that is due (list "redial").
 * Blocked leads (do not disturb, no phone) are never added, and come off the queue if they are on it. A lead no longer on any list (called, answered, booked, replied, no longer qualifying) comes off.
 * The total number of writes is held to `writeBudget` (removals first: they are cheap and keep the queue honest).
 */
export function planQueue(cands: readonly Cand[], tagged: ReadonlySet<string>, lastAdded: ReadonlyMap<string, number>, cfg: Cfg, now: number): Plan {
  const skipped: Skips = { dnd: 0, noPhone: 0, outsideHours: 0, recent: 0, cap: 0 };
  const seen = new Set<string>();
  const wanted = new Set<string>();
  const eligible: Cand[] = [];
  for (const c of [...cands].sort((a, b) => rankScore(b) - rankScore(a))) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    if (c.dnd) { skipped.dnd++; continue; }
    if (!c.phone) { skipped.noPhone++; continue; }
    wanted.add(c.key);
    if (tagged.has(c.key)) continue;
    if (!callWindow(now, c.timeZone, cfg.window).ok) { skipped.outsideHours++; continue; }
    const last = lastAdded.get(c.key);
    if (last !== undefined && now - last < REPEAT_HOURS * H && c.list !== "redial") { skipped.recent++; continue; }
    eligible.push(c);
  }
  const remove = [...tagged].filter((k) => !wanted.has(k)).slice(0, Math.max(0, cfg.writeBudget));
  const room = Math.max(0, Math.min(cfg.maxPerRun, cfg.maxPerDay - cfg.addedToday, cfg.writeBudget - remove.length));
  const add = eligible.slice(0, room);
  skipped.cap = eligible.length - add.length;
  const n = add.length;
  return { add, remove, skipped, sendNote: `Would add ${n} ${n === 1 ? "lead" : "leads"} to your call queue${remove.length ? ` and take ${remove.length} off` : ""}.` };
}

/** A manual send: the top `limit` of a chosen list (or the ticked people), same guards, nobody tagged or enrolled twice. Nothing is taken off. */
export function planSend(cands: readonly Cand[], tagged: ReadonlySet<string>, lastAdded: ReadonlyMap<string, number>, cfg: Cfg, now: number, limit = BATCH_MAX): Plan {
  const p = planQueue(cands.filter((c) => !tagged.has(c.key)), new Set<string>(), lastAdded, { ...cfg, maxPerRun: Math.min(limit, BATCH_MAX) }, now);
  return { ...p, remove: [], sendNote: `Would add ${p.add.length} ${p.add.length === 1 ? "lead" : "leads"} to your call queue.` };
}

/** The status card line. */
export function statusLine(s: { autoOn: boolean; paused: boolean; inQueue: number; lastRunAt: number | null; live: boolean }, now: number): string {
  if (!s.autoOn) return "Auto call queue: OFF";
  if (s.paused) return `Auto call queue: PAUSED, ${s.inQueue} in queue`;
  const ago = s.lastRunAt === null ? "not filled yet" : (() => { const m = Math.max(0, Math.round((now - s.lastRunAt) / 60_000)); return m < 1 ? "last filled just now" : `last filled ${m} min ago`; })();
  return `Auto call queue: ON${s.live ? "" : " (preview only, writes are off)"}, ${s.inQueue} ${s.inQueue === 1 ? "lead" : "leads"} in queue, ${ago}`;
}
