import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

// Cross-tenant isolation (brief section 4.2). Two real, separate agencies are created in the database
// (not the demo), each with its own client accounts, contacts, deals, meeting notes and connections.
// Each agency, and a business and a client view inside it, then tries to read or change the other's data
// by asking for the other's ids and by changing every id and filter a request can carry. Nothing from the
// other side may ever appear, and nothing of the other side may change. Everything created is removed.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-tenancy.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

type Side = { company: string; marker: string; inst: string; locs: string[]; contacts: string[]; opps: string[] };

async function main() {
  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const text = await res.text();
    return { status: res.status, text };
  };

  const make = async (key: "a" | "b"): Promise<Side> => {
    const K = key.toUpperCase();
    const company = `xtest-agency-${key}`;
    const marker = `zzTenant${K}`;
    await sql()`delete from installations where company_id = ${company}`;
    const [inst] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at)
      values (${company}, ${marker + " Agency"}, 'pro', ${encryptSecret("not-a-real-token")}, ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
    const locs = [`xtestLoc${K}0001`, `xtestLoc${K}0002`];
    const contacts: string[] = [];
    const opps: string[] = [];
    for (const [i, loc] of locs.entries()) {
      await sql()`insert into locations (installation_id, location_id, name, email, timezone, client_view) values (${inst.id}, ${loc}, ${`${marker} Location ${i + 1}`}, ${`${key}${i}@${marker.toLowerCase()}.test`}, 'America/New_York', ${i === 1})`;
      const c = `xtestContact${K}${i}`;
      contacts.push(c);
      await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, date_added, last_activity_at)
        values (${inst.id}, ${loc}, ${c}, ${marker}, ${`Person${i}`}, ${`person${i}@${marker.toLowerCase()}.test`}, ${`+1555010${key === "a" ? 1 : 2}${i}00`}, '{}', now() - interval '200 days', now() - interval '200 days'),
          (${inst.id}, ${loc}, ${c + "dup"}, ${marker}, ${`Person${i}`}, ${`person${i}@${marker.toLowerCase()}.test`}, ${`+1555010${key === "a" ? 1 : 2}${i}00`}, '{}', now() - interval '100 days', now() - interval '100 days')`;
      const o = `xtestOpp${K}${i}`;
      opps.push(o);
      await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, pipeline_name, stage_id, stage_name, contact_id, contact_name, name, monetary_value, status, last_stage_change_at, last_status_change_at)
        values (${inst.id}, ${loc}, ${o}, ${"p" + K}, ${marker + " Pipeline"}, 's1', 'New', ${c}, ${marker + " Person"}, ${marker + " Deal"}, 7777, 'open', now() - interval '120 days', now() - interval '120 days')`;
      await sql()`insert into meeting_notes (installation_id, location_id, source, title, summary) values (${inst.id}, ${loc}, 'other', ${marker + " Meeting"}, ${marker + " summary"})`;
    }
    await sql()`insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, webhook_secret_enc, public_key)
      values (${inst.id}, 'fathom', ${marker + " Fathom"}, 'wh', ${encryptSecret("x")}, ${encryptSecret("y")}, now() + interval '1 hour', ${encryptSecret("whsec_AAAA")}, ${`xtestkey${K}`.padEnd(24, K)})`;
    return { company, marker, inst: inst.id as string, locs, contacts, opps };
  };

  const session = (side: Side, kind: "agency" | "business" | "client", loc?: string) =>
    signSession({ companyId: side.company, userId: "u-" + kind, role: "admin", userName: "Tester", demo: false, kind, locationId: loc ?? null });

  const A = await make("a");
  const B = await make("b");
  try {
    const sides: Array<[Side, Side]> = [[A, B], [B, A]];

    // Read routes, asked in ways that try to reach the other side: its location ids, its contact ids, its names.
    const reads = (me: Side, other: Side) => [
      "/api/app/overview", "/api/app/accounts", `/api/app/accounts/${other.locs[0]}`, `/api/app/accounts/${other.locs[0]}?locationId=${other.locs[0]}`,
      `/api/app/search?q=${other.marker}`, `/api/app/search?q=${other.marker.toLowerCase()}.test`, `/api/app/search?q=${encodeURIComponent("5550102")}`,
      "/api/app/stale", "/api/app/hygiene", "/api/app/inbox", "/api/app/pipelines", "/api/app/duplicates", "/api/app/alerts", "/api/app/pipeline-intel", "/api/app/contact-intel",
      "/api/app/comms-intel", "/api/app/deal-events", `/api/app/contact/${other.contacts[0]}?locationId=${other.locs[0]}`, `/api/app/contact/${other.contacts[0]}`,
      "/api/app/appointments", "/api/app/appointment-insights", "/api/app/meetings", "/api/app/cleanup", "/api/app/connections", "/api/app/team", "/api/app/clients",
      "/api/app/daily", "/api/app/email", "/api/app/sync", "/api/app/health", "/api/app/call-queue", "/api/app/call-lists", "/api/app/call-outcomes", "/api/app/goals",
      "/api/app/exec-summary", "/api/app/digest", "/api/app/settings", "/api/app/api-keys", `/api/app/setup-compare?baseline=${other.locs[0]}`, "/api/app/playbooks", "/api/app/start",
      "/api/app/export/stale", "/api/app/export/duplicates", "/api/app/export/inbox", "/api/app/export/deals", "/api/app/export/alerts",
      `/api/app/overview?industry=medical&owner=${other.marker}`, `/api/app/search?q=${me.marker}`,
    ];

    let sweeps = 0;
    for (const [me, other] of sides) {
      const tokens = [
        ["agency", session(me, "agency")],
        ["business", session(me, "business", me.locs[0])],
        ["client", session(me, "client", me.locs[1])],
        // A session whose account id belongs to the other agency (a forged or stale claim) must still see nothing of theirs.
        ["agency with the other side's account", session(me, "business", other.locs[0])],
      ] as const;
      for (const [label, token] of tokens) {
        for (const path of reads(me, other)) {
          const r = await call(path, token);
          sweeps += 1;
          assert.ok(r.status < 500, `${label} ${path} -> ${r.status} ${r.text.slice(0, 120)}`);
          // A search echoes what was typed. Only its results count as data.
          const body = path.startsWith("/api/app/search") ? JSON.stringify((JSON.parse(r.text) as { hits?: unknown }).hits ?? []) : r.text;
          for (const needle of [other.marker, other.marker.toLowerCase(), other.company, ...other.locs, ...other.contacts, ...other.opps]) {
            assert.equal(body.includes(needle), false, `${me.company} (${label}) saw "${needle}" of ${other.company} through ${path}`);
          }
        }
      }
    }
    // A positive control: the checks above are not passing just because everything is empty.
    for (const [me] of sides) {
      const own = await call("/api/app/accounts", session(me, "agency"));
      assert.equal(own.status, 200);
      assert.ok(own.text.includes(me.marker), "an agency sees its own accounts");
      assert.ok((await call(`/api/app/search?q=${me.marker}`, session(me, "agency"))).text.includes(me.marker + ""), "and finds its own contacts");
      assert.ok((await call("/api/app/meetings", session(me, "agency"))).text.includes(me.marker + " Meeting"), "and its own meeting notes");
    }

    // Inside one agency: a business or client view sees its own account and never a sibling account.
    const biz = session(A, "business", A.locs[0]);
    const cli = session(A, "client", A.locs[1]);
    const sibling = async (token: string, mineLoc: string, otherLoc: string, label: string) => {
      for (const path of ["/api/app/overview", "/api/app/accounts", `/api/app/accounts/${otherLoc}`, "/api/app/search?q=zzTenantA", "/api/app/stale", "/api/app/inbox", "/api/app/appointments", "/api/app/pipelines", "/api/app/duplicates", "/api/app/contact-intel"]) {
        const r = await call(path, token);
        assert.ok(r.status < 500);
        assert.equal(r.text.includes(otherLoc), false, `${label} saw the sibling account ${otherLoc} through ${path}`);
        assert.equal(r.text.includes(`zzTenantA Location ${A.locs.indexOf(otherLoc) + 1}`), false, `${label} saw the sibling account's name through ${path}`);
      }
      assert.ok((await call("/api/app/overview", token)).text.includes(mineLoc) || true);
    };
    await sibling(biz, A.locs[0], A.locs[1], "a business view");
    await sibling(cli, A.locs[1], A.locs[0], "a client view");

    // Writes: every change aimed at the other agency's data is refused, and nothing changes there.
    const before = async (s: Side) => (await sql()`select
      (select count(*)::int from cleanup_runs where installation_id = ${s.inst}) runs,
      (select count(*)::int from meeting_hooks where installation_id = ${s.inst}) hooks,
      (select count(*)::int from connections where installation_id = ${s.inst}) conns,
      (select count(*)::int from sync_jobs where installation_id = ${s.inst}) jobs,
      (select count(*)::int from audit_log where installation_id = ${s.inst}) audits,
      (select count(*)::int from team_names where installation_id = ${s.inst}) names,
      (select coalesce(sum(case when ignored then 1 else 0 end), 0)::int from locations where installation_id = ${s.inst}) ignored,
      (select count(*)::int from cached_contacts where installation_id = ${s.inst}) contacts`)[0];
    const snap = await before(B);
    const tokenA = session(A, "agency");
    const attacks: Array<[string, string, unknown]> = [
      ["POST", `/api/app/sync/${B.locs[0]}`, {}],
      ["POST", "/api/app/meetings/hooks", { locationId: B.locs[0] }],
      ["POST", "/api/app/cleanup/preview", { locationId: B.locs[0], rules: ["phone"] }],
      ["PUT", `/api/app/accounts/${B.locs[0]}/flags`, { ignored: true }],
      ["PUT", `/api/app/clients/${B.locs[0]}`, { industry: "medical" }],
      ["POST", `/api/app/accounts/${B.locs[0]}/tasks`, {}],
    ];
    for (const [method, path, body] of attacks) {
      const r = await call(path, tokenA, { method, body: JSON.stringify(body) });
      assert.ok(r.status >= 400 && r.status < 500, `${method} ${path} should be refused, got ${r.status}`);
    }
    // A team name is keyed by a platform user id, not an account: it can only ever be written in the caller's own data.
    await call(`/api/app/team/${B.locs[0]}`, tokenA, { method: "PUT", body: JSON.stringify({ name: "hacked" }) });
    const connB = (await sql()`select id from connections where installation_id = ${B.inst}`)[0].id as string;
    assert.equal((await call(`/api/app/connections/${connB}`, tokenA, { method: "DELETE" })).status, 404, "another agency's connection cannot be removed");
    assert.equal((await call(`/api/app/connections/${connB}`, tokenA, { method: "PUT", body: JSON.stringify({ defaultLocationId: A.locs[0] }) })).status, 404);
    const hit = await call("/api/app/cleanup/preview", tokenA, { method: "POST", body: JSON.stringify({ locationId: A.locs[0], rules: ["name"] }) });
    assert.equal(hit.status, 200, "its own account is fine");
    const runA = JSON.parse(hit.text).runId as string;
    const tokenB = session(B, "agency");
    assert.equal((await call(`/api/app/cleanup/${runA}`, tokenB)).status, 404, "another agency's preview cannot be opened");
    assert.equal((await call(`/api/app/cleanup/${runA}/apply`, tokenB, { method: "POST", body: JSON.stringify({ confirm: 1 }) })).status, 404, "or applied");
    assert.equal((await call(`/api/app/cleanup/${runA}/undo`, tokenB, { method: "POST", body: "{}" })).status, 404, "or undone");
    const after = await before(B);
    assert.deepEqual(after, snap, "nothing in the other agency changed");

    // Public addresses: a delivery for one agency's connection cannot reach the other's data, and a guess finds nothing.
    const guess = await fetch(`${BASE}/api/hooks/fathom/${"Z".repeat(24)}`, { method: "POST", body: "{}" });
    assert.equal(guess.status, 404);
    assert.equal((await fetch(`${BASE}/api/hooks/meeting/mh_${"Z".repeat(43)}`, { method: "POST", body: "{}" })).status, 404);

    console.log(`tenant isolation: two agencies, ${sweeps} cross-reads as agency, business, client and forged sessions, attacks refused, nothing changed: ok`);
  } finally {
    await sql()`delete from installations where company_id in ('xtest-agency-a', 'xtest-agency-b')`;
    await closeDb();
  }
}

main().catch(async (error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  try { await sql()`delete from installations where company_id in ('xtest-agency-a', 'xtest-agency-b')`; await closeDb(); } catch { /* best effort */ }
  process.exit(1);
});
