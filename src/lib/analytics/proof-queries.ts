import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import {
  cleanColor, cleanLogo, cleanText, DEFAULT_SETTINGS, MIN_LEADS, MIN_SHOWS, monthOf, monthWindow, normalizeSections, TOKEN_SHAPE, trendMonths, textProblem,
  type Brand, type Metric, type PrPayload, type PrRow, type PrSettings, type PrStatus, type Sections, type TimelineItem, type TrendPoint,
} from "./proof-core";
import { durationText } from "./moat-core";

// Branded client Proof page and monthly report (stage PR): the database side. Every read is for ONE installation and, for an agency session, only the client accounts it may read
// (`allowed`, decided by the router from the session). The public page reads by the link token alone: the token picks one link row, and that row names the one account.
// Nothing here writes to the CRM or sends anything to a client.

export type Opts = { countAutomated: boolean; defaultTarget: number; businessHours: boolean };

const db = () => sql();
export const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : typeof d === "string" ? new Date(d).toISOString() : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** The tables arrive with a migration. Until it is applied, every read says "not switched on" instead of failing. */
export const tablesMissing = (e: unknown) => (e as { code?: string } | null)?.code === "42P01";

// ---------------------------------------------------------------- settings

export async function getPrSettings(inst: string): Promise<PrSettings> {
  const [r] = await sql()`select display_name, logo_url, brand_color, intro, sections, name_staff, auto_draft from pr_settings where installation_id = ${inst}`;
  if (!r) return { ...DEFAULT_SETTINGS, sections: normalizeSections(null) };
  return { displayName: (r.display_name as string | null) ?? null, logoUrl: cleanLogo(r.logo_url), brandColor: cleanColor(r.brand_color), intro: (r.intro as string | null) ?? null, sections: normalizeSections(r.sections), nameStaff: r.name_staff === true, autoDraft: r.auto_draft !== false };
}

export type SettingsPatch = Partial<{ displayName: unknown; logoUrl: unknown; brandColor: unknown; intro: unknown; sections: unknown; nameStaff: unknown; autoDraft: unknown }>;
/** Validates what a person typed. Returns the cleaned settings or one plain reason. */
export function checkSettings(cur: PrSettings, p: SettingsPatch): { ok: true; value: PrSettings } | { ok: false; error: string } {
  const next: PrSettings = { ...cur };
  if ("displayName" in p) next.displayName = cleanText(p.displayName, 60);
  if ("logoUrl" in p) {
    if (p.logoUrl === null || p.logoUrl === "") next.logoUrl = null;
    else { const l = cleanLogo(p.logoUrl); if (!l) return { ok: false, error: "The logo must be a web address that starts with https://" }; next.logoUrl = l; }
  }
  if ("brandColor" in p) {
    if (p.brandColor === null || p.brandColor === "") next.brandColor = null;
    else { const c = cleanColor(p.brandColor); if (!c) return { ok: false, error: "Colour must look like #1a73e8" }; next.brandColor = c; }
  }
  if ("intro" in p) next.intro = cleanText(p.intro, 400);
  if ("sections" in p) next.sections = normalizeSections(p.sections);
  if ("nameStaff" in p) next.nameStaff = p.nameStaff === true;
  if ("autoDraft" in p) next.autoDraft = p.autoDraft !== false;
  const bad = textProblem(next.displayName, next.intro);
  return bad ? { ok: false, error: bad } : { ok: true, value: next };
}
export async function savePrSettings(inst: string, s: PrSettings, by: string | null) {
  await sql()`insert into pr_settings (installation_id, display_name, logo_url, brand_color, intro, sections, name_staff, auto_draft, updated_by, updated_at)
    values (${inst}, ${s.displayName}, ${s.logoUrl}, ${s.brandColor}, ${s.intro}, ${sql().json(s.sections as never)}, ${s.nameStaff}, ${s.autoDraft}, ${by}, now())
    on conflict (installation_id) do update set display_name = excluded.display_name, logo_url = excluded.logo_url, brand_color = excluded.brand_color, intro = excluded.intro, sections = excluded.sections,
      name_staff = excluded.name_staff, auto_draft = excluded.auto_draft, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(inst, by, "proof.settings", {});
}

/** The brand the page wears: the report's own settings first, then the company's general brand (Settings), then its company name. Never ours. */
export async function brandFor(inst: string): Promise<Brand> {
  const [r] = await sql()`select p.display_name, p.logo_url, p.brand_color, s.brand_name, s.brand_color gen_color, s.brand_logo_url gen_logo, i.company_name
    from installations i left join pr_settings p on p.installation_id = i.id left join settings s on s.installation_id = i.id where i.id = ${inst}`;
  if (!r) return { name: "Monthly report", logoUrl: null, color: null };
  const pick = [r.display_name, r.brand_name, r.company_name].map((x) => cleanText(x, 60)).find((x) => x && !textProblem(x)) ?? "Monthly report";
  return { name: pick, logoUrl: cleanLogo(r.logo_url) ?? cleanLogo(r.gen_logo), color: cleanColor(r.brand_color) ?? cleanColor(r.gen_color) };
}

async function audit(inst: string, by: string | null, action: string, detail: object) {
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${by ?? "unknown"}, ${action}, ${sql().json(detail as never)})`.catch(() => undefined);
}

