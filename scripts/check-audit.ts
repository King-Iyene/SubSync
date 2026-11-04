import assert from "node:assert/strict";

// The rebuilt account audit against a running dev server in demo mode: its counted money agrees with the Overview, an estimate is never presented as a fact,
// a person is in one finding only, every count equals the rows of its list, the client list is paged on the server, and a business or client view only ever
// audits its own account. Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-audit.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

type Item = { locationId: string; contactId: string | null; value: number | null };
type Finding = { key: string; count: number; dollars: number | null; dollarKind: string; items: Item[]; fix: string; title: string; partial: boolean };

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
  const d = audit.body;
  const findings = d.findings as Finding[];
  assert.equal(d.totals.accounts, ov.body.kpis.accounts, "it audits the same accounts the Overview counts");

  // Counted money agrees with the Overview: deals gone quiet plus old or test deals is the Overview's stale value.
  const stale = findings.find((f) => f.key === "stale");
  const leftovers = findings.find((f) => f.key === "leftovers");
  const staleMoney = (stale?.dollars ?? 0) + (leftovers ? leftovers.items.reduce((s, i) => s + (i.value ?? 0), 0) : 0);
  if (!stale?.partial) assert.ok(Math.abs(staleMoney - ov.body.kpis.staleValue) < 1, `counted deal money (${staleMoney}) agrees with the Overview (${ov.body.kpis.staleValue}) to the dollar`);
  assert.ok(!stale || stale.dollarKind === "fact", "deals gone quiet are a fact");
  assert.equal(d.verdict.sitting, stale?.dollars ?? null, "the counted line is the deals finding's figure");

  // An estimate is labelled as one and never includes counted money; the sentence is the sum of the priced findings only.
  for (const f of findings) {
    if (f.dollarKind === "estimate") assert.ok(f.key === "replies" || f.key === "noshows", "only people findings are estimates");
    if (f.dollarKind === "none") assert.equal(f.dollars, null);
    assert.ok(f.fix.length > 5 && f.title.length > 5);
  }
  const priced = findings.filter((f) => f.dollarKind === "estimate").reduce((s, f) => s + (f.dollars ?? 0), 0);
  if (d.verdict.kind === "leak") {
    assert.equal(d.verdict.leak, priced, "the sentence is the sum of the estimated findings");
    assert.match(d.verdict.text, /leaking about \$[\d,]+ a month\.$/);
  } else assert.equal(d.verdict.leak, null);

  // A person is in one finding only (deals first), and every count equals the rows it opens (unless the list was cut).
  const seen = new Set<string>();
  for (const f of findings) {
    if (f.key === "leftovers" || f.key === "appointments") continue;
    for (const it of f.items) {
      if (!it.contactId) continue;
      const k = `${it.locationId}|${it.contactId}`;
      assert.ok(!seen.has(k), `${k} is in one finding only`);
      seen.add(k);
    }
  }
  for (const f of findings) if (!f.partial && f.items.length <= 200) assert.equal(f.items.length, f.count, `${f.key}: the count is the number of rows`);
  assert.equal(d.totals.things, findings.filter((f) => f.key !== "leftovers").reduce((s, f) => s + f.count, 0));

  // The client list is a page of the server's list and its numbers add up.
  assert.ok(d.clients && d.clients.rows.length <= 5);
  const all = await call("/api/app/audit/clients?size=50&sort=name", token);
  assert.equal(all.status, 200);
  assert.equal(all.body.total, d.clients.total);
  if (all.body.pages === 1) for (const k of ["stale", "replies", "noshows", "appointments"]) assert.equal((all.body.rows as Array<Record<string, number>>).reduce((s, r) => s + r[k], 0), findings.find((f) => f.key === k)?.count ?? 0, `clients add up to the ${k} finding`);

  // A business or a client's staff audits its own account only, and is never told how many other accounts exist.
  for (const [label, t] of [["business", biz], ["client", cli]] as const) {
    const mine = await call("/api/app/audit", t);
    assert.equal(mine.status, 200, label);
    assert.equal(mine.body.totals.accounts, 1, `a ${label} view audits its own account only`);
    assert.equal(mine.body.scope, "account");
    assert.equal(mine.body.clients, null);
    assert.equal(mine.body.hiddenAccounts, 0, `${label}: the number of other accounts is never sent`);
    assert.equal(mine.body.canShare, false, `${label}: nobody shares from the demo, and a client's staff never can`);
    assert.equal((await call("/api/app/audit/clients", t)).status, 404, `${label}: no client list`);
    const accounts = new Set((mine.body.findings as Finding[]).flatMap((f) => f.items.map((i) => i.locationId)));
    assert.ok(accounts.size <= 1, `${label}: the lists hold one account's rows at most`);
  }
  assert.equal((await call("/api/app/audit?industry=bad!value&hideTest=1", token)).status, 200, "filters never error");

  // The page filter narrows the audit and everything behind it; an id from nowhere matches no account.
  const pick = d.clients.rows[0]?.id as string | undefined;
  if (pick) {
    const one = await call(`/api/app/audit?accounts=${encodeURIComponent(pick)}`, token);
    assert.equal(one.body.totals.accounts, 1, "the filter narrows the audit to the picked account");
    for (const f of one.body.findings as Finding[]) for (const it of f.items) assert.equal(it.locationId, pick);
    const focus = await call(`/api/app/audit?location=${encodeURIComponent(pick)}`, token);
    assert.equal(focus.body.focus.id, pick);
    assert.equal(focus.body.scope, "account");
    const foreignFocus = await call("/api/app/audit?location=notMyAccount1234", token);
    assert.equal(foreignFocus.body.focus, null, "an account that is not this company's changes nothing");
    assert.equal(foreignFocus.body.totals.accounts, d.totals.accounts);
    const foreign = await call("/api/app/audit?accounts=notMyAccount1234", token);
    assert.equal(foreign.status, 200);
    assert.equal(foreign.body.totals.accounts, 0, "an id from nowhere matches no account of this company");
  }

  const text = JSON.stringify(d, (k, v) => (k === "url" ? undefined : v));
  assert.ok(!/gohighlevel|highlevel|leadconnector|\bghl\b/i.test(text), "no platform name in anything shown");
  assert.match(d.summary, /account audit/);
  assert.ok(d.brand && "name" in d.brand && "color" in d.brand, "the printed page can carry the sender's name and colour");
  const clientShare = await fetch(`${BASE}/api/app/audit/share`, { method: "POST", headers: { Authorization: `Bearer ${cli}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(clientShare.status, 403, "a client's staff cannot create a public link");
  const demoShare = await fetch(`${BASE}/api/app/audit/share`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(demoShare.status, 400, "the demo holds only the public sample, so it cannot make a link");
  assert.equal(d.demo, true);
  assert.equal(d.canShare, false, "the demo cannot share");
  console.log(`account audit: ${d.verdict.text} Counted $${Math.round(staleMoney)} matches the Overview, estimate kept apart, one finding per person, scoped to one account for business and client: ok`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
