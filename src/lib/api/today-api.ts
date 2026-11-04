import { sql } from "../db";
import type { DerivedAccount } from "../analytics/derive";
import type { Settings } from "../analytics/queries";
import { listAlerts } from "../analytics/queries";
import { leadLedger, speedView } from "../analytics/speed-queries";
import { portfolioHeadlines } from "../analytics/digest-intel";
import { seriesByLocation } from "../analytics/digest-service";
import { callQueueAll } from "../analytics/call-queries";
import { staleSoonList, type AuditList } from "../analytics/audit-queries";
import { comingLeads, forecastOf, leadInsights, sinceVisitOf, type Coming, type LeadRow } from "../analytics/today-smart";
import { resolveEvents } from "../analytics/today-state";
import { loadActions, touchVisit } from "../analytics/today-store";
import {
  ageWords, answeredStreak, emptyTotals, mergeReplies, proofOf, replyPulse, withinTargetShare,
  type AccountFacts, type AlertFact, type Kind, type Proof, type Totals, type TodayItem,
} from "../analytics/today-queue";
import { MIN_OUTCOMES_FOR_RATE } from "../analytics/appointment-intel";
import type { AccessKind } from "../access";

// The data behind the rebuilt Today. Every list and every number is read through the function that already produces it for its own page (Speed to lead, the
// Account audit's lists, Appointments, the alerts list); this file only gathers them for the accounts the caller may read (the router decides which, from the
// signed session and never from the request), turns each row into one shape, and builds the ranked queue with the pure rules in today-queue.ts.
// Read only: nothing here writes to the CRM or to SubSync's own tables.

const DAY = 86_400_000;
type Audit = {
  audit: unknown; lists: Record<string, AuditList> | null; live: DerivedAccount[];
  apptView: Awaited<ReturnType<typeof import("../analytics/appointment-queries").appointmentView>>;
};
type Person = { contactId: string | null; name: string; phone: string | null; at: number; calendar: string | null; url: string; locationId: string; dnd: boolean; noOutcome?: boolean };

const toMs = (iso: string | null) => (iso ? Date.parse(iso) : null);

function itemsOf(kind: Kind, list: AuditList | undefined): TodayItem[] {
  return (list?.rows ?? []).map((r) => ({
    id: `${kind}:${r.id}`, kind, locationId: r.locationId, accountName: r.locationName ?? "Client account", name: r.name, detail: r.detail,
    at: toMs(r.at), value: kind === "stale" ? r.value : null, contactId: r.contactId || null, url: (r as unknown as { url: string }).url,
  }));
}

/** The calendar day an appointment falls on in the account's own time zone, relative to now: "today", "tomorrow", or null. */
export function dayBucket(at: number, now: number, timeZone: string): "today" | "tomorrow" | null {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const d = (ms: number) => f.format(new Date(ms));
    if (d(at) === d(now)) return "today";
    if (d(at) === d(now + DAY)) return "tomorrow";
  } catch { /* an unknown zone: nothing is bucketed */ }
  return null;
}

