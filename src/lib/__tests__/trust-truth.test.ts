import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMPANY, PROCESSORS } from "../company.ts";
import { deleteMyDataText, INVENTORY, NEVER_STORED, SHARE_LINK_DAYS, storeLines, uninstallText } from "../data-inventory.ts";
import { DEFAULT_OFF } from "../flags-core.ts";
import { GHL_SCOPES } from "../ghl/scopes.ts";
import { SCOPE_GROUPS } from "../scope-groups.ts";
import { CLAIMS, COMMITMENTS, trustSections, trustText } from "../trust.ts";
import { schemaFromMigrations } from "../../../tests/fixtures/schema-from-migrations.ts";

// N75 and the stage's acceptance: the Trust page says ONLY what is true. Every sentence on it is derived from tested code, or is a claim with a proof run here against
// the source, the migrations and the config, or is a promise listed under its own heading. A claim with no proof, a proof that fails, or a mention of a feature that is
// switched off fails the build.
const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const exists = (file: string) => { try { return statSync(join(ROOT, file)).isFile(); } catch { return false; } };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(rel, out); } else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const migrations = () => readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, ""));

type Proof = () => void;
const has = (file: string, pattern: string): Proof => () => assert.match(read(file), new RegExp(pattern, "i"), `${file} must match /${pattern}/`);
const sourceLacks = (pattern: string): Proof => () => {
  const re = new RegExp(pattern, "i");
  const hits = walk("src").filter((f) => f !== "src/lib/trust.ts" && re.test(read(f)));
  assert.deepEqual(hits, [], `the source must not mention /${pattern}/`);
  assert.doesNotMatch(read("package.json"), re, "package.json must not depend on such a service");
};

