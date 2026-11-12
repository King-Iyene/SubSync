import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { findPublic } from "@/lib/analytics/proof-queries";
import { periodChoices } from "@/lib/analytics/proof-core";

// Cross-tenant test for the branded client Proof page and monthly report:
//   1. Each company lists, prepares, edits, shares, takes back and replaces links only for its OWN client accounts; the other company's account id answers "not found" and is never echoed.
//   2. The public page is opened by the token alone: it shows that one account's totals, never a contact's name, never the other company's data; a forged, malformed, switched-off or replaced token finds nothing.
//   3. A figure with too little behind it is null (never a made-up zero); a shared report does not change when prepared again; a report with a vendor word or a promise is refused.
//   4. Replacing or switching off a link needs the typed account name.
// Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-pr-a", CO_B = "xtest-pr-b", A1 = "xtestPrA1", A2 = "xtestPrA2", B1 = "xtestPrB1";
let instA = "", instB = "", ready = false;
const MONTH = periodChoices(new Date())[0];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client" = "agency", loc: string | null = null) =>
  signSession({ companyId: company, userId: `u-${company}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, ...(kind === "agency" ? { personRole: "agency_owner" as const } : {}) });
async function call(token: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}
const tokenOf = (url: string) => url.split("/proof/")[1];
const at = (day: number, hour = 12) => { const [y, m] = MONTH.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day, hour)); };

async function seed(inst: string, loc: string, tag: string, leads: number) {
  await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values (${inst}, ${loc}, ${`zzPr ${tag}`}, 'UTC', true, 'ok', now())`;
  for (let i = 0; i < leads; i++) {
    await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, human_touch_at, touch_at) values (${inst}, ${loc}, ${`xtest-c-${loc}-${i}`}, ${`xtest-v-${loc}-${i}`}, ${at(5 + (i % 15))}, ${i === 0 ? null : at(5 + (i % 15), 12)}, ${i === 0 ? null : new Date(at(5 + (i % 15), 12).getTime() + (i % 3 === 0 ? 3 : 20) * 60_000)})`;
    await sql()`update lead_touches set human_touch_at = touch_at where installation_id = ${inst} and location_id = ${loc} and conversation_id = ${`xtest-v-${loc}-${i}`}`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, tags) values (${inst}, ${loc}, ${`xtest-c-${loc}-${i}`}, ${`Zed${tag}`}, ${`Person${i}`}, '{}')`;
  }
  await sql()`insert into client_daily (installation_id, location_id, day, new_leads, booked, showed, noshow, won, won_value) values (${inst}, ${loc}, ${at(8).toISOString().slice(0, 10)}, ${leads}, 6, 4, 1, 2, 4321)`;
  await sql()`insert into td_receipts (installation_id, location_id, week_start, found, cleared, still_open, median_fix_minutes) values (${inst}, ${loc}, ${MONTH + "-01"}, 5, 4, 1, 30)`;
  await sql()`insert into cf_recover_items (installation_id, location_id, kind, contact_id, ref_id, contact_name, since_at, recovered_at, recovered_how) values (${inst}, ${loc}, 'unanswered', ${`xtest-c-${loc}-1`}, '', ${`Zed${tag} Person1`}, ${at(6)}, ${at(7)}, 'replied')`;
}

