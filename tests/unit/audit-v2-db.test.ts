import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { staleDealList, waitingList } from "@/lib/analytics/audit-queries";
import { findShared, revokeShared } from "@/lib/analytics/share-queries";
import { buildSharePayload } from "@/lib/analytics/share-intel";
import { buildAuditV2, healthyLines } from "@/lib/analytics/audit-v2";
import { shareSourceOf } from "@/lib/analytics/audit-v2";

// The rebuilt Account audit against the real database (two fixture companies, removed afterwards; neither has a refresh token, so the production scheduler ignores
// them). Skipped when no database is configured. Covers: the share link's safety rules (a link opens only while it is live, a wrong token opens nothing, only the
// company that made a link can switch it off, a view is counted only on a live link, and nothing names an account) and the list reads at 150 client accounts.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-audit-a", CO_B = "xtest-audit-b";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const token = () => randomBytes(24).toString("base64url");
let instA = "", instB = "";

async function mkInstall(company: string) {
  await sql()`delete from installations where company_id = ${company}`;
  const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${company}, ${"zz" + company}, 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
  await sql()`insert into settings (installation_id) values (${i.id}) on conflict do nothing`;
  return i.id as string;
}
async function shareRow(inst: string, id: string, o: { expires: string; revoked?: boolean }) {
  const payload = buildSharePayload(shareSourceOf(buildAuditV2({
    now: Date.now(), staleDays: 30, slaHours: 4, scope: "all", accounts: [], stale: { items: [], total: 0, totalValue: 0 },
    waiting: { leads: [], leadsTotal: 0, conversations: [], conversationsTotal: 0 }, noshows: { items: [], total: 0 }, appointments: { items: [], total: 0 },
  }), healthyLines({ scope: "all", leadsInTarget: null, showRate: null, openValue: 0, staleValue: 0, clean: { replies: true, stale: true, noshows: true, appointments: true } }), 3), "Acme Agency", ["Secret Client Ltd"]);
  await sql()`insert into shared_audits (installation_id, id, payload, expires_at, revoked_at) values (${inst}, ${id}, ${sql().json(payload as never)}, ${o.expires === "past" ? sql()`now() - interval '1 minute'` : sql()`now() + interval '14 days'`}, ${o.revoked ? sql()`now()` : null})`;
}

describe.skipIf(!HAS_DB)("the share link of the audit", () => {
  const live = token(), expired = token(), revoked = token();
  beforeAll(async () => {
    instA = await mkInstall(CO_A); instB = await mkInstall(CO_B);
    await shareRow(instA, live, { expires: "future" });
    await shareRow(instA, expired, { expires: "past" });
    await shareRow(instA, revoked, { expires: "future", revoked: true });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("a live link opens, and the snapshot holds no account name", async () => {
    const f = await findShared(live);
    expect(f).not.toBeNull();
    expect(f!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(JSON.stringify(f!.payload)).not.toContain("Secret Client Ltd");
  });

  it("an expired link, a switched-off link, a wrong token and a malformed id open nothing", async () => {
    expect(await findShared(expired)).toBeNull();
    expect(await findShared(revoked)).toBeNull();
    expect(await findShared(token())).toBeNull();
    expect(await findShared(live.slice(0, -1) + (live.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await findShared("short")).toBeNull();
    expect(await findShared("a'; drop table shared_audits; --")).toBeNull();
  });

  it("a view is counted only on a live link", async () => {
    const before = (await sql()`select views from shared_audits where id = ${live}`)[0].views as number;
    await findShared(live);
    expect((await sql()`select views from shared_audits where id = ${live}`)[0].views as number).toBe(before + 1);
    await findShared(expired); await findShared(revoked);
    expect((await sql()`select views from shared_audits where id = ${expired}`)[0].views as number).toBe(0);
    expect((await sql()`select views from shared_audits where id = ${revoked}`)[0].views as number).toBe(0);
  });

  it("only the company that made a link can switch it off; the id alone is not enough", async () => {
    expect(await revokeShared(instB, live), "another company").toBe(false);
    expect(await findShared(live)).not.toBeNull();
    expect(await revokeShared(instA, "short")).toBe(false);
    expect(await revokeShared(instA, live)).toBe(true);
    expect(await findShared(live), "switched off, it no longer opens").toBeNull();
    expect(await revokeShared(instA, live), "already off").toBe(false);
  });
});

describe.skipIf(!HAS_DB)("reading the lists behind the audit at 150 client accounts", () => {
  const ids = Array.from({ length: 150 }, (_, i) => `xtestAuditLoc${i}`);
  beforeAll(async () => {
    instA = await mkInstall(CO_A); instB = await mkInstall(CO_B);
    const db = sql();
    await db`insert into locations ${db(ids.map((l, i) => ({ installation_id: instA, location_id: l, name: `Audit Fixture ${i}`, timezone: "UTC", ignored: false })))}`;
    await db`insert into pipelines ${db(ids.map((l) => ({ installation_id: instA, location_id: l, pipeline_id: "p1", name: "Sales", stages: db.json([{ id: "s1", name: "New" }] as never) })))}`;
    const deals = ids.flatMap((l, i) => Array.from({ length: 1 + (i % 3) }, (_, d) => ({
      installation_id: instA, location_id: l, opportunity_id: `${l}-d${d}`, pipeline_id: "p1", stage_id: "s1", contact_id: `${l}-c${d}`, contact_name: `Contact ${i}-${d}`, name: `Deal ${i}-${d}`,
      monetary_value: 1000 * (i + 1), status: "open", assigned_to: "u1", last_stage_change_at: ago(60), last_action_at: ago(60), updated_remote_at: ago(60), last_status_change_at: ago(60), created_remote_at: ago(90),
    })));
    await db`insert into cached_opportunities ${db(deals)}`;
    const convs = ids.flatMap((l, i) => Array.from({ length: i % 4 }, (_, c) => ({
      installation_id: instA, location_id: l, conversation_id: `${l}-v${c}`, contact_id: `${l}-c${c}`, contact_name: `Person ${i}-${c}`, last_message_type: "TYPE_SMS", last_message_direction: "inbound", last_message_at: hoursAgo(6 + c), unread_count: 0,
    })));
    await db`insert into cached_conversations ${db(convs)}`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("every deal gone quiet and every waiting conversation is counted, with a true total past the row cap, and nothing from another company", async () => {
    const wantDeals = ids.reduce((s, _, i) => s + 1 + (i % 3), 0);
    const wantConvs = ids.reduce((s, _, i) => s + (i % 4), 0);
    const all = await staleDealList(instA, ids, 30, 3000);
    expect(all.total).toBe(wantDeals);
    expect(all.rows).toHaveLength(wantDeals);
    const capped = await staleDealList(instA, ids, 30, 100);
    expect(capped.rows).toHaveLength(100);
    expect(capped.total, "the total stays true under a cap").toBe(wantDeals);
    const conv = await waitingList(instA, ids, 4, 3000);
    expect(conv.total).toBe(wantConvs);
    expect((await staleDealList(instB, ids, 30, 3000)).total, "another company reads nothing of these accounts").toBe(0);
    expect((await waitingList(instB, ids, 4, 3000)).total).toBe(0);
  });
});
