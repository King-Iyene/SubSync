import { afterAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/lib/db";

// Every stored token or secret in the real database is in our encrypted format (AES-256-GCM, "v1.iv.tag.ciphertext"),
// never a readable token. Only the shape is checked; no value is ever printed. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const FORMAT = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

describe.skipIf(!HAS_DB)("tokens and secrets are encrypted at rest", () => {
  afterAll(async () => { await closeDb(); });

  it("installations: access and refresh tokens", async () => {
    const rows = await sql()`select company_id, access_token_enc, refresh_token_enc from installations where access_token_enc is not null or refresh_token_enc is not null`;
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows.filter((r) => (r.access_token_enc && !FORMAT.test(r.access_token_enc as string)) || (r.refresh_token_enc && !FORMAT.test(r.refresh_token_enc as string))).length;
    expect(bad, "rows whose token is not in the encrypted format").toBe(0);
  });
  it("connections: access token, refresh token and webhook secret", async () => {
    const rows = await sql()`select access_token_enc, refresh_token_enc, webhook_secret_enc from connections`;
    const bad = rows.filter((r) => [r.access_token_enc, r.refresh_token_enc, r.webhook_secret_enc].some((v) => v && !FORMAT.test(v as string))).length;
    expect(bad, "rows with a secret that is not in the encrypted format").toBe(0);
  });
  it("API keys are stored only as a hash and a short prefix", async () => {
    const cols = (await sql()`select column_name from information_schema.columns where table_name = 'api_keys' order by column_name`).map((c) => c.column_name as string);
    expect(cols).toContain("key_hash");
    expect(cols).not.toContain("key");
    expect(cols).not.toContain("secret");
    const rows = await sql()`select key_hash from api_keys`;
    for (const r of rows) expect(r.key_hash as string).toMatch(/^[a-f0-9]{64}$/);
  });
  it("meeting hooks keep only a hash of their private address", async () => {
    const rows = await sql()`select token_hash from meeting_hooks`;
    for (const r of rows) expect(r.token_hash as string).toMatch(/^[a-f0-9]{64}$/);
  });
});