// ---------------------------------------------------------------- measuring one account

type Loc = { name: string; tz: string; target: number };
async function locOf(inst: string, loc: string, defaultTarget: number): Promise<Loc | null> {
  const [l] = await sql()`select name, timezone, speed_target_minutes from locations where installation_id = ${inst} and location_id = ${loc} and not ignored`;
  if (!l) return null;
  let tz = typeof l.timezone === "string" && l.timezone ? l.timezone : "UTC";
  try { await sql()`select ${"2026-01-01"}::date::timestamp at time zone ${tz} t`; } catch { tz = "UTC"; }
  const name = cleanText(l.name, 80) ?? "Client account";
  return { name: textProblem(name) ? "Client account" : name, tz, target: typeof l.speed_target_minutes === "number" ? l.speed_target_minutes : defaultTarget };
}

type Reply = { leads: number; answered: number; median: number | null; within: number };
async function replyWindow(inst: string, loc: string, l: Loc, from: string, to: string, o: Opts): Promise<Reply> {
  const reply = o.countAutomated ? sql()`coalesce(t.human_touch_at, t.touch_at)` : sql()`t.human_touch_at`;
  const [r] = await sql()`
    select count(t.id)::int leads, count(${reply})::int answered,
      percentile_cont(0.5) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) filter (where ${reply} is not null) med,
      count(*) filter (where ${reply} is not null and extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60 <= ${l.target})::int within_n
    from lead_touches t
    where t.installation_id = ${inst} and t.location_id = ${loc} and t.excluded is null
      and t.lead_at >= (${from}::date::timestamp at time zone ${l.tz}) and t.lead_at < least((${to}::date::timestamp at time zone ${l.tz}), now() - interval '1 hour')`;
  return { leads: Number(r.leads), answered: Number(r.answered), median: r.med === null ? null : Math.round(Number(r.med)), within: Number(r.within_n) };
}

type Daily = { rows: number; leads: number; booked: number; showed: number; noshow: number; wonDeals: number; wonValue: number };
async function dailyWindow(inst: string, loc: string, from: string, to: string): Promise<Daily> {
  const [r] = await sql()`select count(*)::int rows, coalesce(sum(new_leads), 0)::int leads, coalesce(sum(booked), 0)::int booked, coalesce(sum(showed), 0)::int showed, coalesce(sum(noshow), 0)::int noshow,
      coalesce(sum(won), 0)::int won, coalesce(sum(won_value), 0)::float8 won_value
    from client_daily where installation_id = ${inst} and location_id = ${loc} and day >= ${from}::date and day < ${to}::date`;
  return { rows: Number(r.rows), leads: Number(r.leads), booked: Number(r.booked), showed: Number(r.showed), noshow: Number(r.noshow), wonDeals: Number(r.won), wonValue: Number(r.won_value) };
}

