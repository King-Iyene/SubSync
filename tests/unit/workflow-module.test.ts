import { describe, expect, it } from "vitest";
import { ACTION_KEYS, PAYLOAD_FIELDS, RATE, TRIGGER_KEYS, dedupeKey, heldForQuiet, idempotencyKey, parseCall, parseSubscription, roomLeft, safeTargetUrl, triggerPayload, verifyCall, type Subject } from "@/lib/workflow-module/core";
import { handleAction, type ActionDeps } from "@/lib/workflow-module/actions";
import { fireTarget, type FireDeps, type FireReport } from "@/lib/workflow-module/fire";
import type { Target } from "@/lib/workflow-module/store";
import { DEFAULT_OFF } from "@/lib/flags-core";

const SECRET = "s".repeat(40);
const hdr = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("verification", () => {
  it("refuses without the secret, with a wrong one, and when the server has none", () => {
    expect(verifyCall(hdr({}), "{}", { WORKFLOW_MODULE_SECRET: SECRET })).toMatchObject({ ok: false, status: 401 });
    expect(verifyCall(hdr({ "x-subsync-key": "x".repeat(40) }), "{}", { WORKFLOW_MODULE_SECRET: SECRET })).toMatchObject({ ok: false, status: 401 });
    expect(verifyCall(hdr({ "x-subsync-key": SECRET }), "{}", {})).toMatchObject({ ok: false, status: 503 });
    expect(verifyCall(hdr({ "x-subsync-key": "short" }), "{}", { WORKFLOW_MODULE_SECRET: "short" })).toMatchObject({ ok: false, status: 503 });
  });
  it("accepts the right secret; a platform signature that is present but wrong is refused; a required one must exist", () => {
    expect(verifyCall(hdr({ "x-subsync-key": SECRET }), "{}", { WORKFLOW_MODULE_SECRET: SECRET }).ok).toBe(true);
    expect(verifyCall(hdr({ "x-subsync-key": SECRET, "x-ghl-signature": "AAAA" }), "{}", { WORKFLOW_MODULE_SECRET: SECRET })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyCall(hdr({ "x-subsync-key": SECRET }), "{}", { WORKFLOW_MODULE_SECRET: SECRET, WORKFLOW_MODULE_REQUIRE_SIGNATURE: "true" })).toMatchObject({ ok: false, reason: "no_signature" });
  });
});

