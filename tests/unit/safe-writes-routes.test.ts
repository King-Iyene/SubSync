import { beforeEach, describe, expect, it, vi } from "vitest";

// Two companies, several accounts each. The database is an in-memory fixture keyed by installation AND account (like the real tables), the CRM is a recording fake, and the real route and
// the real gateway run on top. These tests prove what the ROUTES do with the session: another company's (or another account's) id is "not found", nothing is sent to the CRM for it, and
// a client's staff can only mark a task done.
const A = "inst-A", B = "inst-B";
const accounts: Record<string, string[]> = { [A]: ["locA1", "locA2"], [B]: ["locB1"] };
const contacts = new Set(["inst-A:locA1:cA1", "inst-B:locB1:cB1"]);
const pipelines: Record<string, number> = { "inst-A:locA1": 0, "inst-A:locA2": 2, "inst-B:locB1": 0 };
const ours = new Set(["inst-A:locA1:taskOurs"]);
const optedIn = new Set(["inst-A:locA1", "inst-B:locB1"]);
let scopeText = "locations/tags.write pipelines.create locations/customValues.write locations/customValues.readonly contacts.write";
const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
const crm: Array<{ method: string; url: string; body: string | null }> = [];
const tokensFor: string[] = [];
let crmTags: string[] = ["existing-tag"];
let crmCustom: Array<{ id: string; name: string; value: string }> = [];

vi.mock("../../src/lib/api/tenant-guard", () => ({
  ownedLocation: async (inst: string, allowed: string[] | null, v: unknown) => (typeof v === "string" && (!allowed || allowed.includes(v)) && accounts[inst]?.includes(v) ? v : null),
}));
vi.mock("../../src/lib/analytics/cleanup-config", () => ({ writeEnabledFor: async (inst: string, loc: string) => optedIn.has(`${inst}:${loc}`) }));
vi.mock("../../src/lib/ghl/http", () => ({
  ghlFetch: async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    crm.push({ method, url, body: (init.body as string | undefined) ?? null });
    const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (method === "GET" && /\/tags\?/.test(url)) return ok({ tags: crmTags.map((name) => ({ name })) });
    if (method === "GET" && /\/customValues$/.test(url)) return ok({ customValues: crmCustom });
    if (method === "GET" && /\/opportunities\/pipelines/.test(url)) return ok({ pipelines: [] });
    if (method === "GET" && /\/tasks\/taskOurs$/.test(url)) return ok({ task: { id: "taskOurs", title: "Call Dana back", completed: false } });
    if (method === "GET" && /\/tasks\/taskOther$/.test(url)) return ok({ task: { id: "taskOther", title: "Someone else's task", completed: false } });
    return ok({ ok: true });
  },
}));
vi.mock("../../src/lib/db", () => {
  const f = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?");
    const has = (...xs: string[]) => xs.every((x) => values.includes(x));
    if (q.includes("from installations")) return Promise.resolve([{ scope: scopeText }]);
    if (q.includes("from cached_contacts")) return Promise.resolve(contacts.has(`${values[0]}:${values[1]}:${values[2]}`) ? [{ ok: 1 }] : []);
    if (q.includes("from pipelines")) return Promise.resolve([{ n: pipelines[`${values[0]}:${values[1]}`] ?? 0 }]);
    if (q.includes("from locations l")) return Promise.resolve([{ m: 20 }]);
    if (q.includes("from contact_writes")) return Promise.resolve((values[2] as string[]).filter((id) => ours.has(`${values[0]}:${values[1]}:${id}`)).map((task_id) => ({ task_id })));
    if (q.includes("from mn_tasks")) return Promise.resolve([]);
    if (q.includes("insert into audit_log")) { audits.push({ action: "audit", detail: values[values.length - 1] as Record<string, unknown> }); return Promise.resolve([]); }
    void has;
    return Promise.resolve([]);
  };
  (f as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return { sql: () => f };
});

import { handleSafeWrites } from "../../src/lib/api/safe-writes-routes";