async function movedWindow(inst: string, loc: string, l: Loc, from: string, to: string): Promise<{ deals: number; value: number } | null> {
  const [any] = await sql()`select 1 x from deal_history where installation_id = ${inst} and location_id = ${loc} limit 1`;
  if (!any) return null;
  const [r] = await sql()`select count(*)::int n, coalesce(sum(v), 0)::float8 val from (
      select distinct on (opportunity_id) opportunity_id, coalesce(value, 0) v from deal_history
      where installation_id = ${inst} and location_id = ${loc} and kind = 'stage' and at >= (${from}::date::timestamp at time zone ${l.tz}) and at < (${to}::date::timestamp at time zone ${l.tz})
      order by opportunity_id, at desc) s`;
  return { deals: Number(r.n), value: Number(r.val) };
}

async function recoveredWindow(inst: string, loc: string, l: Loc, from: string, to: string): Promise<number | null> {
  const [any] = await sql()`select 1 x from cf_recover_items where installation_id = ${inst} and location_id = ${loc} limit 1`;
  if (!any) return null;
  const [r] = await sql()`select count(*)::int n from cf_recover_items where installation_id = ${inst} and location_id = ${loc} and recovered_at is not null and recovered_how is distinct from 'dropped'
    and recovered_at >= (${from}::date::timestamp at time zone ${l.tz}) and recovered_at < (${to}::date::timestamp at time zone ${l.tz})`;
  return Number(r.n);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDay = (d: string) => { const [, m, day] = d.split("-"); return `${Number(day)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}`; };

async function timelineOf(inst: string, loc: string, l: Loc, from: string, to: string): Promise<TimelineItem[]> {
  const out: TimelineItem[] = [];
  const weeks = await sql()`select week_start::text ws, found, cleared, median_fix_minutes from td_receipts where installation_id = ${inst} and location_id = ${loc} and week_start >= ${from}::date and week_start < ${to}::date and found > 0 order by week_start desc limit 6`;
  for (const w of weeks) {
    const med = num(w.median_fix_minutes);
    out.push({ on: String(w.ws), text: `Week of ${shortDay(String(w.ws))}: caught ${plural(Number(w.found), "problem", "problems")}, ${Number(w.cleared)} fixed${med !== null && Number(w.cleared) > 0 ? ` (typically within ${durationText(med)})` : ""}.` });
  }
  const rec = await sql()`select greatest((date_trunc('week', recovered_at at time zone ${l.tz}))::date, ${from}::date)::text ws, kind, count(*)::int n from cf_recover_items
    where installation_id = ${inst} and location_id = ${loc} and recovered_at is not null and recovered_how is distinct from 'dropped'
      and recovered_at >= (${from}::date::timestamp at time zone ${l.tz}) and recovered_at < (${to}::date::timestamp at time zone ${l.tz}) group by 1, 2 order by 1 desc limit 8`;
  for (const r of rec) {
    const n = Number(r.n);
    out.push({ on: String(r.ws), text: r.kind === "no_show" ? `${plural(n, "no-show was", "no-shows were")} rebooked after we flagged ${n === 1 ? "it" : "them"}.` : r.kind === "missed_call" ? `${plural(n, "missed call was", "missed calls were")} called back after we flagged ${n === 1 ? "it" : "them"}.` : `${plural(n, "lead that had gone quiet got", "leads that had gone quiet got")} an answer after we flagged ${n === 1 ? "it" : "them"}.` });
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)).slice(0, 12);
}

