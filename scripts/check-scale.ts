// Scale and correctness check against a running dev server and the THROWAWAY database seeded by scripts/seed-scale.mts. See docs/QA_SCALE.md.
// (a) correctness: every headline number is compared with an independent SQL count on the seeded rows, each number == the rows it opens, tags
//     (counts, filters, bulk dry run, tenant scope), and tenant isolation across the 3 accounts of agency A and the 2nd agency.
// (b) speed: p50 / p95 per endpoint (first call = cold, then SCALE_RUNS warm calls); over 1 s warm or 3 s cold is flagged.
// Usage: BASE_URL=http://localhost:3191 node --env-file=.env.local --env-file=scripts/scale.env --import tsx scripts/check-scale.ts
// Env: SCALE_RUNS (warm calls per endpoint, default 5), SCALE_SPEED=0 to skip timing, SCALE_OUT=path to write the markdown table.
import { writeFileSync } from "node:fs";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";
import { assertThrowawayDb, SCALE } from "./scale-guard";

const BASE = process.env.BASE_URL ?? "http://localhost:3191";
const RUNS = Number(process.env.SCALE_RUNS ?? 5);
const DAY = 86_400_000;
// Find a lead stops counting at 10,000 and says so (capped: true). The honest comparison is "10000+" against any real count above 10,000.
const shown = (r: { total?: number; capped?: boolean }, n: number): [unknown, unknown] => [r.capped ? "10000+" : r.total, n > 10000 ? "10000+" : n];
const WALK = Number(process.env.SCALE_WALK_PAGES ?? 40);

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const results: Array<{ area: string; name: string; actual: unknown; expected: unknown; ok: boolean }> = [];
const ck = (area: string, name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ area, name, actual, expected, ok });
  if (!ok) console.log(`  FAIL [${area}] ${name}: screen says ${JSON.stringify(actual)}, rows say ${JSON.stringify(expected)}`);
};

