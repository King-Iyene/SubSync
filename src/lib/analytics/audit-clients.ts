// The Account audit for an agency: the client accounts ranked by what is wrong, paged on the server so it holds at 100 or 1,000 accounts; plus the progress lines and
// the "reading your accounts" state of a first run. Pure (no database, no React), unit tested in src/lib/__tests__/audit-v2.test.ts.

import { priceRows, type AuditAccount, type AuditV2, type FindingKey } from "./audit-v2.ts";
import { MIN_FOR_MEDIAN } from "./speed-intel.ts";
import { withinTargetShare } from "./today-queue.ts";

export type ClientRow = {
  id: string; name: string;
  stale: number; staleDollars: number; replies: number; noshows: number; appointments: number; leftovers: number;
  /** The four kinds added up (leftovers are never in it). */
  things: number;
  /** The estimate for this client (people waiting plus no-shows, priced), or null when it cannot be priced. */
  estimate: number | null;
  /** Used only to put the list in order: counted deal money plus the estimate. Never shown as one number. */
  rank: number;
};

const KEYS: FindingKey[] = ["stale", "replies", "noshows", "appointments", "leftovers"];

/** One row per client account that has something to fix, built from the same rows as the findings (so a client's numbers add up to the totals). */
export function clientRows(a: AuditV2, accounts: AuditAccount[]): ClientRow[] {
  const by = new Map<string, ClientRow>();
  const names = new Map(accounts.map((x) => [x.id, x.name]));
  const people = new Map<string, Array<{ locationId: string }>>();
  const row = (id: string, fallback: string): ClientRow => {
    let r = by.get(id);
    if (!r) { r = { id, name: names.get(id) ?? fallback, stale: 0, staleDollars: 0, replies: 0, noshows: 0, appointments: 0, leftovers: 0, things: 0, estimate: null, rank: 0 }; by.set(id, r); }
    return r;
  };
  for (const key of KEYS) {
    const f = a.findings.find((x) => x.key === key);
    if (!f) continue;
    for (const it of f.items) {
      const r = row(it.locationId, it.accountName);
      if (key === "stale") { r.stale += 1; r.staleDollars += it.value ?? 0; }
      else if (key === "leftovers") r.leftovers += 1;
      else r[key] += 1;
      if (key === "replies" || key === "noshows") people.set(it.locationId, [...(people.get(it.locationId) ?? []), it]);
    }
  }
  const out: ClientRow[] = [];
  for (const r of by.values()) {
    r.things = r.stale + r.replies + r.noshows + r.appointments;
    if (r.things === 0) continue;
    const acct = accounts.find((x) => x.id === r.id);
    r.estimate = acct ? priceRows(people.get(r.id) ?? [], [acct]).dollars : null;
    r.staleDollars = Math.round(r.staleDollars);
    r.rank = r.staleDollars + (r.estimate ?? 0);
    out.push(r);
  }
  return out;
}

export type ClientSort = "money" | "things" | "name";
export const CLIENT_SORTS: ClientSort[] = ["money", "things", "name"];
export const CLIENT_SORT_LABEL: Record<ClientSort, string> = { money: "Most money at risk", things: "Most things to fix", name: "Name" };
export const parseClientSort = (v: string | null | undefined): ClientSort => (CLIENT_SORTS.includes(v as ClientSort) ? (v as ClientSort) : "money");

export type ClientPage = { rows: ClientRow[]; total: number; page: number; pages: number; from: number; to: number };

/** Search, order and page. `size` is clamped to 1..50 and `page` into range, so any request gives a valid page. */
export function pageClients(rows: ClientRow[], o: { q?: string; sort?: ClientSort; page?: number; size?: number }): ClientPage {
  const q = (o.q ?? "").trim().toLowerCase();
  const size = Math.min(50, Math.max(1, Math.floor(o.size ?? 5)));
  const kept = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows];
  const sort = o.sort ?? "money";
  kept.sort((x, y) => (sort === "name" ? x.name.localeCompare(y.name) : sort === "things" ? y.things - x.things || y.rank - x.rank : y.rank - x.rank || y.things - x.things) || x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
  const pages = Math.max(1, Math.ceil(kept.length / size));
  const page = Math.min(Math.max(0, Math.floor(o.page ?? 0)), pages - 1);
  const slice = kept.slice(page * size, page * size + size);
  return { rows: slice, total: kept.length, page, pages, from: slice.length ? page * size + 1 : 0, to: page * size + slice.length };
}