export async function buildToday(i: {
  installationId: string; kind: AccessKind; limitTo: string | null; now: number;
  allowed: string[] | null; settings: Settings; audit: Audit;
  links: { contact: (l: string, c: string) => string; opportunities: (l: string) => string; account: (l: string) => string };
  permits: (locationId: string) => boolean;
  /** The lanes of Done and Snooze marks this person reads ("team", or their own for a client's staff), and the key their last-visit memory is kept under. */
  lanes: string[]; userKey: string;
}) {
  const { installationId, now, links, settings } = i;
  const target = settings.speedTargetMinutes;
  const liveIds = i.audit.live.map((a) => a.locationId);
  const [speed, ledgerAll, alerts, series, actionLog, soonDeals, zoneRows, sinceAt] = await Promise.all([
    speedView(installationId, i.allowed, target, now),
    leadLedger(installationId, i.allowed, now),
    i.kind === "client" ? Promise.resolve([]) : listAlerts(installationId, true, 500, i.limitTo ?? undefined),
    seriesByLocation(installationId, liveIds, 10),
    loadActions(installationId, i.lanes, now),
    staleSoonList(installationId, liveIds, settings.staleDays).catch(() => []),
    sql()`select location_id, timezone from locations where installation_id = ${installationId} and not ignored`,
    touchVisit(installationId, i.userKey, now),
  ]);
  const replies = ledgerAll.map((r) => ({ locationId: r.locationId, leadAt: r.leadAt, touchAt: r.touchAt }));
  const zones: Record<string, string> = Object.fromEntries(zoneRows.filter((z) => i.permits(z.location_id as string)).map((z) => [z.location_id as string, (z.timezone as string | null) || "UTC"]));

  // ---- the four kinds of thing, each from the function its own page uses. Waiting people come from TWO lists (new leads past their reply target, and conversations the
  // customer wrote last) and are merged so that each person is counted once (mergeReplies, docs/METRICS.md "Today, third pass"). ----
  const lists = i.audit.lists ?? {};
  const waiters = mergeReplies({
    leads: speed.waiting.map((w) => ({
      locationId: w.locationId, accountName: w.locationName, contactId: w.contactId, name: w.name, at: now - w.waitingMinutes * 60_000, never: w.neverAnswered,
      url: links.contact(w.locationId, w.contactId), owner: w.unassigned ? null : w.owner?.label ?? null, source: w.source === "No source recorded" ? null : w.source,
      detail: w.neverAnswered ? "Never answered" : `Waiting ${ageWords(w.waitingMinutes)}`,
    })),
    leadsTotal: speed.waitingTotal,
    conversations: (lists.slow?.rows ?? []).map((r) => ({ id: r.id, locationId: r.locationId, accountName: r.locationName ?? "Client account", contactId: r.contactId, name: r.name, at: toMs(r.at), url: (r as unknown as { url: string }).url, detail: r.detail })),
    conversationsTotal: lists.slow?.total ?? 0,
  });
  const items: TodayItem[] = [...waiters.items, ...itemsOf("appointments", lists.unmarked), ...itemsOf("noshows", lists.noshows), ...itemsOf("stale", lists.stale)];
  const totals: Totals = emptyTotals();
  const set = (k: Kind, count: number, dollars: number | null) => { totals[k] = { count, dollars: dollars && dollars > 0 ? dollars : null, shown: items.filter((x) => x.kind === k).length }; };
  set("replies", waiters.count, null);
  totals.replies.newLeads = waiters.newLeads;
  set("appointments", lists.unmarked?.total ?? 0, null);
  set("noshows", lists.noshows?.total ?? 0, null);
  set("stale", lists.stale?.total ?? 0, lists.stale?.totalValue ?? null);

  const accounts: AccountFacts[] = i.audit.live.map((a) => ({ id: a.locationId, name: a.name ?? "Unnamed account", followUpEstimate: a.followUpRevenueAtRisk, url: links.opportunities(a.locationId) }));

  // ---- access, said plainly (a missing permission is never a false all-clear) ----
  const sp = speed.access;
  const leadsBlocked = sp.total > 0 && sp.ok === 0 && sp.needsPermission.length === sp.total;
  const ap = i.audit.apptView.access;
  const apptsBlocked = ap.total > 0 && ap.ok === 0 && ap.needsPermission.length === ap.total;

  // ---- reply speed against the account's own usual, and the stale-deal count against its own normal ----
  const pulse = replyPulse(replies, now);
  const staleHead = portfolioHeadlines([...series.values()]).find((h) => h.key === "stale")?.change ?? null;
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  // ---- what SubSync caught ----
  const facts: AlertFact[] = alerts.filter((a) => (a.locationId === null ? i.limitTo === null && i.allowed === null : i.permits(a.locationId))).map((a) => ({
    id: a.id, locationId: a.locationId, accountName: a.locationId ? names.get(a.locationId) ?? "Client account" : "All accounts", title: a.title, severity: a.severity,
    createdAt: Date.parse(a.createdAt), resolvedAt: toMs(a.resolvedAt),
  }));
  const proof: Proof | null = i.kind === "client" ? null : proofOf(facts, now);

  // ---- the lead ledger and what is worked out from it (docs/METRICS.md, "Today, second pass"). The rows are the Speed to lead rows; nothing is written. ----
  const ledgerRows: LeadRow[] = ledgerAll.map((r) => ({ ...r, url: links.contact(r.locationId, r.contactId) }));
  const LEDGER_CAP = 3000;
  const ledger = [...ledgerRows].sort((a, b) => b.leadAt - a.leadAt).slice(0, LEDGER_CAP);
  const insights = leadInsights(ledgerRows, now);
  const sinceVisit = sinceVisitOf({ since: sinceAt, ledger: ledgerRows, alerts: facts, targetMinutes: target, now });

  // ---- if nobody acts today: leads inside their reply window, deals about to turn stale, appointments still to happen today ----
  const comingDeals: Coming[] = soonDeals.filter((d) => i.permits(d.locationId)).map((d) => ({
    id: `coming:deal:${d.id}`, kind: "stale" as const, locationId: d.locationId, accountName: names.get(d.locationId) ?? "Client account", name: d.name, at: d.at, value: d.value, contactId: d.contactId,
    url: d.contactId ? links.contact(d.locationId, d.contactId) : links.opportunities(d.locationId),
  }));
  const comingAppts: Coming[] = i.audit.apptView.upcoming.filter((p) => dayBucket(p.at, now, zones[p.locationId] ?? "UTC") === "today" && i.permits(p.locationId)).map((p) => ({
    id: `coming:appt:${p.id}`, kind: "appointments" as const, locationId: p.locationId, accountName: names.get(p.locationId) ?? "Client account", name: p.name, at: p.at, value: null, contactId: p.contactId,
    url: p.contactId ? links.contact(p.locationId, p.contactId) : links.opportunities(p.locationId),
  }));
  const forecast = forecastOf(comingLeads(ledgerRows, target, now).slice(0, 200), comingDeals, comingAppts);
  // Only marks on accounts this person may read: the team lane of an installation can hold marks on accounts a business or a client view must never learn about.
  const resolved = resolveEvents(actionLog.events.filter((e) => i.permits(e.locationId)), now, i.lanes);

  const base = {
    ledger, ledgerTotal: ledgerRows.length, insights, sinceVisit, forecast, zones,
    holds: resolved.holds, assigned: resolved.assigned, actionsReady: actionLog.available,
    now, scope: i.limitTo ? ("account" as const) : ("all" as const), kind: i.kind, accounts, items, totals, staleDays: settings.staleDays, targetMinutes: target,
    access: { leadsBlocked, apptsBlocked }, readLimit: null as string | null,
    outlier: (i.audit.audit as { outlier: { value: number; share: number } | null }).outlier ?? null,
    pulse: { reply: { current: pulse.current, usual: pulse.usual, points: pulse.points, verdict: pulse.verdict }, stale: staleHead ? { today: staleHead.today, usual: staleHead.avg7, samples: staleHead.samples, unusual: staleHead.unusual } : null },
    proof,
  };
  if (!i.limitTo) return { ...base, mine: null };

  // ---- a client account's own view: calls to make, today and tomorrow, my numbers ----
  const v = i.audit.apptView;
  const ids = [...new Set([...v.recover, ...v.upcoming, ...v.items, ...v.unmarked].map((p) => p.contactId).filter((x): x is string => !!x))];
  const dnd = new Set<string>();
  if (ids.length > 0) for (const r of await sql()`select contact_id from cached_contacts where installation_id = ${installationId} and location_id = ${i.limitTo} and contact_id = any(${ids}::text[]) and dnd`) dnd.add(r.contact_id as string);
  const person = (p: (typeof v.recover)[number]): Person => ({
    contactId: p.contactId, name: p.name, phone: p.phone, at: p.at, calendar: p.calendar, locationId: p.locationId, noOutcome: p.noOutcome,
    url: p.contactId ? links.contact(p.locationId, p.contactId) : links.opportunities(p.locationId), dnd: p.contactId ? dnd.has(p.contactId) : false,
  });
  const [tz] = await sql()`select timezone from locations where installation_id = ${installationId} and location_id = ${i.limitTo}`;
  const zone = (tz?.timezone as string | null) ?? "UTC";
  const dayList = [...v.items, ...v.upcoming].filter((p, n, all) => all.findIndex((q) => q.id === p.id) === n).map(person).sort((a, b) => a.at - b.at);
  const newLeads = await callQueueAll(installationId, [i.limitTo], { preset: "new_unanswered" }).catch(() => ({ total: 0, rows: [] }));
  const prevShare = withinTargetShare(replies, target, now - 7 * DAY, 7);
  const thisShare = withinTargetShare(replies, target, now, 7);
  return {
    ...base,
    mine: {
      timeZone: zone,
      calls: {
        newLeads: { total: newLeads.total, rows: newLeads.rows.slice(0, 5).map((r) => ({ contactId: r.contactId, name: r.name, hasPhone: !!r.phone, url: links.contact(r.locationId, r.contactId) })) },
        noshows: { total: v.recoverTotal, rows: v.recover.slice(0, 5).map(person) },
        confirm: { total: v.unconfirmedTotal, rows: v.upcoming.filter((p) => p.unconfirmed).slice(0, 5).map(person) },
      },
      appointments: {
        today: dayList.filter((p) => dayBucket(p.at, now, zone) === "today"), tomorrow: dayList.filter((p) => dayBucket(p.at, now, zone) === "tomorrow"),
        noOutcomeToday: dayList.filter((p) => dayBucket(p.at, now, zone) === "today" && p.noOutcome).length,
      },
      numbers: {
        reply: { current: pulse.current, usual: pulse.usual, verdict: pulse.verdict },
        showRate: { now: v.current.showRate, usual: v.compare?.showRate ?? null, nNow: v.current.outcomes, nUsual: v.compare?.outcomes ?? 0, minN: MIN_OUTCOMES_FOR_RATE },
        inTarget: { now: thisShare.share, usual: prevShare.share, nNow: thisShare.judged, nUsual: prevShare.judged },
        streakDays: answeredStreak(replies, target, now),
      },
    },
  };
}