/** Every figure of one account for one month and the month before, measured from our own records. A figure with too little behind it is null, never a made-up zero. */
export async function buildPayload(inst: string, loc: string, month: string, o: Opts & { nameStaff: boolean }, now = new Date()): Promise<PrPayload | null> {
  const l = await locOf(inst, loc, o.defaultTarget);
  if (!l) return null;
  const w = monthWindow(month, now), months = trendMonths(month);
  const mw = months.map((m) => monthWindow(m, now));
  const [cur, prev, curD, prevD, trendD, curM, prevM, curR, prevR, trendReply] = await Promise.all([
    replyWindow(inst, loc, l, w.from, w.to, o), replyWindow(inst, loc, l, w.prevFrom, w.prevTo, o),
    dailyWindow(inst, loc, w.from, w.to), dailyWindow(inst, loc, w.prevFrom, w.prevTo),
    Promise.all(mw.map((x) => dailyWindow(inst, loc, x.from, x.to))),
    movedWindow(inst, loc, l, w.from, w.to), movedWindow(inst, loc, l, w.prevFrom, w.prevTo),
    recoveredWindow(inst, loc, l, w.from, w.to), recoveredWindow(inst, loc, l, w.prevFrom, w.prevTo),
    Promise.all(mw.map((x) => replyWindow(inst, loc, l, x.from, x.to, o))),
  ]);
  const [receipts] = await sql()`select count(*)::int rows, coalesce(sum(found), 0)::int found, coalesce(sum(cleared), 0)::int cleared, (select still_open from td_receipts where installation_id = ${inst} and location_id = ${loc} and week_start >= ${w.from}::date and week_start < ${w.to}::date order by week_start desc limit 1) still_open,
      avg(median_fix_minutes) filter (where cleared > 0) typical from td_receipts where installation_id = ${inst} and location_id = ${loc} and week_start >= ${w.from}::date and week_start < ${w.to}::date`;
  const [first] = await sql()`select least((select min(lead_at)::date from lead_touches where installation_id = ${inst} and location_id = ${loc}), (select min(day) from client_daily where installation_id = ${inst} and location_id = ${loc}))::text d`;
  const timeline = await timelineOf(inst, loc, l, w.from, w.to);
  const team = o.nameStaff ? await teamOf(inst, loc, l, w.from, w.to, o) : null;

  const enough = (r: Reply) => r.leads >= MIN_LEADS;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
  const leadsOf = (r: Reply, d: Daily) => (r.leads > 0 ? r.leads : d.rows > 0 ? d.leads : null);
  const noShow = (d: Daily) => (d.showed + d.noshow >= MIN_SHOWS ? pct(d.noshow, d.showed + d.noshow) : null);
  const booked = (d: Daily) => (d.rows > 0 ? d.booked : null);
  const trend: TrendPoint[] = months.map((m, i) => {
    const r = trendReply[i], d = trendD[i];
    return { month: m, leads: leadsOf(r, d), withinPct: enough(r) ? pct(r.within, r.leads) : null, showRate: d.showed + d.noshow >= MIN_SHOWS ? pct(d.showed, d.showed + d.noshow) : null, won: d.rows > 0 ? d.wonValue : null };
  });
  const found = Number(receipts.rows) > 0 ? Number(receipts.found) : null;
  const m = (c: number | null, p: number | null): Metric => ({ current: c, previous: p });
  const payload: PrPayload = {
    v: 1, account: l.name, month, label: w.label, prevLabel: w.prevLabel, partial: w.partial, from: w.from, to: w.lastDay, builtAt: now.toISOString(),
    historyStarts: typeof first?.d === "string" ? first.d : null, targetMinutes: l.target, clock: o.businessHours ? "working hours" : "every hour",
    leads: m(leadsOf(cur, curD), leadsOf(prev, prevD)),
    replyMedian: m(enough(cur) ? cur.median : null, enough(prev) ? prev.median : null),
    withinTarget: m(enough(cur) ? pct(cur.within, cur.leads) : null, enough(prev) ? pct(prev.within, prev.leads) : null),
    neverAnswered: enough(cur) ? cur.leads - cur.answered : null,
    recovered: m(curR, prevR),
    booked: m(booked(curD), booked(prevD)), showed: m(curD.rows > 0 ? curD.showed : null, prevD.rows > 0 ? prevD.showed : null), noShowRate: m(noShow(curD), noShow(prevD)),
    moved: { deals: m(curM?.deals ?? null, prevM?.deals ?? null), value: m(curM && curM.deals > 0 ? curM.value : null, prevM && prevM.deals > 0 ? prevM.value : null) },
    won: { deals: m(curD.rows > 0 ? curD.wonDeals : null, prevD.rows > 0 ? prevD.wonDeals : null), value: m(curD.rows > 0 && curD.wonDeals > 0 ? curD.wonValue : null, prevD.rows > 0 && prevD.wonDeals > 0 ? prevD.wonValue : null) },
    caught: { found, fixed: found === null ? null : Number(receipts.cleared), stillOpen: found === null ? null : num(receipts.still_open), typicalFixMinutes: found === null ? null : receipts.typical === null ? null : Math.round(Number(receipts.typical)) },
    timeline, trend, team,
  };
  return payload;
}

