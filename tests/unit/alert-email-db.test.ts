import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { emailPendingAlerts } from "@/lib/analytics/service";
import { getSettings } from "@/lib/analytics/queries";
import type { Mail } from "@/lib/email";

// Alert emails against the real database, on a fixture company removed afterwards: each alert is emailed once, a failed send is retried,
// quiet hours hold warnings (never criticals) until the morning, and resolved, informational and week-old alerts are never sent.
// The sender is a stand-in that records what would have been sent. Skipped with no database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-alertmail-co";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let inst = "";
const sent: Array<{ to: string; mail: Mail }> = [];
let failNext = false;
const sender = async (to: string, mail: Mail) => { if (failNext) { failNext = false; return false; } sent.push({ to, mail }); return true; };
const at = (hour: number) => new Date(Date.UTC(2026, 10, 3, hour, 0, 0)); // 3 Nov 2026, UTC
const emailed = async () => (await sql()`select title from alerts where installation_id = ${inst} and email_notified_at is not null order by title`).map((r) => r.title as string);

async function alert(key: string, severity: string, title: string, extra = "") {
  await sql().unsafe(`insert into alerts (installation_id, kind, severity, title, dedupe_key ${extra ? ", " + extra.split("=")[0] : ""}) values ('${inst}', 'sla', '${severity}', '${title}', '${key}' ${extra ? ", " + extra.split("=")[1] : ""})`);
}

describe.skipIf(!HAS_DB)("alert emails: once, retried, quiet hours", () => {
  beforeAll(async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "SubSync <hello@example.test>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    await sql()`delete from installations where company_id = ${CO}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzAlertMail', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into settings (installation_id, digest_email, digest_timezone, alert_quiet_hours) values (${inst}, 'owner@example.test', 'UTC', true)
      on conflict (installation_id) do update set digest_email = 'owner@example.test', digest_timezone = 'UTC', alert_quiet_hours = true`;
    await alert("k-crit", "critical", "A critical alert");
    await alert("k-warn", "warning", "A warning alert");
    await alert("k-info", "info", "An informational alert");
    await alert("k-old", "warning", "A week-old warning", "created_at=now() - interval '9 days'");
    await alert("k-done", "warning", "A resolved warning", "resolved_at=now()");
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; vi.unstubAllEnvs(); await closeDb(); });

  const run = async (hour: number) => emailPendingAlerts(inst, await getSettings(inst), at(hour), sender);

  it("in quiet hours only the critical alert goes out", async () => {
    expect(await run(23)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].mail.text).toContain("A critical alert");
    expect(sent[0].mail.text).not.toContain("A warning alert");
    expect(await emailed()).toEqual(["A critical alert"]);
  });

  it("the email carries the stop link and the one-click header", () => {
    const m = sent[0].mail;
    expect(m.text).toMatch(/Stop these emails: https:\/\/app\.example\.test\/api\/email\/unsubscribe\?t=/);
    expect(m.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.test\/api\/email\/unsubscribe\?t=/);
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("a second run in quiet hours sends nothing: the critical one is not emailed twice and the warning still waits", async () => {
    expect(await run(23)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("a failed send is not marked as sent, so it is retried on the next run", async () => {
    failNext = true;
    expect(await run(8)).toBe(0);
    expect(await emailed()).toEqual(["A critical alert"]);
    expect(await run(8)).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].mail.text).toContain("A warning alert");
  });

  it("in the morning the warning goes out once; informational, resolved and week-old alerts never do; then nothing is left", async () => {
    expect(await emailed()).toEqual(["A critical alert", "A warning alert"]);
    expect(await run(9)).toBe(0);
    expect(sent).toHaveLength(2);
    for (const never of ["An informational alert", "A resolved warning", "A week-old warning"]) expect(await emailed()).not.toContain(never);
  });

  it("with quiet hours switched off a warning goes out at night", async () => {
    await sql()`update settings set alert_quiet_hours = false where installation_id = ${inst}`;
    await alert("k-warn2", "warning", "A second warning");
    expect(await run(23)).toBe(1);
    expect(sent[sent.length - 1].mail.text).toContain("A second warning");
  });

  it("no address means no email", async () => {
    await sql()`update settings set digest_email = null where installation_id = ${inst}`;
    await alert("k-warn3", "warning", "A third warning");
    expect(await run(12)).toBe(0);
  });
});
