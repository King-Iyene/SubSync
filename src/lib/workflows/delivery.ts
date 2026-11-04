// Workflows module: campaign delivery. Pure. The platform gives one set of totals per campaign (sent, delivered, opened, clicked, bounced, failed, unsubscribed,
// queued) and no list of the people behind each number, so everything here works on those totals and never invents a count. A field the platform did not
// send is null ("not available"), never zero. Definitions: docs/METRICS.md (Campaign delivery).
import { toMs } from "./model.ts";

export type Stats = { sent: number | null; delivered: number | null; opened: number | null; clicked: number | null; bounced: number | null; failed: number | null; unsubscribed: number | null; queued: number | null };
export const STAT_KEYS = ["sent", "delivered", "opened", "clicked", "bounced", "failed", "unsubscribed", "queued"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_LABEL: Record<StatKey, string> = { sent: "Sent", delivered: "Delivered", opened: "Opened", clicked: "Clicked", bounced: "Bounced", failed: "Failed", unsubscribed: "Unsubscribed", queued: "Waiting to send" };
export const BAD: ReadonlySet<StatKey> = new Set<StatKey>(["bounced", "failed", "unsubscribed", "queued"]);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pickNum = (o: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const k of keys) { const v = o[k]; if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v); if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) return Math.round(Number(v)); }
  return null;
};
const sum = (...v: Array<number | null>) => (v.every((x) => x === null) ? null : v.reduce<number>((a, b) => a + (b ?? 0), 0));

/** The statistics answer has a `stats` object. Several spellings are accepted; hard and soft bounces are added; a missing field stays null. */
export function parseStats(json: unknown): Stats | null {
  const root = obj(json);
  const s = obj(root.stats ?? root.data ?? root);
  const out: Stats = {
    sent: pickNum(s, "sent", "total", "totalSent", "processed", "requested"),
    delivered: pickNum(s, "delivered", "deliveredCount"),
    opened: pickNum(s, "opened", "opens", "uniqueOpens"),
    clicked: pickNum(s, "clicked", "clicks", "uniqueClicks"),
    bounced: pickNum(s, "bounced", "bounces") ?? sum(pickNum(s, "hardBounced", "hardBounce"), pickNum(s, "softBounced", "softBounce")),
    failed: pickNum(s, "failed", "errors", "dropped", "rejected"),
    unsubscribed: pickNum(s, "unsubscribed", "unsubscribes"),
    queued: pickNum(s, "queued", "pending", "scheduled", "waiting"),
  };
  return STAT_KEYS.every((k) => out[k] === null) ? null : out;
}

export type Camp = { campaignId: string; locationId: string; name: string; status: string; kind: string | null; updatedAt: number | null; createdAt: number | null; stats: Stats | null; takenAt: number | null };

/** Share of `part` in `whole`, only when both are known and the whole is not zero. */
export const rate = (part: number | null, whole: number | null): number | null => (part === null || whole === null || whole <= 0 ? null : Math.min(1, part / whole));
export const pct = (r: number | null) => (r === null ? "Not available" : `${Math.round(r * 1000) / 10}%`);

export const MIN_SENT = 50;
const DAY = 86_400_000;

export type Flag = { campaignId: string; locationId: string; kind: "not_delivered" | "stuck" | "bouncing" | "unsubscribing"; why: string; next: string; estimate: boolean };
/** Campaigns that look sent but did not reach people, and why in plain words. Below the minimum sample nothing is claimed. */
export function flagsFor(camps: Camp[], now: number): Flag[] {
  const out: Flag[] = [];
  for (const c of camps) {
    const s = c.stats;
    if (!s) continue;
    const base = { campaignId: c.campaignId, locationId: c.locationId, estimate: false };
    const sent = s.sent, del = rate(s.delivered, sent), bounce = rate(s.bounced, sent), unsub = rate(s.unsubscribed, s.delivered ?? sent);
    if (s.queued !== null && s.queued > 0 && c.updatedAt !== null && now - c.updatedAt > 2 * DAY && c.status !== "draft") {
      out.push({ ...base, kind: "stuck", estimate: true, why: `${s.queued} messages are still waiting and nothing changed for ${Math.floor((now - c.updatedAt) / DAY)} days.`, next: "Open the campaign in your CRM and check its sending status and the sending domain." });
    }
    if (sent === null || sent < MIN_SENT) continue;
    if (del !== null && del < 0.8 && (c.status === "done" || c.status === "published")) {
      out.push({ ...base, kind: "not_delivered", why: `It shows as sent, but only ${pct(del)} of ${sent} messages were delivered.${bounce !== null && bounce > 0.1 ? " Many addresses bounced, so the list probably has old or mistyped emails." : s.failed !== null && s.failed / sent > 0.1 ? " Many failed outright, which usually means a problem with the sending domain." : " The rest were not accepted by the inbox providers."}`, next: "Check the sending domain setup in your CRM and clean the list before the next send." });
    } else if (bounce !== null && bounce > 0.05) {
      out.push({ ...base, kind: "bouncing", why: `${pct(bounce)} bounced. Above 5% hurts how inbox providers treat the sending domain.`, next: "Remove addresses that bounced and check how the list was collected." });
    }
    if (unsub !== null && unsub > 0.02) out.push({ ...base, kind: "unsubscribing", estimate: true, why: `${pct(unsub)} unsubscribed. Above 2% usually means the message did not match what people signed up for.`, next: "Check who it was sent to and how often." });
  }
  return out;
}