async function teamOf(inst: string, loc: string, l: Loc, from: string, to: string, o: Opts) {
  const reply = o.countAutomated ? sql()`coalesce(t.human_touch_at, t.touch_at)` : sql()`t.human_touch_at`;
  const rows = await sql()`select split_part(coalesce(u.name, 'Team member'), ' ', 1) name, count(*)::int n,
      percentile_cont(0.5) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) med
    from lead_touches t left join location_users u on u.installation_id = t.installation_id and u.location_id = t.location_id and u.user_id = t.touch_user_id
    where t.installation_id = ${inst} and t.location_id = ${loc} and t.excluded is null and ${reply} is not null and t.touch_user_id is not null
      and t.lead_at >= (${from}::date::timestamp at time zone ${l.tz}) and t.lead_at < (${to}::date::timestamp at time zone ${l.tz})
    group by 1 having count(*) >= 3 order by n desc limit 5`;
  const out = rows.map((r) => ({ name: cleanText(r.name, 30) ?? "Team member", firstReplies: Number(r.n), medianMinutes: r.med === null ? null : Math.round(Number(r.med)) }));
  return out.length ? out : null;
}

// ---------------------------------------------------------------- prepared reports

export type ReportRow = { payload: PrPayload; intro: string | null; sections: Sections; nameStaff: boolean; status: "draft" | "shared"; builtAt: string; sharedAt: string | null; auto: boolean };
const toReport = (r: Record<string, unknown>): ReportRow => ({ payload: r.payload as PrPayload, intro: (r.intro as string | null) ?? null, sections: normalizeSections(r.sections), nameStaff: r.name_staff === true, status: r.status === "shared" ? "shared" : "draft", builtAt: iso(r.built_at) ?? "", sharedAt: iso(r.shared_at), auto: r.auto_prepared === true });

export async function getReport(inst: string, loc: string, month: string): Promise<ReportRow | null> {
  const [r] = await sql()`select payload, intro, sections, name_staff, status, built_at, shared_at, auto_prepared from pr_reports where installation_id = ${inst} and location_id = ${loc} and period = ${month + "-01"}::date`;
  return r ? toReport(r) : null;
}

export type PrepareResult = { ok: true; kept: boolean } | { ok: false; error: string };
/** Makes or refreshes the DRAFT for one account and month. A report that was already shared is never changed behind the owner's back: it must be taken back to a draft first. */
export async function prepareReport(inst: string, loc: string, month: string, o: Opts, by: string | null, auto = false): Promise<PrepareResult> {
  const settings = await getPrSettings(inst);
  const [existing] = await sql()`select status from pr_reports where installation_id = ${inst} and location_id = ${loc} and period = ${month + "-01"}::date`;
  if (existing?.status === "shared") return { ok: true, kept: true };
  const payload = await buildPayload(inst, loc, month, { ...o, nameStaff: settings.nameStaff });
  if (!payload) return { ok: false, error: "That client account was not found" };
  await sql()`insert into pr_reports (installation_id, location_id, period, status, payload, sections, name_staff, auto_prepared, built_at)
    values (${inst}, ${loc}, ${month + "-01"}::date, 'draft', ${sql().json(payload as never)}, ${sql().json(settings.sections as never)}, ${settings.nameStaff}, ${auto}, now())
    on conflict (installation_id, location_id, period) do update set payload = excluded.payload, name_staff = excluded.name_staff, built_at = now() where pr_reports.status = 'draft'`;
  if (!auto) await audit(inst, by, "proof.prepared", { month });
  return { ok: true, kept: false };
}

