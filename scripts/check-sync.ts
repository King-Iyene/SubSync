import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

// Sync freshness over real HTTP (stage S0.4). Two real companies are created in the database (not the demo), with known "last refreshed" times,
// and every answer that carries freshness is asked for: Today, the Overview, the one-line freshness, the Sync status panel and the Slack brief
// text. They must all say the SAME sentence (N74), the sentence must change when data is stale or a refresh failed, a client's staff see only their
// own account's, the panel is refused to them, and the sync-running note shows only for a first or a long-running sync (UX-06). The operator's
// diagnostics and the alarm address open only with the server secret. Everything created is removed.
// Usage: BASE_URL=http://localhost:3100 CRON_SECRET=... node --env-file=.env.local --import tsx scripts/check-sync.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const CRON = process.env.CRON_SECRET;
const MIN = 60_000;

type Side = { company: string; marker: string; inst: string; locs: string[] };

async function main() {
  const call = async (path: string, token: string | null, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
    const text = await res.text();
    let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, body };
  };

  const make = async (key: "a" | "b"): Promise<Side> => {
    const K = key.toUpperCase();
    const company = `xtest-sync-${key}`;
    const marker = `zzSync${K}`;
    await sql()`delete from installations where company_id = ${company}`;
    // No refresh token: the real scheduler and the real alarm only look at installs that have one, so they leave a fixture alone.
    const [inst] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${company}, ${marker + " Agency"}, 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
    const locs = [`xtestSync${K}0001`, `xtestSync${K}0002`];
    const ages = key === "a" ? [7 * MIN + 10_000, 12 * MIN + 10_000] : [3 * MIN + 10_000, 4 * MIN + 10_000];
    for (const [i, loc] of locs.entries()) {
      const t = new Date(Date.now() - ages[i]);
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, conversations_synced_at, last_synced_at) values (${inst.id}, ${loc}, ${`${marker} Account ${i + 1}`}, 'America/New_York', true, ${t}, ${t})`;
    }
    return { company, marker, inst: inst.id as string, locs };
  };
  const session = (side: Side, kind: "agency" | "business" | "client", loc?: string) =>
    signSession({ companyId: side.company, userId: "u-" + kind, role: "admin", userName: "Tester", demo: false, kind, locationId: loc ?? null, dataOwner: false });

  const A = await make("a");
  const B = await make("b");
  const wipeJobs = (s: Side) => sql()`delete from sync_jobs where installation_id = ${s.inst}`;
  try {
    const agencyA = session(A, "agency");
    const bizA = session(A, "business", A.locs[0]);
    const clientA1 = session(A, "client", A.locs[0]);
    const clientA2 = session(A, "client", A.locs[1]);
    const agencyB = session(B, "agency");

    // The sentence every surface says for one session. Asked together; if a minute turns over between two answers the whole set is asked again.
    // A client's staff may call only the freshness line and the Overview, so for them those two are compared; the agency and a business have all five.
    const sentences = async (tok: string, full: boolean) => {
      const [fresh, overview, daily, digest, panel] = await Promise.all([
        call("/api/app/freshness", tok), call("/api/app/overview", tok),
        full ? call("/api/app/daily", tok) : Promise.resolve(null), full ? call("/api/app/digest", tok) : Promise.resolve(null), full ? call("/api/app/sync-status", tok) : Promise.resolve(null),
      ]);
      for (const r of [fresh, overview, daily, digest, panel]) if (r) assert.equal(r.status, 200, r.text.slice(0, 200));
      return {
        freshness: fresh.body.freshness.text as string,
        overview: overview.body.freshness.text as string,
        today: daily ? (daily.body.freshness.text as string) : null,
        brief: digest ? ((digest.body.text as string).match(/_([^_]+)\._/)?.[1] ?? "") : null,
        panel: panel ? (panel.body.freshness.text as string) : null,
        notes: [fresh.body.freshness.syncingNote, overview.body.freshness.syncingNote, daily?.body.freshness.syncingNote ?? null, panel?.body.freshness.syncingNote ?? null].filter((n, i) => i < 2 || full) as Array<string | null>,
      };
    };
    const allSame = async (tok: string, full: boolean, expected: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const s = await sentences(tok, full);
        const values = [s.freshness, s.overview, ...[s.today, s.brief, s.panel].filter((v): v is string => v !== null)];
        if (values.every((v) => v === expected)) return s;
        if (attempt === 2) assert.fail(`the screens disagree: ${JSON.stringify(s)} (wanted "${expected}" everywhere)`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    };

    // 1. A clean agency: the oldest account decides, and every surface says it.
    await wipeJobs(A);
    await allSame(agencyA, true, "Updated 12 min ago");
    // A business or a client inside the first account says that account's own time, in every place.
    await allSame(bizA, true, "Updated 7 min ago");
    await allSame(clientA1, false, "Updated 7 min ago");
    await allSame(clientA2, false, "Updated 12 min ago");
    for (const p of ["/api/app/daily", "/api/app/digest", "/api/app/sync-status"]) assert.equal((await call(p, clientA1)).status, 403, `${p} is not for a client`);
    const other = await call("/api/app/freshness", agencyB);
    assert.equal(other.body.freshness.text, "Updated 4 min ago", "another company's agency sees its own time");
    assert.ok(!other.text.includes(A.marker) && !other.text.includes(A.locs[0]), "and nothing of the first company");
    console.log("one sentence everywhere (Today, Overview, freshness line, Sync status, Slack brief), for agency, business and client: ok");

    // 2. Account names and times are listed per account only for what the person may see.
    const agencyList = (await call("/api/app/freshness", agencyA)).body.freshness.accounts as Array<{ name: string; text: string }>;
    assert.deepEqual(agencyList.map((a) => a.text), ["Updated 7 min ago", "Updated 12 min ago"]);
    const clientList = (await call("/api/app/freshness", clientA1)).body.freshness.accounts as Array<{ name: string }>;
    assert.equal(clientList.length, 1, "a client sees only its own account");
    assert.ok(!(await call("/api/app/freshness", clientA1)).text.includes(`${A.marker} Account 2`), "never the neighbour's name");

    // 3. The panel is for the agency and a business, never for a client's staff.
    assert.equal((await call("/api/app/sync-status", clientA1)).status, 403, "a client is refused the panel");
    assert.equal((await call("/api/app/sync-status", session(B, "client", B.locs[0]))).status, 403);
    const panel = (await call("/api/app/sync-status", agencyA)).body;
    assert.ok(panel.nextRun && /^Next refresh in about/.test(panel.nextRun.text), `next run: ${panel.nextRun?.text}`);
    assert.ok(panel.schedule.length >= 4 && panel.schedule.some((s: string) => /Every 15 minutes/.test(s)));
    assert.equal((await call("/api/app/sync-status", bizA)).body.freshness.accounts.length, 1, "a business sees its own account in the panel");
    console.log("Sync status panel: next run, what runs when, refused to clients, own account only for a business: ok");

    // 4. A sync that has only just started is a normal refresh: no running note anywhere (UX-06). A long one, or a first one, says so.
    await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at) values (${A.inst}, ${A.locs[0]}, 'conversations', 'running', now() - interval '1 minute')`;
    let s = await sentences(agencyA, true);
    assert.deepEqual(s.notes, [null, null, null, null], "a normal refresh in progress shows no 'sync running' note");
    await wipeJobs(A);
    await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at) values (${A.inst}, ${A.locs[0]}, 'contacts', 'running', now() - interval '16 minutes')`;
    s = await sentences(agencyA, true);
    assert.ok(s.notes.every((n) => typeof n === "string" && /has been running for 1[56] minutes/.test(n)), `a long-running sync is said once, the same way: ${JSON.stringify(s.notes)}`);
    await wipeJobs(A);
    console.log("the 'sync running' note: absent for a normal refresh, present for a long one: ok");

    // 5. Stale and failed say so, in the same words on every surface.
    await sql()`update locations set conversations_synced_at = now() - interval '45 minutes', last_synced_at = now() - interval '45 minutes' where installation_id = ${A.inst} and location_id = ${A.locs[1]}`;
    await allSame(agencyA, true, "Updated 45 min ago, refresh is delayed");
    await sql()`update locations set conversations_synced_at = now() - interval '12 minutes' - interval '10 seconds', last_synced_at = now() - interval '12 minutes' - interval '10 seconds' where installation_id = ${A.inst} and location_id = ${A.locs[1]}`;
    await sql()`insert into sync_jobs (installation_id, location_id, type, status, error, created_at, finished_at) values (${A.inst}, ${A.locs[1]}, 'conversations', 'failed', '/conversations/search returned 429 for Bearer abc.def@x.com', now() - interval '1 minute', now() - interval '1 minute')`;
    await allSame(agencyA, true, "Updated 12 min ago, but the latest refresh failed for 1 account");
    const failed = (await call("/api/app/sync-status", agencyA)).body;
    assert.equal(failed.freshness.state, "failing");
    assert.ok(failed.problems.length === 1 && /slow down/.test(failed.problems[0].reason) && failed.problems[0].account === `${A.marker} Account 2`);
    assert.ok(!failed.problems[0].reason.includes("429") && !JSON.stringify(failed).includes("Bearer"), "the reason is plain words, never the raw message");
    assert.equal((await call("/api/app/freshness", clientA1)).body.freshness.state, "fresh", "the neighbour's failure is not shown to the first account's staff");
    const clientView = await call("/api/app/freshness", clientA2);
    assert.equal(clientView.body.freshness.state, "failing");
    assert.ok(!clientView.text.includes("429") && !clientView.text.includes("Bearer"));
    await wipeJobs(A);
    console.log("stale and failed wording is the same on every surface; reasons are plain; a neighbour's failure stays hidden: ok");

    // 6. The operator's addresses open only with the server secret.
    for (const path of ["/api/admin/diagnostics", "/api/cron/watchdog"]) {
      assert.equal((await call(path, null)).status, 401, `${path} without a secret`);
      assert.equal((await call(path, "not-the-secret")).status, 401, `${path} with a wrong secret`);
      assert.equal((await call(path, agencyA)).status, 401, `${path} with an agency owner's session`);
      assert.equal((await call(path, clientA1)).status, 401, `${path} with a client's session`);
    }
    if (CRON) {
      const d = await call("/api/admin/diagnostics", CRON);
      assert.equal(d.status, 200);
      assert.ok(Array.isArray(d.body.installations) && d.body.installations.length > 0 && typeof d.body.alarms === "number" && Array.isArray(d.body.webhookEvents3d));
      for (const i of d.body.installations) assert.ok(typeof i.verdict.state === "string" && typeof i.freshness === "string" && i.installation.length === 8);
      assert.ok(!d.text.includes("xtest") && !d.text.includes("zzSync"), "the fixture (no refresh token) is not a real install and is not listed");
      const w = await call("/api/cron/watchdog", CRON);
      assert.equal(w.status, 200);
      assert.ok(typeof w.body.checked === "number");
      console.log(`diagnostics and alarm addresses: secret only; ${d.body.installations.length} real installs listed, ${d.body.alarms} alarms now; watchdog checked ${w.body.checked}: ok`);
    } else {
      console.log("diagnostics: refusals checked; CRON_SECRET not set for this run, so the authorised answer was not checked");
    }

    console.log("sync freshness: one sentence on every surface, stale and failed wording, running note rules, client privacy, operator addresses: ok");
  } finally {
    await sql()`delete from installations where company_id in ('xtest-sync-a', 'xtest-sync-b')`;
    await closeDb();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
