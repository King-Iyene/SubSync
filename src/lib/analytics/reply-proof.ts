import { randomBytes } from "node:crypto";
import { sql } from "../db";
import {
  chainHash, GENESIS_HASH, MIN_PROOF_LEADS, payloadHash, PROOF_METHOD, proofTextProblems, signHash, verifyPage, type ProofPayload, type Verification,
} from "./moat-core";

// D6. A shareable, agency-branded reply-time page for one client account. The numbers are MEASURED here from the account's own records (never typed in), the snapshot is
// stored with a hash chain (and an optional signature from PROOF_SIGNING_SECRET) so an edited page no longer verifies, and the owner can switch a link off.

export const PROOF_ID = /^[A-Za-z0-9_-]{20,64}$/;
export const PROOF_DAYS = 30;
const secret = () => process.env.PROOF_SIGNING_SECRET || null;

export type ProofBrand = { name: string; color: string | null; logoUrl: string | null };

/** The measured figures for one account over the last 30 days: reply times from first person reply, within-target share against the account's target. */
export async function measureAccount(installationId: string, locationId: string, countAutomated: boolean, defaultTarget: number, businessHours: boolean) {
  const db = sql();
  const reply = countAutomated ? db`coalesce(t.human_touch_at, t.touch_at)` : db`t.human_touch_at`;
  const [r] = await db`
    select coalesce(l.name, 'Client account') name, coalesce(l.speed_target_minutes, ${defaultTarget})::int target,
      count(t.id)::int leads, count(${reply})::int answered,
      percentile_cont(0.5) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) filter (where ${reply} is not null) med,
      percentile_cont(0.9) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) filter (where ${reply} is not null) p90,
      count(*) filter (where ${reply} is not null and extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60 <= coalesce(l.speed_target_minutes, ${defaultTarget}))::int within
    from locations l
    left join lead_touches t on t.installation_id = l.installation_id and t.location_id = l.location_id and t.excluded is null
      and t.lead_at > now() - make_interval(days => ${PROOF_DAYS}) and t.lead_at < now() - interval '1 hour'
    where l.installation_id = ${installationId} and l.location_id = ${locationId} and not l.ignored
    group by l.name, l.speed_target_minutes`;
  if (!r) return null;
  const leads = Number(r.leads), answered = Number(r.answered);
  return {
    account: r.name as string, targetMinutes: Number(r.target), leads, answered, neverAnswered: leads - answered,
    medianMinutes: r.med === null ? null : Math.round(Number(r.med)), p90Minutes: r.p90 === null ? null : Math.round(Number(r.p90)),
    withinTargetPct: leads ? Math.round((Number(r.within) / leads) * 100) : null, clock: (businessHours ? "working hours" : "every hour") as ProofPayload["clock"],
  };
}

export type CreateResult = { ok: true; id: string; seq: number } | { ok: false; error: string };

