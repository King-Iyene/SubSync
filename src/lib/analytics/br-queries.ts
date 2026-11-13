import { sql } from "../db";
import { isLive } from "../live-flags";
import { realTransports } from "../notifications/transports";
import { ttlCache } from "../ttl-cache";
import { unsubscribeUrl } from "../unsubscribe";
import { buildBrief, briefDue, briefEmail, sectionsOf, SECTIONS, type Brief, type BriefInputs, type Section } from "./br-core";
import { localDay, validZone } from "./cash-intel";
import { dealsSummary, recoverSummary, saveBoard } from "./cash-queries";
import { today as paymentsToday } from "./payments-queries";
import { headline as financeHeadline } from "./finance-queries";
import { today } from "./today3-queries";
import { summary as walletSummary } from "./wg-queries";
import { briefIgnored } from "./ignored-leads-alerts";

// The database side of the 7 am brief. It READS what SubSync already computes (Today, missed leads, slipping deals, save-this-account, wallet, payments) and keeps its own record of each brief
// (br_history: shown or sent, opened, acted). The email goes through the one outward gate (realTransports, then the SEND_EMAIL_LIVE switch): with the switch off it writes a "WOULD SEND" line
// and sends nothing. It goes only to the people you chose and changes nothing in the CRM. A person's choices (br_prefs) are that person's own: every read and write here is keyed by the installation AND the
// verified user, never by anything the browser sends.

export type BriefFlags = { cf_save: boolean; cf_recover: boolean; cf_deals: boolean; wg_wallet: boolean; pm_module: boolean; td_today: boolean; fn_today?: boolean; sp_ignored?: boolean };
const cache = ttlCache<BriefInputs>(60_000, 50);
export const forgetBrief = (inst: string) => cache.clear(JSON.stringify([inst]).slice(0, -1));

const HASH: Record<string, string> = { speed: "#speed", appointments: "#appointments", pipeline: "#pipeline", clients: "#clients", team: "#team", "data-health": "#data-health", settings: "#settings" };
const ID = /^[A-Za-z0-9_-]{3,128}$/;

/** The numbers behind a brief, whole business. One section failing is left out; it never blocks the rest. */
export async function gather(inst: string, f: BriefFlags, now = Date.now()): Promise<BriefInputs> {
  const key = JSON.stringify([inst, Object.values(f), Math.floor(now / 60_000)]);
  const hit = cache.get(key);
  if (hit) return hit;
  const scope = { inst, allowed: null, level: "all" as const, selfId: null };
  const quiet = async <T>(on: boolean, fn: () => Promise<T>): Promise<T | null> => (on ? fn().catch(() => null) : null);
  const [td, save, rec, deals, wallet, pay, fin, ign] = await Promise.all([
    quiet(true, () => today(scope, null, now)),
    quiet(f.cf_save, () => saveBoard(scope, now)),
    quiet(f.cf_recover, () => recoverSummary(scope, null, now)),
    quiet(f.cf_deals, () => dealsSummary(scope, null, now)),
    quiet(f.wg_wallet, () => walletSummary({ inst, allowed: null }, { account: () => "" }, now)),
    quiet(f.pm_module, () => paymentsToday({ inst, allowed: null }, {})),
    quiet(f.fn_today === true, () => financeHeadline({ inst, allowed: null }, { account: () => "" }, now)),
    quiet(f.sp_ignored === true, () => briefIgnored(inst, now)),
  ]);
  const out: BriefInputs = {
    accounts: td?.accounts ?? 0,
    attention: (td?.items ?? []).map((i) => ({ kind: i.kind, label: i.label, why: i.why, count: i.count, accounts: i.accounts, money: i.money, hash: HASH[i.module] ?? "#today", topName: i.top[0]?.name ?? null, oldestHours: i.oldestHours })),
    save: save ? { accounts: save.accounts.map((a) => ({ locationId: a.locationId, name: a.name, evidence: a.evidence.map((e) => e.text), dollarText: a.dollarText, hash: a.list === "recover" ? `#today?tab=recover&account=${encodeURIComponent(a.locationId)}` : a.list === "deals" ? "#pipeline" : a.list === "speed" ? "#speed" : "#clients" })), more: save.more } : null,
    recover: rec ? { total: rec.total, estValue: rec.estValue } : null,
    deals: deals ? { slipping: deals.stale.count + deals.soon.count, value: deals.stale.value !== null || deals.soon.value !== null ? (deals.stale.value ?? 0) + (deals.soon.value ?? 0) : null, lost: deals.lost.count, lostNoReason: deals.lost.noReason } : null,
    wallet: wallet ? { empty: wallet.counts.empty, low: wallet.counts.low, spike: wallet.counts.spike, names: wallet.top.map((r) => r.name) } : null,
    payments: pay ? paymentsOf(pay.atRisk) : null,
    ignored: ign,
    finance: fin ? { highRisk: fin.highRisk, highRiskMrr: fin.highRiskMrr, overdue: fin.overdue, overdueTotal: fin.overdueTotal } : null,
  };
  cache.set(key, out);
  return out;
}