type Kind = "agency" | "business" | "client";
function ctx(kind: Kind, inst: string, part: string, opts: { body?: unknown; method?: string; query?: string; role?: string; demo?: boolean; flag?: boolean } = {}) {
  const limitTo = kind === "agency" ? null : accounts[inst][0];
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  return {
    session: { personRole: kind === "agency" ? "agency_owner" : kind === "business" ? "account_admin" : "account_user", userId: "u1", userName: "Pat", role: opts.role ?? (kind === "client" ? "user" : "admin"), companyId: "co1" },
    installationId: inst, plan: "pro", demo: opts.demo === true, kind, limitTo, entitlements: { features: { safe_writes: opts.flag !== false }, locked: [] },
    request: new Request(`http://x/api/app/sw/${part}${opts.query ?? ""}`, { method, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), url: new URL(`http://x/api/app/sw/${part}${opts.query ?? ""}`), segments: ["sw", part],
  } as never;
}
const helpers = (c: { limitTo: string | null }) => ({ allowed: async () => (c.limitTo ? [c.limitTo] : null), locationToken: async (loc: string) => { tokensFor.push(loc); return "tok"; } });
const call = (c: ReturnType<typeof ctx>) => handleSafeWrites(c, helpers(c as never));
const writes = () => crm.filter((x) => x.method !== "GET");

beforeEach(() => {
  crm.length = 0; audits.length = 0; tokensFor.length = 0; crmTags = ["existing-tag"]; crmCustom = [];
  scopeText = "locations/tags.write pipelines.create locations/customValues.write locations/customValues.readonly contacts.write";
  delete process.env.WRITE_GHL_LIVE;
});

describe("cross-tenant: another company's or another account's id is not found and nothing is sent", () => {
  const body = (loc: string, extra: object = {}) => ({ locationId: loc, step: "do", confirmed: true, name: "stolen", ...extra });
  for (const part of ["tag", "pipeline", "sla"]) {
    it(`company A cannot ${part} in company B's account`, async () => {
      process.env.WRITE_GHL_LIVE = "true";
      const r = await call(ctx("agency", A, part, { body: body("locB1") }));
      expect(r.status).toBe(404);
      expect(crm).toEqual([]); expect(tokensFor).toEqual([]);
    });
    it(`a business session cannot ${part} in another account of its own company`, async () => {
      process.env.WRITE_GHL_LIVE = "true";
      const r = await call(ctx("business", A, part, { body: body("locA2") }));
      expect(r.status).toBe(404);
      expect(crm).toEqual([]);
    });
  }
  it("a task: company A cannot touch company B's contact, nor use its own account id with B's contact", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const t = { step: "do", confirmed: true, op: "complete", taskId: "taskOurs" };
    expect((await call(ctx("agency", A, "task", { body: { ...t, locationId: "locB1", contactId: "cB1" } }))).status).toBe(404);
    expect((await call(ctx("agency", A, "task", { body: { ...t, locationId: "locA1", contactId: "cB1" } }))).status).toBe(404);
    expect(crm).toEqual([]); expect(tokensFor).toEqual([]);
  });
  it("the setup card of another company's account is not found", async () => {
    expect((await call(ctx("agency", A, "setup", { query: "?locationId=locB1" }))).status).toBe(404);
  });
  it("the token is only ever minted for the account the session owns", async () => {
    await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "new-tag", step: "preview" } }));
    expect(new Set(tokensFor)).toEqual(new Set(["locA1"]));
  });
});

describe("who may do what", () => {
  it("a client's staff cannot create a tag, a pipeline or the value, and cannot delete a task", async () => {
    for (const part of ["tag", "pipeline", "sla"]) expect((await call(ctx("client", A, part, { body: { locationId: "locA1", name: "x1", step: "preview" } }))).status, part).toBe(403);
    const r = await call(ctx("client", A, "task", { body: { locationId: "locA1", contactId: "cA1", taskId: "taskOurs", op: "delete", step: "preview" } }));
    expect(r.status).toBe(403);
    expect(crm).toEqual([]);
  });
  it("a client's staff can mark a task done on their own account (preview, then a practice run)", async () => {
    const p = await (await call(ctx("client", A, "task", { body: { locationId: "locA1", contactId: "cA1", taskId: "taskOurs", op: "complete", step: "preview" } }))).json();
    expect(p.preview.title).toBe("Mark this task done");
    const d = await call(ctx("client", A, "task", { body: { locationId: "locA1", contactId: "cA1", taskId: "taskOurs", op: "complete", step: "do", confirmed: true } }));
    expect((await d.json()).dryRun).toBe(true);
    expect(writes()).toEqual([]);
  });
  it("the feature flag off means 404 for everything", async () => {
    expect((await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "x1", step: "preview" }, flag: false }))).status).toBe(404);
  });
});