// One entry per claim id: what must be true in the code for the sentence to stand. Written here, not on the page, so the page holds only words.
const PROOFS: Record<string, Proof[]> = {
  tokens_encrypted: [has("src/lib/crypto.ts", "aes-256-gcm"), () => {
    for (const [table, info] of Object.entries(INVENTORY)) for (const [col, how] of Object.entries(info.secrets ?? {})) if (how === "encrypted") assert.ok(col.endsWith("_enc"), `${table}.${col}`);
    assert.ok(Object.values(INVENTORY).some((i) => Object.values(i.secrets ?? {}).includes("encrypted")));
  }],
  keys_hashed: [() => {
    const hashed = Object.entries(INVENTORY).flatMap(([t, i]) => Object.entries(i.secrets ?? {}).filter(([, how]) => how === "hashed").map(([c]) => `${t}.${c}`));
    assert.ok(hashed.includes("api_keys.key_hash") && hashed.includes("meeting_hooks.token_hash"), `hashed secrets: ${hashed.join(", ")}`);
  }],
  rls: [() => {
    const created = new Set<string>(); const secured = new Set<string>();
    for (const sql of migrations()) {
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) created.add(m[1]);
      for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi)) secured.add(m[1]);
    }
    assert.ok(created.size > 30, "the migrations create the tables");
    assert.deepEqual([...created].filter((t) => !secured.has(t)), [], "a table without row-level security");
  }, has("src/lib/db.ts", "server only|bypasses RLS")],
  no_passwords: [() => { for (const sql of migrations()) assert.doesNotMatch(sql, /password/i, "no column or table for passwords"); }, has("src/app/api/sso/route.ts", "decrypt")],
  signed_sessions: [has("src/lib/session.ts", "DEFAULT_TTL_SECONDS = 60 \\* 60"), has("src/lib/session.ts", "timingSafeEqual")],
  webhook_signed: [has("src/app/api/webhooks/ghl/route.ts", "signature"), has("src/lib/ghl/webhook.ts", "ed25519")],
  client_read_only: [() => assert.ok(exists("tests/unit/client-access.test.ts")), has("tests/unit/client-access.test.ts", "can call only the read-only views of their own account")],
  isolation_tests: [has("scripts/check-tenancy.ts", "cross-reads")],
  owner_delete: [has("src/lib/access.ts", "mayDeleteData"), has("src/lib/api/router.ts", "data\\.purge_refused"), has("src/lib/api/router.ts", "data\\.purged"), has("src/lib/api/router.ts", "Type DELETE to confirm")],
  settings_audit: [has("src/lib/feedback-queries.ts", "settings\\.changed"), has("src/lib/api/router.ts", "logSettingsChange\\(ctx\\.installationId")],
  // AI is the customer's own connection, off by default, and names never leave without the account's opt-in (the gateway refuses it).
  ai_own: [has("src/lib/ai/gateway.ts", "includesNames && !conn\\.shareNames"), has("src/lib/ai/gateway.ts", "AI_KILL_ALL"), has("src/lib/flags-core.ts", "\"ai_byo\"")],
  // Sending: the permission is optional, the feature is off by default, nothing sends without the person's confirm, and the do-not-contact mark is re-read just before the request.
  send_on_press: [
    () => { const s = SCOPE_GROUPS.flatMap((g) => g.scopes).find((x) => (x.scope as string) === "conversations/message.write"); assert.ok(s && s.required === false && (GHL_SCOPES as readonly string[]).includes("conversations/message.write")); },
    () => assert.ok(DEFAULT_OFF.has("send_messages" as never)),
    has("src/lib/ghl/workbench.ts", "if \\(!a\\.confirmed\\) return \\{ outcome: \"needs_confirm\" \\}"),
    has("src/lib/api/send-routes.ts", "preSend"), has("src/lib/ghl/send-guard.ts", "dnd_unknown"), has("src/lib/api/send-routes.ts", "message\\.send"),
  ],
  // Changes to the CRM: the list is in one place and every change goes through the gateway files.
  changes_crm: [() => assert.ok(exists("docs/CRM_WRITES.md")), has("src/lib/ghl/crm-gateway.ts", "WRITE_GHL_LIVE"), has("src/lib/ghl/workbench.ts", "WRITE_GHL_LIVE"), has("src/lib/ghl/appointment-gateway.ts", "WRITE_GHL_LIVE")],
  never_stored: [() => {
    const schema = schemaFromMigrations();
    for (const n of NEVER_STORED) { const cols = schema.get(n.table); assert.ok(cols, n.table); assert.deepEqual([...cols].filter((c) => n.columns.test(c)), [], `${n.table}: ${n.claim}`); }
  }],
  kill_switch: [has("src/lib/runtime-guards.ts", "maintenanceOn"), has("src/app/api/cron/sync/route.ts", "maintenanceOn")],
  webhook_ids_3_days: [has("src/app/api/cron/sync/route.ts", "interval '3 days'")],
  email_unsubscribe: [has("src/lib/email.ts", "List-Unsubscribe"), () => {
    // Every place the app sends a mail passes the stop-link headers on the same call.
    const calls: string[] = [];
    for (const f of walk("src")) for (const line of read(f).split(/\r?\n/)) if (/\b(sendEmail|sendEmailResult|send)\(.*\.\.\.mail/.test(line)) calls.push(`${f}: ${line.trim()}`);
    assert.ok(calls.length >= 2, "the mail calls are found (so this check is not looking at nothing)");
    assert.deepEqual(calls.filter((c) => !c.includes("unsubscribeHeaders")), [], "a mail sent without the stop link");
  }],
};

test("every claim on the page has a proof, and every proof holds against the code", () => {
  const ids = CLAIMS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "claim ids are unique");
  assert.deepEqual(Object.keys(PROOFS).sort(), [...ids].sort(), "every claim has proofs, and no proof is left for a claim that is gone");
  for (const c of CLAIMS) { assert.ok(PROOFS[c.id].length > 0, c.id); for (const p of PROOFS[c.id]) p(); }
});

test("a proof really fails when the claim is false (so this test cannot pass by checking nothing)", () => {
  assert.throws(has("src/lib/crypto.ts", "rot13-encryption"));
  assert.throws(sourceLacks("getInstallation"), "a word that IS in the source is found");
  assert.throws(has("src/lib/session.ts", "DEFAULT_TTL_SECONDS = 60 \\* 600"));
});