export async function createProofPage(i: { installationId: string; locationId: string; by: string | null; brand: ProofBrand; countAutomated: boolean; defaultTarget: number; businessHours: boolean }): Promise<CreateResult> {
  const m = await measureAccount(i.installationId, i.locationId, i.countAutomated, i.defaultTarget, i.businessHours);
  if (!m) return { ok: false, error: "That client account was not found" };
  if (m.leads < MIN_PROOF_LEADS) return { ok: false, error: `Not enough leads yet: ${MIN_PROOF_LEADS - m.leads} more needed in the last ${PROOF_DAYS} days` };
  const now = new Date();
  const payload: ProofPayload = {
    kind: "reply_time_proof", brand: i.brand, account: m.account,
    periodFrom: new Date(now.getTime() - PROOF_DAYS * 86_400_000).toISOString().slice(0, 10), periodTo: now.toISOString().slice(0, 10),
    leads: m.leads, answered: m.answered, neverAnswered: m.neverAnswered, medianMinutes: m.medianMinutes, p90Minutes: m.p90Minutes,
    withinTargetPct: m.withinTargetPct, targetMinutes: m.targetMinutes, clock: m.clock, measuredAt: now.toISOString(), method: PROOF_METHOD,
  };
  const text = `${payload.brand.name} ${payload.account}`;
  if (proofTextProblems(text).length) return { ok: false, error: "The business or account name contains a word that cannot be shown on this page" };
  const id = randomBytes(24).toString("base64url");
  const db = sql();
  const created = await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"proof:" + i.installationId}, 0))`;
    const [prev] = await tx`select seq, chain_hash from reply_proof_pages where installation_id = ${i.installationId} order by seq desc limit 1`;
    const seq = prev ? Number(prev.seq) + 1 : 1;
    const prevHash = prev ? (prev.chain_hash as string) : GENESIS_HASH;
    const pHash = payloadHash(payload);
    const createdAt = new Date();
    const cHash = chainHash(prevHash, pHash, createdAt.toISOString());
    const sig = secret() ? signHash(cHash, secret() as string) : null;
    await tx`insert into reply_proof_pages (id, installation_id, location_id, seq, payload, payload_hash, prev_hash, chain_hash, signature, created_by, created_at)
      values (${id}, ${i.installationId}, ${i.locationId}, ${seq}, ${tx.json(payload as never)}, ${pHash}, ${prevHash}, ${cHash}, ${sig}, ${i.by}, ${createdAt})`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${i.installationId}, ${i.by ?? "unknown"}, 'reply_proof.created', ${tx.json({ ref: id.slice(-6), seq } as never)})`;
    return seq;
  });
  return { ok: true, id, seq: created };
}

export async function listProofPages(installationId: string, allowed: string[] | null) {
  const rows = await sql()`
    select id, location_id, seq, created_at, expires_at, revoked_at, views, last_viewed_at, payload->>'account' account
    from reply_proof_pages where installation_id = ${installationId} and (${allowed === null} or location_id = any(${allowed ?? []}::text[]))
    order by created_at desc limit 50`;
  return rows.map((r) => ({
    id: r.id as string, locationId: r.location_id as string, seq: Number(r.seq), account: r.account as string, createdAt: (r.created_at as Date).toISOString(),
    expiresAt: (r.expires_at as Date).toISOString(), revoked: r.revoked_at !== null, views: Number(r.views),
  }));
}

/** Switches a link off. Only the installation that made it can (and only for accounts the caller may read). */
export async function revokeProofPage(installationId: string, allowed: string[] | null, id: string, by: string | null): Promise<boolean> {
  if (!PROOF_ID.test(id)) return false;
  const done = await sql()`update reply_proof_pages set revoked_at = now()
    where id = ${id} and installation_id = ${installationId} and revoked_at is null and (${allowed === null} or location_id = any(${allowed ?? []}::text[])) returning id`;
  if (done.length) await sql()`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${by ?? "unknown"}, 'reply_proof.revoked', ${sql().json({ ref: id.slice(-6) } as never)})`;
  return done.length > 0;
}

/** The public read: a page opens only while it is not expired and not switched off. The id alone is the key (192 random bits). Returns the verification with it. */
export async function findProofPage(id: string): Promise<{ payload: ProofPayload; expiresAt: Date; verification: Verification; seq: number; chainHash: string } | null> {
  if (!PROOF_ID.test(id)) return null;
  const db = sql();
  const [row] = await db`select * from reply_proof_pages where id = ${id} and expires_at > now() and revoked_at is null`;
  if (!row) return null;
  const [prev] = Number(row.seq) > 1
    ? await db`select chain_hash from reply_proof_pages where installation_id = ${row.installation_id} and seq = ${Number(row.seq) - 1}`
    : [undefined];
  const verification = verifyPage({
    payload: row.payload, payloadHash: row.payload_hash as string, prevHash: row.prev_hash as string, chainHash: row.chain_hash as string,
    createdAtIso: (row.created_at as Date).toISOString(), signature: (row.signature as string | null) ?? null,
  }, prev ? (prev.chain_hash as string) : null, secret());
  await db`update reply_proof_pages set views = views + 1, last_viewed_at = now() where id = ${id}`.catch(() => undefined);
  return { payload: row.payload as ProofPayload, expiresAt: row.expires_at as Date, verification, seq: Number(row.seq), chainHash: row.chain_hash as string };
}
