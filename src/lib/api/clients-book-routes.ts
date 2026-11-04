import type { DerivedAccount } from "../analytics/derive";
import type { Settings } from "../analytics/queries";
import { bookOf } from "../analytics/clients-v2-book";
import { countedDealMoney, profilesOf } from "../analytics/clients-v2-queries";
import {
  clientSummaryText, dateWords, dealsLine, facetsOf, headlineOf, nextStep, parseFilter, parseSort, primaryOf, reminderDays, selectClients, summarize, supportLine, talkingPoints, valueFormula, valueOf, whatChanged,
  RENEWAL_WINDOW_DAYS, type BookRow,
} from "../analytics/clients-v2";
import { INDUSTRY_PICKER, playbookLine } from "../analytics/client-success";
import { noteSummaries, historyStart } from "../analytics/client-success-queries";
import { pageOf } from "../analytics/speed-v2";
import type { Core } from "./audit-api";
import { trendDays } from "./client-routes";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The rebuilt Clients screen's endpoints: GET /api/app/clients?part=home|list|names|one. (The older GET /api/app/clients with no part stays for the Compare and Reviews tabs and
// the CSV export.) Agency only: the route policy refuses a business owner and a client's staff before this runs, so a fee or a note never reaches an account user. The client
// accounts come from the signed session (`live`, built by the router from accountsFor); an id in the address only NARROWS inside them, and a profile or a log is read for those
// ids only. Read only: the writes are the older PUT clients/<id> and the notes routes, which check the same accounts.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type BookCtx = { ctx: Ctx; settings: Settings; live: DerivedAccount[]; links: ReturnType<typeof deepLinks>; core: () => Promise<Core>; now: number };

const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const ID = /^[A-Za-z0-9_-]{3,64}$/;
export const INLINE = 5;

async function loadBook(c: BookCtx): Promise<{ rows: BookRow[]; ids: string[]; core: Core }> {
  const ids = c.live.map((a) => a.locationId);
  const [core, profiles, notes] = await Promise.all([c.core(), profilesOf(c.ctx.installationId, ids), noteSummaries(c.ctx.installationId, ids)]);
  const audit = new Map(core.clients.map((r) => [r.id, { replies: r.replies, noshows: r.noshows, stale: r.stale, staleDollars: r.staleDollars }]));
  const rows = bookOf({
    now: c.now, targetMinutes: core.targetMinutes,
    accounts: c.live.map((a) => ({ locationId: a.locationId, name: a.name, score: a.score, churn: a.churn, dormant: a.dormant, daysInactive: a.daysInactive, leadFlowDropPct: a.leadFlowDropPct, contactsSyncedAt: a.contactsSyncedAt })),
    profiles, lastConversationOn: new Map([...notes].map(([id, n]) => [id, n.lastConversationOn])), audit, replies: core.replies,
  });
  return { rows, ids, core };
}

const out = (r: BookRow, links: ReturnType<typeof deepLinks>) => ({ ...r, url: links.account(r.id) });

export async function handleClientsPart(c: BookCtx): Promise<Response> {
  const sp = c.ctx.url.searchParams;
  const part = sp.get("part");

  if (part === "names") {
    // Light list for the pickers of Compare and Reviews: names and ids only.
    return json({ clients: c.live.map((a) => ({ locationId: a.locationId, name: a.name ?? "Unnamed account", score: a.score })).sort((a, b) => a.name.localeCompare(b.name)) });
  }

  if (part === "home") {
    const { rows, core } = await loadBook(c);
    const s = summarize(rows);
    const needs = selectClients(rows, { filter: "needs" });
    const renewing = selectClients(rows, { filter: "renewing", sort: "renewal" });
    const first = needs[0] ?? null;
    return json({
      now: c.now, summary: s, headline: headlineOf(s), support: supportLine(s), primary: primaryOf(s, first ? { name: first.name } : null), next: s.needYou === 0 ? nextStep(s) : null,
      needs: { total: needs.length, rows: needs.slice(0, INLINE).map((r) => out(r, c.links)), ids: needs.slice(0, 200).map((r) => r.id) },
      renewals: { total: renewing.length, fee: s.renewals60Fee, overdue: s.renewalsOverdue, windowDays: RENEWAL_WINDOW_DAYS, rows: renewing.slice(0, INLINE).map((r) => out(r, c.links)) },
      facets: facetsOf(rows), reading: core.reading, readLimit: core.readLimit, targetMinutes: core.targetMinutes,
      industryChoices: INDUSTRY_PICKER.map((p) => p.value), firstId: rows[0]?.id ?? null,
    });
  }

  if (part === "list") {
    const { rows } = await loadBook(c);
    const filter = parseFilter(sp.get("filter"));
    const chosen = selectClients(rows, { filter, q: (sp.get("q") ?? "").slice(0, 80), sort: parseSort(sp.get("sort")) });
    const pg = pageOf(chosen, int(sp.get("page"), 0), int(sp.get("size"), 25));
    return json({ ...pg, filter, rows: pg.rows.map((r) => out(r, c.links)), facets: facetsOf(rows), industryChoices: INDUSTRY_PICKER.map((p) => p.value) });
  }

  if (part === "one") {
    const id = sp.get("id") ?? "";
    // Only a client the caller may see: an id that is not one of them is simply "not found", like any other company's account.
    if (!ID.test(id) || !c.live.some((a) => a.locationId === id)) return json({ error: "Client not found" }, 404);
    const [{ rows }, money, days, since] = await Promise.all([loadBook(c), countedDealMoney(c.ctx.installationId, [id], c.now), trendDays(c.ctx.installationId, id, 120), historyStart(c.ctx.installationId, id)]);
    const row = rows.find((r) => r.id === id);
    if (!row) return json({ error: "Client not found" }, 404);
    const m = money.get(id) ?? { pipeline30: 0, dealsStarted30: 0, won30: 0, wonCount30: 0 };
    const value = valueOf({ fee: row.fee, pipeline30: m.pipeline30, dealsStarted30: m.dealsStarted30, won30: m.won30, wonCount30: m.wonCount30 });
    const dl = dealsLine(m);
    const changed = whatChanged(days);
    const needs = selectClients(rows, { filter: "needs" });
    const at = needs.findIndex((r) => r.id === id);
    const summary = clientSummaryText({
      name: row.name, brand: c.settings.brandName, label: row.needs && row.level !== "at_risk" && row.level !== "watch" ? row.needs.label : row.label, reasons: row.reasons, changed, valueLine: dl,
      renewalLine: row.renewal ? `${row.renewal.words} (${dateWords(row.renewal.date, c.now)}).` : null, on: dateWords(new Date(c.now).toISOString().slice(0, 10), c.now),
    });
    return json({
      row: out(row, c.links), value, valueFormula: valueFormula(), dealsLine: dl, changed, historyStartsOn: since,
      talk: talkingPoints(row.reasons, row.renewal, { name: row.name, dealsLine: dl, nowMs: c.now }), reminders: reminderDays(row.renewal?.date ?? null, c.now),
      summary, industryChoices: INDUSTRY_PICKER.map((p) => p.value), playbook: playbookLine(row.industry),
      // Where this client sits in the "needs you" queue, so the page can offer the next one.
      queue: { position: at < 0 ? null : at + 1, total: needs.length, previous: at > 0 ? needs[at - 1].id : null, next: at >= 0 && at < needs.length - 1 ? needs[at + 1].id : null },
    });
  }
  return json({ error: "Unknown part of this screen" }, 400);
}
