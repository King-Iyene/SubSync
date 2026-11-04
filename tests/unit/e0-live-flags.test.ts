import { describe, expect, it } from "vitest";
import { describeDryRun, isLive, LIVE_FLAGS, liveFlags, outward } from "@/lib/live-flags";
import { ASSUMED_LIMITS, buildComment, buildFieldUpdate, buildNote, idFromAnswer, LIMITS_VERIFIED, writeToCrm } from "@/lib/ghl/crm-writes";

// DRY-RUN MODE (docs/OVERNIGHT_RULES.md section 3). The four switches are off unless the variable is exactly "true"; with one off, the exact request is
// built and recorded as "WOULD WRITE" (ids and field names only) and nothing is sent.

type Row = { installationId: string; action: string; detail: Record<string, unknown> };
const recorder = () => { const rows: Row[] = []; const logs: unknown[][] = []; return { rows, logs, deps: { env: {} as Record<string, string>, audit: async (r: Row) => { rows.push(r); }, log: (...a: unknown[]) => { logs.push(a); } } }; };

describe("the four live switches", () => {
  it("are exactly the five named in the rules (the fifth is the Workflows module), and all off with no environment", () => {
    expect([...LIVE_FLAGS]).toEqual(["SEND_EMAIL_LIVE", "SEND_SLACK_LIVE", "WRITE_GHL_LIVE", "FATHOM_WEBHOOK_LIVE", "WORKFLOWS_WRITE_LIVE", "DATA_HEALTH_WRITE_LIVE"]);
    expect(liveFlags({})).toEqual({ SEND_EMAIL_LIVE: false, SEND_SLACK_LIVE: false, WRITE_GHL_LIVE: false, FATHOM_WEBHOOK_LIVE: false, WORKFLOWS_WRITE_LIVE: false, DATA_HEALTH_WRITE_LIVE: false });
  });
  it("only the exact word true switches one on (a typo can never switch anything on)", () => {
    for (const v of ["", "1", "yes", "TRUE", "True", " true", "true ", "on", "false", "0"]) expect(isLive("WRITE_GHL_LIVE", { WRITE_GHL_LIVE: v }), JSON.stringify(v)).toBe(false);
    expect(isLive("WRITE_GHL_LIVE", { WRITE_GHL_LIVE: "true" })).toBe(true);
    expect(isLive("SEND_EMAIL_LIVE", { WRITE_GHL_LIVE: "true" })).toBe(false);
  });
  it("is off in this test run (the committed default), and no file sets one to true", async () => {
    expect(isLive("WRITE_GHL_LIVE")).toBe(false);
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits: string[] = [];
    const SET_TRUE = /(SEND_EMAIL_LIVE|SEND_SLACK_LIVE|WRITE_GHL_LIVE|FATHOM_WEBHOOK_LIVE)["']?\s*[:=]\s*["']?true/;
    // A usage line inside a comment ("WRITE_GHL_LIVE=true node ...") is documentation, not a committed value.
    const code = (text: string) => text.split("\n").filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join("\n");
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== ".next" && n !== ".git") walk(p); }
        else if (/\.(ts|tsx|mjs|json|sh)$/.test(p) && !p.endsWith("e0-live-flags.test.ts") && SET_TRUE.test(code(readFileSync(p, "utf8")))) hits.push(p);
      }
    };
    for (const d of ["src", "scripts", "tests"]) walk(d);
    expect(hits, "a live switch committed as true").toEqual([]);
  });
});

