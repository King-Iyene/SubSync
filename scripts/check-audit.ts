import assert from "node:assert/strict";

// The account audit against a running dev server in demo mode: its money agrees with the Overview, an
// estimate is never presented as a fact, and a business or client view only ever audits its own account.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-audit.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const call = async (path: string, token: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const signIn = async (as?: string) => ((await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true, ...(as ? { as } : {}) }) })).json()) as { session: string });
  const token = (await signIn()).session;
  const biz = (await signIn("business")).session;
  const cli = (await signIn("client")).session;

  assert.equal((await fetch(`${BASE}/api/app/audit`)).status, 401);
  const [audit, ov] = await Promise.all([call("/api/app/audit", token), call("/api/app/overview", token)]);
  assert.equal(audit.status, 200, JSON.stringify(audit.body).slice(0, 200));
  const a = audit.body.audit;
  assert.equal(a.accountsScanned, ov.body.kpis.accounts, "it audits the same accounts the Overview counts");
  assert.ok(Math.abs(a.staleDollars - ov.body.kpis.staleValue) < 1, "stale money agrees with the Overview to the dollar");
  const stale = a.findings.find((f: { key: string }) => f.key === "stale");
  assert.ok(stale && stale.kind === "fact" && stale.dollars === a.staleDollars, "stale deals are a fact, with the same figure");
  for (const f of a.findings) {
    if (f.kind === "estimate") assert.equal(f.key, "slow", "only the slow follow-up figure is an estimate");
    if (f.kind === "fact") assert.ok(f.dollars === null || f.dollars >= 0);
    assert.ok(["critical", "warning", "info"].includes(f.severity) && f.fix.length > 5 && f.title.length > 5);
  }
  const order = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  const ranks = a.findings.map((f: { severity: string }) => order[f.severity]);
  assert.deepEqual([...ranks].sort(), ranks, "most serious first");
  if (a.estimatedDollars === null) assert.equal(ov.body.kpis.estimateAccounts === 0 || a.findings.every((f: { kind: string }) => f.kind !== "estimate"), true);
  assert.ok(a.rows.length <= 10);
  assert.match(audit.body.summary, /account audit/);
  assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(JSON.stringify(audit.body)), "no platform name in anything shown");

  for (const [label, t] of [["business", biz], ["client", cli]] as const) {
    const mine = await call("/api/app/audit", t);
    assert.equal(mine.status, 200, label);
    assert.equal(mine.body.audit.accountsScanned, 1, `a ${label} view audits its own account only`);
    assert.ok(mine.body.audit.rows.length <= 1);
    assert.ok(mine.body.audit.staleDollars <= a.staleDollars + 0.5);
  }
  assert.equal((await call("/api/app/audit?industry=bad!value&hideTest=1", token)).status, 200, "filters never error");

  // Stage F6. Every number opens the list it was counted from: the count on the finding is the count of the list (rows may be capped, the total is not).
  assert.ok(audit.body.lists, "an agency session is sent the lists behind the numbers");
  for (const f of a.findings as Array<{ key: string; count: number | null }>) {
    const list = audit.body.lists[f.key];
    if (list && f.count !== null) assert.equal(list.total, f.count, `${f.key}: the list's total is the number on the finding`);
    if (list) assert.ok(list.rows.length <= Math.max(list.total, 0) && list.rows.length <= 100, `${f.key}: a capped list never sends more than its total`);
  }
  const staleFinding = a.findings.find((f: { key: string }) => f.key === "stale");
  if (staleFinding) assert.ok(Math.abs(audit.body.lists.stale.totalValue - a.staleDollars) < 1, "the listed stale deals add up to the dollar figure");
  assert.ok(audit.body.brand && "name" in audit.body.brand && "color" in audit.body.brand, "the printed page can carry the sender's name and colour");
  assert.ok(!/gohighlevel|highlevel|leadconnector|\bghl\b/i.test(JSON.stringify(a.notes)), "no platform name in the definitions");
  for (const n of a.notes) assert.ok(n.text.length > 40 && !/\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i.test(n.text), `note ${n.key} is plain words`);
  for (const f of a.findings) if (f.note) assert.ok(a.notes.some((n: { key: string }) => n.key === f.note), `${f.key} has its definition`);

  // The page filter narrows the audit and everything behind it (N8): one picked account gives one account's numbers and only its rows.
  const pick = a.rows[0]?.locationId as string | undefined;
  if (pick) {
    const one = await call(`/api/app/audit?accounts=${encodeURIComponent(pick)}`, token);
    assert.equal(one.status, 200);
    assert.equal(one.body.audit.accountsScanned, 1, "the filter narrows the audit to the picked account");
    assert.ok(one.body.hiddenAccounts >= 0);
    for (const list of Object.values(one.body.lists ?? {}) as Array<{ rows: Array<{ locationId: string }> }>) for (const r of list.rows) assert.equal(r.locationId, pick, "a list behind a filtered audit holds only the picked account's rows");
    const foreign = await call("/api/app/audit?accounts=notMyAccount1234", token);
    assert.equal(foreign.status, 200);
    assert.equal(foreign.body.audit.accountsScanned, 0, "an id from nowhere changes nothing it should not: it matches no account of this company");
  }

  // Scoping of the lists: a business or a client's staff reads only its own account's rows, and a client's staff can neither share nor see links.
  for (const [label, t] of [["business", biz], ["client", cli]] as const) {
    const mine = await call("/api/app/audit", t);
    for (const list of Object.values(mine.body.lists ?? {}) as Array<{ rows: Array<{ locationId: string }> }>) {
      const accountsInRows = new Set(list.rows.map((r) => r.locationId));
      assert.ok(accountsInRows.size <= 1, `${label}: the lists hold one account's rows at most`);
    }
    assert.equal(mine.body.canShare, false, `${label}: nobody shares from the demo, and a client's staff never can`);
  }
  const clientShare = await fetch(`${BASE}/api/app/audit/share`, { method: "POST", headers: { Authorization: `Bearer ${cli}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(clientShare.status, 403, "a client's staff cannot create a public link");
  const demoShare = await fetch(`${BASE}/api/app/audit/share`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(demoShare.status, 400, "the demo holds only the public sample, so it cannot make a link");
  assert.equal(audit.body.demo, true);
  assert.equal(audit.body.canShare, false, "the demo cannot share");
  console.log(`account audit: money matches the Overview ($${Math.round(a.staleDollars)} stale), estimate kept apart, ranked, scoped to one account for business and client: ok`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