function paymentsOf(atRisk: Array<{ currency: string; count: number; amount: number }>): { count: number; amount: number | null } {
  const count = atRisk.reduce((t, x) => t + x.count, 0);
  const cur = new Set(atRisk.filter((x) => x.count > 0).map((x) => x.currency || "USD"));
  // Different currencies are never added together: one currency gives a figure, more than one gives none.
  return { count, amount: cur.size === 1 ? atRisk.reduce((t, x) => t + (x.amount > 0 ? x.amount : 0), 0) || null : null };
}

// ------------------------------------------------------------------ a person's own choices

export type BrPrefs = { email: string | null; emailOn: boolean; hour: number; timezone: string; quietDays: number[]; sections: Section[]; defaultTimezone: string; lastSentKey: string | null };
const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,255}\.[^\s@,;]{2,}$/;

export async function defaultZone(inst: string): Promise<string> {
  const [st] = await sql()`select digest_timezone from settings where installation_id = ${inst}`.catch(() => []);
  const [lz] = await sql()`select timezone from locations where installation_id = ${inst} and coalesce(timezone, '') <> '' order by name limit 1`.catch(() => []);
  return validZone((st?.digest_timezone as string | null) ?? (lz?.timezone as string | null) ?? "UTC");
}

export async function getPrefs(inst: string, user: string): Promise<BrPrefs> {
  const [p] = await sql()`select email, email_on, hour, timezone, quiet_days, sections, last_sent_key from br_prefs where installation_id = ${inst} and user_key = ${user}`.catch(() => []);
  const dz = await defaultZone(inst);
  return {
    email: (p?.email as string | null) ?? null, emailOn: p?.email_on === true, hour: p ? Number(p.hour) : 7, timezone: p ? validZone(p.timezone as string) : dz,
    quietDays: ((p?.quiet_days as number[] | null) ?? []).map(Number), sections: [...sectionsOf(p?.sections)], defaultTimezone: dz, lastSentKey: (p?.last_sent_key as string | null) ?? null,
  };
}

const isZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