describe("outward: build, record, send nothing", () => {
  it("with the switch off it never calls send, writes one WOULD line to the audit table and the log, and returns the dry run", async () => {
    const r = recorder();
    let called = 0;
    const out = await outward({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.note.create", installationId: "inst-1", ids: { locationId: "L1", contactId: "C1" }, fields: ["body"] }, async () => { called++; return 1; }, r.deps);
    expect(called).toBe(0);
    expect(out).toEqual({ live: false, dryRun: true, line: "WOULD WRITE crm.note.create locationId=L1 contactId=C1 fields=body" });
    expect(r.rows).toEqual([{ installationId: "inst-1", action: "dry_run.would_write", detail: { what: "crm.note.create", verb: "WRITE", flag: "WRITE_GHL_LIVE", ids: { locationId: "L1", contactId: "C1" }, fields: ["body"] } }]);
    expect(r.logs[0]).toEqual(["WOULD WRITE crm.note.create locationId=L1 contactId=C1 fields=body"]);
  });
  it("a send is a WOULD SEND line, with its own audit action", async () => {
    const r = recorder();
    const out = await outward({ flag: "SEND_EMAIL_LIVE", verb: "SEND", what: "email.alert", installationId: "i", ids: { alertId: "A1" } }, async () => 1, r.deps);
    expect(out).toMatchObject({ live: false, line: "WOULD SEND email.alert alertId=A1" });
    expect(r.rows[0].action).toBe("dry_run.would_send");
  });
  it("with the switch on it runs the real call and records nothing", async () => {
    const r = recorder();
    const out = await outward({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.note.create", installationId: "i" }, async () => "done", { ...r.deps, env: { WRITE_GHL_LIVE: "true" } });
    expect(out).toEqual({ live: true, result: "done" });
    expect(r.rows).toEqual([]);
  });
  it("what is written down is ids and field names only: text passed as an id is replaced, so a message can never be logged by mistake", () => {
    const d = describeDryRun({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.note.create", ids: { contactId: "Hi Jo, your invoice is attached", locationId: "L1", token: "Bearer abcdefghijklmnopqrstuvwxyz0123456789" }, fields: ["body", "a message with spaces", "x".repeat(80)] });
    expect(JSON.stringify(d)).not.toMatch(/invoice|Bearer|abcdefghijklmnop|spaces/);
    expect(d.detail.ids).toEqual({ contactId: "[not an id]", locationId: "L1", token: "[not an id]" });
    expect(d.detail.fields).toEqual(["body"]);
  });
  it("a failing audit write never turns a dry run into an error, and no installation means the log only", async () => {
    const log: unknown[] = [];
    const out = await outward({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "x.y", installationId: "i" }, async () => 1, { env: {}, audit: async () => { throw new Error("db down"); }, log: (...a) => log.push(a) });
    expect(out).toMatchObject({ live: false });
    const none = recorder();
    await outward({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "x.y" }, async () => 1, none.deps);
    expect(none.rows).toEqual([]);
    expect(none.logs).toHaveLength(1);
  });
});

describe("the CRM write client (note, internal comment, custom field): request shapes from the documented API, and a dry run by default", () => {
  it("builds the note, comment and field requests as INTEGRATIONS_SPEC section 4 documents them", () => {
    expect(buildNote({ contactId: "C 1", body: "hello", userId: "U1" })).toEqual({ method: "POST", path: "/contacts/C%201/notes", version: "2021-07-28", scope: "contacts.write", body: { body: "hello", userId: "U1" } });
    expect(buildNote({ contactId: "C1", body: "hello" }).body).toEqual({ body: "hello" });
    expect(buildComment({ contactId: "C1", message: "m", userId: "U1" })).toEqual({ method: "POST", path: "/conversations/messages", version: "2021-04-15", scope: "conversations/message.write", body: { type: "InternalComment", contactId: "C1", message: "m", userId: "U1" } });
    expect(buildFieldUpdate({ contactId: "C1", fields: [{ id: "F1", value: "2026-11-01" }] })).toEqual({ method: "PUT", path: "/contacts/C1", version: "2021-07-28", scope: "contacts.write", body: { customFields: [{ id: "F1", field_value: "2026-11-01" }] } });
  });
  it("the limits are conservative and marked not verified until the morning test has measured them", () => {
    expect(LIMITS_VERIFIED).toBe(false);
    expect(ASSUMED_LIMITS.noteChars).toBeLessThanOrEqual(5000);
    expect(ASSUMED_LIMITS.commentChars).toBeLessThanOrEqual(5000);
  });
  it("with WRITE_GHL_LIVE off it sends NOTHING and fetches no token: the fetch and the token function are never called, the audit holds ids and the field name only", async () => {
    const r = recorder();
    let fetched = 0, tokens = 0;
    const out = await writeToCrm({
      installationId: "inst-1", locationId: "LB", contactId: "CB", meetingId: "M1", request: buildNote({ contactId: "CB", body: "SECRET MEETING SUMMARY the client's private details", userId: "U1" }),
      token: async () => { tokens++; return "tok"; }, fetchImpl: (async () => { fetched++; return new Response("{}"); }) as typeof fetch,
    }, r.deps);
    expect(out).toEqual({ outcome: "dry_run", line: "WOULD WRITE crm.note.create locationId=LB contactId=CB meetingId=M1 fields=body,userId" });
    expect(fetched).toBe(0);
    expect(tokens).toBe(0);
    expect(JSON.stringify(r.rows) + JSON.stringify(r.logs)).not.toMatch(/SECRET|private details|tok/);
  });
  it("with the switch on it sends exactly one request with the person as author, and reads the id the CRM gave", async () => {
    const r = recorder();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const out = await writeToCrm({
      installationId: "i", locationId: "LB", contactId: "CB", request: buildNote({ contactId: "CB", body: "b", userId: "U9" }), token: async () => "tok",
      fetchImpl: (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ note: { id: "NOTE123456" } }), { status: 201 }); }) as typeof fetch,
    }, { ...r.deps, env: { WRITE_GHL_LIVE: "true" } });
    expect(out).toEqual({ outcome: "written", id: "NOTE123456" });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://services.leadconnectorhq.com/contacts/CB/notes");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ body: "b", userId: "U9" });
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("a refused write says it needs permission, and a server error is a failure with its status", async () => {
    const live = { env: { WRITE_GHL_LIVE: "true" }, audit: async () => undefined, log: () => undefined };
    const fake = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;
    const base = { installationId: "i", locationId: "L", contactId: "C", request: buildNote({ contactId: "C", body: "b" }), token: async () => "t" };
    expect(await writeToCrm({ ...base, fetchImpl: fake(403) }, live)).toEqual({ outcome: "needs_permission" });
    expect(await writeToCrm({ ...base, fetchImpl: fake(422) }, live)).toEqual({ outcome: "failed", status: 422 });
  });
  it("finds the id in the places the platform puts it", () => {
    expect(idFromAnswer({ note: { id: "n1abcd" } })).toBe("n1abcd");
    expect(idFromAnswer({ messageId: "m1abcd" })).toBe("m1abcd");
    expect(idFromAnswer({ id: "i1abcd" })).toBe("i1abcd");
    expect(idFromAnswer(null)).toBeNull();
  });
});
