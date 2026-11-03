import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";
import { refreshInsights } from "../src/lib/analytics/service";

// One filter, the same numbers on every page (stage F1, N8 and N1). A made-up agency with three client accounts is built in the real database
// (one of them is a test account), every figure it should produce is worked out here from the fixture constants and not from the app, and then every
// page's data is read under each filter: nothing, hide test accounts, one account manager, one kind of business, and two filters together.
// Each page must (1) show exactly the figure the fixture gives for the accounts still shown, and (2) contain no trace of an account the filter hides.
// Everything created is removed afterwards. It has no refresh token, so the production scheduler ignores it.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-filter.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const CO = "xtest-agency-filter";

// Every disagreement is collected and printed together, so one run shows everything that is wrong instead of stopping at the first.
const failures: string[] = [];
const eq = (actual: unknown, expected: unknown, message: string) => {
  try { assert.deepStrictEqual(actual, expected, message); } catch { failures.push(`${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
};
const ok = (cond: unknown, message: string) => { if (!cond) failures.push(message); };
// A handful of requests at once: the app answers each page from its own database reads, and the run is otherwise very slow on a remote database.
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

type Acct = { loc: string; name: string; marker: string; industry: string; owner: string; test: boolean; counted: number[]; };
// Per account: contacts 12; counted deals as listed; plus one deal with no value, one with no owner, one in a Disqualified stage (value 999);
// three conversations (waiting+unread 30h, pending+unread 1h, answered 5h); two appointments (one past with no outcome, one future).
const ACCOUNTS: Acct[] = [
  { loc: "xtestFltrA", name: "zzFilterAcme Dental", marker: "zzFilterAcme", industry: "Dental clinic", owner: "Sam", test: false, counted: [1111, 2222] },
  { loc: "xtestFltrB", name: "zzFilterBirch Dental", marker: "zzFilterBirch", industry: "Dental clinic", owner: "Priya", test: false, counted: [3333] },
  { loc: "xtestFltrC", name: "zzFilterZed Test Clinic", marker: "zzFilterZed", industry: "Roofing contractor", owner: "Sam", test: true, counted: [4444, 5555] },
];
const CONTACTS = 12;

const FILTERS: Array<{ label: string; query: string; shown: string[] }> = [
  { label: "no filter", query: "", shown: ["xtestFltrA", "xtestFltrB", "xtestFltrC"] },
  { label: "hide test accounts", query: "hideTest=1", shown: ["xtestFltrA", "xtestFltrB"] },
  { label: "one account manager (Sam)", query: "owner=Sam", shown: ["xtestFltrA", "xtestFltrC"] },
  { label: "one kind of business (medical)", query: "industry=medical", shown: ["xtestFltrA", "xtestFltrB"] },
  { label: "Sam, and hide test accounts", query: "owner=Sam&hideTest=1", shown: ["xtestFltrA"] },
  // The client-account picker in the filter bar (D0). An id from another company in the list changes nothing: only this company's own accounts can be picked.
  { label: "two client accounts picked", query: "accounts=xtestFltrB,xtestFltrC", shown: ["xtestFltrB", "xtestFltrC"] },
  { label: "one picked, plus a stranger's id, and hide test accounts", query: "accounts=xtestFltrA,xtestFltrC,someone-elses-id&hideTest=1", shown: ["xtestFltrA"] },
];

// Pages whose job is to manage every account (the filter options, the settings that switch access per account) or that describe the connection as a
// whole (freshness: "a filter on screen never changes it", docs/METRICS.md) are not narrowed, on purpose.
const NOT_NARROWED = ["settings", "segments", "api-keys", "roadmap", "start", "sync-status", "freshness", "goals", "call-lists", "connections", "usage"];

async function main() {
  const db = sql();
  await db`delete from installations where company_id = ${CO}`;
  const [inst] = await db`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at)
    values (${CO}, 'zzFilterAgency', 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
  const id = inst.id as string;
  await db`insert into settings (installation_id) values (${id}) on conflict do nothing`;
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
  try {
    for (const a of ACCOUNTS) {
      await db`insert into locations (installation_id, location_id, name, timezone, owner, calendar_count, pipeline_count, contacts_synced_at, opportunities_synced_at, conversations_synced_at, last_synced_at)
        values (${id}, ${a.loc}, ${a.name}, 'UTC', ${a.owner}, 1, 1, now(), now(), now(), now())`;
      await db`insert into account_profiles (installation_id, location_id, industry) values (${id}, ${a.loc}, ${a.industry})`;
      await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${id}, ${a.loc}, 'p1', 'Sales', ${db.json([{ id: "s1", name: "New" }, { id: "s3", name: "Disqualified" }] as never)})`;
      for (let k = 1; k <= CONTACTS; k++) {
        await db`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, date_added, last_activity_at)
          values (${id}, ${a.loc}, ${a.loc + "c" + k}, ${a.marker}, ${"Person" + k}, ${`p${k}@${a.marker.toLowerCase()}.test`}, ${"+1555020" + String(1000 + k)}, ${k > 8 ? ["cold email outreach"] : []}, now() - interval '200 days', now() - interval '200 days')`;
      }
      const deal = (n: string, value: number, owner: string | null, stage: string) => db`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at, created_remote_at)
        values (${id}, ${a.loc}, ${a.loc + n}, 'p1', ${stage}, ${a.loc + "c1"}, ${a.marker + " Person"}, ${a.marker + " Deal " + n}, ${value}, 'open', ${owner}, ${ago(60 * 24)}, ${ago(60 * 24)}, ${ago(60 * 24)}, ${ago(60 * 24)}, ${ago(90 * 24)})`;
      for (const [i, v] of a.counted.entries()) await deal("counted" + i, v, "u1", "s1");
      await deal("novalue", 0, "u1", "s1");
      await deal("noowner", 777, null, "s1");
      await deal("closedout", 999, "u1", "s3");
      const conv = (n: string, dir: string, hours: number, unread: number) => db`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
        values (${id}, ${a.loc}, ${a.loc + n}, ${a.loc + "c" + (2 + Number(n.slice(-1)))}, ${a.marker + " Caller"}, 'TYPE_SMS', ${dir}, ${ago(hours)}, ${unread})`;
      await conv("v1", "inbound", 30, 1);
      await conv("v2", "inbound", 1, 1);
      await conv("v3", "outbound", 5, 0);
      const appt = (n: string, daysAhead: number, status: string) => db`insert into cached_appointments (installation_id, location_id, appointment_id, calendar_id, calendar_name, contact_id, title, status, start_at, end_at, assigned_to)
        values (${id}, ${a.loc}, ${a.loc + n}, 'cal1', 'Main', ${a.loc + "c5"}, ${a.marker + " Visit"}, ${status}, ${new Date(Date.now() + daysAhead * 86_400_000)}, ${new Date(Date.now() + daysAhead * 86_400_000 + 1_800_000)}, 'u1')`;
      await appt("a1", -5, "new");
      await appt("a2", 3, "confirmed");
      await db`update locations set appointments_access = 'ok', appointments_synced_at = now() where installation_id = ${id} and location_id = ${a.loc}`;
    }
    await refreshInsights(id); // writes today's snapshot and the alerts, the way a real refresh does

    const token = signSession({ companyId: CO, userId: "u-agency", role: "admin", userName: "Tester", demo: false, kind: "agency", locationId: null, dataOwner: false });
    const get = async (path: string, query: string) => {
      const url = `${BASE}/api/app/${path}${query ? (path.includes("?") ? "&" : "?") + query : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      assert.strictEqual(res.status, 200, `${path} ${query}: ${res.status} ${text.slice(0, 200)}`);
      return text;
    };
    const json = async (path: string, query: string) => JSON.parse(await get(path, query)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const csvRows = async (kind: string, query: string) => (await get(`export/${kind}`, query)).trim().split(/\r?\n/).length - 1;

    const PAGES = [
      "overview", "accounts", "onboarding", "search?q=zzFilter", "stale", "hygiene", "inbox", "pipelines", "duplicates", "alerts", "pipeline-intel", "contact-intel", "comms-intel",
      "deal-events", "appointments", "appointment-insights", "meetings", "cleanup", "team", "clients", "daily", "email", "call-queue", "exec-summary", "daily-brief", "digest",
      "playbooks", "setup-compare", "speed", "audit", "export/accounts", "export/stale", "export/duplicates", "export/inbox", "export/deals", "export/alerts", "export/clients",
    ];

    for (const f of FILTERS) {
      const shown = ACCOUNTS.filter((a) => f.shown.includes(a.loc));
      const hidden = ACCOUNTS.filter((a) => !f.shown.includes(a.loc));
      const n = shown.length;
      const counted = shown.flatMap((a) => a.counted);
      const countedValue = counted.reduce((s, v) => s + v, 0);
      const staleCount = counted.length + 2 * n; // counted + no value + no owner (the closed-out deal is never stale)
      const q = f.query;

      // ---- (1) every page that reports a figure reports the fixture's figure
      const [ov, acc, pi, pl, ib, ci, co, st, hy, tm, cl, dl, ap, sr] = await Promise.all(
        ["overview", "accounts", "pipeline-intel", "pipelines", "inbox", "comms-intel", "contact-intel", "stale", "hygiene", "team", "clients", "daily", "appointments", "search?q=zzFilter"].map((p) => json(p, q)),
      );
      const csvCounts = await Promise.all(["accounts", "stale", "inbox", "deals"].map((kind) => csvRows(kind, q)));
      const k = ov.kpis;
      eq(k.accounts, n, `${f.label}: accounts on Overview`);
      eq(k.contacts, CONTACTS * n, `${f.label}: contacts on Overview`);
      eq(k.openOpps, counted.length, `${f.label}: open deals on Overview`);
      eq(k.openValue, countedValue, `${f.label}: open pipeline on Overview`);
      eq(k.excludedDeals, 3 * n, `${f.label}: left-out deals on Overview`);
      eq(k.excludedByStage, n, `${f.label}: of those, in a closed-out stage`);
      eq(k.unread, 2 * n, `${f.label}: unread on Overview`);
      eq(k.unanswered, n, `${f.label}: waiting on Overview`);

      eq((acc.accounts as unknown[]).length, n, `${f.label}: accounts listed`);
      eq((acc.accounts as Array<{ openValue: number }>).reduce((s, a) => s + a.openValue, 0), countedValue, `${f.label}: accounts add up to the Overview total`);

      eq(pi.totals.open, counted.length, `${f.label}: open deals on Pipeline`);
      eq(pi.totals.openValue, countedValue, `${f.label}: open pipeline on Pipeline`);
      eq(pi.excluded, { count: 3 * n, closedOut: n, noValue: n, noOwner: n }, `${f.label}: left-out deals on Pipeline`);
      eq(pi.forecast.openValue, countedValue, `${f.label}: the forecast is about the same deals`);

      eq(pl.totals.open, countedValue, `${f.label}: open value on the stage table`);

      eq(ib.waitingTotal, n, `${f.label}: waiting on Inbox`);
      eq(ib.unread.unread, 2 * n, `${f.label}: unread on Inbox is the same figure as Today and Overview`);
      eq(ib.unread.unreadAndWaiting, n, `${f.label}: of those, also waiting`);
      eq(ib.unread.unreadAndWaiting + ib.unread.unreadNotWaiting, ib.unread.unread, `${f.label}: the parts add up`);
      eq(ci.aging.total, ib.waitingTotal, `${f.label}: the wait chart counts the same customers as the list`);

      eq(co.lifecycle.total, CONTACTS * n, `${f.label}: contacts on Leads`);
      eq(co.engagement.working + co.engagement.cold, CONTACTS * n, `${f.label}: working leads plus cold lists are every contact`);
      eq(co.engagement.cold, 4 * n, `${f.label}: the cold-tagged contacts`);

      eq((st.deals as unknown[]).length, staleCount, `${f.label}: stale deals`);
      eq(hy.totals.open, staleCount, `${f.label}: deals in the hygiene view (the closed-out deal is not a data problem)`);
      eq((tm.members as Array<{ openCount: number }>).reduce((s, m) => s + m.openCount, 0), counted.length, `${f.label}: a person's open deals add up to the Pipeline`);
      eq((cl.clients as unknown[]).length, n, `${f.label}: clients`);
      eq(dl.accounts, n, `${f.label}: accounts on Today`);
      const unreadToday = (dl.headlines as Array<{ key: string; change: { today: number } }>).find((h) => h.key === "unread")!.change.today;
      eq(unreadToday, 2 * n, `${f.label}: unread on Today equals unread on Inbox`);
      eq(ap.unmarkedTotal, n, `${f.label}: appointments with no outcome`);
      eq(csvCounts[0], n, `${f.label}: accounts export`);
      eq(csvCounts[1], staleCount, `${f.label}: stale deals export`);
      eq(csvCounts[2], 2 * n, `${f.label}: inbox export (the two unread conversations of each account; the answered one is not in the inbox)`);
      eq(csvCounts[3], counted.length, `${f.label}: open deals export`);
      eq((sr.hits as unknown[]).length, CONTACTS * n, `${f.label}: contact search`);

      // ---- (2) nothing about a hidden account appears anywhere
      const bodies = await pool(PAGES, 8, async (page) => ({ page, body: await get(page, q) }));
      for (const { page, body: raw } of bodies) {
        let body = raw;
        // The freshness line is the one thing a filter never changes (stage S0.4, docs/METRICS.md): it states how old the data of everything the
        // person may see is, so it is never made to look fresher by hiding the stalest account. It is left out of the search for hidden accounts.
        try { const parsed = JSON.parse(body) as Record<string, unknown>; delete parsed.freshness; body = JSON.stringify(parsed); } catch { /* a CSV export */ }
        for (const h of hidden) {
          ok(!body.includes(h.marker) && !body.includes(h.loc), `${f.label}: ${page} still shows the hidden account ${h.name}`);
        }
      }
      console.log(`  ${f.label}: ${n} of 3 accounts (${failures.length} disagreements so far), ${PAGES.length} pages checked, same figures on every page, no hidden account anywhere: ok`);
    }
    if (failures.length > 0) {
      console.error(`filter: ${failures.length} disagreements`);
      for (const f of failures) console.error("  - " + f);
      process.exitCode = 1;
    } else console.log(`filter: the same filter gives the same numbers on every page (${FILTERS.length} filters, ${PAGES.length} pages, ${NOT_NARROWED.length} pages that manage every account on purpose): ok`);
  } finally {
    await db`delete from installations where company_id = ${CO}`;
    await closeDb();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
