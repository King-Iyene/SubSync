import type { DerivedAccount } from "../analytics/derive";
import type { Settings } from "../analytics/queries";
import { appointmentList, staleDealList, waitingList, type AuditList } from "../analytics/audit-queries";
import { replyRows, speedView } from "../analytics/speed-queries";
import { seriesByLocation } from "../analytics/digest-service";
import { freshnessFor } from "../sync/freshness-queries";
import { auditSummaryV2, buildAuditV2, healthyLines, type AuditAccount, type AuditV2, type Finding } from "../analytics/audit-v2";
import { clientRows, pageClients, parseClientSort, progressOf, readingOf, type ClientRow } from "../analytics/audit-clients";
import { ageWords, withinTargetShare, type TodayItem } from "../analytics/today-queue";
import type { appointmentView } from "../analytics/appointment-queries";
import type { deepLinks } from "../links";

// The data behind the rebuilt Account audit. Every list comes from the function that already produces it for its own page (the Account audit's stale-deal and
// waiting-conversation queries, Speed to lead's waiting leads, Appointments); this file gathers them for the accounts the router decided the caller may read (never
// from the request), turns each row into Today's one item shape and hands them to the pure rules in analytics/audit-v2.ts. Read only: nothing is written to the CRM
// or to SubSync's tables. The result is kept for 45 seconds per caller scope so paging the client list does not read everything again.

type Apv = Awaited<ReturnType<typeof appointmentView>>;
export type AuditBase = { settings: Settings; live: DerivedAccount[]; apptView: Apv; links: ReturnType<typeof deepLinks>; readLimit: string | null };

/** The most rows read per list (the totals stay true past it) and the most rows sent to the browser per finding. */
export const READ_ROWS = 3000;
export const SEND_ROWS = 200;
const toMs = (iso: string | null) => (iso ? Date.parse(iso) : null);

export type Core = {
  audit: AuditV2; clients: ClientRow[]; accounts: AuditAccount[]; healthy: string[]; progress: ReturnType<typeof progressOf>;
  reading: ReturnType<typeof readingOf>; scope: "all" | "account"; targetMinutes: number; staleDays: number; slaHours: number; now: number;
  readLimit: string | null; accountNames: string[];
  /** False when no account's calendar could be read, so the two appointment counts are "not checked" (never zero). */
  calendars: boolean;
  /** Accounts SubSync has not finished reading for the first time: they are never recorded in the history (a zero there would be a false baseline). */
  unreadIds: string[];
  /** The lead ledger of the last 14 days (Speed to lead's rows), kept so the Clients book can judge replies per client without a second read. */
  replies: Array<{ locationId: string; leadAt: number; touchAt: number | null }>;
};

type WithUrl = AuditList["rows"][number] & { url?: string };
const itemsOf = (kind: TodayItem["kind"], list: AuditList | null, link: (r: WithUrl) => string): TodayItem[] =>
  (list?.rows ?? []).map((r: WithUrl) => ({
    id: `${kind}:${r.id}`, kind, locationId: r.locationId, accountName: r.locationName ?? "Client account", name: r.name, detail: r.detail, at: toMs(r.at), value: kind === "stale" ? r.value : null,
    contactId: r.contactId || null, url: link(r),
  }));