export async function savePrefs(inst: string, user: string, b: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const hour = Number(b.hour ?? 7);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: "Choose an hour between 0 and 23." };
  const tz = typeof b.timezone === "string" ? b.timezone.slice(0, 64) : "";
  if (!tz || !isZone(tz)) return { ok: false, error: "Choose a time zone from the list." };
  const quiet = Array.isArray(b.quietDays) ? [...new Set(b.quietDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const secs = Array.isArray(b.sections) ? [...new Set(b.sections.map(String).filter((x): x is Section => (SECTIONS as readonly string[]).includes(x)))] : [...SECTIONS];
  if (!secs.length) return { ok: false, error: "Keep at least one section on." };
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email address does not look right." };
  const on = b.emailOn === true && email !== "";
  if (b.emailOn === true && !email) return { ok: false, error: "Add your email address to get the brief by email." };
  await sql()`insert into br_prefs (installation_id, user_key, email, email_on, hour, timezone, quiet_days, sections, updated_at)
    values (${inst}, ${user}, ${email || null}, ${on}, ${hour}, ${tz}, ${quiet}::int[], ${secs}::text[], now())
    on conflict (installation_id, user_key) do update set email = excluded.email, email_on = excluded.email_on, hour = excluded.hour, timezone = excluded.timezone, quiet_days = excluded.quiet_days,
      sections = excluded.sections, updated_at = now()`;
  return { ok: true };
}

// ------------------------------------------------------------------ the record

export type BrHistoryRow = { id: string; day: string; channel: "email" | "app" | "test"; mode: "sent" | "dry_run" | "shown"; itemCount: number; dollars: number | null; opened: boolean; acted: boolean; actedTitle: string | null; at: string };

async function record(inst: string, user: string, day: string, channel: "email" | "app" | "test", mode: "sent" | "dry_run" | "shown", b: Brief, opened: boolean): Promise<string | null> {
  const db = sql();
  const items = b.items.map((i) => ({ key: i.key, title: i.title, count: i.count }));
  const r = await db`insert into br_history (installation_id, user_key, day, channel, mode, items, item_count, dollars, opened_at)
    values (${inst}, ${user}, ${day}, ${channel}, ${mode}, ${db.json(items as never)}, ${b.items.length}, ${b.dollar.amount}, ${opened ? new Date() : null})
    ${channel === "test" ? db`` : db`on conflict (installation_id, user_key, day, channel) where channel <> 'test' do update set items = excluded.items, item_count = excluded.item_count, dollars = excluded.dollars, opened_at = coalesce(br_history.opened_at, excluded.opened_at)`}
    returning id`;
  return (r[0]?.id as string | undefined) ?? null;
}

/** The brief was shown in the app today: one row per person per day, "opened" set. */
export const recordSeen = (inst: string, user: string, day: string, b: Brief) => record(inst, user, day, "app", "shown", b, true);

/** The person pressed Open on one item of today's in-app brief. The key must be one the brief actually held that day. */
export async function recordActed(inst: string, user: string, day: string, key: string): Promise<boolean> {
  if (typeof key !== "string" || key.length > 120) return false;
  const [row] = await sql()`select items from br_history where installation_id = ${inst} and user_key = ${user} and day = ${day} and channel = 'app'`;
  const items = ((row?.items as Array<{ key: string; title: string }> | undefined) ?? []);
  const hit = items.find((i) => i.key === key);
  if (!hit) return false;
  await sql()`update br_history set acted_at = coalesce(acted_at, now()), acted_key = coalesce(acted_key, ${key}) where installation_id = ${inst} and user_key = ${user} and day = ${day} and channel = 'app'`;
  return true;
}

export async function history(inst: string, user: string, limit = 14): Promise<BrHistoryRow[]> {
  const rows = await sql()`select id, day, channel, mode, items, item_count, dollars::float8 d, opened_at, acted_at, acted_key, created_at from br_history
    where installation_id = ${inst} and user_key = ${user} order by created_at desc limit ${Math.min(30, Math.max(1, limit))}`.catch(() => []);
  return rows.map((r) => ({
    id: r.id as string, day: r.day as string, channel: r.channel as BrHistoryRow["channel"], mode: r.mode as BrHistoryRow["mode"], itemCount: Number(r.item_count), dollars: r.d === null ? null : Number(r.d),
    opened: r.opened_at !== null, acted: r.acted_at !== null, actedTitle: ((r.items as Array<{ key: string; title: string }>).find((i) => i.key === r.acted_key)?.title) ?? null, at: (r.created_at as Date).toISOString(),
  }));
}

// ------------------------------------------------------------------ building one person's brief

export async function briefFor(inst: string, prefs: Pick<BrPrefs, "sections" | "timezone">, f: BriefFlags, now = Date.now()): Promise<Brief> {
  const inputs = await gather(inst, f, now);
  return buildBrief(inputs, sectionsOf(prefs.sections), localDay(now, validZone(prefs.timezone)));
}

const appBase = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

/** The email of one brief to the person's own saved address, through the outward gate. Returns whether it was really sent or only rehearsed (dry run). */
export async function emailBrief(inst: string, email: string, b: Brief, ai: string | null = null): Promise<{ dryRun: boolean; subject: string; text: string }> {
  const base = appBase(), stop = unsubscribeUrl(base, inst, email);
  const m = briefEmail(b, { appUrl: base, stopUrl: stop, settingsUrl: `${base}/app#today?brief=settings`, ai });
  const r = await realTransports(inst, () => stop).email(email, { subject: m.subject, text: m.text, html: m.html }, []);
  const dry = r.ok ? r.dryRun === true : !isLive("SEND_EMAIL_LIVE");
  return { dryRun: dry, subject: m.subject, text: m.text };
}

/** Hourly: sends each person's brief at their own hour of their own day. At most one per person per local day (the day key is claimed first, so a second run sends nothing). Returns briefs handed to the gate. */
export async function runBriefs(inst: string, f: BriefFlags, now = Date.now()): Promise<number> {
  const rows = await sql()`select user_key, email, hour, timezone, quiet_days, sections, last_sent_key from br_prefs where installation_id = ${inst} and email_on and email is not null`.catch(() => []);
  let sent = 0;
  for (const p of rows) {
    const tz = validZone(p.timezone as string);
    const { due, key } = briefDue(now, tz, Number(p.hour), ((p.quiet_days as number[] | null) ?? []).map(Number), (p.last_sent_key as string | null) ?? null);
    if (!due || !ID.test(p.user_key as string)) continue;
    const claimed = await sql()`update br_prefs set last_sent_key = ${key} where installation_id = ${inst} and user_key = ${p.user_key as string} and last_sent_key is not distinct from ${(p.last_sent_key as string | null) ?? null} returning 1`;
    if (!claimed.length) continue;
    const b = await briefFor(inst, { sections: [...sectionsOf(p.sections)], timezone: tz }, f, now);
    // Nothing needs the person: no email (one useful brief, not a ping that says nothing). The in-app brief still says so.
    if (!b.items.length) continue;
    const r = await emailBrief(inst, p.email as string, b, await (await import("../ai/brief")).wordingForEmail(inst, b));
    await record(inst, p.user_key as string, key, "email", r.dryRun ? "dry_run" : "sent", b, false);
    sent++;
  }
  return sent;
}

/** A test to the person's own saved address, at most 5 a day. Writes a "test" row. The rehearsal (dry run) returns the exact words so the person can read them. */
export async function sendTest(inst: string, user: string, f: BriefFlags, now = Date.now()): Promise<{ ok: true; dryRun: boolean; to: string; subject: string; text: string } | { ok: false; error: string; status: number }> {
  const p = await getPrefs(inst, user);
  if (!p.email) return { ok: false, error: "Save your email address first.", status: 400 };
  const [n] = await sql()`select count(*)::int n from br_history where installation_id = ${inst} and user_key = ${user} and channel = 'test' and created_at > now() - interval '24 hours'`;
  if (Number(n?.n ?? 0) >= 5) return { ok: false, error: "That is enough tests for today. Try again tomorrow.", status: 429 };
  const b = await briefFor(inst, p, f, now);
  const r = await emailBrief(inst, p.email, b);
  await record(inst, user, localDay(now, validZone(p.timezone)), "test", r.dryRun ? "dry_run" : "sent", b, false);
  return { ok: true, dryRun: r.dryRun, to: p.email, subject: r.subject, text: r.text };
}
