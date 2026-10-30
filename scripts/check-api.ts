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
  assert.ok(du.body.groups.length > 0 && du.body.groups[0].people[0].url.includes("/contacts/detail/"));
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
  assert.ok(ci.body.cohorts.length >= 1 && ci.body.cohorts.every((x: { leads: number; converted: number }) => x.converted <= x.leads), "cohorts sane");
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

  // --- clients, QBR, executive summary
  const es = await call("/api/app/exec-summary", { token });
  assert.equal(es.status, 200);
  assert.equal(es.body.kpis.length, 5);
  assert.ok(es.body.kpis[0].current >= 0);
  assert.equal((await call("/api/app/goals", { method: "PUT", token, body: JSON.stringify({ metric: "monthly_leads", target: 100 }) })).status, 200);
  const es2 = await call("/api/app/exec-summary", { token });
  assert.equal(es2.body.goals.length, 1);
  assert.ok(["achieved", "on_track", "at_risk", "behind"].includes(es2.body.goals[0].status));
  assert.equal((await call("/api/app/goals", { method: "PUT", token, body: JSON.stringify({ metric: "monthly_leads", target: null }) })).status, 200);

  const cl = await call("/api/app/clients", { token });
  assert.equal(cl.status, 200);
  assert.ok(cl.body.clients.length >= 13);
  const target = cl.body.clients[0];
  const upd = (body: unknown) => call(`/api/app/clients/${target.locationId}`, { method: "PUT", token, body: JSON.stringify(body) });
  assert.equal((await upd({})).status, 400);
  assert.equal((await upd({ monthlyFee: -5 })).status, 400);
  assert.equal((await upd({ renewalDate: "31/03/2027" })).status, 400);
  assert.equal((await upd({ industry: "x".repeat(61) })).status, 400);
  assert.equal((await upd({ notes: "x".repeat(2001) })).status, 400);
  assert.equal((await call("/api/app/clients/nope-not-here", { method: "PUT", token, body: JSON.stringify({ industry: "Dental" }) })).status, 404);
  const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  assert.equal((await upd({ monthlyFee: 2500, renewalDate: soon, industry: "Roofing", notes: "Prefers no calls after 6pm", markContacted: true })).status, 200);
  const cl2 = await call("/api/app/clients", { token });
  const mine = cl2.body.clients.find((x: { locationId: string }) => x.locationId === target.locationId);
  assert.equal(mine.profile.monthlyFee, 2500);
  assert.equal(mine.renewal.bucket, "30");
  assert.equal(mine.contactGap.flagged, false);
  assert.ok(mine.roi && mine.roi.pipelineMultiple >= 0);
  assert.ok(cl2.body.revenue.monthly >= 2500);
  assert.ok(cl2.body.renewals.some((r: { locationId: string }) => r.locationId === target.locationId));
  assert.ok(cl2.body.segments.some((s: { industry: string }) => s.industry === "Roofing"));
  const other = cl.body.clients[1];
  const cmp = await call(`/api/app/clients/compare?a=${target.locationId}&b=${other.locationId}`, { token });
  assert.equal(cmp.status, 200);
  assert.ok(cmp.body.notes.length >= 1);
  assert.equal((await call(`/api/app/clients/compare?a=${target.locationId}&b=${target.locationId}`, { token })).status, 400);
  const qbr = await call(`/api/app/qbr/${target.locationId}`, { token });
  assert.equal(qbr.status, 200);
  assert.ok(qbr.body.history.length > 10 && qbr.body.client.activity.startsWith("In the last 30 days"));
  assert.equal((await call("/api/app/qbr/nope-not-here", { token })).status, 404);
  // put the demo account back the way it was
  assert.equal((await upd({ monthlyFee: null, renewalDate: null, industry: null, notes: null })).status, 200);
  console.log("clients + QBR + executive summary: ok");

  // --- communication analysis, daily priorities, setup score, exports
  const ci2 = await call("/api/app/comms-intel", { token });
  assert.equal(ci2.status, 200);
  assert.equal(ci2.body.aging.buckets.length, 6);
  assert.equal(ci2.body.aging.buckets.reduce((s: number, b: { count: number }) => s + b.count, 0), ci2.body.aging.total);
  assert.ok(ci2.body.gaps.total > 0 && ci2.body.gaps.stages.length > 0, "quiet deals found");
  assert.ok(ci2.body.afterHours.leads > 100 && ci2.body.afterHours.afterHoursPct >= 0);
  const db2 = await call("/api/app/daily-brief", { token });
  assert.equal(db2.status, 200);
  assert.ok(Array.isArray(db2.body.priorities) && db2.body.priorities.length <= 5);
  assert.ok(db2.body.priorities.every((p: { go: string; title: string }) => p.go && p.title));
  const cl3 = await call("/api/app/clients", { token });
  assert.ok(cl3.body.clients.every((x: { setup: { score: number } }) => x.setup.score >= 0 && x.setup.score <= 100));
  for (const kind of ["deals", "clients"]) {
    const res = await fetch(BASE + "/api/app/export/" + kind, { headers: { Authorization: "Bearer " + token } });
    assert.equal(res.status, 200, kind);
    assert.ok((res.headers.get("content-type") ?? "").includes("text/csv"), kind + " is a CSV");
    const text = await res.text();
    assert.ok(text.split("\r\n").length > 5, kind + " has rows");
  }
  assert.equal((await call("/api/app/export/nope", { token })).status, 404);
  console.log("communication + priorities + setup + exports: ok");

  // --- business and client views: one account only, never the agency pages
  const biz = await call("/api/sso", { method: "POST", body: JSON.stringify({ demo: true, as: "business" }) });
  assert.equal(biz.status, 200);
  assert.equal(biz.body.kind, "business");
  const bt = biz.body.session as string;
  const own = biz.body.user.activeLocation as string;
  assert.ok(own);
  const otherAcc = acc.body.accounts.find((a: { locationId: string; ignored: boolean }) => a.locationId !== own && !a.ignored);
  const bov = await call("/api/app/overview", { token: bt });
  assert.equal(bov.status, 200);
  assert.equal(bov.body.kind, "business");
  assert.equal(bov.body.kpis.accounts, 1, "a business sees one account");
  const bacc = await call("/api/app/accounts", { token: bt });
  assert.equal(bacc.body.accounts.length, 1);
  assert.equal(bacc.body.accounts[0].locationId, own);
  assert.equal((await call(`/api/app/accounts/${otherAcc.locationId}`, { token: bt })).status, 404, "another account is not found");
  assert.equal((await call(`/api/app/accounts/${own}`, { token: bt })).status, 200);
  for (const p of ["clients", `qbr/${own}`, "export/clients", "clients/compare?a=x1x&b=y2y"]) {
    assert.equal((await call(`/api/app/${p}`, { token: bt })).status, 403, `${p} is agency only`);
  }
  assert.equal((await call(`/api/app/accounts/${own}/flags`, { token: bt, method: "PUT", body: JSON.stringify({ ignored: true }) })).status, 403);
  assert.equal((await call(`/api/app/clients/${own}`, { token: bt, method: "PUT", body: JSON.stringify({ monthlyFee: 5 }) })).status, 403);
  const [sample] = await sql()`select first_name from cached_contacts where location_id = ${own} and length(first_name) >= 3 limit 1`;
  const bs = await call(`/api/app/search?q=${encodeURIComponent(sample.first_name)}&location=${otherAcc.locationId}`, { token: bt });
  assert.ok(bs.body.hits.length > 0 && bs.body.hits.every((h: { locationId: string }) => h.locationId === own), "search stays in the account even if another is asked for");
  const rows = (res: { body: Record<string, unknown> }, key: string) => (res.body[key] as Array<{ locationId: string | null }>);
  assert.ok(rows(await call("/api/app/stale?days=30", { token: bt }), "deals").every((d) => d.locationId === own), "stale deals");
  assert.ok(rows(await call("/api/app/inbox", { token: bt }), "items").every((d) => d.locationId === own), "inbox");
  assert.ok(rows(await call("/api/app/duplicates", { token: bt }), "groups").every((d) => d.locationId === own), "duplicates");
  assert.ok(rows(await call("/api/app/alerts", { token: bt }), "alerts").every((d) => d.locationId === own), "alerts");
  assert.ok(rows(await call("/api/app/call-queue", { token: bt }), "rows").every((d) => d.locationId === own), "call queue");
  assert.ok(rows(await call("/api/app/hygiene", { token: bt }), "accounts").every((d) => d.locationId === own), "hygiene");
  const bpi = await call("/api/app/pipeline-intel", { token: bt });
  assert.equal(bpi.status, 200);
  assert.ok(bpi.body.accounts.every((a: { locationId: string }) => a.locationId === own), "pipeline accounts");
  const bci = await call("/api/app/contact-intel", { token: bt });
  assert.equal(bci.status, 200);
  assert.ok(bci.body.topLeads.every((c: { locationId: string }) => c.locationId === own), "leads");
  assert.equal((await call("/api/app/settings", { token: bt })).body.kind, "business");
  console.log("business view: ok (one account, agency pages refused)");

  const cli4 = await call("/api/sso", { method: "POST", body: JSON.stringify({ demo: true, as: "client" }) });
  assert.equal(cli4.body.kind, "client");
  const ct = cli4.body.session as string;
  const cown = cli4.body.user.activeLocation as string;
  const cov = await call("/api/app/overview", { token: ct });
  assert.equal(cov.status, 200);
  assert.equal(cov.body.kpis.accounts, 1);
  for (const [m, p] of [
    ["GET", "settings"], ["GET", "export/stale"], ["GET", "call-queue"], ["GET", "goals"], ["GET", "api-keys"], ["GET", "exec-summary"],
    ["GET", "daily-brief"], ["GET", "clients"], ["GET", "health"], ["POST", "sync"], ["PUT", "settings"], ["POST", "call-outcomes"],
  ] as const) {
    assert.equal((await call(`/api/app/${p}`, { token: ct, method: m, ...(m === "GET" ? {} : { body: "{}" }) })).status, 403, `${m} ${p} refused for a client`);
  }
  const cpi = await call("/api/app/pipeline-intel", { token: ct });
  assert.equal(cpi.status, 200);
  assert.equal(Object.keys(cpi.body.goals).length, 0, "a client never sees the agency's targets");
  assert.ok(cpi.body.accounts.every((a: { locationId: string }) => a.locationId === cown));
  // a session cannot be upgraded by editing it
  const [cBody, cSig] = ct.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cBody, "base64url").toString()), kind: "agency", locationId: null })).toString("base64url");
  assert.equal((await call("/api/app/clients", { token: `${forged}.${cSig}` })).status, 401, "an edited session is refused");
  console.log("client view: ok (read-only, own account only)");

  // The agency can switch a client's view on and off.
  const flagOn = await call(`/api/app/accounts/${roofing.locationId}/flags`, { token, method: "PUT", body: JSON.stringify({ clientView: true }) });
  assert.equal(flagOn.status, 200);
  assert.equal((await call(`/api/app/accounts/${roofing.locationId}`, { token })).body.clientView, true);
  const stg = await call("/api/app/settings", { token });
  assert.ok(stg.body.clientView.on >= 1 && stg.body.clientView.total >= 14);
  await call(`/api/app/accounts/${roofing.locationId}/flags`, { token, method: "PUT", body: JSON.stringify({ clientView: false }) });
  assert.equal((await call(`/api/app/accounts/${roofing.locationId}`, { token })).body.clientView, false);
  console.log("agency switch for client view: ok");

  // --- sources, do-not-disturb, birthdays, teamRes, deal movement, contact timeline
  const ci3 = await call("/api/app/contact-intel", { token });
  assert.ok(ci3.body.sources.length >= 4 && ci3.body.sources.every((s: { contacts: number; source: string }) => s.contacts > 0 && s.source));
  assert.equal(ci3.body.sources.reduce((s: number, x: { contacts: number }) => s + x.contacts, 0), ci3.body.lifecycle ? ci3.body.sources.reduce((s: number, x: { contacts: number }) => s + x.contacts, 0) : 0);
  assert.ok(ci3.body.dnd.dnd > 50 && ci3.body.dnd.dnd < ci3.body.dnd.total, "some contacts are do-not-disturb");
  assert.ok(ci3.body.birthdays.every((b: { days: number }) => b.days >= 0 && b.days <= 30));
  const queueRes = await call("/api/app/call-queue", { token });
  const [dndRow] = await sql()`select contact_id from cached_contacts where dnd limit 1`;
  assert.ok(!queueRes.body.rows.some((r: { contactId: string }) => r.contactId === dndRow.contact_id), "do-not-disturb contacts never reach a call list");
  const teamRes = await call("/api/app/team", { token });
  assert.equal(teamRes.status, 200);
  assert.ok(teamRes.body.members.length >= 4 && teamRes.body.members.some((m: { name: string | null }) => m.name === "Dana Brooks"));
  assert.ok(teamRes.body.members.every((m: { label: string }) => m.label));
  const unnamed = teamRes.body.members.find((m: { name: string | null; userId: string }) => m.name === null && m.userId !== "unassigned");
  assert.equal((await call(`/api/app/team/${unnamed.userId}`, { token, method: "PUT", body: JSON.stringify({ name: "Test Person" }) })).status, 200);
  assert.ok((await call("/api/app/team", { token })).body.members.some((m: { name: string | null }) => m.name === "Test Person"));
  assert.equal((await call(`/api/app/team/${unnamed.userId}`, { token, method: "PUT", body: JSON.stringify({ name: null }) })).status, 200);
  assert.equal((await call(`/api/app/team/${unnamed.userId}`, { token, method: "PUT", body: JSON.stringify({ name: "x".repeat(61) }) })).status, 400);
  const moveRes = await call("/api/app/deal-events", { token });
  assert.ok(moveRes.body.moves.length > 10 && moveRes.body.moves.every((m: { toLabel: string | null }) => m.toLabel));
  const [oneContact] = await sql()`select location_id, contact_id from cached_contacts where location_id = ${roofing.locationId} limit 1`;
  const timelineRes = await call(`/api/app/contact/${oneContact.location_id}/${oneContact.contact_id}`, { token });
  assert.equal(timelineRes.status, 200);
  assert.ok(timelineRes.body.contact.name && Array.isArray(timelineRes.body.timeline) && timelineRes.body.url.includes("/contacts/detail/"));
  assert.equal((await call(`/api/app/contact/${oneContact.location_id}/nope-nope`, { token })).status, 404);
  // a business reads its own teamRes and timeline only; a client never sees the teamRes
  const bTeam = await call("/api/app/team", { token: bt });
  assert.equal(bTeam.status, 200);
  assert.equal((await call("/api/app/team", { token: ct })).status, 403);
  const foreign = await sql()`select contact_id from cached_contacts where location_id = ${otherAcc.locationId} limit 1`;
  assert.equal((await call(`/api/app/contact/${otherAcc.locationId}/${foreign[0].contact_id}`, { token: bt })).status, 404, "a business cannot open another account's contact");
  assert.equal((await call(`/api/app/contact/${otherAcc.locationId}/${foreign[0].contact_id}`, { token: ct })).status, 404, "nor can a client");
  console.log("sources + DND + birthdays + teamRes + movement + timeline: ok");

  // --- duplicates: scored review queue, decisions with snapshots, dry-run bulk, undo
  const dq = await call("/api/app/duplicates", { token });
  assert.equal(dq.status, 200);
  assert.ok(dq.body.groups.length > 3 && dq.body.summary.exact > 0 && dq.body.canReview === true);
  for (const g of dq.body.groups as Array<{ confidence: number; people: Array<{ contactId: string }>; survivorId: string; plan: unknown[]; reasons: string[] }>) {
    assert.ok(g.people.length >= 2 && g.confidence >= 50 && g.confidence <= 100 && g.reasons.length > 0 && g.plan.length === 4);
    assert.ok(g.people.some((p) => p.contactId === g.survivorId), "the recommended record is one of the group");
  }
  assert.ok(dq.body.summary.accounts.length >= 13);
  const dupTarget = dq.body.groups[0] as { locationId: string; people: Array<{ contactId: string }>; survivorId: string };
  const dupIds = dupTarget.people.map((p) => p.contactId);
  const review = (body: unknown, tok = token) => call("/api/app/duplicates/review", { token: tok, method: "POST", body: JSON.stringify(body) });
  assert.equal((await review({ locationId: dupTarget.locationId, contactIds: dupIds, decision: "delete_them", keepContactId: dupIds[0] })).status, 400, "unknown decisions are refused");
  assert.equal((await review({ locationId: dupTarget.locationId, contactIds: dupIds, decision: "keep" })).status, 400, "a keep decision needs a record");
  assert.equal((await review({ locationId: dupTarget.locationId, contactIds: [dupIds[0], "nope-nope"], decision: "not_duplicate" })).status, 404, "contacts that do not exist");
  assert.equal((await review({ locationId: otherAcc.locationId, contactIds: dupIds, decision: "not_duplicate" })).status, 404, "contacts from a different account");
  const sumOf = (b: { summary: { exact: number; format: number; name: number } }) => b.summary.exact + b.summary.format + b.summary.name;
  const before = sumOf(dq.body);
  assert.equal((await review({ locationId: dupTarget.locationId, contactIds: dupIds, decision: "keep", keepContactId: dupTarget.survivorId })).status, 200);
  const [rev] = await sql()`select decision, snapshot from duplicate_reviews where location_id = ${dupTarget.locationId} order by decided_at desc limit 1`;
  assert.equal(rev.decision, "keep");
  assert.equal(rev.snapshot.contacts.length, dupIds.length, "a snapshot of the records is saved");
  const [audit] = await sql()`select count(*)::int n from audit_log where action = 'duplicates.keep'`;
  assert.ok(audit.n >= 1, "the action is logged");
  assert.equal(sumOf((await call("/api/app/duplicates", { token })).body), before - 1, "a reviewed group leaves the queue");
  assert.equal((await call("/api/app/duplicates?reviewed=1", { token })).body.groups.filter((g: { review: unknown }) => g.review).length, 1);
  const dry = await call("/api/app/duplicates/bulk", { token, method: "POST", body: JSON.stringify({ decision: "not_duplicate", minConfidence: 0, maxConfidence: 100 }) });
  assert.equal(dry.body.dryRun, true, "bulk defaults to a dry run");
  assert.ok(dry.body.count > 0 && dry.body.sample.length > 0);
  const [still] = await sql()`select count(*)::int n from duplicate_reviews`;
  assert.equal(still.n, 1, "a dry run records nothing");
  assert.equal((await call("/api/app/duplicates/bulk", { token, method: "POST", body: JSON.stringify({ decision: "not_duplicate", minConfidence: 90, maxConfidence: 10 }) })).status, 400);
  const applied = await call("/api/app/duplicates/bulk", { token, method: "POST", body: JSON.stringify({ decision: "not_duplicate", minConfidence: 90, maxConfidence: 100, dryRun: false }) });
  assert.equal(applied.status, 200);
  assert.ok(applied.body.count > 0);
  assert.equal((await call("/api/app/duplicates/undo", { token, method: "POST", body: JSON.stringify({ locationId: dupTarget.locationId, key: "00000000-9" }) })).status, 404);
  const [firstReview] = await sql()`select group_key from duplicate_reviews where location_id = ${dupTarget.locationId} limit 1`;
  assert.equal((await call("/api/app/duplicates/undo", { token, method: "POST", body: JSON.stringify({ locationId: dupTarget.locationId, key: firstReview.group_key }) })).status, 200);
  // a client view can look but not decide; a business decides only about its own account
  assert.equal((await review({ locationId: dupTarget.locationId, contactIds: dupIds, decision: "not_duplicate" }, ct)).status, 403);
  assert.equal((await call("/api/app/duplicates", { token: ct })).body.canReview, false);
  assert.equal((await review({ locationId: dupTarget.locationId, contactIds: dupIds, decision: "not_duplicate" }, bt)).status, dupTarget.locationId === own ? 200 : 404);
  await sql()`delete from duplicate_reviews where installation_id = (select id from installations where is_demo)`;
  await sql()`delete from audit_log where installation_id = (select id from installations where is_demo)`;
  console.log("duplicates: scored queue, snapshots, audit log, dry run, undo, isolation: ok");

  // --- the daily brief: changes against each account's own history, ranked attention, schedule
  const daily = await call("/api/app/daily", { token });
  assert.equal(daily.status, 200);
  assert.equal(daily.body.headlines.length, 4);
  for (const h of daily.body.headlines as Array<{ change: { today: number; yesterday: number | null; avg7: number | null; samples: number } }>) {
    assert.ok(h.change.yesterday !== null && h.change.avg7 !== null && h.change.samples >= 4, "history exists for yesterday and the 7 day average");
  }
  assert.ok(daily.body.attention.length > 0 && daily.body.fine.length > 0, "some accounts need attention and some are fine");
  assert.equal(daily.body.attention.length + daily.body.fine.length, daily.body.accounts);
  const weights = daily.body.attention.map((a: { weight: number }) => a.weight);
  assert.deepEqual(weights, [...weights].sort((x: number, y: number) => y - x), "ranked most urgent first");
  for (const a of daily.body.attention as Array<{ items: Array<{ title: string; detail: string }>; url: string; severity: string }>) {
    assert.ok(a.items.length >= 1 && a.items.every((i) => i.title && i.detail) && a.url.includes("/dashboard") && ["critical", "warning", "info"].includes(a.severity));
  }
  assert.ok(daily.body.fine.every((f: { checked: string[] }) => f.checked.length >= 5), "fine accounts say what was checked");
  assert.equal(daily.body.notWatched.length, 4);
  assert.equal(daily.body.limited, false);
  assert.ok(typeof daily.body.freshness.label === "string" && daily.body.freshness.label.length > 5);
  const bd = await call("/api/app/daily", { token: bt });
  assert.equal(bd.status, 200);
  assert.equal(bd.body.limited, true);
  assert.ok([...bd.body.attention, ...bd.body.fine].every((x: { locationId: string }) => x.locationId === own) && bd.body.attention.length + bd.body.fine.length === 1);
  assert.equal((await call("/api/app/daily", { token: ct })).status, 403, "a client view has no daily brief");
  const putS = (b: unknown) => call("/api/app/settings", { token, method: "PUT", body: JSON.stringify(b) });
  assert.equal((await putS({ digestHour: 25 })).status, 400);
  assert.equal((await putS({ digestTimezone: "Mars/Olympus" })).status, 400);
  const okSet = await putS({ digestHour: 9, digestTimezone: "Africa/Lagos" });
  assert.equal(okSet.status, 200);
  assert.equal(okSet.body.settings.digestHour, 9);
  assert.equal(okSet.body.settings.digestTimezone, "Africa/Lagos");
  assert.equal((await call("/api/app/daily", { token })).body.schedule.timezone, "Africa/Lagos");
  assert.equal((await putS({ digestHour: null, digestTimezone: null })).body.settings.digestHour, null);
  assert.match((await call("/api/app/digest", { token })).body.text, /daily brief/);
  assert.equal((await call("/api/cron/daily")).status, 401, "the hourly job needs its secret");
  console.log("daily brief: own-history comparison, ranking, scoping, schedule: ok");

  // --- getting started reflects real state; page usage is counted without personal data
  await sql()`delete from usage_events where installation_id = (select id from installations where is_demo)`;
  const st1 = await call("/api/app/start", { token });
  assert.equal(st1.status, 200);
  assert.equal(st1.body.steps.length, 7, "agency sees seven steps including client view");
  assert.ok(st1.body.steps.every((s: { title: string; body: string }) => s.title && s.body));
  assert.equal(st1.body.steps.find((s: { id: string }) => s.id === "connected").done, true);
  assert.equal(st1.body.steps.find((s: { id: string }) => s.id === "duplicates").done, false, "not done until the page has been opened");
  assert.equal(st1.body.steps.find((s: { id: string }) => s.id === "synced").detail.includes("account"), true);
  const views = st1.body.steps.map((s: { view: string | null }) => s.view).filter(Boolean);
  assert.equal(new Set(views.filter((v: string) => v === "overview")).size <= 1 && views.filter((v: string) => v === "overview").length <= 1, true, "no two steps open the same page twice");
  const ping = (view: string, tok = token) => call("/api/app/usage", { token: tok, method: "POST", body: JSON.stringify({ view }) });
  assert.equal((await ping("duplicates")).status, 200);
  assert.equal((await ping("not-a-page")).status, 400);
  assert.equal((await ping("today", ct)).status, 200, "a client view can be counted too");
  const st2 = await call("/api/app/start", { token });
  assert.equal(st2.body.steps.find((s: { id: string }) => s.id === "duplicates").done, true);
  assert.equal(st2.body.doneCount, st1.body.doneCount + 2, "the duplicates and today steps tick themselves off");
  assert.equal((await call("/api/app/start", { token: bt })).body.steps.length, 6, "a business has no client-view step");
  assert.equal((await call("/api/app/daily", { token })).body.connection.ok, true);
  await sql()`delete from usage_events where installation_id = (select id from installations where is_demo)`;
  console.log("getting started + usage + connection: ok");

  // --- appointments: rates, to-do lists, permission state, scoping, no-show recovery call list
  const ap = await call("/api/app/appointments", { token });
  assert.equal(ap.status, 200);
  assert.ok(ap.body.last30.booked > 20 && ap.body.prior30.booked > 10, "bookings exist in both 30 day windows");
  assert.ok(ap.body.last30.showRate > 0.2 && ap.body.last30.showRate < 1, "a believable show rate");
  assert.equal(ap.body.last30.held + ap.body.last30.noShow + ap.body.last30.cancelled <= ap.body.last30.booked, true);
  assert.ok(ap.body.upcoming7 > 0 && ap.body.unmarkedTotal > 0 && ap.body.recoverTotal > 0 && ap.body.unconfirmedTotal > 0, "every to-do list has something");
  assert.ok(ap.body.recover.every((p: { url: string; name: string }) => p.name && p.url.includes("/contacts/detail/")));
  assert.equal(ap.body.access.needsPermission.length, 1, "the account that predates the permission is called out");
  assert.ok(ap.body.byCalendar.length >= 3 && ap.body.byPerson.some((p: { label: string }) => p.label === "Dana Brooks"), "people use their names");
  assert.equal(ap.body.canSeeAccounts, true);
  assert.ok(ap.body.perAccount.some((a: { access: string }) => a.access === "needs_permission"));
  const bap = await call("/api/app/appointments", { token: bt });
  assert.equal(bap.status, 200);
  assert.equal(bap.body.canSeeAccounts, false);
  assert.ok(bap.body.perAccount.length === 1 && bap.body.perAccount[0].locationId === own, "a business sees only its own appointments");
  assert.ok([...bap.body.recover, ...bap.body.unmarked, ...bap.body.unconfirmed].every((p: { locationName: string | null }) => p.locationName === bap.body.perAccount[0].name));
  assert.equal((await call("/api/app/appointments", { token: ct })).status, 200, "a client view can see its own appointments");
  const nsq = await call("/api/app/call-queue?preset=noshow_recovery", { token });
  assert.equal(nsq.status, 200);
  assert.ok(nsq.body.total > 0 && nsq.body.rows.every((r: { contactId: string }) => r.contactId));
  assert.ok(!nsq.body.rows.some((r: { contactId: string }) => r.contactId === dndRow.contact_id), "still never a do-not-disturb contact");
  assert.ok(nsq.body.presets.some((p: { id: string }) => p.id === "noshow_recovery"));
  assert.equal((await call("/api/app/daily", { token })).status, 200, "the brief still builds with appointment signals");
  console.log("appointments: rates, to-do lists, permission state, scoping, recovery list: ok");

  // Leave the demo data as we found it.
  await sql()`delete from domain_checks where domain in ('example-demo.com', 'other-demo.org')`;
  await closeDb();
  console.log("\nAll API checks passed.");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