/** Prepares every account that has no report for the month yet, a batch at a time. `remaining` tells the screen to ask again. */
export async function prepareMissing(inst: string, allowed: string[] | null, month: string, o: Opts, by: string | null, batch = 25, auto = false): Promise<{ prepared: number; remaining: number }> {
  const todo = await sql()`select l.location_id from locations l where l.installation_id = ${inst} and not l.ignored and (${allowed === null} or l.location_id = any(${allowed ?? []}::text[]))
    and not exists (select 1 from pr_reports r where r.installation_id = l.installation_id and r.location_id = l.location_id and r.period = ${month + "-01"}::date) order by l.name, l.location_id limit ${batch + 1}`;
  const ids = todo.slice(0, batch).map((r) => r.location_id as string);
  let prepared = 0;
  for (let i = 0; i < ids.length; i += 3) {
    const done = await Promise.all(ids.slice(i, i + 3).map((id) => prepareReport(inst, id, month, o, by, auto).catch(() => ({ ok: false as const, error: "failed" }))));
    prepared += done.filter((d) => d.ok).length;
  }
  if (!auto) await audit(inst, by, "proof.prepared_all", { month, prepared });
  return { prepared, remaining: Math.max(0, todo.length - batch) };
}

export async function saveReportEdit(inst: string, loc: string, month: string, edit: { intro?: unknown; sections?: unknown }, by: string | null): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const row = await getReport(inst, loc, month);
  if (!row) return { ok: false, error: "Prepare this report first", status: 404 };
  if (row.status === "shared") return { ok: false, error: "This report is shared. Take it back to a draft before editing", status: 409 };
  const intro = "intro" in edit ? cleanText(edit.intro, 400) : row.intro;
  const bad = textProblem(intro);
  if (bad) return { ok: false, error: bad, status: 400 };
  const sections = "sections" in edit ? normalizeSections(edit.sections) : row.sections;
  await sql()`update pr_reports set intro = ${intro}, sections = ${sql().json(sections as never)} where installation_id = ${inst} and location_id = ${loc} and period = ${month + "-01"}::date and status = 'draft'`;
  await audit(inst, by, "proof.edited", { month });
  return { ok: true };
}

// ---------------------------------------------------------------- the link

export type LinkInfo = { exists: boolean; revoked: boolean; views: number; lastViewedAt: string | null; createdAt: string | null; token: string | null };
export async function getLink(inst: string, loc: string, withToken = false): Promise<LinkInfo> {
  const [k] = await sql()`select token_enc, created_at, revoked_at, views, last_viewed_at from pr_links where installation_id = ${inst} and location_id = ${loc}`;
  if (!k) return { exists: false, revoked: false, views: 0, lastViewedAt: null, createdAt: null, token: null };
  let token: string | null = null;
  if (withToken && !k.revoked_at) { try { token = decryptSecret(k.token_enc as string); } catch { token = null; } }
  return { exists: true, revoked: k.revoked_at !== null, views: Number(k.views), lastViewedAt: iso(k.last_viewed_at), createdAt: iso(k.created_at), token };
}
const newToken = () => randomBytes(32).toString("base64url");

