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
  console.log(`account audit: money matches the Overview ($${Math.round(a.staleDollars)} stale), estimate kept apart, ranked, scoped to one account for business and client: ok`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