describe("preview first, confirm second", () => {
  it("tag: the preview says what will be created and sends nothing; a missing confirm is refused", async () => {
    const p = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "needs-first-reply", step: "preview" } }))).json();
    expect(p.preview.canConfirm).toBe(true); expect(p.preview.exists).toBe(false);
    expect(writes()).toEqual([]);
    expect((await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "needs-first-reply", step: "do" } }))).status).toBe(409);
    expect(writes()).toEqual([]);
  });
  it("tag: a tag the account already has cannot be confirmed, and is never created twice", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const p = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "Existing-Tag", step: "preview" } }))).json();
    expect(p.preview.exists).toBe(true); expect(p.preview.canConfirm).toBe(false);
    const d = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "existing-tag", step: "do", confirmed: true } }))).json();
    expect(d.already).toBe(true);
    expect(writes()).toEqual([]);
  });
  it("tag: practice mode by default (switch off), then live creates exactly one tag in the right account", async () => {
    const dry = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "needs-first-reply", step: "do", confirmed: true } }))).json();
    expect(dry.dryRun).toBe(true); expect(writes()).toEqual([]);
    process.env.WRITE_GHL_LIVE = "true";
    const live = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "needs-first-reply", step: "do", confirmed: true } }))).json();
    expect(live.done).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].url).toContain("/locations/locA1/tags"); expect(writes()[0].body).toBe(JSON.stringify({ name: "needs-first-reply" }));
    expect(audits.some((a) => a.detail?.what === "crm.account.write" && a.detail?.result === "done")).toBe(true);
  });
  it("tag: an account that is not opted in stays in practice mode even with the switch on", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const r = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA2", name: "needs-first-reply", step: "do", confirmed: true } }))).json();
    expect(r.dryRun).toBe(true); expect(r.reason).toBe("account"); expect(writes()).toEqual([]);
  });
  it("tag: no permission to create is named, not blurred (live)", async () => {
    process.env.WRITE_GHL_LIVE = "true"; scopeText = "contacts.write";
    const r = await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "needs-first-reply", step: "do", confirmed: true } }));
    expect(r.status).toBe(403);
    expect((await r.json()).message).toContain("Needs permission: reconnect");
    expect(writes()).toEqual([]);
  });
  it("pipeline: offered only when the account has none; one with pipelines is refused", async () => {
    const none = await (await call(ctx("agency", A, "pipeline", { body: { locationId: "locA1", step: "preview" } }))).json();
    expect(none.preview.title).toContain("SubSync Sales");
    expect(none.preview.lines[0]).toContain("New lead, Contacted, Booked, Showed, Won, Lost");
    const have = await call(ctx("agency", A, "pipeline", { body: { locationId: "locA2", step: "do", confirmed: true } }));
    expect(have.status).toBe(422);
    const card = await (await call(ctx("agency", A, "setup", { query: "?locationId=locA2" }))).json();
    expect(card.pipeline.show).toBe(false);
    const card1 = await (await call(ctx("agency", A, "setup", { query: "?locationId=locA1" }))).json();
    expect(card1.pipeline.show).toBe(true); expect(card1.sla.minutes).toBe(20);
    expect(writes()).toEqual([]);
  });
  it("pipeline: live creates one pipeline with six stages", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const r = await (await call(ctx("agency", A, "pipeline", { body: { locationId: "locA1", step: "do", confirmed: true } }))).json();
    expect(r.done).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].url).toMatch(/\/opportunities\/pipelines$/);
    expect(JSON.parse(writes()[0].body as string).stages).toHaveLength(6);
  });
  it("reply target: create when missing, update when different, nothing when equal; value comes from SubSync, not the browser", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const body = { locationId: "locA1", step: "do", confirmed: true, minutes: 1 };
    expect((await (await call(ctx("agency", A, "sla", { body }))).json()).done).toBe(true);
    expect(writes()[0].method).toBe("POST"); expect(writes()[0].body).toBe(JSON.stringify({ name: "subsync_sla_minutes", value: "20" }));
    crm.length = 0; crmCustom = [{ id: "val1", name: "subsync_sla_minutes", value: "10" }];
    expect((await (await call(ctx("agency", A, "sla", { body }))).json()).done).toBe(true);
    expect(writes()[0].method).toBe("PUT"); expect(writes()[0].url).toContain("/customValues/val1");
    crm.length = 0; crmCustom = [{ id: "val1", name: "subsync_sla_minutes", value: "20" }];
    expect((await (await call(ctx("agency", A, "sla", { body }))).json()).unchanged).toBe(true);
    expect(writes()).toEqual([]);
  });
  it("reply target: without permission to read custom values SubSync does not guess", async () => {
    scopeText = "locations/customValues.write";
    const r = await call(ctx("agency", A, "sla", { body: { locationId: "locA1", step: "preview" } }));
    expect(r.status).toBe(403);
  });
});