describe("parsing, subscription address, payload", () => {
  it("takes the tenant only from extras.locationId and ignores ids in data or elsewhere", () => {
    const c = parseCall({ locationId: "evilLoc1", data: { locationId: "evilLoc2" }, extras: { locationId: "locGood1", contactId: "ctc12345" }, meta: { key: "subsync_mark_outcome" } });
    expect(c).toMatchObject({ locationId: "locGood1", contactId: "ctc12345", key: "subsync_mark_outcome" });
    expect(parseCall({ extras: { locationId: "bad id!" } }).locationId).toBeNull();
  });
  it("only accepts the CRM own https workflow address", () => {
    const ok = "https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/abc123/def456";
    expect(safeTargetUrl(ok)).toBe(ok);
    for (const bad of [
      "http://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/a1b2/c3d4",
      "https://evil.example.com/workflows-marketplace/triggers/execute/a1b2/c3d4",
      "https://services.leadconnectorhq.com.evil.com/workflows-marketplace/triggers/execute/a1b2/c3d4",
      "https://services.leadconnectorhq.com/other",
      "https://user@services.leadconnectorhq.com/workflows-marketplace/triggers/execute/a1b2/c3d4",
      "https://services.leadconnectorhq.com:8443/workflows-marketplace/triggers/execute/a1b2/c3d4",
    ]) expect(safeTargetUrl(bad)).toBeNull();
    expect(parseSubscription({ triggerData: { id: "t1234", key: "subsync_no_show", eventType: "CREATED", targetUrl: ok }, extras: { locationId: "locGood1", workflowId: "wf12345" } })).toMatchObject({ triggerKey: "subsync_no_show", locationId: "locGood1" });
    expect(parseSubscription({ triggerData: { key: "other", eventType: "CREATED", targetUrl: ok }, extras: { locationId: "locGood1" } })).toBeNull();
  });
  it("a trigger carries only the plain fields and a link, never message text", () => {
    const s: Subject = { contactId: "c1234", name: "Ann\nLee", phone: "+1555", source: "ads", minutesWaiting: 31.6, pipeline: "P", stage: "S", owner: null, episode: "e", link: "https://app.example.com/x" };
    const p = triggerPayload("subsync_lead_unanswered", { ...s, message: "hello there" } as Subject);
    expect(Object.keys(p).sort()).toEqual([...PAYLOAD_FIELDS].sort());
    expect(p.name).toBe("Ann Lee");
    expect(p.minutesWaiting).toBe(32);
    expect(JSON.stringify(p)).not.toContain("hello there");
  });
  it("limits and quiet hours", () => {
    expect(roomLeft(0, 0)).toBe(RATE.perRun);
    expect(roomLeft(RATE.perHour, 0)).toBe(0);
    expect(roomLeft(25, 0)).toBe(5);
    expect(roomLeft(0, RATE.perDay)).toBe(0);
    expect(heldForQuiet(23, true)).toBe(true);
    expect(heldForQuiet(12, true)).toBe(false);
    expect(heldForQuiet(23, false)).toBe(false);
    expect(heldForQuiet(null, true)).toBe(false);
  });
  it("the same call hashes the same, a different contact does not", () => {
    const a = parseCall({ extras: { locationId: "locGood1", contactId: "ctc12345", workflowId: "wf12345" }, meta: { key: "subsync_add_to_call_queue" } });
    expect(idempotencyKey(a)).toBe(idempotencyKey({ ...a }));
    expect(idempotencyKey(a)).not.toBe(idempotencyKey({ ...a, contactId: "ctc99999" }));
  });
  it("is off by default", () => { expect(DEFAULT_OFF.has("wf_module")).toBe(true); });
  it("keys follow the subsync_ pattern", () => { for (const k of [...TRIGGER_KEYS, ...ACTION_KEYS]) expect(k).toMatch(/^subsync_[a-z_]+$/); });
});

function fakeDeps(over: Partial<ActionDeps> = {}) {
  const log: string[] = [];
  const claimed = new Set<string>();
  const deps: ActionDeps = {
    tenantOf: async (l) => (l === "locGood1" ? { installationId: "inst-A", companyId: "co-A" } : l === "locOther1" ? { installationId: "inst-B", companyId: "co-B" } : null),
    flagOn: async () => true,
    enabled: async (i, _l, k) => i === "inst-A" && k !== "subsync_mark_outcome",
    recentCalls: async () => 0,
    claim: async (i, l, k, idem) => { const key = `${i}|${l}|${k}|${idem}`; if (claimed.has(key)) return false; claimed.add(key); return true; },
    finish: async () => undefined,
    // inst-A knows contact ctcA1111 (and nobody else); another account contact id is simply unknown here
    contact: async (i, l, c) => (i === "inst-A" && l === "locGood1" && c === "ctcA1111" ? { exists: true, dnd: false, tags: [] } : c === "ctcDnd111" && i === "inst-A" ? { exists: true, dnd: true, tags: [] } : { exists: false, dnd: false, tags: [] }),
    queueTag: async () => "call-now",
    addTag: async (a) => { log.push(`tag ${a.installationId}/${a.locationId}/${a.contactId}/${a.tag}`); return "dry_run"; },
    appointment: async (i, _l, id) => (i === "inst-A" && id === "apptPast1" ? { appointmentId: id, contactId: "ctcA1111", status: "new", startAt: "2026-01-01T10:00:00Z", contactName: "A" } : i === "inst-A" && id === "apptFut11" ? { appointmentId: id, contactId: "ctcA1111", status: "new", startAt: "2099-01-01T10:00:00Z", contactName: "A" } : null),
    latestPastAppointment: async () => null,
    setOutcome: async (a) => { log.push(`outcome ${a.installationId}/${a.appointmentId}/${a.status}`); return "dry_run"; },
    now: () => Date.parse("2026-11-12T12:00:00Z"),
    ...over,
  };
  return { deps, log };
}
const call = (key: string, loc: string, contact: string | null, data: Record<string, unknown> = {}, wf = "wf12345") => ({ extras: { locationId: loc, ...(contact ? { contactId: contact } : {}), workflowId: wf }, meta: { key }, data });

