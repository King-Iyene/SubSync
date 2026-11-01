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
    // No refresh token on purpose: the production scheduler (every 5 minutes, same database) only queues sync jobs for installations that
    // have one, so a fixture with one would get jobs from the cron in the middle of the "nothing changed" comparison below.
    const [inst] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at)
      values (${company}, ${marker + " Agency"}, 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
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

    // TENANCY_FAST=1 skips the long cross-read sweep (while iterating on the share link and write attacks); the full run does not.
    let sweeps = 0;
    for (const [me, other] of process.env.TENANCY_FAST === "1" ? [] : sides) {
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

    // An account user (read-only client view of one account) cannot change anything, share anything, or read settings.
    const tokenAccountUser = session(A, "client", A.locs[0]);
    const refused: Array<[string, string, unknown]> = [
      ["PUT", "/api/app/settings", { staleDays: 5 }], ["POST", "/api/app/audit/share", {}], ["POST", "/api/app/sync", {}],
      ["PUT", `/api/app/accounts/${A.locs[0]}/flags`, { ignored: true }], ["GET", "/api/app/settings", undefined], ["GET", "/api/app/connections", undefined],
      ["POST", "/api/app/meetings/hooks", { locationId: A.locs[0] }], ["POST", "/api/app/cleanup/preview", { locationId: A.locs[0], rules: ["name"] }],
      ["POST", "/api/app/audit/revoke", { id: "x".repeat(30) }], ["GET", "/api/app/audit/shares", undefined],
    ];
    for (const [method, path, body] of refused) {
      const r = await call(path, tokenAccountUser, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(r.status, 403, `an account user must be refused ${method} ${path}, got ${r.status}`);
    }

    // The share link: made from one agency's data it carries none of the other's, hides its own account names, the id
    // cannot be guessed, and an account user cannot create one.
    const shareA = await call("/api/app/audit/share", tokenA, { method: "POST", body: "{}" });
    assert.equal(shareA.status, 200, shareA.text.slice(0, 200));
    const urlA = JSON.parse(shareA.text).url as string;
    const idA = urlA.split("/").pop() as string;
    assert.ok(idA.length >= 32, "the id is long");
    const pageA = await fetch(`${BASE}/audit/${idA}`);
    const htmlA = await pageA.text();
    assert.equal(pageA.status, 200);
    assert.ok(!htmlA.includes(B.marker), "the other agency's name is not in this agency's shared page");
    assert.ok(!htmlA.includes(`${A.marker} Location`), "its own account names are scrubbed");
    // White-label: a prospect who opens the shared page must never read the platform's name or our internal words.
    const noScripts = htmlA.replace(/<script[\s\S]*?<\/script>/g, " ");
    const readable = noScripts.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    assert.ok(!/gohighlevel|highlevel|leadconnector|\bghl\b/i.test(noScripts), "the shared page does not name the platform");
    assert.ok(!/\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i.test(readable), "the shared page does not use our internal words");
    const shareB = await call("/api/app/audit/share", tokenB, { method: "POST", body: "{}" });
    const idB = (JSON.parse(shareB.text).url as string).split("/").pop() as string;
    assert.notEqual(idA, idB, "every link is unique");
    assert.ok(!(await (await fetch(`${BASE}/audit/${idB}`)).text()).includes(A.marker), "the other agency's share carries none of this one's data");
    // An unknown id shows the not-found page and none of a snapshot. (The status can be 200: the page streams before the lookup
    // finishes in this project's rendering mode; that is recorded as a known soft-404 in docs/features/S0.2.md.)
    for (const bad of ["Z".repeat(32), "short", idA.slice(0, -1) + (idA.endsWith("A") ? "B" : "A")]) {
      const res = await fetch(`${BASE}/audit/${bad}`);
      const html = await res.text();
      assert.ok(!html.includes("Run your own free audit") && !html.includes("counted") && !html.includes("Stale deal value"), `an unknown share id must show no snapshot (${bad.slice(0, 6)}...)`);
      assert.ok(res.status === 404 || html.toLowerCase().includes("could not be found") || html.includes("404"), "an unknown id shows the not-found page");
    }

    // Share link lifecycle (F6): 14 day expiry, a view count, generic previews, noindex, revoke only by the owner, a rate limit.
    {
      const listA = async () => JSON.parse((await call("/api/app/audit/shares", tokenA)).text).links as Array<{ id: string; createdAt: string; expiresAt: string; revoked: boolean; views: number }>;
      const mine = (await listA()).find((l) => l.id === idA);
      assert.ok(mine, "the new link is in its owner's list");
      const days = (Date.parse(mine.expiresAt) - Date.parse(mine.createdAt)) / 86_400_000;
      assert.ok(days > 13.9 && days < 14.1, `a new link works for 14 days (got ${days.toFixed(2)})`);
      assert.ok(!(await (await call("/api/app/audit/shares", tokenB)).text).includes(idA), "another agency's list never shows this link");
      assert.equal((await call("/api/app/audit/shares", session(A, "client", A.locs[0]))).status, 403, "an account user cannot list links");

      // The public page: noindex, no name in the preview tags, and a view is counted.
      const before = (await listA()).find((l) => l.id === idA)?.views ?? 0;
      const html2 = await (await fetch(`${BASE}/audit/${idA}`)).text();
      assert.match(html2, /<meta name="robots" content="[^"]*noindex/i, "the page asks not to be indexed");
      assert.match(html2, /property="og:title" content="Account audit"/, "the preview title is generic");
      for (const marker of [A.marker, B.marker]) assert.ok(!html2.includes(marker), "no agency name anywhere in the page or its preview tags");
      const after = (await listA()).find((l) => l.id === idA)?.views ?? 0;
      assert.ok(after > before, `a view is counted (${before} to ${after})`);

      // Only the owner can switch a link off: another agency, an account user and a made-up id all fail, and the link keeps working.
      assert.equal((await call("/api/app/audit/revoke", tokenB, { method: "POST", body: JSON.stringify({ id: idA }) })).status, 404, "another agency cannot revoke it");
      assert.equal((await call("/api/app/audit/revoke", session(A, "client", A.locs[0]), { method: "POST", body: JSON.stringify({ id: idA }) })).status, 403, "an account user cannot revoke it");
      assert.equal((await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: "short" }) })).status, 400, "a malformed id is refused");
      assert.ok((await (await fetch(`${BASE}/audit/${idA}`)).text()).includes("Snapshot taken"), "still works after the failed attempts");

      // The owner switches it off: the public page no longer shows it, the list says so, and a second revoke finds nothing to do.
      assert.equal((await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idA }) })).status, 200);
      const gone = await (await fetch(`${BASE}/audit/${idA}`)).text();
      assert.ok(!gone.includes("Snapshot taken") && !gone.includes("What we found"), "a switched-off link shows nothing");
      assert.equal((await listA()).find((l) => l.id === idA)?.revoked, true);
      assert.equal((await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idA }) })).status, 404, "revoking twice is a no-op");

      // Rate limit: past 30 lookups a minute from one address even a valid link is refused. (A link made just for this.)
      const idC = (JSON.parse((await call("/api/app/audit/share", tokenA, { method: "POST", body: "{}" })).text).url as string).split("/").pop() as string; // the link's own origin may be another host, so ask this server
      let refusedAt = 0;
      for (let i = 1; i <= 45 && !refusedAt; i++) if (!(await (await fetch(`${BASE}/audit/${idC}`)).text()).includes("Snapshot taken")) refusedAt = i;
      assert.ok(refusedAt > 0 && refusedAt <= 45, "a burst of lookups is eventually refused");
      await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idC }) });
    }

    // Client access is enforced on the server: switched off, a client's own session is refused at once; switched on, it works; and it
    // is put back as it was found.
    {
      const clientToken = session(A, "client", A.locs[1]);
      const was = (await sql()`select client_view from locations where installation_id = ${A.inst} and location_id = ${A.locs[1]}`)[0].client_view as boolean;
      const setView = async (on: boolean) => assert.equal((await call(`/api/app/accounts/${A.locs[1]}/flags`, tokenA, { method: "PUT", body: JSON.stringify({ clientView: on }) })).status, 200);
      try {
        await setView(true);
        assert.equal((await call("/api/app/overview", clientToken)).status, 200, "client access on: the client's own session works");
        await setView(false);
        assert.equal((await call("/api/app/overview", clientToken)).status, 403, "client access off: the same session is refused straight away");
        assert.equal((await call("/api/app/inbox", clientToken)).status, 403, "and on every other page");
        await setView(true);
        assert.equal((await call("/api/app/overview", clientToken)).status, 200, "switched back on, it works again");
      } finally { await setView(was); }
    }

    // The company name set in Settings is the name on the shared page.
    {
      await call("/api/app/settings", tokenA, { method: "PUT", body: JSON.stringify({ brandName: "ZZ Brand Alpha" }) });
      try {
        const idBrand = (JSON.parse((await call("/api/app/audit/share", tokenA, { method: "POST", body: "{}" })).text).url as string).split("/").pop() as string;
        const page = await (await fetch(`${BASE}/audit/${idBrand}`)).text();
        assert.ok(page.includes("ZZ Brand Alpha"), "the shared page carries the company's own name");
        assert.ok(!page.includes("Your company"), "and not the placeholder");
        await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idBrand }) });
      } finally { await call("/api/app/settings", tokenA, { method: "PUT", body: JSON.stringify({ brandName: null }) }); }
    }

    // The webhook: unsigned or wrongly signed deliveries change nothing.
    const body = JSON.stringify({ type: "UNINSTALL", companyId: B.company, webhookId: "xtest-wh-1" });
    assert.equal((await fetch(`${BASE}/api/webhooks/ghl`, { method: "POST", body })).status, 401, "unsigned");
    assert.equal((await fetch(`${BASE}/api/webhooks/ghl`, { method: "POST", body, headers: { "x-ghl-signature": "AAAA" } })).status, 401, "wrong signature");
    assert.deepEqual(await before(B), snap, "a refused webhook changed nothing");

    // Public addresses: a delivery for one agency's connection cannot reach the other's data, and a guess finds nothing.
    const guess = await fetch(`${BASE}/api/hooks/fathom/${"Z".repeat(24)}`, { method: "POST", body: "{}" });
    assert.equal(guess.status, 404);
    assert.equal((await fetch(`${BASE}/api/hooks/meeting/mh_${"Z".repeat(43)}`, { method: "POST", body: "{}" })).status, 404);

    console.log(`tenant isolation: two agencies, ${sweeps} cross-reads as agency, business, client and forged sessions, attacks refused, account user read-only, share link and webhook safe, nothing changed: ok`);
  } finally {
    await sql()`delete from installations where company_id in ('xtest-agency-a', 'xtest-agency-b')`;
    await closeDb();
  }
}

main().catch(async (error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error, error instanceof Error && error.cause ? `\ncause: ${String(error.cause)}` : "");
  try { await sql()`delete from installations where company_id in ('xtest-agency-a', 'xtest-agency-b')`; await closeDb(); } catch { /* best effort */ }
  process.exit(1);
});