test("every sentence on the page is derived, a proven claim, or a promise shown as a promise, and nothing else", () => {
  const sections = trustSections();
  const claimed = new Set<string>(); const promised = new Set<string>();
  for (const s of sections) for (const i of s.items) {
    assert.ok(["derived", "claim", "commitment"].includes(i.kind), `${s.id}: ${i.text.slice(0, 50)}`);
    if (i.kind === "claim") { assert.ok(i.claim && CLAIMS.some((c) => c.id === i.claim), `${s.id}: unknown claim`); assert.equal(i.text, CLAIMS.find((c) => c.id === i.claim)!.text); claimed.add(i.claim!); }
    if (i.kind === "commitment") { assert.ok(i.commitment && COMMITMENTS.some((c) => c.id === i.commitment)); assert.equal(i.text, COMMITMENTS.find((c) => c.id === i.commitment)!.text); promised.add(i.commitment!); }
  }
  assert.deepEqual([...claimed].sort(), CLAIMS.map((c) => c.id).sort(), "every proven claim is on the page (no proof for a sentence that is not shown)");
  assert.deepEqual([...promised].sort(), COMMITMENTS.map((c) => c.id).sort());
});

test("promises are only promises: nothing a promise says is dressed up as something the code does", () => {
  for (const c of COMMITMENTS) assert.doesNotMatch(c.text, /\b(automatically|encrypted|checked by|guarantee)\b/i, c.id);
  // The compliance line says "working toward" and never claims a certificate (N75).
  const compliance = COMMITMENTS.find((c) => c.id === "compliance")!.text;
  assert.match(compliance, /working toward/i);
  assert.match(compliance, /do not claim/i);
  assert.doesNotMatch(compliance, /\b(compliant|certified)\b(?! under)/i);
});

test("what we store, what is deleted, and the permissions on the page are exactly what the code produces", () => {
  const text = trustText();
  for (const l of storeLines({ meetings: true })) assert.ok(text.includes(`${l.title}`) && text.includes(l.text), `the page lists "${l.title}"`);
  assert.ok(text.includes(deleteMyDataText()));
  assert.ok(text.includes(uninstallText()));
  const all = SCOPE_GROUPS.flatMap((g) => g.scopes);
  assert.deepEqual(all.map((s) => s.scope).sort(), [...GHL_SCOPES].sort(), "the permission groups are exactly the permissions the install link asks for");
  for (const s of all) assert.ok(text.includes(`${s.scope} (${s.required ? "required" : "optional"}`), `the page says why ${s.scope} is asked`);
  const required = all.filter((s) => s.required).length;
  assert.ok(text.includes(`${GHL_SCOPES.length} permissions: ${required} required and ${GHL_SCOPES.length - required} optional`));
  // The same count is in the scope plan document, so the page cannot drift from it.
  assert.match(read("docs/SCOPE_PLAN.md"), new RegExp(`${GHL_SCOPES.length} (new )?scopes|same\\s+${GHL_SCOPES.length} scopes|${GHL_SCOPES.length - 9} new optional|asks for the same\\s+${GHL_SCOPES.length}`, "i"));
  assert.ok(text.includes(`${SHARE_LINK_DAYS} days`));
});

test("the outside services on the page are the ones in the code and config, and no other", () => {
  const text = trustText();
  for (const p of PROCESSORS) assert.ok(text.includes(p.name), p.name);
  // Each named service really is wired in.
  assert.ok(exists("vercel.json"), "Vercel: vercel.json");
  assert.match(read("src/lib/db.ts"), /supabase/i, "Supabase: src/lib/db.ts");
  assert.match(read("src/lib/email.ts"), /api\.resend\.com/, "Resend: src/lib/email.ts");
  assert.match(read("src/lib/notify.ts"), /hooks\.slack\.com/, "Slack: src/lib/notify.ts");
  assert.ok(exists("src/app/api/hooks/fathom/[key]/route.ts"), "Fathom: its webhook route");
  // No service is used by the code without being listed: the hosts the source talks to, other than the CRM's own and the listed ones, are none.
  const hosts = new Set<string>();
  for (const f of walk("src")) for (const m of read(f).matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase());
  const known = /(^|\.)(resend\.com|youtube-nocookie\.com|youtube\.com|slack\.com|fathom\.(video|ai)|leadconnectorhq\.com|gohighlevel\.com|zoom\.us|googleapis\.com|google\.com|kdsquares\.com|vercel\.app|vercel\.com|supabase\.(co|com)|w3\.org|schema\.org|openapi\.vercel\.sh|example\.com|youragency\.com|fonts\.g(oogleapis|static)\.com|github\.com|nextjs\.org|ui\.shadcn\.com|developer\.mozilla\.org|openrouter.ai|api.openai.com|auth.openai.com|api.anthropic.com)$/;
  const unknown = [...hosts].filter((h) => !known.test(h));
  assert.deepEqual(unknown, [], "a web host the code talks to that the Trust page does not account for");
});