/** The one link for an account. Made when first needed; a switched-off link gets a NEW token when it is switched back on, so the old address never works again. */
export async function ensureLink(inst: string, loc: string, by: string | null): Promise<string> {
  const cur = await getLink(inst, loc, true);
  if (cur.exists && !cur.revoked && cur.token) return cur.token;
  const token = newToken();
  if (!cur.exists) await sql()`insert into pr_links (installation_id, location_id, token_hash, token_enc) values (${inst}, ${loc}, ${tokenHash(token)}, ${encryptSecret(token)})`;
  else await sql()`update pr_links set token_hash = ${tokenHash(token)}, token_enc = ${encryptSecret(token)}, rotated_at = now(), revoked_at = null where installation_id = ${inst} and location_id = ${loc}`;
  await audit(inst, by, "proof.link_made", {});
  return token;
}
export async function regenerateLink(inst: string, loc: string, by: string | null): Promise<string> {
  const token = newToken();
  const done = await sql()`update pr_links set token_hash = ${tokenHash(token)}, token_enc = ${encryptSecret(token)}, rotated_at = now(), revoked_at = null where installation_id = ${inst} and location_id = ${loc} returning 1`;
  if (!done.length) await sql()`insert into pr_links (installation_id, location_id, token_hash, token_enc) values (${inst}, ${loc}, ${tokenHash(token)}, ${encryptSecret(token)})`;
  await audit(inst, by, "proof.link_regenerated", {});
  return token;
}
export async function revokeLink(inst: string, loc: string, by: string | null): Promise<boolean> {
  const done = await sql()`update pr_links set revoked_at = now() where installation_id = ${inst} and location_id = ${loc} and revoked_at is null returning 1`;
  if (done.length) await audit(inst, by, "proof.link_revoked", {});
  return done.length > 0;
}

export async function shareReport(inst: string, loc: string, month: string, by: string | null): Promise<{ ok: true; token: string } | { ok: false; error: string; status: number }> {
  const row = await getReport(inst, loc, month);
  if (!row) return { ok: false, error: "Prepare this report first", status: 404 };
  const bad = textProblem(row.payload.account, row.intro);
  if (bad) return { ok: false, error: bad, status: 400 };
  const token = await ensureLink(inst, loc, by);
  await sql()`update pr_reports set status = 'shared', shared_at = coalesce(shared_at, now()), shared_by = ${by} where installation_id = ${inst} and location_id = ${loc} and period = ${month + "-01"}::date`;
  await audit(inst, by, "proof.shared", { month });
  return { ok: true, token };
}
export async function unshareReport(inst: string, loc: string, month: string, by: string | null): Promise<boolean> {
  const done = await sql()`update pr_reports set status = 'draft', shared_at = null where installation_id = ${inst} and location_id = ${loc} and period = ${month + "-01"}::date and status = 'shared' returning 1`;
  if (done.length) await audit(inst, by, "proof.unshared", { month });
  return done.length > 0;
}

// ---------------------------------------------------------------- the list

export type ListFilter = { month: string; status: PrStatus | null; q: string | null; page: number; size: number };
const STATUS_SQL = () => sql()`case when r.id is null then 'none' when r.status = 'draft' then 'draft' when k.last_viewed_at is not null and k.last_viewed_at >= r.shared_at then 'viewed' else 'shared' end`;