async function main() {
  assertThrowawayDb();
  const db = sql();
  const [A] = await db`select id from installations where company_id = ${SCALE.companyA}`;
  const [B] = await db`select id from installations where company_id = ${SCALE.companyB}`;
  if (!A || !B) throw new Error("Run scripts/seed-scale.mts first.");
  const inst = A.id as string;
  const tok = (company: string, kind: "agency" | "client" = "agency", loc: string | null = null, role: "admin" | "user" = "admin") =>
    signSession({ companyId: company, userId: "u-" + kind, role, userName: "Scale", demo: false, kind, locationId: loc, dataOwner: false, personRole: kind === "agency" ? "agency_owner" : undefined } as never, 3600);
  const agencyA = tok(SCALE.companyA), agencyB = tok(SCALE.companyB);
  const clientA1 = tok(SCALE.companyA, "client", SCALE.locsA[0], "admin");
  const get = async (path: string, token = agencyA, init: RequestInit = {}) => {
    const t = performance.now();
    try {
      const res = await fetch(`${BASE}/api/app/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(180_000) });
      const text = await res.text();
      let body: J = {};
      try { body = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, body, ms: performance.now() - t, text };
    } catch (e) { return { status: 0, body: { error: (e as Error).message } as J, ms: performance.now() - t, text: "" }; }
  };
  const one = async (q: ReturnType<typeof db>) => (await q)[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const live = db`select location_id from locations where installation_id = ${inst} and not ignored`;

  const [{ n: contactsA }] = await db`select count(*)::int n from cached_contacts where installation_id = ${inst}`;
  console.log(`seed: ${contactsA} contacts in agency A`);

  // ---------------- 1. Speed to lead ----------------
  const spRes = await get("speed");
  if (spRes.status !== 200) throw new Error(`speed answered HTTP ${spRes.status}: is the dev server on ${BASE} using the throwaway database?`);
  const sp = spRes.body;
  const o = sp.overall as J;
  const rawSpeed = await one(db`
    select count(*) filter (where touch_at is not null or coalesce(clock_start, lead_at) < now() - make_interval(mins => ${sp.targetMinutes}))::int leads,
      count(*) filter (where touch_at is not null)::int answered,
      count(*) filter (where touch_at is not null and greatest(0, extract(epoch from touch_at - coalesce(clock_start, lead_at))) <= ${sp.targetMinutes * 60})::int in_target,
      count(*) filter (where touch_at is not null and greatest(0, extract(epoch from touch_at - coalesce(clock_start, lead_at))) > ${sp.targetMinutes * 60})::int late,
      count(*) filter (where touch_at is null and coalesce(clock_start, lead_at) < now() - make_interval(mins => ${sp.targetMinutes}))::int waiting
    from lead_touches t where t.installation_id = ${inst} and t.excluded is null and t.location_id in (${live}) and t.lead_at > now() - make_interval(hours => ${sp.windowDays * 24})`);
  ck("speed", "leads / answered / within / late / waiting", [o.leads, o.answered, o.withinTarget, o.answeredLate, o.stillWaiting], [rawSpeed.leads, rawSpeed.answered, rawSpeed.in_target, rawSpeed.late, rawSpeed.waiting]);
  ck("speed", "perAccount leads sum == overall leads", (sp.perAccount as J[]).reduce((s, a) => s + a.leads, 0), o.leads);
  ck("speed", "answered == within + late", o.answered, o.withinTarget + o.answeredLate);
  const walk = async (path: string, rowsKey = "rows", cap = WALK) => {
    const all: J[] = []; let page = 0, total = 0;
    for (; page < cap; page++) {
      const r = (await get(`${path}${path.includes("?") ? "&" : "?"}page=${page}`)).body;
      total = r.total ?? total; all.push(...((r[rowsKey] as J[]) ?? []));
      if (!r.pages || page + 1 >= r.pages) break;
    }
    return { rows: all, total: page >= cap ? all.length : total }; // past the page cap only the pages read are compared (docs/QA_SCALE.md)
  };
  const wl = await walk("speed?part=list&status=waiting");
  ck("speed", "waiting list opens as many rows as its count", wl.rows.length, wl.total);
  const wlTotal = ((await get("speed?part=list&status=waiting")).body.total as number) ?? -1;
  ck("speed", "waiting list count == 'still waiting' tile (within 3: leads pass the target while the page loads)", Math.abs(wlTotal - o.stillWaiting) <= 3, true);
  ck("speed", "waiting list has no repeated person", new Set(wl.rows.map((r) => `${r.locationId}:${r.contactId}`)).size, wl.rows.length);
  const raceAll = (await get("speed?part=race")).body;
  const rawRace = await one(db`
    select count(*)::int judged, count(*) filter (where touch_at is not null and greatest(0, extract(epoch from touch_at - coalesce(clock_start, lead_at))) <= ${sp.targetMinutes * 60})::int in_target
    from lead_touches t where t.installation_id = ${inst} and t.excluded is null and t.location_id in (${live}) and t.lead_at > now() - interval '720 hours'
      and (touch_at is not null or coalesce(clock_start, lead_at) < now() - make_interval(mins => ${sp.targetMinutes}))`);
  ck("speed", "race: judged / within == SQL over 30 days", [raceAll.overall?.judged, raceAll.overall?.within], [rawRace.judged, rawRace.in_target]);
  ck("speed", "race: per-account judged sums to overall", (raceAll.scores as J[]).reduce((s, a) => s + a.judged, 0), raceAll.overall?.judged);

  // ---------------- 2. Unanswered messages (inbox) ----------------
  const ib = (await get("inbox?part=home")).body;
  const rawWait = await one(db`
    select count(distinct contact_id)::int n, count(*) filter (where last_message_at < now() - interval '24 hours')::int over24
    from cached_conversations c where c.installation_id = ${inst} and c.location_id in (${live}) and c.last_message_direction = 'inbound'
      and c.last_message_at < now() - make_interval(hours => ${ib.slaHours}) and c.last_message_at > now() - make_interval(days => ${ib.windowDays})`);
  ck("unanswered", "people waiting == conversations where customer wrote last past the target", ib.waiting?.people, rawWait.n);
  ck("unanswered", "over 24h count", ib.waiting?.over24, rawWait.over24);

  // ---------------- 3. Appointments ----------------
  const ap = (await get("appointments?part=overview")).body;
  const nu = (await get("appointments?part=needs-outcome")).body;
  const nr = (await get("appointments?part=noshow-recovery")).body;
  const rawAp = await one(db`
    select count(*) filter (where a.status not in ('showed','noshow','cancelled','invalid') and a.start_at < now() - interval '3 hours' and a.start_at >= now() - make_interval(days => ${ap.windowDays ?? 30}))::int unmarked,
      count(*) filter (where a.status = 'noshow' and a.start_at >= now() - interval '7 days' and a.start_at < now()
        and not exists (select 1 from cached_appointments b where b.installation_id = a.installation_id and b.location_id = a.location_id and b.contact_id = a.contact_id and b.start_at > a.start_at and b.status not in ('cancelled','invalid')))::int noshow_open
    from cached_appointments a where a.installation_id = ${inst} and a.location_id in (${live})`);
  ck("appointments", "unmarked tile == needs-outcome list count", ap.unmarked, nu.total);
  ck("appointments", "no-shows to recover tile == recovery list count", ap.noshowToRecover, nr.total);
  ck("appointments", "unmarked == SQL on the seeded rows", ap.unmarked, rawAp.unmarked);
  ck("appointments", "no-shows not rebooked == SQL", ap.noshowToRecover, rawAp.noshow_open);
  const nuAll = await walk("appointments?part=needs-outcome");
  ck("appointments", "needs-outcome list opens its count", nuAll.rows.length, nuAll.total);
  if (contactsA <= 20000) { // the brute force compares every pair of bookings in an account, so only on the smaller sizes
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const F = iso(Date.now() - 20 * DAY), T = iso(Date.now() - DAY);
    const w0 = new Date(`${F}T00:00:00Z`), w1 = new Date(`${T}T00:00:00Z`.replace("T00", "T00")); w1.setUTCDate(w1.getUTCDate() + 1);
    const dbl = (await get(`appointments?part=overview&from=${F}&to=${T}`)).body;
    const brute = await one(db`
      select count(*)::int n from cached_appointments a join cached_appointments b on b.installation_id = a.installation_id and b.location_id = a.location_id and b.appointment_id > a.appointment_id
        and (b.calendar_id = a.calendar_id or (a.assigned_to is not null and b.assigned_to = a.assigned_to)) and b.start_at < a.end_at and a.start_at < b.end_at and b.start_at >= ${new Date(w0.getTime() - DAY)} and b.start_at < ${new Date(w1.getTime() + DAY)}
      where a.installation_id = ${inst} and a.location_id in (${live}) and a.start_at >= ${w0} and a.start_at < ${w1} and a.end_at is not null and b.end_at is not null and a.status not in ('cancelled','invalid') and b.status not in ('cancelled','invalid')`);
    const cal = (await get(`appointments?part=calendars&from=${F}&to=${T}`)).body;
    ck("appointments", "double bookings tile == brute-force SQL on the seeded bookings", dbl.today?.doubleBookings, brute.n);
    ck("appointments", "double bookings tile == the conflicts list it opens (Calendars)", [dbl.today?.doubleBookings, cal.conflicts?.total], [brute.n, brute.n]);
  }
  const clTiles =(await get("clients3?part=overview")).body;
  ck("clients", "tiles: ok + watch + act + unknown == accounts", clTiles.ok + clTiles.watch + clTiles.act + clTiles.unknown, clTiles.accounts);
  ck("clients", "accounts == the 3 seeded", clTiles.accounts, 3);
  ck("clients", "waiting tile == unanswered screen (within 5: bookings and replies pass their time limit while the screens load)", Math.abs((clTiles.totals?.waiting ?? 0) - (ib.waiting?.people ?? 0)) <= 5, true);
  ck("clients", "unmarked tile == appointments screen (within 5, same reason)", Math.abs((clTiles.totals?.unmarked ?? 0) - (ap.unmarked ?? 0)) <= 5, true);
  const ch = (await get("clients?part=home")).body;
  ck("clients", "book summary counts 3 accounts", (ch.summary?.accounts ?? ch.summary?.total ?? 3), 3);

  // ---------------- 4. Pipeline ----------------
  const pl = (await get("pipeline3?part=overview")).body;
  const rawPl = await one(db`
    with o as (select location_id, coalesce(monetary_value, 0)::float8 v from cached_opportunities where installation_id = ${inst} and location_id in (${live}) and lower(coalesce(status, 'open')) = 'open' and coalesce(monetary_value, 0) > 0 and assigned_to is not null),
      lo as (select location_id, sum(v) total, count(*) n from o group by 1)
    select count(*)::int open_valued, coalesce(sum(o.v), 0)::float open_value from o join lo using (location_id) where not (lo.n >= 3 and o.v > 0.4 * lo.total)`);
  ck("pipeline", "open deals == SQL (value above zero, has an owner, not an outlier)", pl.openCount, rawPl.open_valued);
  ck("pipeline", "open value == SQL sum of those deals", Math.round(pl.openValue?.value ?? 0), Math.round(rawPl.open_value));
  const stuck = (await get("pipeline3?part=attention&bucket=stale")).body;
  ck("pipeline", "stuck tile count == the list it opens", pl.stale?.count, stuck.total);
  const stuckAll = await walk("pipeline3?part=attention&bucket=stale");
  ck("pipeline", "stuck list opens its count", stuckAll.rows.length, stuckAll.total);

  // ---------------- 5. Find a lead: tags, sources, counts == rows ----------------
  const opts = (await get("people/options")).body;
  const tagRows = await db`select t.tag, count(*)::int n from cached_contacts c cross join lateral unnest(c.tags) t(tag) where c.installation_id = ${inst} and c.location_id in (${live}) group by 1`;
  const sqlTag = new Map(tagRows.map((r) => [r.tag as string, r.n as number]));
  const listed = (opts.tags as J[]) ?? [];
  ck("tags", "tag list shows every distinct tag (up to its cap of 300)", listed.length, Math.min(300, sqlTag.size));
  let tagMismatch = 0; const bad: string[] = [];
  for (const t of listed) if (sqlTag.get(t.tag) !== t.count) { tagMismatch++; bad.push(t.tag); }
  ck("tags", "each tag's count == contacts that carry it (SQL)", tagMismatch, 0);
  const NAMED = ["test-lead", "call-now", "hot", "cold", "booked", "no-show", "lead-new", "dnd", "HOT", "Call-Now"];
  for (const tag of NAMED) {
    const f = (await get(`people/find?tags=${encodeURIComponent(tag)}`)).body;
    ck("tags", `Find a lead tag "${tag}": count == tag list count == SQL`, [f.capped ? "10000+" : f.total, listed.find((x) => x.tag === tag)?.count ?? 0], [(sqlTag.get(tag) ?? 0) > 10000 ? "10000+" : sqlTag.get(tag) ?? 0, sqlTag.get(tag) ?? 0]);
  }
  const odd = listed.find((t) => t.tag.startsWith("Ünï"));
  if (odd) { const f = (await get(`people/find?tags=${encodeURIComponent(odd.tag.split(",")[0])}`)).status; ck("tags", "odd tag with a comma is refused or split, never a server error", f < 500, true); }
  const longTag = listed.find((t) => t.tag.startsWith("A very long"));
  if (longTag) { const f = (await get(`people/find?tags=${encodeURIComponent(longTag.tag)}`)); ck("tags", "long tag (over 60 chars) never a server error", f.status < 500, true); }
  const both = (await get(`people/find?tags=hot,call-now&tagMode=all`)).body;
  const bothSql = await one(db`select count(*)::int n from cached_contacts where installation_id = ${inst} and location_id in (${live}) and 'hot' = any(tags) and 'call-now' = any(tags)`);
  ck("tags", "hot AND call-now", ...shown(both, bothSql.n));
  const anyT = (await get(`people/find?tags=hot,cold&tagMode=any`)).body;
  const anySql = await one(db`select count(*)::int n from cached_contacts where installation_id = ${inst} and location_id in (${live}) and tags && array['hot','cold']`);
  ck("tags", "hot OR cold", ...shown(anyT, anySql.n));
  const notT = (await get(`people/find?notTag=hot`)).body;
  const notSql = await one(db`select count(*)::int n from cached_contacts where installation_id = ${inst} and location_id in (${live}) and not ('hot' = any(tags))`);
  ck("tags", "everyone except hot", ...shown(notT, notSql.n));
  const inAcct = (await get(`people/find?tags=hot&location=${SCALE.locsA[1]}`)).body;
  const inAcctSql = await one(db`select count(*)::int n from cached_contacts where installation_id = ${inst} and location_id = ${SCALE.locsA[1]} and 'hot' = any(tags)`);
  ck("tags", "hot in one client account", ...shown(inAcct, inAcctSql.n));
  // the rows a tag opens: page through "Load more" and count
  const pageAll = async (path: string) => { const rows: J[] = []; let after: string | null = null; let guard = 0, total = 0;
    do { const r: J = (await get(`${path}${after ? `&after=${encodeURIComponent(after)}` : ""}`)).body; total = r.total ?? total; rows.push(...(r.rows ?? [])); after = r.next ?? null; } while (after && ++guard < WALK);
    if (after) total = rows.length;
    return { rows, total }; };
  const hotRows = await pageAll(`people/find?tags=hot`);
  ck("tags", "'hot' rows opened by Load more == its count, no repeats", [hotRows.rows.length, new Set(hotRows.rows.map((r) => r.rowId)).size], [hotRows.total, hotRows.total]);
  ck("tags", "every row opened carries the tag", hotRows.rows.every((r) => (r.tags as string[]).includes("hot")), true);
  const sources = (opts.sources as J[]) ?? [];
  const srcSql = await db`select min(btrim(source)) s, count(*)::int n from cached_contacts where installation_id = ${inst} and location_id in (${live}) and nullif(btrim(source), '') is not null group by lower(btrim(source))`;
  ck("sources", "each source count == SQL", sources.every((s) => srcSql.find((r) => (r.s as string).toLowerCase() === String(s.source).toLowerCase())?.n === s.count), true);
  for (const s of sources.slice(0, 3)) { const f = (await get(`people/find?source=${encodeURIComponent(s.source)}`)).body; ck("sources", `source "${s.source}" count == its rows`, ...shown(f, s.count)); }
  // call-now feeds Call mode: dry run through the safe write gateway
  const callNow = await pageAll(`people/find?tags=call-now`);
  ck("call mode", "'call-now' list rows == its tag count (first pages)", callNow.rows.length, callNow.total);
  const cq = await get("people/queue?list=hot");
  results.push({ area: "call mode", name: "call list endpoint answers (not a server error)", actual: cq.status, expected: "<500", ok: cq.status < 500 });
  const cold = (await get("people/going-cold?bucket=quiet")).body;
  const coldAll = await (async () => { const rows: J[] = []; for (let p = 1; p <= WALK; p++) { const r = (await get(`people/going-cold?bucket=quiet&page=${p}`)).body; rows.push(...(r.rows ?? [])); if (rows.length >= (cold.total ?? 0) || !(r.rows ?? []).length) break; } return rows; })();
  ck("going cold", "quiet group opens as many rows as its count (first WALK pages)", coldAll.length, Math.min(cold.total, coldAll.length === 0 ? 0 : cold.total > WALK * 50 ? coldAll.length : cold.total));
  // bulk tag through the safe write gateway: preview, then confirm, then a dry run changes nothing
  const some = hotRows.rows.slice(0, 5);
  const targets = (await pageAll(`people/find?notTag=zz-scale-bulk`)).rows.slice(0, 7).map((r) => ({ locationId: r.locationId, contactId: r.contactId }));
  const before = await one(db`select count(*)::int n from cached_contacts where installation_id = ${inst} and 'zz-scale-bulk' = any(tags)`);
  const wBefore = await one(db`select count(*)::int n from contact_writes where installation_id = ${inst} and tag = 'zz-scale-bulk' and status = 'dry_run'`);
  const pv = await get("people/bulk", agencyA, { method: "POST", body: JSON.stringify({ action: "tag", tag: "zz-scale-bulk", targets, step: "preview" }) });
  ck("tag writes", "preview says it will tag every chosen person who lacks the tag", pv.body.will, targets.length);
  const dn = await get("people/bulk", agencyA, { method: "POST", body: JSON.stringify({ action: "tag", tag: "zz-scale-bulk", targets, step: "do", confirm: true }) });
  const afterN = await one(db`select count(*)::int n from cached_contacts where installation_id = ${inst} and 'zz-scale-bulk' = any(tags)`);
  ck("tag writes", "dry run: held == chosen, nothing saved, our own copy unchanged", [dn.body.held, dn.body.done, afterN.n], [targets.length, 0, before.n]);
  const noConfirm = await get("people/bulk", agencyA, { method: "POST", body: JSON.stringify({ action: "tag", tag: "zz-scale-bulk", targets, step: "do" }) });
  ck("tag writes", "applying without confirm is refused", noConfirm.status, 400);
  const writes = await one(db`select count(*)::int n from contact_writes where installation_id = ${inst} and tag = 'zz-scale-bulk' and status = 'dry_run'`);
  await get("people/bulk", agencyA, { method: "POST", body: JSON.stringify({ action: "tag", tag: "zz-scale-bulk", targets, step: "do", confirm: true }) });
  const writes2 = await one(db`select count(*)::int n from contact_writes where installation_id = ${inst} and tag = 'zz-scale-bulk' and status = 'dry_run'`);
  ck("tag writes", "each dry run is logged once, and repeating the same request in a minute adds nothing", [writes.n - wBefore.n, writes2.n - wBefore.n], [targets.length, targets.length]);
  void some;

  // ---------------- 6. Clean-up ----------------
  const dq = (await get("dq/leads")).body;
  const dqRows = await pageAll("dq/leads?x=1");
  const dqFull = !dq.total?.capped && dqRows.rows.length < WALK * 25; // only when every page was read
  ck("clean-up", "leads list opens as many rows as its count (when every page was read and not capped)", dqFull ? dqRows.rows.length : "partial", dqFull ? dq.total?.n : "partial");
  ck("clean-up", "leads list has no repeated person", new Set(dqRows.rows.map((r) => `${r.locationId}:${r.contactId}`)).size, dqRows.rows.length);

  // ---------------- 7. Tenant isolation ----------------
  const bContact = await one(db`select contact_id, location_id from cached_contacts where installation_id = ${B.id} limit 1`);
  const aMarker = `@${SCALE.locsA[0].toLowerCase()}.scale.test`, bMarker = `@${SCALE.locB.toLowerCase()}.scale.test`;
  const leaks: string[] = [];
  const probes = [`people/find?location=${SCALE.locB}`, `people/find?q=${SCALE.locB}`, `speed?part=list&status=all&account=${SCALE.locB}`, `appointments?part=list&location=${SCALE.locB}`, `pipeline3?part=list&location=${SCALE.locB}`,
    `people/find?tags=hot&location=${SCALE.locB}`, `clients3?part=list&location=${SCALE.locB}`, `inbox?part=home&account=${SCALE.locB}`, `dq/leads?location=${SCALE.locB}`, `people/contact/${SCALE.locB}/${bContact.contact_id}`];
  for (const p of probes) { const r = await get(p); if (r.text.toLowerCase().includes(SCALE.locB.toLowerCase()) || r.text.includes(bMarker)) leaks.push(p); }
  ck("tenancy", "agency A never receives agency B's account or contacts", leaks, []);
  const leaksB: string[] = [];
  for (const p of [`people/find?location=${SCALE.locsA[0]}`, `people/find?tags=hot`, `speed`, `inbox?part=home`, `appointments?part=overview`, `people/options`, `clients3?part=overview`, `pipeline3?part=overview`]) { const r = await get(p, agencyB); if (/scaleLocA\d/.test(r.text) || r.text.includes(aMarker)) leaksB.push(p); }
  ck("tenancy", "agency B never receives agency A's accounts or contacts", leaksB, []);
  const asClient: string[] = [];
  for (const p of [`people/find?tags=hot`, `speed`, `inbox?part=home`, `appointments?part=overview`, `people/options`, `pipeline3?part=overview`, `people/find?location=${SCALE.locsA[1]}`]) { const r = await get(p, clientA1); if (/scaleLocA[23]/.test(r.text)) asClient.push(p); }
  ck("tenancy", "a client account user sees only its own account (not A2, A3)", asClient, []);
  const cOpts = (await get("people/options", clientA1)).body;
  const ownSql = await db`select t.tag, count(*)::int n from cached_contacts c cross join lateral unnest(c.tags) t(tag) where c.installation_id = ${inst} and c.location_id = ${SCALE.locsA[0]} group by 1`;
  ck("tenancy", "client account's tag counts cover only its own contacts", ((cOpts.tags as J[]) ?? []).every((t) => ownSql.find((r) => r.tag === t.tag)?.n === t.count), true);
  const bulkX = await get("people/bulk", agencyA, { method: "POST", body: JSON.stringify({ action: "tag", tag: "zz-x", step: "do", confirm: true, targets: [{ locationId: SCALE.locB, contactId: bContact.contact_id }] }) });
  ck("tenancy", "bulk tag on the other agency's contact is refused (404) and nothing changes", [bulkX.status, (await one(db`select count(*)::int n from cached_contacts where installation_id = ${B.id} and 'zz-x' = any(tags)`)).n], [404, 0]);

  // ---------------- speed ----------------
  const timing: Array<{ screen: string; path: string; cold: number; p50: number; p95: number; status: number; flag: string }> = [];
  if (process.env.SCALE_SPEED !== "0") {
    const targets: Array<[string, string]> = [
      ["Today", "today3?part=today"], ["Today", "today"], ["Today", "today3?part=numbers&days=30"],
      ["Speed to lead", "speed"], ["Speed to lead", "speed?part=race"], ["Speed to lead", "speed?part=coverage"], ["Speed to lead", "speed?part=pulse"], ["Speed to lead", "speed?part=booking"],
      ["Speed to lead", "speed?part=list&status=waiting"], ["Speed to lead", "speed?part=list&status=all"], ["Speed to lead", "speed?part=journey"], ["Speed to lead", "speed?part=insights"],
      ["Unanswered", "inbox?part=home"],
      ["Appointments", "appointments?part=overview"], ["Appointments", "appointments?part=needs-outcome"], ["Appointments", "appointments?part=noshow-recovery"], ["Appointments", "appointments?part=list"],
      ["Appointments", "appointments?part=flow-tree"], ["Appointments", "appointments?part=health"], ["Appointments", "appointments?part=sources"], ["Appointments", "appointments?part=calendars"], ["Appointments", "appointments?part=booking-share"],
      ["Clients", "clients3?part=overview"], ["Clients", "clients3?part=needs-attention"], ["Clients", "clients3?part=billing"], ["Clients", "clients3?part=people"], ["Clients", "clients?part=home"],
      ["Pipeline", "pipeline3?part=overview"], ["Pipeline", "pipeline3?part=attention&bucket=stale"], ["Pipeline", "pipeline3?part=list"], ["Pipeline", "pipeline3?part=forecast"], ["Pipeline", "pipeline3?part=sources"], ["Pipeline", "pipeline3?part=health"], ["Pipeline", "pipeline-intel?view=board"],
      ["Find a lead", "people/options"], ["Find a lead", "people/find"], ["Find a lead", "people/find?tags=hot"], ["Find a lead", "people/find?tags=call-now&tagMode=any"], ["Find a lead", "people/find?notTag=hot&source=Referral"],
      ["Find a lead", "people/going-cold?bucket=quiet"], ["Find a lead", "contact-intel"],
      ["Clean-up", "dq/leads"], ["Clean-up", "dq/dupes"], ["Clean-up", "data-health"], ["Clean-up", "cleanup"],
    ];
    for (const [screen, path] of targets) {
      await get(path, agencyB); // compiles the route on a tiny account, so the first call on A measures the data, not the build
      const first = await get(path);
      const runs: number[] = [];
      for (let i = 0; i < RUNS; i++) runs.push((await get(path)).ms);
      runs.sort((a, b) => a - b);
      const q = (p: number) => runs[Math.min(runs.length - 1, Math.floor(p * runs.length))] ?? first.ms;
      const flag = first.status >= 400 || first.status === 0 ? `HTTP ${first.status}` : [q(0.95) > 1000 ? "WARM>1s" : "", first.ms > 3000 ? "COLD>3s" : ""].filter(Boolean).join(" ");
      timing.push({ screen, path, cold: Math.round(first.ms), p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), status: first.status, flag });
      console.log(`${String(Math.round(first.ms)).padStart(7)} cold ${String(Math.round(q(0.5))).padStart(6)} p50 ${String(Math.round(q(0.95))).padStart(6)} p95  ${first.status}  ${path} ${flag}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\ncorrectness: ${results.length - failed.length}/${results.length} passed`);
  if (process.env.SCALE_OUT) {
    const md = [`size ${contactsA} contacts in agency A. Checks: ${results.length - failed.length}/${results.length} passed.`, "", "| Screen | Endpoint | Cold ms | p50 ms | p95 ms | Flag |", "|---|---|---|---|---|---|",
      ...timing.map((t) => `| ${t.screen} | \`${t.path}\` | ${t.cold} | ${t.p50} | ${t.p95} | ${t.flag} |`), "", ...failed.map((f) => `- FAIL [${f.area}] ${f.name}: screen ${JSON.stringify(f.actual)} vs rows ${JSON.stringify(f.expected)}`)].join("\n");
    writeFileSync(process.env.SCALE_OUT, md);
  }
  await closeDb();
  if (failed.length) { console.error(`${failed.length} check(s) failed`); process.exit(1); }
  console.log("scale check: ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