test("the disabled Zoom integration is not mentioned, while the Meeting notes module is available", () => {
  assert.ok(DEFAULT_OFF.has("zoom_meet"), "Zoom remains off by default");
  assert.ok(!DEFAULT_OFF.has("meetings"), "Meeting notes is available for launch testing");
  const text = trustText();
  assert.doesNotMatch(text, /zoom|google meet/i);
  assert.doesNotMatch(text, /\b(GoHighLevel|HighLevel|GHL)\b/);
  // The permission names themselves (for example "locations.readonly") are machine names, not wording.
  const words = text.replace(/[a-z]+(\/[a-zA-Z]+)?\.(readonly|write|read)/g, "");
  assert.doesNotMatch(words, /\bsub-?accounts?\b|\blocations?\b/i, "public wording: client accounts, not sub-accounts or locations");
});

test("the Fathom notice is explained, and says what is read and stored", () => {
  const text = trustText();
  const fathom = trustSections().find((s) => s.id === "fathom")!;
  assert.match(fathom.intro ?? "", /not been reviewed by Fathom yet/);
  assert.match(fathom.intro ?? "", /review program for apps is new/);
  assert.match(fathom.intro ?? "", /transcript is kept only if you switch that on/);
  assert.ok(text.includes("Fathom"));
  // The settings default that sentence relies on: transcripts are off unless chosen.
  assert.match(read("supabase/migrations/20261031040000_segments_and_meetings.sql") + read("src/lib/analytics/queries.ts"), /keep_transcripts|keepTranscripts/);
});

test("the page has every part N75 asks for", () => {
  const ids = trustSections().map((s) => s.id);
  for (const needed of ["read", "store", "how-long", "delete", "services", "security", "incidents", "status", "fathom", "company"]) assert.ok(ids.includes(needed), needed);
  const status = trustSections().find((s) => s.id === "status")!;
  assert.match(status.intro ?? "", /no public status page yet/i, "honest about the missing status page");
  assert.match(status.intro ?? "", /Settings, Sync status/);
});

test("the company details are written once and match on every public page", () => {
  const pages = ["src/app/privacy/page.tsx", "src/app/terms/page.tsx", "src/app/support/page.tsx", "src/components/legal-page.tsx", "src/app/page.tsx", "src/app/installed/error/page.tsx"];
  for (const f of pages) {
    const t = read(f);
    // The company is always written the same way: every mention of the name is followed by the legal form.
    assert.doesNotMatch(t, /KD Squares(?! Ltd)/, `${f}: the company name is written without its legal form`);
    for (const m of t.matchAll(/[\w.-]+@[\w.-]+\.[a-z]{2,}/gi)) assert.equal(m[0], COMPANY.supportEmail, `${f}: support address`);
  }
  assert.match(trustText(), new RegExp(COMPANY.legalName));
  assert.match(trustText(), new RegExp(COMPANY.supportEmail.replace(".", "\\.")));
  assert.match(read("src/app/support/page.tsx"), /COMPANY.supportReply/, "the support page promises what COMPANY.supportReply says");
  assert.equal(COMPANY.supportReply, "24 hours");
  // Nothing invented: no registration number, address or phone in the constants until King supplies them.
  assert.deepEqual(Object.keys(COMPANY).sort(), ["legalName", "product", "supportEmail", "supportReply"]);
});

test("the page itself is built only from the data, and the guard table and tenancy document list it", () => {
  const page = read("src/app/trust/page.tsx");
  assert.match(page, /trustSections\(\)/);
  assert.doesNotMatch(page, /<li>[^{<]{20,}/, "no sentence is typed into the page by hand inside a list");
  assert.match(read("src/lib/route-guards.ts"), /route: "\/trust"/);
  assert.match(read("docs/TENANCY.md"), /`\/trust`/);
});