export async function listRows(inst: string, allowed: string[] | null, f: ListFilter) {
  const scope = sql()`l.installation_id = ${inst} and not l.ignored and (${allowed === null} or l.location_id = any(${allowed ?? []}::text[])) and (${f.q === null} or position(lower(${f.q ?? ""}) in lower(coalesce(l.name, ''))) > 0)`;
  const from = sql()`from locations l left join pr_reports r on r.installation_id = l.installation_id and r.location_id = l.location_id and r.period = ${f.month + "-01"}::date
    left join pr_links k on k.installation_id = l.installation_id and k.location_id = l.location_id`;
  const counts = await sql()`select ${STATUS_SQL()} st, count(*)::int n, count(*) filter (where r.auto_prepared and r.status = 'draft')::int auto ${from} where ${scope} group by 1`;
  const c: Record<PrStatus, number> = { none: 0, draft: 0, shared: 0, viewed: 0 };
  let autoDrafts = 0;
  for (const r of counts) { c[r.st as PrStatus] = Number(r.n); autoDrafts += Number(r.auto); }
  const total = c.none + c.draft + c.shared + c.viewed;
  const filtered = f.status ? c[f.status] : total;
  const rows = await sql()`select l.location_id, coalesce(l.name, 'Unnamed account') name, ${STATUS_SQL()} st, r.built_at, r.shared_at, r.auto_prepared, k.views, k.last_viewed_at, k.revoked_at, (k.token_hash is not null) has_link,
      (r.payload->'leads'->>'current')::int leads
    ${from} where ${scope} and (${f.status === null} or ${STATUS_SQL()} = ${f.status ?? ""}) order by l.name, l.location_id limit ${f.size} offset ${f.page * f.size}`;
  const out: PrRow[] = rows.map((r) => ({
    locationId: r.location_id as string, name: r.name as string, status: r.st as PrStatus, linkOff: r.revoked_at !== null && r.has_link === true, builtAt: iso(r.built_at), sharedAt: iso(r.shared_at), auto: r.auto_prepared === true,
    views: r.views === null ? 0 : Number(r.views), lastViewedAt: iso(r.last_viewed_at), hasLink: r.has_link === true, leads: num(r.leads),
  }));
  return { rows: out, total: filtered, all: total, counts: c, autoDrafts, page: f.page, size: f.size, pages: Math.max(1, Math.ceil(filtered / f.size)) };
}

// ---------------------------------------------------------------- the public page

export type PublicView = {
  brand: Brand; account: string | null; report: { payload: PrPayload; intro: string | null; sections: Sections; nameStaff: boolean; sharedAt: string } | null; months: Array<{ month: string; label: string }>;
};
/** The one read the public page makes. The token picks one link row; that row names the one account; nothing else is looked at. A switched-off link finds nothing. */
export async function findPublic(token: string, month: string | null): Promise<PublicView | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [k] = await sql()`select installation_id, location_id from pr_links where token_hash = ${tokenHash(token)} and revoked_at is null`;
  if (!k) return null;
  const inst = k.installation_id as string, loc = k.location_id as string;
  const shared = await sql()`select period::text p, payload, intro, sections, name_staff, shared_at from pr_reports where installation_id = ${inst} and location_id = ${loc} and status = 'shared' order by period desc limit 12`;
  const chosen = shared.find((r) => month && String(r.p).slice(0, 7) === month) ?? shared[0] ?? null;
  const brand = await brandFor(inst);
  await sql()`update pr_links set views = views + 1, last_viewed_at = now() where token_hash = ${tokenHash(token)}`.catch(() => undefined);
  const months = shared.map((r) => { const m = String(r.p).slice(0, 7); return { month: m, label: (r.payload as PrPayload).label }; });
  if (!chosen) return { brand, account: null, report: null, months };
  const intro = (chosen.intro as string | null) ?? (await getPrSettings(inst)).intro;
  return { brand, account: (chosen.payload as PrPayload).account, report: { payload: chosen.payload as PrPayload, intro, sections: normalizeSections(chosen.sections), nameStaff: chosen.name_staff === true, sharedAt: iso(chosen.shared_at) ?? "" }, months };
}

// ---------------------------------------------------------------- monthly draft (from the hourly job)

/** On the first days of a month, makes a draft for last month for every account that has none, so the owner only reviews and sends. Never sends. A batch per hour until done. */
export async function autoPrepare(inst: string, o: Opts, now = new Date()): Promise<number> {
  if (now.getUTCDate() > 7) return 0;
  const s = await getPrSettings(inst);
  if (!s.autoDraft) return 0;
  const month = monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  return (await prepareMissing(inst, null, month, o, null, 30, true)).prepared;
}