describe.skipIf(!HAS_DB)("client Proof page cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from pr_reports limit 1`; await sql()`select 1 from pr_links limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'Brightside Marketing', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'Zeta Media', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await seed(instA, A1, "A1", 12);
    await seed(instA, A2, "A2", 2); // too few leads to measure a reply time
    await seed(instB, B1, "B1", 12);
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("lists only its own accounts, counts equal rows, and refuses another company's account", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    const la = await call(a, "GET", `proof?part=list&period=${MONTH}&size=50`);
    expect(la.status).toBe(200);
    expect(la.body.rows.map((r: Json) => r.locationId).sort()).toEqual([A1, A2]);
    expect(la.body.total).toBe(2);
    expect(la.body.counts.none).toBe(2);
    expect(la.text).not.toContain("zzPr B1");
    const lb = await call(b, "GET", `proof?part=list&period=${MONTH}&size=50`);
    expect(lb.body.rows.map((r: Json) => r.locationId)).toEqual([B1]);
    for (const [m, p, body] of [["POST", "proof/prepare", { locationId: B1, month: MONTH }], ["GET", `proof?part=report&account=${B1}&period=${MONTH}`, undefined], ["POST", "proof/share", { locationId: B1, month: MONTH }], ["POST", "proof/unshare", { locationId: B1, month: MONTH }],
      ["PUT", "proof/report", { locationId: B1, month: MONTH, intro: "x" }], ["POST", "proof/link", { locationId: B1, month: MONTH, action: "revoke", confirm: "zzPr B1" }]] as const) {
      const r = await call(a, m, p, body);
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(r.text).not.toContain(B1);
    }
    expect((await call(a, "GET", `proof?part=list&period=${MONTH}&q=B1`)).body.rows).toEqual([]);
  });

  it("an account user and a forged or unsigned session cannot reach it", async () => {
    if (!ready) return;
    expect((await call(session(CO_A, "client", A1), "GET", `proof?part=list&period=${MONTH}`)).status).toBe(403);
    expect((await call("forged.token.value", "GET", `proof?part=list&period=${MONTH}`)).status).toBe(401);
    expect((await call(session(CO_A), "GET", "proof?part=list&period=2999-01")).status).toBe(400);
    expect((await call(session(CO_A), "POST", "proof/prepare", { locationId: A1, month: "../../x" })).status).toBe(400);
  });

  it("prepares from its own records; a figure with too little behind it is null, never zero", async () => {
    if (!ready) return;
    const a = session(CO_A);
    expect((await call(a, "POST", "proof/prepare", { locationId: A1, month: MONTH })).status).toBe(200);
    expect((await call(a, "POST", "proof/prepare", { locationId: A2, month: MONTH })).status).toBe(200);
    const r1 = (await call(a, "GET", `proof?part=report&account=${A1}&period=${MONTH}`)).body;
    const p1 = r1.report.payload;
    expect(p1.leads.current).toBe(12);
    expect(p1.withinTarget.current).not.toBeNull();
    expect(p1.replyMedian.current).not.toBeNull();
    expect(p1.booked.current).toBe(6);
    expect(p1.noShowRate.current).toBe(20); // 1 no-show of 5 with an outcome
    expect(p1.won.deals.current).toBe(2);
    expect(p1.won.value.current).toBe(4321);
    expect(p1.recovered.current).toBe(1);
    expect(p1.caught).toMatchObject({ found: 5, fixed: 4, stillOpen: 1 });
    expect(p1.timeline.length).toBeGreaterThan(0);
    expect(JSON.stringify(r1)).not.toMatch(/Zed|Person\d|zzPr B1|xtest-c-/i);
    const p2 = (await call(a, "GET", `proof?part=report&account=${A2}&period=${MONTH}`)).body.report.payload;
    expect(p2.replyMedian.current).toBeNull();
    expect(p2.withinTarget.current).toBeNull();
    expect(p2.neverAnswered).toBeNull();
    expect(p2.trend).toHaveLength(6);
    expect(p2.trend.every((t: Json) => t.withinPct === null)).toBe(true);
  });

  it("the public page is opened by the token alone and shows one account's totals only", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    await call(b, "POST", "proof/prepare", { locationId: B1, month: MONTH });
    const sa = await call(a, "POST", "proof/share", { locationId: A1, month: MONTH });
    const sb = await call(b, "POST", "proof/share", { locationId: B1, month: MONTH });
    expect(sa.status).toBe(200);
    const ta = tokenOf(sa.body.url), tb = tokenOf(sb.body.url);
    expect(ta).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ta).not.toBe(tb);
    const pa = await findPublic(ta, null), pb = await findPublic(tb, null);
    expect(pa?.report?.payload.account).toBe("zzPr A1");
    expect(pb?.report?.payload.account).toBe("zzPr B1");
    expect(JSON.stringify(pa)).not.toMatch(/zzPr B1|Zeta Media|Zed|Person\d|xtest-c-|xtestPrB1|xtestPrA1|installation|location_id/i);
    expect(pa?.brand.name).toBe("Brightside Marketing");
    // Forged and malformed tokens find nothing, including a real token with one character changed and another company's token with this company's hash.
    expect(await findPublic("A".repeat(43), null)).toBeNull();
    expect(await findPublic(ta.slice(0, -1) + (ta.endsWith("A") ? "B" : "A"), null)).toBeNull();
    expect(await findPublic("short", null)).toBeNull();
    expect(await findPublic(ta + "x", null)).toBeNull();
    expect(await findPublic("' or 1=1 --" + "A".repeat(40), null)).toBeNull();
    // The list shows the link's opens as a count only.
    const row = (await call(a, "GET", `proof?part=list&period=${MONTH}`)).body.rows.find((r: Json) => r.locationId === A1);
    expect(row.status).toBe("viewed");
    expect(row.views).toBeGreaterThanOrEqual(1);
    expect(Object.keys(row)).not.toContain("ip");
  });

  it("a shared report does not change when prepared again, and can be taken back to a draft", async () => {
    if (!ready) return;
    const a = session(CO_A);
    const before = (await call(a, "GET", `proof?part=report&account=${A1}&period=${MONTH}`)).body.report;
    expect(before.status).toBe("shared");
    const again = await call(a, "POST", "proof/prepare", { locationId: A1, month: MONTH });
    expect(again.body.kept).toBe(true);
    expect((await call(a, "GET", `proof?part=report&account=${A1}&period=${MONTH}`)).body.report.builtAt).toBe(before.builtAt);
    expect((await call(a, "PUT", "proof/report", { locationId: A1, month: MONTH, intro: "x" })).status).toBe(409);
    expect((await call(a, "POST", "proof/unshare", { locationId: A1, month: MONTH })).body.ok).toBe(true);
    expect((await call(a, "PUT", "proof/report", { locationId: A1, month: MONTH, intro: "Thanks for trusting us." })).status).toBe(200);
    expect((await call(a, "POST", "proof/share", { locationId: A1, month: MONTH })).status).toBe(200);
  });

  it("replacing or switching off a link needs the typed account name; the old token stops working", async () => {
    if (!ready) return;
    const a = session(CO_A);
    const cur = (await call(a, "GET", `proof?part=report&account=${A1}&period=${MONTH}`)).body.link.url as string;
    const t0 = tokenOf(cur);
    expect((await call(a, "POST", "proof/link", { locationId: A1, month: MONTH, action: "regenerate", confirm: "wrong" })).status).toBe(400);
    expect((await call(a, "POST", "proof/link", { locationId: A1, month: MONTH, action: "regenerate" })).status).toBe(400);
    expect((await findPublic(t0, null))?.report).not.toBeNull();
    const re = await call(a, "POST", "proof/link", { locationId: A1, month: MONTH, action: "regenerate", confirm: " ZZPR a1 " });
    expect(re.status).toBe(200);
    const t1 = tokenOf(re.body.url);
    expect(t1).not.toBe(t0);
    expect(await findPublic(t0, null)).toBeNull();
    expect((await findPublic(t1, null))?.report?.payload.account).toBe("zzPr A1");
    expect((await call(a, "POST", "proof/link", { locationId: A1, month: MONTH, action: "revoke", confirm: "zzPr A1" })).body.ok).toBe(true);
    expect(await findPublic(t1, null)).toBeNull();
    const off = (await call(a, "GET", `proof?part=report&account=${A1}&period=${MONTH}`)).body.link;
    expect(off.revoked).toBe(true);
    expect(off.url).toBeNull();
    const again = await call(a, "POST", "proof/share", { locationId: A1, month: MONTH });
    expect(tokenOf(again.body.url)).not.toBe(t1);
    expect(await findPublic(t1, null)).toBeNull();
  });

  it("text with the platform's name or a promise is refused, and settings only change this company's own brand", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    await call(a, "POST", "proof/unshare", { locationId: A1, month: MONTH });
    expect((await call(a, "PUT", "proof/report", { locationId: A1, month: MONTH, intro: "Built on GoHighLevel" })).status).toBe(400);
    expect((await call(a, "PUT", "proof/report", { locationId: A1, month: MONTH, intro: "We guarantee results" })).status).toBe(400);
    expect((await call(a, "PUT", "proof/settings", { displayName: "My sub-account" })).status).toBe(400);
    expect((await call(a, "PUT", "proof/settings", { brandColor: "red" })).status).toBe(400);
    expect((await call(a, "PUT", "proof/settings", { logoUrl: "http://example.com/x.png" })).status).toBe(400);
    expect((await call(a, "PUT", "proof/settings", { displayName: "Brightside", brandColor: "#12AB34", intro: "Hello", nameStaff: true })).status).toBe(200);
    const opts = (await call(b, "GET", "proof?part=options")).body;
    expect(opts.settings.displayName).toBeNull();
    expect(opts.settings.nameStaff).toBe(false);
    expect((await call(a, "GET", "proof?part=options")).body.settings).toMatchObject({ displayName: "Brightside", brandColor: "#12ab34", nameStaff: true });
  });

  it("prepare all makes drafts only for this company's accounts that have none, and a second call has nothing left", async () => {
    if (!ready) return;
    const b = session(CO_B);
    await sql()`delete from pr_reports where installation_id = ${instB}`;
    const r = await call(b, "POST", "proof/prepare-all", { month: MONTH });
    expect(r.body).toMatchObject({ ok: true, prepared: 1, remaining: 0 });
    expect((await call(b, "POST", "proof/prepare-all", { month: MONTH })).body).toMatchObject({ prepared: 0, remaining: 0 });
    expect((await sql()`select count(*)::int n from pr_reports where installation_id = ${instA}`)[0].n).toBeGreaterThan(0);
    expect((await sql()`select count(*)::int n from pr_reports where installation_id = ${instB} and location_id <> ${B1}`)[0].n).toBe(0);
  });
});
