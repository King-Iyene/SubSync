import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestMeeting, type ConnectionRow } from "@/lib/connections/queries";
import { closeDb, sql } from "@/lib/db";
import { hookMeeting } from "../fixtures/meeting-hook";

// N93 and principle 13: no code path puts a meeting on a contact that was not matched by an exact email. Two layers:
//   1. a read of every source file: the only place that sets a meeting's contact is the email matcher, and the only thing that calls the CRM
//      writer is that same path;
//   2. real rows in the real database, with the CRM call recorded instead of made: a meeting is written to a contact only when one exact
//      email says so, and never for a name, an unknown email, two records with the same email, or the same email in two clients.
// Nothing goes to the CRM: the HTTP call and the token lookup are replaced, and the calls are counted.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const crmCalls: Array<{ url: string; body: string }> = [];

vi.mock("@/lib/ghl/http", () => ({
  ghlFetch: async (url: string, init: { body?: string }) => {
    crmCalls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ note: { id: "note-" + crmCalls.length } }), { status: 201, headers: { "content-type": "application/json" } });
  },
}));
vi.mock("@/lib/sync/engine", () => ({ locationAccessToken: async () => "not-a-real-token" }));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") sources(p, out); } else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

describe("meetings reach a contact only through the email matcher (read of the code)", () => {
  const all = sources(join(process.cwd(), "src")).map((f) => ({ rel: f.slice(f.indexOf("src")).split("\\").join("/"), text: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1") }));

  it("only recordMeeting stores a meeting, and no statement sets or changes a meeting's contact except that insert", () => {
    const inserts = all.filter((f) => /insert\s+into\s+meeting_notes/i.test(f.text)).map((f) => f.rel);
    expect(inserts).toEqual(["src/lib/analytics/meeting-queries.ts"]);
    for (const f of all) {
      for (const m of f.text.matchAll(/update\s+meeting_notes\s+set([^`;]*)/gi)) expect(m[1], `${f.rel}: an update of meeting_notes must not touch contact_id`).not.toMatch(/contact_id/i);
    }
    const queries = all.find((f) => f.rel === "src/lib/analytics/meeting-queries.ts")!.text;
    expect(queries).toMatch(/matchContact\(m\.attendees,/);
    expect(queries.match(/hit\?\.contactId/g)?.length, "the contact id stored comes only from the matcher's result").toBe(1);
    expect(queries).toMatch(/if \(row\?\.id && hit\) await pushMeetingToCrm/);
  });

  it("the CRM writer is called from one place, only for a matched meeting, and reads the contact from the stored row", () => {
    const callers = all.filter((f) => /pushMeetingToCrm\s*\(/.test(f.text) && f.rel !== "src/lib/analytics/meeting-crm.ts").map((f) => f.rel);
    expect(callers).toEqual(["src/lib/analytics/meeting-queries.ts"]);
    const writer = all.find((f) => f.rel === "src/lib/analytics/meeting-crm.ts")!.text;
    expect(writer).toMatch(/!m\.contact_id/);
    // The note request is built by the one CRM write client (stage E0): the writer hands it the stored row's contact and nothing else, and that client is
    // the only file that knows the notes path.
    expect(writer.match(/buildNote\(\{ contactId: ([^,]*),/g)).toEqual(["buildNote({ contactId: m.contact_id as string,"]);
    expect(writer).not.toMatch(/\/notes/);
    const client = all.find((f) => f.rel === "src/lib/ghl/crm-writes.ts")!.text;
    expect(client.match(/\/contacts\/\$\{seg\(a\.contactId\)\}\/notes/g)).toHaveLength(1);
  });

  it("no setting, API route or screen can choose the account an unmatched meeting goes to", () => {
    for (const f of all) {
      if (f.rel === "src/lib/data-inventory.ts") continue;
      expect(f.text, `${f.rel} still mentions the old setting`).not.toMatch(/setDefaultAccount|defaultLocationId|defaultLocationName|connectionUpdate/);
      if (!/^src\/lib\/__tests__/.test(f.rel)) expect(f.text, `${f.rel} reads or writes connections.default_location_id`).not.toMatch(/default_location_id/);
    }
    expect(all.find((f) => f.rel === "src/app/app/views/connections.tsx")!.text).not.toMatch(/nobody in a meeting|save it in/i);
  });
});

describe.skipIf(!HAS_DB)("against real rows", () => {
  const CO = "xtest-meeting-match-co";
  const A = "xtestMeetLocA01";
  const B = "xtestMeetLocB01";
  let inst = "";
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

  const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
    id: "00000000-0000-0000-0000-000000000000", installationId: inst, provider: "fathom", status: "connected", label: "Fathom", externalId: null, accessTokenEnc: null, refreshTokenEnc: null,
    tokenExpiresAt: null, webhookSecretEnc: null, onlyLocationId: null, isDemo: false, keepTranscripts: false, ...over,
  });
  const rows = async () => await sql()`select location_id, contact_id, title from meeting_notes where installation_id = ${inst} order by title`;

  // The CRM write client is a dry run unless WRITE_GHL_LIVE is "true" (stage E0). These tests are about WHICH contact is written, so they switch it on, with the
  // HTTP call replaced above; the dry-run behaviour itself is tested in e0-live-flags.test.ts and e0-ingest.test.ts.
  beforeAll(async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    await sql()`delete from installations where company_id = ${CO}`;
    // No tokens at all: the production scheduler only queues jobs for installs with a refresh token.
    const [i] = await sql()`insert into installations (company_id, company_name, plan) values (${CO}, 'zzMeetMatch', 'pro') returning id`;
    inst = i.id as string;
    for (const [loc, name] of [[A, "zzMeet Client A"], [B, "zzMeet Client B"]]) await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, ${name})`;
    const contact = (loc: string, id: string, first: string, email: string | null) =>
      sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added) values (${inst}, ${loc}, ${id}, ${first}, 'Test', ${email}, '{}', now())`;
    await contact(A, "c-dana-a", "Dana", "dana@meet.test");
    await contact(B, "c-dana-b", "Dana", "dana@meet.test");
    await contact(A, "c-lee-a", "Lee", "lee@meet.test");
    await contact(A, "c-twin-1", "Twin", "twin@meet.test");
    await contact(A, "c-twin-2", "Twin", "twin@meet.test");
    await contact(A, "c-pat-a", "Pat", null);
    await contact(B, "c-bo-b", "Bo", "bo@meet.test");
  });
  beforeEach(async () => { crmCalls.length = 0; await sql()`delete from meeting_notes where installation_id = ${inst}`; });
  afterAll(async () => { vi.unstubAllEnvs(); await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("an unknown email, a name alone, a shared email and two records with one email are not saved and write nothing to the CRM", async () => {
    const cases: Array<[string, Array<{ name: string | null; email: string | null }>]> = [
      ["unknown email", [{ name: "Stranger", email: "nobody@nowhere.test" }]],
      ["a name that is a contact's name, with no email", [{ name: "Pat Test", email: null }]],
      ["a name that is a contact's name, with another email", [{ name: "Lee Test", email: "different@meet.test" }]],
      ["the same email in two clients", [{ name: "Dana", email: "dana@meet.test" }]],
      ["two records in one account with the same email", [{ name: "Twin", email: "twin@meet.test" }]],
    ];
    for (const [i, [label, attendees]] of cases.entries()) {
      const r = await ingestMeeting(row(), hookMeeting(`M${i}`, attendees), `fathom:n93-${i}`);
      expect(r, label).toMatchObject({ saved: false, matched: false, reason: "no_account" });
    }
    expect(await rows(), "nothing was saved").toEqual([]);
    expect(crmCalls, "and nothing was written to the CRM").toEqual([]);
  });

  it("one exact email in one account is saved on that contact and written once, and a repeat delivery writes nothing more", async () => {
    const first = await ingestMeeting(row(), hookMeeting("Kitchen", [{ name: "Lee", email: "LEE@meet.test" }]), "fathom:n93-lee");
    expect(first).toMatchObject({ saved: true, matched: true });
    expect(await rows()).toEqual([{ location_id: A, contact_id: "c-lee-a", title: "Kitchen" }]);
    expect(crmCalls.map((c) => c.url.split("/contacts/")[1])).toEqual(["c-lee-a/notes"]);
    const again = await ingestMeeting(row(), hookMeeting("Kitchen", [{ name: "Lee", email: "lee@meet.test" }]), "fathom:n93-lee");
    expect(again).toMatchObject({ saved: false, reason: "duplicate" });
    expect(crmCalls.length, "the same meeting twice writes one note").toBe(1);
    expect((await rows()).length).toBe(1);
  });

  it("a connection limited to one business never looks outside it, and one record there is enough", async () => {
    const outside = await ingestMeeting(row({ onlyLocationId: B }), hookMeeting("Elsewhere", [{ name: "Lee", email: "lee@meet.test" }]), "fathom:n93-else");
    expect(outside).toMatchObject({ saved: false, reason: "no_account" });
    expect(crmCalls.length).toBe(0);
    const inside = await ingestMeeting(row({ onlyLocationId: B }), hookMeeting("Inside", [{ name: "Dana", email: "dana@meet.test" }]), "fathom:n93-in");
    expect(inside.saved).toBe(true);
    expect(await rows()).toEqual([{ location_id: B, contact_id: "c-dana-b", title: "Inside" }]);
    expect(crmCalls.map((c) => c.url.split("/contacts/")[1])).toEqual(["c-dana-b/notes"]);
  });

  it("a stored default account is never read, even if a leftover value is in the column", async () => {
    await sql()`insert into connections (installation_id, provider, label, default_location_id, connected_by) values (${inst}, 'fathom', 'Fathom', ${B}, 'test')`;
    const r = await ingestMeeting(row(), hookMeeting("Stray", [{ name: "Stranger", email: "nobody@nowhere.test" }]), "fathom:n93-stray");
    expect(r).toMatchObject({ saved: false, reason: "no_account" });
    expect(await rows()).toEqual([]);
    expect(crmCalls.length).toBe(0);
  });

  it("the private-address path matches by exact email inside its own account only", async () => {
    const { recordMeeting } = await import("@/lib/analytics/meeting-queries");
    const hook = { id: "", installationId: inst, locationId: A, keepTranscripts: false };
    const none = await recordMeeting(hook, hookMeeting("By name", [{ name: "Pat Test", email: null }]), "other:1");
    expect(none).toMatchObject({ matched: false, duplicate: false });
    const twins = await recordMeeting(hook, hookMeeting("Twins", [{ name: "Twin", email: "twin@meet.test" }]), "other:2");
    expect(twins.matched).toBe(false);
    const wrongAccount = await recordMeeting(hook, hookMeeting("Other client", [{ name: "Bo", email: "bo@meet.test" }]), "other:3");
    expect(wrongAccount.matched).toBe(false);
    expect(crmCalls.length, "none of those wrote to the CRM").toBe(0);
    expect((await rows()).every((r) => r.contact_id === null)).toBe(true);
    const ok = await recordMeeting(hook, hookMeeting("Matched", [{ name: "Lee", email: "lee@meet.test" }]), "other:4");
    expect(ok.matched).toBe(true);
    expect(crmCalls.map((c) => c.url.split("/contacts/")[1])).toEqual(["c-lee-a/notes"]);
  });
});