export async function loadCore(i: { installationId: string; ids: string[]; limitTo: string | null; now: number; base: AuditBase }): Promise<Core> {
  const { installationId, ids, now, base } = i;
  const { settings, links } = base;
  const live = base.live.filter((a) => ids.includes(a.locationId));
  const target = settings.speedTargetMinutes;
  const [stale, conv, speed, replies, series, fresh] = await Promise.all([
    staleDealList(installationId, ids, settings.staleDays, READ_ROWS),
    waitingList(installationId, ids, settings.slaHours, READ_ROWS),
    speedView(installationId, ids, target, now),
    replyRows(installationId, ids, now).catch(() => []),
    seriesByLocation(installationId, ids, 30).catch(() => new Map()),
    freshnessFor(installationId, { limitTo: i.limitTo, onlyIds: new Set(ids) }),
  ]);
  const v = base.apptView;
  const link = (r: WithUrl) => (r.contactId ? links.contact(r.locationId, r.contactId) : links.opportunities(r.locationId));
  const calendars = v.access.total > 0 && v.access.ok > 0;
  const unmarked = calendars ? appointmentList(v.unmarked, v.unmarkedTotal, "Started") : null;
  const recover = calendars ? appointmentList(v.recover, v.recoverTotal, "No-show on") : null;

  const accounts: AuditAccount[] = live.map((a) => ({ id: a.locationId, name: a.name ?? "Unnamed account", winRate: a.winRate, avgDeal: a.avgDealValue, won: a.wonCount, lost: a.lostCount }));
  const audit = buildAuditV2({
    now, staleDays: settings.staleDays, slaHours: settings.slaHours, scope: live.length === 1 || i.limitTo ? "account" : "all", accounts,
    stale: { items: itemsOf("stale", stale, link), total: stale.total, totalValue: stale.totalValue ?? 0 },
    waiting: {
      leads: speed.waiting.map((w) => ({
        locationId: w.locationId, accountName: w.locationName, contactId: w.contactId, name: w.name, at: now - w.waitingMinutes * 60_000, never: w.neverAnswered,
        url: links.contact(w.locationId, w.contactId), owner: w.unassigned ? null : w.owner?.label ?? null, source: w.source === "No source recorded" ? null : w.source,
        detail: w.neverAnswered ? "Never answered" : `Waiting ${ageWords(w.waitingMinutes)}`,
      })),
      leadsTotal: speed.waitingTotal,
      conversations: conv.rows.map((r: WithUrl) => ({ id: r.id, locationId: r.locationId, accountName: r.locationName ?? "Client account", contactId: r.contactId, name: r.name, at: toMs(r.at), url: link(r), detail: r.detail })),
      conversationsTotal: conv.total,
    },
    noshows: recover ? { items: itemsOf("noshows", recover, link), total: recover.total } : null,
    appointments: unmarked ? { items: itemsOf("appointments", unmarked, link), total: unmarked.total } : null,
    calendars: { needPermission: v.access.needsPermission.length, total: v.access.total },
  });

  const by = (key: Finding["key"]) => audit.findings.some((f) => f.key === key);
  const share = withinTargetShare(replies, target, now, 14);
  const healthy = healthyLines({
    scope: live.length === 1 || i.limitTo ? "account" : "all",
    leadsInTarget: { share: share.share, judged: share.judged, minutes: target },
    showRate: calendars ? { rate: v.current.showRate, outcomes: v.current.outcomes, target: v.target.showRate } : null,
    openValue: live.reduce((s, a) => s + a.openValue, 0), staleValue: live.reduce((s, a) => s + a.staleValue, 0),
    clean: { replies: !by("replies"), stale: !by("stale"), noshows: calendars ? !by("noshows") : null, appointments: calendars ? !by("appointments") : null },
  });
  const seriesIn = [...series.entries()].map(([id, points]) => ({ id, points: points.map((p: { day: string; stale: number; dealsOk?: boolean }) => ({ day: p.day, stale: p.stale, ok: p.dealsOk === true })) }));
  return {
    audit, clients: clientRows(audit, accounts), accounts, healthy, progress: progressOf({ series: seriesIn, replies, targetMinutes: target, now }),
    reading: readingOf({ state: fresh.state, accounts: fresh.accounts }), scope: live.length === 1 || i.limitTo ? "account" : "all", targetMinutes: target,
    staleDays: settings.staleDays, slaHours: settings.slaHours, now, readLimit: base.readLimit, accountNames: accounts.map((a) => a.name), replies, calendars, unreadIds: fresh.accounts.filter((a) => a.state === "first").map((a) => a.locationId),
  };
}

// ---------- the 45 second cache ----------

const TTL = 45_000;
const cache = new Map<string, { at: number; core: Promise<Core> }>();
/** The key holds the installation and the exact accounts, so one caller's result can never be handed to another scope. */
export function coreFor(i: { installationId: string; ids: string[]; limitTo: string | null; now: number; base: () => Promise<AuditBase>; fresh?: boolean }): Promise<Core> {
  const key = `${i.installationId}|${i.limitTo ?? ""}|${[...i.ids].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && !i.fresh && i.now - hit.at < TTL) return hit.core;
  const core = i.base().then((base) => loadCore({ ...i, base }));
  core.catch(() => { if (cache.get(key)?.core === core) cache.delete(key); });
  cache.set(key, { at: i.now, core });
  if (cache.size > 60) for (const [k, v] of cache) if (i.now - v.at > TTL) cache.delete(k);
  return core;
}

/** The rows of the client list for the request's search, order and page. */
export function clientPage(core: Core, sp: URLSearchParams) {
  const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
  const sort = parseClientSort(sp.get("sort"));
  const page = pageClients(core.clients, { q: (sp.get("q") ?? "").slice(0, 80), sort, page: int(sp.get("page"), 0), size: int(sp.get("size"), 5) });
  return { ...page, sort, withProblems: core.clients.length, clean: core.accounts.length - core.clients.length, accounts: core.accounts.length };
}

/** What the screen needs: the findings with at most SEND_ROWS rows each (the count stays true), and the first page of clients. */
export function pagePayload(core: Core, sp: URLSearchParams, extra: { brand: { name: string | null; color: string | null; logoUrl?: string | null }; who: string }) {
  const a = core.audit;
  return {
    verdict: a.verdict, grade: a.grade, startHere: a.startHere, totals: a.totals, notes: a.notes, healthy: core.healthy, progress: core.progress, reading: core.reading,
    findings: a.findings.map((f) => ({ ...f, items: f.items.slice(0, SEND_ROWS) })),
    clients: core.scope === "all" ? clientPage(core, sp) : null,
    summary: auditSummaryV2(a, extra.who, core.healthy),
    scope: core.scope, staleDays: core.staleDays, slaHours: core.slaHours, targetMinutes: core.targetMinutes, readLimit: core.readLimit, now: core.now,
    brand: extra.brand, generatedAt: new Date(core.now).toISOString(),
  };
}