describe("actions", () => {
  it("add to call queue: dry run through the gateway, then idempotent", async () => {
    const { deps, log } = fakeDeps();
    const a = await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcA1111"), deps);
    expect(a.status).toBe(200); expect(a.body).toMatchObject({ ok: true, result: "dry_run" });
    const b = await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcA1111"), deps);
    expect(b.body.result).toBe("already");
    expect(log).toEqual(["tag inst-A/locGood1/ctcA1111/call-now"]);
  });
  it("an unknown account is refused and nothing is written", async () => {
    const { deps, log } = fakeDeps();
    expect((await handleAction(call("subsync_add_to_call_queue", "locNone111", "ctcA1111"), deps)).status).toBe(403);
    expect(log).toEqual([]);
  });
  it("a contact from another account is never found, even when the caller names a real account", async () => {
    const { deps, log } = fakeDeps();
    const r = await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcB2222"), deps);
    expect(r.body.result).toBe("not_found");
    expect(log).toEqual([]);
  });
  it("opt-in: an account that has not switched the action on is refused (403) before anything else", async () => {
    const { deps, log } = fakeDeps();
    const r = await handleAction(call("subsync_add_to_call_queue", "locOther1", "ctcA1111"), deps);
    expect(r.status).toBe(403); expect(r.body.result).toBe("not_enabled");
    const o = await handleAction(call("subsync_mark_outcome", "locGood1", "ctcA1111", { outcome: "noshow", appointmentId: "apptPast1" }), deps);
    expect(o.body.result).toBe("not_enabled");
    expect(log).toEqual([]);
  });
  it("Do Not Disturb contacts are left alone", async () => {
    const { deps, log } = fakeDeps();
    expect((await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcDnd111"), deps)).body.result).toBe("dnd");
    expect(log).toEqual([]);
  });
  it("already tagged does nothing", async () => {
    const { deps, log } = fakeDeps({ contact: async () => ({ exists: true, dnd: false, tags: ["Call-Now"] }) });
    expect((await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcA1111"), deps)).body.result).toBe("already");
    expect(log).toEqual([]);
  });
  it("mark outcome: past appointment is recorded; future is refused; another account appointment is not found; bad outcome is refused", async () => {
    const { deps, log } = fakeDeps({ enabled: async () => true });
    expect((await handleAction(call("subsync_mark_outcome", "locGood1", "ctcA1111", { outcome: "no-show", appointmentId: "apptPast1" }), deps)).body.result).toBe("dry_run");
    expect((await handleAction(call("subsync_mark_outcome", "locGood1", "ctcA1111", { outcome: "showed", appointmentId: "apptFut11" }), deps)).body.result).toBe("future");
    expect((await handleAction(call("subsync_mark_outcome", "locOther1", "ctcA1111", { outcome: "showed", appointmentId: "apptPast1" }), deps)).body.result).toBe("not_found");
    expect((await handleAction(call("subsync_mark_outcome", "locGood1", "ctcA1111", { outcome: "maybe", appointmentId: "apptPast1" }), deps)).body.result).toBe("bad_input");
    expect(log).toEqual(["outcome inst-A/apptPast1/noshow"]);
  });
  it("flag off, unknown key and the per-minute cap", async () => {
    expect((await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcA1111"), fakeDeps({ flagOn: async () => false }).deps)).status).toBe(404);
    expect((await handleAction(call("something_else", "locGood1", "ctcA1111"), fakeDeps().deps)).status).toBe(400);
    expect((await handleAction(call("subsync_add_to_call_queue", "locGood1", "ctcA1111"), fakeDeps({ recentCalls: async () => 999 }).deps)).status).toBe(429);
  });
});

describe("trigger firing", () => {
  const URL_A = "https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/a1b2/c3d4";
  const target = (over: Partial<Target> = {}): Target => ({ installationId: "inst-A", locationId: "locGood1", tz: "UTC", quiet: true, appDomain: null, speedTarget: 15, subs: [{ triggerKey: "subsync_lead_unanswered", url: URL_A }], enabled: new Map([["subsync_lead_unanswered", null]]), ...over } as Target);
  const subj = (n: number): Subject[] => Array.from({ length: n }, (_, i) => ({ contactId: `c${i}000`, name: "N", phone: null, source: null, minutesWaiting: 20, pipeline: null, stage: null, owner: null, episode: `loc:${i}`, link: "https://x.example/c" }));
  const rep = (): FireReport => ({ accounts: 0, sent: 0, wouldSend: 0, held: 0, skipped: 0, failed: 0 });
  const NOON = Date.parse("2026-11-12T12:00:00Z"), NIGHT = Date.parse("2026-11-12T23:30:00Z");
  function deps(o: { sent?: Set<string>; counts?: { hour: number; day: number }; live?: boolean; n?: number } = {}) {
    const posts: Array<{ url: string; body: string }> = [];
    const sent = o.sent ?? new Set<string>();
    const d: FireDeps = {
      candidates: async (_t, _k, _now, limit) => subj(o.n ?? 5).filter((s) => !sent.has(`subsync_lead_unanswered:${s.episode}`)).slice(0, limit),
      counts: async () => o.counts ?? { hour: 0, day: 0 },
      alreadySent: async (_t, k) => sent.has(k),
      record: async (_t, _k, dedupe, _c, status) => { if (status === "sent") sent.add(dedupe); return true; },
      token: async () => "tok",
      sleep: async () => undefined,
      fetchImpl: (async (url: string, init: RequestInit) => { posts.push({ url, body: String(init.body) }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch,
      live: { env: { WORKFLOWS_WRITE_LIVE: o.live ? "true" : "false" }, audit: async () => undefined, log: () => undefined },
    };
    return { d, posts, sent };
  }
  it("a dry run sends nothing and records nothing as sent", async () => {
    const { d, posts, sent } = deps(); const r = rep();
    await fireTarget(target(), NOON, d, r);
    expect(posts).toEqual([]); expect(sent.size).toBe(0); expect(r.wouldSend).toBe(5);
  });
  it("live: sends one per lead, never twice (dedupe), and never past the per-run cap", async () => {
    const { d, posts } = deps({ live: true, n: 50 });
    await fireTarget(target(), NOON, d, rep());
    expect(posts.length).toBe(RATE.perRun);
    await fireTarget(target(), NOON, d, rep());
    expect(posts.length).toBe(RATE.perRun * 2); // the next 20, not the same 20
    expect(new Set(posts.map((p) => p.body)).size).toBe(posts.length);
  });
  it("rate limit: nothing is sent when the hour is full", async () => {
    const { d, posts } = deps({ live: true, counts: { hour: RATE.perHour, day: 0 } }); const r = rep();
    await fireTarget(target(), NOON, d, r);
    expect(posts).toEqual([]); expect(r.skipped).toBe(1);
  });
  it("quiet hours hold everything; an account that turned quiet hours off still sends", async () => {
    const a = deps({ live: true }); const r = rep();
    await fireTarget(target(), NIGHT, a.d, r);
    expect(a.posts).toEqual([]); expect(r.held).toBe(1);
    const b = deps({ live: true });
    await fireTarget(target({ quiet: false }), NIGHT, b.d, rep());
    expect(b.posts.length).toBe(5);
  });
  it("needs a workflow listening and the trigger switched on; one address is posted once even with two workflows", async () => {
    const none = deps({ live: true });
    await fireTarget(target({ subs: [] }), NOON, none.d, rep());
    await fireTarget(target({ enabled: new Map() }), NOON, none.d, rep());
    expect(none.posts).toEqual([]);
    const two = deps({ live: true, n: 1 });
    await fireTarget(target({ subs: [{ triggerKey: "subsync_lead_unanswered", url: URL_A }, { triggerKey: "subsync_lead_unanswered", url: URL_A }] }), NOON, two.d, rep());
    expect(two.posts.length).toBe(1);
  });
  it("what is posted holds no message text", async () => {
    const { d, posts } = deps({ live: true, n: 1 });
    await fireTarget(target(), NOON, d, rep());
    expect(Object.keys(JSON.parse(posts[0]!.body)).sort()).toEqual([...PAYLOAD_FIELDS].sort());
  });
  it("dedupeKey is stable", () => { expect(dedupeKey("subsync_no_show", "a:b")).toBe("subsync_no_show:a:b"); });
});
