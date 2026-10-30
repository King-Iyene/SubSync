import assert from "node:assert/strict";
import { closeDb, sql } from "../src/lib/db";

// End-to-end check of the HTTP API against a running dev server in demo mode.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-api.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const call = async (path: string, init: RequestInit & { token?: string | null } = {}) => {
    const { token, ...rest } = init;
    const res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : await res.text() };
  };

  // --- sign-in
  const sso = await call("/api/sso", { method: "POST", body: JSON.stringify({ demo: true }) });
  assert.equal(sso.status, 200, JSON.stringify(sso.body));
  const token = sso.body.session as string;
  assert.ok(token && sso.body.demo === true);
  console.log("sign-in (demo): ok");


  assert.equal((await call("/api/app/overview")).status, 401, "no token is refused");
  assert.equal((await call("/api/app/overview", { token: token.slice(0, -3) + "xyz" })).status, 401, "tampered token is refused");
  const [b64] = token.split(".");
  assert.equal((await call("/api/app/overview", { token: `${b64}.${"A".repeat(43)}` })).status, 401, "forged signature is refused");
  assert.equal((await call("/api/cron/sync")).status, 401, "cron needs its secret");
  assert.equal((await call("/api/webhooks/ghl", { method: "POST", body: JSON.stringify({ type: "AppUninstall", companyId: "demo-agency" }) })).status, 401, "unsigned webhook refused");
  console.log("auth guards: ok");

  // --- overview
  const ov = await call("/api/app/overview", { token });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.kpis.accounts, 13, "13 live accounts (1 ignored)");
  assert.equal(ov.body.kpis.ignored, 1);
  assert.ok(ov.body.kpis.dormant >= 2 && ov.body.kpis.staleValue > 50000 && ov.body.kpis.openAlerts > 5);
  assert.ok(ov.body.attention.length > 0 && ov.body.attention.every((x: { url: string }) => x.url.startsWith("https://app.gohighlevel.com/v2/location/")));
  assert.equal(Object.values(ov.body.bands as Record<string, number>).reduce((a, b) => a + b, 0), 13);
  console.log(`overview: ok (avg score ${ov.body.kpis.avgScore}, ${ov.body.kpis.openAlerts} alerts, $${Math.round(ov.body.kpis.staleValue)} stale)`);

  // --- accounts
  const acc = await call("/api/app/accounts", { token });
  assert.equal(acc.body.accounts.length, 14);
  const summit = acc.body.accounts.find((a: { name: string }) => a.name === "Summit HVAC Services");
  assert.equal(summit.dormant, true);
  const roofing = acc.body.accounts.find((a: { name: string }) => a.name === "Sunrise Roofing Co");
  const detail = await call(`/api/app/accounts/${roofing.locationId}`, { token });
  assert.equal(detail.status, 200);
  assert.ok(detail.body.trend.length >= 30 && detail.body.checklist.items.length >= 10 && detail.body.breakdown.components.length === 5);
  assert.ok(detail.body.staleDeals.length > 0);
  assert.equal((await call("/api/app/accounts/nope-nope-nope-nope", { token })).status, 404);
  assert.equal((await call("/api/app/accounts/bad%20id!", { token })).status, 404, "bad ids never reach SQL");
  console.log("accounts + detail: ok");

  // --- search
  const s1 = await call("/api/app/search?q=ava", { token });
  assert.equal(s1.status, 200);
  assert.ok(s1.body.hits.length > 0 && s1.body.hits[0].url.includes("/contacts/detail/"));
  assert.equal((await call("/api/app/search?q=a", { token })).body.hits.length, 0);
  assert.equal((await call("/api/app/search?q=ava&location=bad%20loc", { token })).status, 400);
  const inj = await call(`/api/app/search?q=${encodeURIComponent("x'; drop table cached_contacts;--")}`, { token });
  assert.equal(inj.status, 200, "SQL injection attempt is just a harmless string");
  assert.equal((await call("/api/app/search?q=ava", { token })).status, 200, "table still exists");
  console.log("search: ok");

  // --- views
  const st = await call("/api/app/stale?days=45", { token });
  assert.ok(st.body.deals.length > 0 && st.body.deals.every((d: { daysStale: number }) => d.daysStale >= 45) && st.body.totalValue > 0);
  const ib = await call("/api/app/inbox", { token });
  assert.ok(ib.body.items.length > 0 && ib.body.overSla >= 7 && ib.body.items[0].overSla);
  const pl = await call("/api/app/pipelines", { token });
  assert.ok(pl.body.stages.length >= 5 && pl.body.accounts.length >= 12 && pl.body.totals.open > 0);
  const du = await call("/api/app/duplicates", { token });
  assert.ok(du.body.groups.length > 0 && du.body.groups[0].contacts[0].url.includes("/contacts/detail/"));
  const em = await call("/api/app/email", { token });
  assert.ok(em.body.checks.length >= 6 && em.body.checks.some((c: { status: string }) => c.status === "critical"));
  const al = await call("/api/app/alerts", { token });
  assert.ok(al.body.alerts.length > 5 && al.body.alerts.every((a: { title: string }) => a.title.length > 0));
  console.log("stale / inbox / pipelines / duplicates / email / alerts: ok");

  // --- email check (demo uses canned results, never the network)
  const bad = await call("/api/app/email/check", { method: "POST", token, body: JSON.stringify({ domains: ["not a domain"] }) });
  assert.equal(bad.status, 400);
  const chk = await call("/api/app/email/check", { method: "POST", token, body: JSON.stringify({ domains: ["Example-Demo.com", "http://www.other-demo.org/x"] }) });
  assert.equal(chk.status, 200);
  assert.equal(chk.body.checked.length, 2);
  console.log("email check: ok");

  // --- settings
  const gs = await call("/api/app/settings", { token });
  assert.equal(gs.body.settings.dormantDays, 30);
  assert.ok(!JSON.stringify(gs.body).includes("hooks.slack.com"), "webhook url is never returned");
  const put = (b: unknown) => call("/api/app/settings", { method: "PUT", token, body: JSON.stringify(b) });
  assert.equal((await put({ staleDays: 3 })).status, 400);
  assert.equal((await put({ slaHours: 500 })).status, 400);
  assert.equal((await put({ slackWebhookUrl: "https://evil.example.com/services/x" })).status, 400);
  assert.equal((await put({ customChecklist: ["a".repeat(81)] })).status, 400);
  assert.equal((await put({ appDomain: "not a domain" })).status, 400);
  const ok = await put({ slaHours: 6, customChecklist: ["Send welcome gift", "Collect testimonial"] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.slaHours, 6);
  assert.deepEqual(ok.body.settings.customChecklist, ["Send welcome gift", "Collect testimonial"]);
  await put({ slaHours: 4, customChecklist: [] });
  console.log("settings + validation: ok");

  // --- account controls
  const flag = (b: unknown) => call(`/api/app/accounts/${roofing.locationId}/flags`, { method: "PUT", token, body: JSON.stringify(b) });
  assert.equal((await flag({ ignored: true })).status, 200);
  assert.equal((await call("/api/app/overview", { token })).body.kpis.accounts, 12, "ignoring an account removes it from the totals");
  assert.equal((await flag({ ignored: false, owner: "Taylor" })).status, 200);
  assert.equal((await flag({ owner: "x".repeat(61) })).status, 400);
  assert.equal((await call("/api/app/overview", { token })).body.kpis.accounts, 13);
  const task = (b: unknown) => call(`/api/app/accounts/${roofing.locationId}/tasks`, { method: "PUT", token, body: JSON.stringify(b) });
  assert.equal((await task({ task: "bogus", done: true })).status, 400);
  assert.equal((await task({ task: "manual:kickoff", done: true })).status, 200);
  const d2 = await call(`/api/app/accounts/${roofing.locationId}`, { token });
  assert.equal(d2.body.checklist.items.find((i: { key: string }) => i.key === "manual:kickoff").status, "done");
  await task({ task: "manual:kickoff", done: false });
  const dis = await call(`/api/app/alerts/${al.body.alerts[0].id}/dismiss`, { method: "POST", token });
  assert.equal(dis.status, 200);
  await call("/api/app/sync", { method: "POST", token }); // recomputes alerts, which re-raises it
  console.log("account controls: ok");

  // --- exports
  for (const kind of ["accounts", "stale", "duplicates", "inbox", "alerts"]) {
    const r = await call(`/api/app/export/${kind}`, { token });
    assert.equal(r.status, 200, kind);
    assert.ok(String(r.headers.get("content-type")).startsWith("text/csv"));
    assert.ok(String(r.headers.get("content-disposition")).includes(".csv"));
    assert.ok((r.body as string).split("\r\n").length > 2, `${kind} has rows`);
    assert.ok(!/(^|\r\n)[=+\-@]/.test((r.body as string).split("\r\n").slice(1).join("\r\n")), "no formula injection");
  }
  assert.equal((await call("/api/app/export/secrets", { token })).status, 404);
  assert.equal((await call("/api/app/settings/test-slack", { method: "POST", token })).status, 400, "no webhook configured");
  const dg = await call("/api/app/digest", { token });
  assert.match(dg.body.text, /Demo Agency/);
  console.log("exports + digest: ok");

  // --- hygiene + keys + AI connector
  const hy = await call("/api/app/hygiene", { token });
  assert.ok(hy.body.accounts.length > 0 && hy.body.totals.open > 0);
  assert.equal((await call("/api/app/api-keys", { method: "POST", token, body: JSON.stringify({ name: "" }) })).status, 400);
  const made = await call("/api/app/api-keys", { method: "POST", token, body: JSON.stringify({ name: "check-api" }) });
  assert.equal(made.status, 200);
  const apiKey = made.body.key as string;
  assert.ok(apiKey.startsWith("sk_subsync_"));
  const listed = await call("/api/app/api-keys", { token });
  assert.ok(listed.body.keys.some((k: { id: string }) => k.id === made.body.row.id));
  assert.ok(!JSON.stringify(listed.body).includes(apiKey), "the key is never shown again");
  assert.equal((await call(`/api/app/api-keys/not-a-uuid/revoke`, { method: "POST", token })).status, 404);

  const mcp = (body: unknown, key: string | null = apiKey) => call("/api/mcp", { method: "POST", token: key, body: JSON.stringify(body) });
  assert.equal((await call("/api/mcp")).status, 405);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 1, method: "ping" }, null)).status, 401);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 1, method: "ping" }, "sk_subsync_" + "x".repeat(43))).status, 401);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 1, method: "ping" }, token)).status, 401, "a session token is not an API key");
  const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, "subsync");
  assert.equal((await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const tl = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(tl.body.result.tools.length >= 7);
  const call1 = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });
    assert.equal(r.status, 200);
    return r.body.result as { isError?: boolean; content: Array<{ text: string }> };
  };
  const ps = JSON.parse((await call1("portfolio_summary")).content[0].text);
  assert.equal(ps.clientAccounts, 13);
  assert.ok(ps.dormantAccounts.includes("Summit HVAC Services"));
  const la = JSON.parse((await call1("list_accounts", { filter: "dormant" })).content[0].text);
  assert.ok(la.length >= 2 && la.every((a: { dormant: boolean }) => a.dormant));
  const ga = JSON.parse((await call1("get_account", { name: "sunrise" })).content[0].text);
  assert.equal(ga.name, "Sunrise Roofing Co");
  assert.equal(ga.scoreBreakdown.length, 5);
  assert.equal((await call1("get_account", { name: "zzzz-nothing" })).isError, true);
  assert.equal((await call1("search_contacts", { query: "a" })).isError, true);
  const sc = JSON.parse((await call1("search_contacts", { query: "walker" })).content[0].text);
  assert.ok(sc.length > 0 && sc.length <= 20);
  const sd = JSON.parse((await call1("list_stale_deals", { limit: 5, min_days: 45 })).content[0].text);
  assert.ok(sd.length === 5 && sd.every((d: { daysStale: number }) => d.daysStale >= 45));
  assert.ok(JSON.parse((await call1("list_waiting_conversations")).content[0].text).length >= 7);
  assert.ok(JSON.parse((await call1("list_alerts", { severity: "critical" })).content[0].text).every((a: { severity: string }) => a.severity === "critical"));
  assert.equal((await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "drop_tables" } })).body.error.code, -32602);

  assert.equal((await call(`/api/app/api-keys/${made.body.row.id}/revoke`, { method: "POST", token })).status, 200);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 401, "a revoked key stops working at once");
  console.log("hygiene + api keys + AI connector: ok");

  // --- health + per-account resync
  const hl = await call("/api/app/health", { token });
  assert.equal(hl.status, 200);
  assert.equal(hl.body.level, "healthy");
  assert.ok(hl.body.accounts.length >= 13);
  assert.equal((await call(`/api/app/sync/${hl.body.accounts[0].locationId}`, { method: "POST", token })).status, 200);
  assert.equal((await call("/api/app/sync/not valid!", { method: "POST", token })).status, 404);
  console.log("health + resync: ok");

  // --- pipeline intelligence + goals
  const pi = await call("/api/app/pipeline-intel", { token });
  assert.equal(pi.status, 200);
  assert.ok(pi.body.totals.open > 100, "open deals");
  assert.ok(pi.body.risky.length > 0 && pi.body.risky[0].score >= pi.body.risky[pi.body.risky.length - 1].score, "risk sorted");
  assert.equal(pi.body.aging.buckets.length, 4);
  assert.ok(pi.body.stages.length >= 5);
  assert.ok(pi.body.accounts.length >= 10);
  assert.equal((await call("/api/app/pipeline-intel?location=bad id!", { token })).status, 400);
  assert.equal((await call("/api/app/goals", { method: "PUT", token, body: JSON.stringify({ metric: "monthly_revenue", target: -5 }) })).status, 400);
  assert.equal((await call("/api/app/goals", { method: "PUT", token, body: JSON.stringify({ metric: "nope", target: 5 }) })).status, 400);
  assert.equal((await call("/api/app/goals", { method: "PUT", token, body: JSON.stringify({ metric: "monthly_revenue", target: 50000 }) })).status, 200);
  const covered = await call("/api/app/pipeline-intel", { token });
  assert.equal(covered.body.coverage.target, 50000);
  assert.equal((await call("/api/app/goals", { method: "PUT", token, body: JSON.stringify({ metric: "monthly_revenue", target: null }) })).status, 200);
  console.log("pipeline intelligence + goals: ok");

  // --- contact intelligence
  const ci = await call("/api/app/contact-intel", { token });
  assert.equal(ci.status, 200);
  assert.ok(ci.body.lifecycle.total > 3000, "contacts counted");
  assert.equal(ci.body.lifecycle.leads + ci.body.lifecycle.opportunities + ci.body.lifecycle.customers + ci.body.lifecycle.lost, ci.body.lifecycle.total, "lifecycle adds up");
  assert.ok(ci.body.topLeads.length > 0 && ci.body.topLeads[0].score >= ci.body.topLeads[ci.body.topLeads.length - 1].score, "leads sorted by score");
  assert.ok(ci.body.vips.length > 0);
  assert.ok(ci.body.inactive.d30 >= ci.body.inactive.d60 && ci.body.inactive.d60 >= ci.body.inactive.d90, "inactive buckets nest");
  assert.equal(ci.body.growth.weekly.length > 0, true);
  assert.ok(ci.body.quality.total === ci.body.lifecycle.total);
  console.log("contact intelligence: ok");

  // --- call queue, saved lists, outcomes
  const cq = await call("/api/app/call-queue?preset=hot_uncontacted", { token });
  assert.equal(cq.status, 200);
  assert.ok(cq.body.rows.length > 0, "hot list has people");
  assert.ok(cq.body.rows[0].priority >= cq.body.rows[cq.body.rows.length - 1].priority, "sorted by priority");
  for (const p of cq.body.presets) {
    const r = await call(`/api/app/call-queue?preset=${p.id}`, { token });
    assert.equal(r.status, 200, p.id);
  }
  assert.equal((await call("/api/app/call-queue?preset=nope", { token })).status, 400);
  assert.equal((await call("/api/app/call-queue?preset=custom&idleDays=-3", { token })).status, 400);
  assert.equal((await call("/api/app/call-queue?preset=custom&tag=vip&deal=open", { token })).status, 200);
  const first = cq.body.rows[0];
  assert.equal((await call("/api/app/call-outcomes", { method: "POST", token, body: JSON.stringify({ locationId: first.locationId, contactId: "does-not-exist", outcome: "booked" }) })).status, 404);
  assert.equal((await call("/api/app/call-outcomes", { method: "POST", token, body: JSON.stringify({ locationId: first.locationId, contactId: first.contactId, outcome: "ghosted" }) })).status, 400);
  assert.equal((await call("/api/app/call-outcomes", { method: "POST", token, body: JSON.stringify({ locationId: first.locationId, contactId: first.contactId, outcome: "voicemail" }) })).status, 200);
  const after = await call("/api/app/call-queue?preset=hot_uncontacted", { token });
  assert.ok(!after.body.rows.some((r: { contactId: string; locationId: string }) => r.contactId === first.contactId && r.locationId === first.locationId), "called contact is hidden");
  const sum = await call(`/api/app/call-outcomes?since=${encodeURIComponent(new Date(Date.now() - 600000).toISOString())}`, { token });
  assert.equal(sum.status, 200);
  assert.ok(sum.body.session.calls >= 1);
  assert.equal((await call("/api/app/call-outcomes?since=2001-01-01", { token })).status, 400);
  const made2 = await call("/api/app/call-lists", { method: "POST", token, body: JSON.stringify({ name: "check-api list", filters: { preset: "custom", tag: "vip" } }) });
  assert.equal(made2.status, 200);
  assert.equal((await call("/api/app/call-lists", { method: "POST", token, body: JSON.stringify({ name: "", filters: {} }) })).status, 400);
  assert.equal((await call("/api/app/call-lists", { method: "POST", token, body: JSON.stringify({ name: "x", filters: { preset: "hack" } }) })).status, 400);
  const ls = await call("/api/app/call-lists", { token });
  assert.ok(ls.body.lists.some((l: { id: string }) => l.id === made2.body.id));
  assert.equal((await call(`/api/app/call-lists/${made2.body.id}`, { method: "DELETE", token })).status, 200);
  assert.equal((await call(`/api/app/call-lists/${made2.body.id}`, { method: "DELETE", token })).status, 404);
  assert.equal((await call("/api/app/call-lists/not-a-uuid", { method: "DELETE", token })).status, 404);
  console.log("call queue + lists + outcomes: ok");

  // Leave the demo data as we found it.
  await sql()`delete from domain_checks where domain in ('example-demo.com', 'other-demo.org')`;
  await closeDb();
  console.log("\nAll API checks passed.");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