// ---------- progress ----------

export type ProgressLine = { key: "stale" | "speed"; label: string; text: string; verdict: "better" | "worse" | "same" | "not_enough" };
export type SeriesIn = Array<{ id: string; points: Array<{ day: string; stale: number; ok: boolean }> }>;
const DAY = 86_400_000;
export const MIN_HISTORY_DAYS = 7;
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Progress, from data SubSync already keeps (no new history is recorded for this). Two lines, each with its own minimum, and "not enough data yet" when it cannot say:
 * deals gone quiet (the daily check's count now against its oldest count at least 7 days earlier, for the accounts that have a trusted reading on both days) and leads
 * answered inside the reply target (this week against the week before, each needs 5 judged leads).
 */
export function progressOf(i: { series: SeriesIn; replies: Array<{ leadAt: number; touchAt: number | null }>; targetMinutes: number; now: number }): ProgressLine[] {
  const out: ProgressLine[] = [];
  const days = i.series.flatMap((s) => s.points.filter((p) => p.ok).map((p) => p.day));
  const latest = days.length ? days.reduce((m, d) => (d > m ? d : m)) : null;
  const oldest = days.length ? days.reduce((m, d) => (d < m ? d : m)) : null;
  const span = latest && oldest ? (Date.parse(`${latest}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / DAY : 0;
  if (!latest || !oldest || span < MIN_HISTORY_DAYS) {
    out.push({ key: "stale", label: "Deals that stopped moving", verdict: "not_enough", text: `Not enough history yet. SubSync compares after ${MIN_HISTORY_DAYS} days of daily checks.` });
  } else {
    let before = 0, now = 0, n = 0;
    for (const s of i.series) {
      const a = s.points.find((p) => p.day === oldest && p.ok), b = s.points.find((p) => p.day === latest && p.ok);
      if (a && b) { before += a.stale; now += b.stale; n += 1; }
    }
    if (n === 0) out.push({ key: "stale", label: "Deals that stopped moving", verdict: "not_enough", text: "Not enough history yet for these accounts." });
    else out.push({
      key: "stale", label: "Deals that stopped moving", verdict: now < before ? "better" : now > before ? "worse" : "same",
      text: now === before ? `${now} on ${shortDay(oldest)} and ${now} now (daily check).` : `${before} on ${shortDay(oldest)}, ${now} now (daily check).`,
    });
  }
  const mine = withinTargetShare(i.replies, i.targetMinutes, i.now, 7), prev = withinTargetShare(i.replies, i.targetMinutes, i.now - 7 * DAY, 7);
  const label = `Leads answered within ${i.targetMinutes} minutes`;
  if (mine.share === null || prev.share === null) out.push({ key: "speed", label, verdict: "not_enough", text: `Not enough leads yet to compare weeks (needs ${MIN_FOR_MEDIAN} in each).` });
  else {
    const d = Math.round(mine.share * 100) - Math.round(prev.share * 100);
    out.push({ key: "speed", label, verdict: d >= 5 ? "better" : d <= -5 ? "worse" : "same", text: `${Math.round(mine.share * 100)}% this week (${mine.judged} leads), ${Math.round(prev.share * 100)}% the week before (${prev.judged} leads).` });
  }
  return out;
}

// ---------- first run ----------

export type Reading = { reading: boolean; done: number; total: number; text: string };

/** "Reading your client accounts: 5 of 12 done." while the first read of the accounts runs; not reading once every account has finished once. */
export function readingOf(i: { state: string; accounts: Array<{ state: string }> }): Reading {
  const total = i.accounts.length;
  const waiting = i.accounts.filter((a) => a.state === "first").length;
  const done = total - waiting;
  const reading = (i.state === "first_sync" || i.state === "never") && total > 0 && waiting > 0;
  return {
    reading, done, total,
    text: !reading ? "" : i.state === "never" && done === 0
      ? `SubSync has not read your ${total === 1 ? "account" : "client accounts"} yet. It starts on its own and usually takes a few minutes.`
      : `Reading your ${total === 1 ? "account" : "client accounts"}: ${done} of ${total} done. This usually takes a few minutes. The numbers below fill in as each one finishes.`,
  };
}