export type AccountDelivery = { locationId: string; campaigns: number; sent: number; delivered: number; bounced: number; failed: number; unsubscribed: number; queued: number; score: number | null };
/** Delivery health 0 to 100: the delivered share, minus a penalty for bounces, failures and unsubscribes, from totals only. Needs MIN_SENT sent, else null (not enough data). */
export function scoreOf(a: Pick<AccountDelivery, "sent" | "delivered" | "bounced" | "failed" | "unsubscribed">): number | null {
  if (a.sent < MIN_SENT) return null;
  const d = a.delivered / a.sent, bad = (a.bounced + a.failed) / a.sent, u = a.unsubscribed / Math.max(1, a.delivered);
  return Math.max(0, Math.min(100, Math.round(100 * d - 100 * bad * 0.5 - 100 * Math.min(u, 0.1) * 2)));
}
export function byAccount(camps: Camp[]): AccountDelivery[] {
  const m = new Map<string, AccountDelivery>();
  for (const c of camps) {
    if (!c.stats) continue;
    const a = m.get(c.locationId) ?? { locationId: c.locationId, campaigns: 0, sent: 0, delivered: 0, bounced: 0, failed: 0, unsubscribed: 0, queued: 0, score: null };
    a.campaigns++; a.sent += c.stats.sent ?? 0; a.delivered += c.stats.delivered ?? 0; a.bounced += c.stats.bounced ?? 0; a.failed += c.stats.failed ?? 0; a.unsubscribed += c.stats.unsubscribed ?? 0; a.queued += c.stats.queued ?? 0;
    m.set(c.locationId, a);
  }
  return [...m.values()].map((a) => ({ ...a, score: scoreOf(a) })).sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || y.sent - x.sent);
}

/** Totals for a set of campaigns. A figure is null when no campaign reported it. */
export function totals(camps: Camp[]): Stats {
  const t: Stats = { sent: null, delivered: null, opened: null, clicked: null, bounced: null, failed: null, unsubscribed: null, queued: null };
  for (const c of camps) if (c.stats) for (const k of STAT_KEYS) { const v = c.stats[k]; if (v !== null) t[k] = (t[k] ?? 0) + v; }
  return t;
}

/** A campaign's delivered share against the same account's own earlier campaigns. Needs 3 earlier campaigns of 50 or more, else null. */
export function againstOwnNormal(c: Camp, all: Camp[]): { own: number; normal: number; diff: number } | null {
  const own = c.stats ? rate(c.stats.delivered, c.stats.sent) : null;
  if (own === null || (c.stats?.sent ?? 0) < MIN_SENT) return null;
  const earlier = all.filter((x) => x.locationId === c.locationId && x.campaignId !== c.campaignId && x.stats && (x.stats.sent ?? 0) >= MIN_SENT && (x.createdAt ?? 0) < (c.createdAt ?? Infinity));
  if (earlier.length < 3) return null;
  const rs = earlier.map((x) => rate(x.stats?.delivered ?? null, x.stats?.sent ?? null)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (rs.length < 3) return null;
  const normal = rs[Math.floor(rs.length / 2)];
  return { own, normal, diff: own - normal };
}

export type DateRange = "7" | "30" | "90" | "all";
export function filterCamps(camps: Camp[], f: { status: string; range: DateRange; source: string; now: number }): Camp[] {
  return camps.filter((c) => (f.status === "all" || c.status === f.status) && (f.source === "all" || c.kind === f.source)
    && (f.range === "all" || (c.createdAt ?? c.updatedAt ?? 0) >= f.now - Number(f.range) * DAY));
}
export const statsFromRow = (r: Record<string, unknown>): Stats => ({
  sent: num(r.sent), delivered: num(r.delivered), opened: num(r.opened), clicked: num(r.clicked), bounced: num(r.bounced), failed: num(r.failed), unsubscribed: num(r.unsubscribed), queued: num(r.queued),
});
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
void toMs;