describe("tasks: delete needs the typed name and a task SubSync made", () => {
  const t = (taskId: string, extra: object = {}) => ({ locationId: "locA1", contactId: "cA1", taskId, op: "delete", ...extra });
  it("the preview of a SubSync-made task asks for the name; a task SubSync did not make is refused", async () => {
    const mine = await (await call(ctx("agency", A, "task", { body: t("taskOurs", { step: "preview" }) }))).json();
    expect(mine.preview.typeToConfirm).toBe("Call Dana back");
    const other = await (await call(ctx("agency", A, "task", { body: t("taskOther", { step: "preview" }) }))).json();
    expect(other.preview.canConfirm).toBe(false); expect(other.preview.typeToConfirm).toBeNull();
    process.env.WRITE_GHL_LIVE = "true";
    const r = await call(ctx("agency", A, "task", { body: t("taskOther", { step: "do", confirmed: true, confirmText: "Someone else's task" }) }));
    expect(r.status).toBe(422);
    expect(writes()).toEqual([]);
  });
  it("a wrong name deletes nothing; the right name deletes exactly that task (live)", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    expect((await call(ctx("agency", A, "task", { body: t("taskOurs", { step: "do", confirmed: true, confirmText: "Call" }) }))).status).toBe(422);
    expect(writes()).toEqual([]);
    const ok = await (await call(ctx("agency", A, "task", { body: t("taskOurs", { step: "do", confirmed: true, confirmText: "call dana back" }) }))).json();
    expect(ok.done).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].method).toBe("DELETE"); expect(writes()[0].url).toContain("/contacts/cA1/tasks/taskOurs");
  });
  it("the title comes from the CRM, never from the browser: a typed name that only matches a browser-sent title is refused", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const r = await call(ctx("agency", A, "task", { body: t("taskOurs", { step: "do", confirmed: true, confirmText: "Forged title", title: "Forged title" }) }));
    expect(r.status).toBe(422); expect(writes()).toEqual([]);
  });
  it("in practice mode a delete is a dry run and sends nothing", async () => {
    const r = await (await call(ctx("agency", A, "task", { body: t("taskOurs", { step: "do", confirmed: true, confirmText: "Call Dana back" }) }))).json();
    expect(r.dryRun).toBe(true); expect(writes()).toEqual([]);
  });
});

describe("the demo can never write", () => {
  it("demo previews and confirms are practice runs with no CRM call", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const p = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "demo-tag", step: "preview" }, demo: true }))).json();
    expect(p.ok).toBe(true);
    const d = await (await call(ctx("agency", A, "tag", { body: { locationId: "locA1", name: "demo-tag", step: "do", confirmed: true }, demo: true }))).json();
    expect(d.dryRun).toBe(true);
    expect(crm).toEqual([]);
  });
});
