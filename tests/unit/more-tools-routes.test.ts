import { beforeEach, describe, expect, it, vi } from "vitest";

// Two companies, several accounts each. Database = in-memory fixture keyed by installation AND account, CRM = recording fake, the real route and gateway run on top. Proves the ROUTES: another
// company's (or another account's) account, contact or pipeline is "not found" and nothing reaches the CRM; a client's staff cannot save quotes, rename stages or read the install record.
const A = "inst-A", B = "inst-B";
const accounts: Record<string, string[]> = { [A]: ["locA1", "locA2"], [B]: ["locB1"] };
const contacts: Record<string, { name: string; email: string | null; phone: string | null }> = {
  "inst-A:locA1:cA1": { name: "Dana Reed", email: "d@example.com", phone: "+15550000001" },
  "inst-A:locA1:cNoMail": { name: "No Mail", email: null, phone: "+15550000002" },
  "inst-B:locB1:cB1": { name: "Bo Other", email: "b@example.com", phone: "+15550000003" },
};
const pipes = new Set(["inst-A:locA1:pA1", "inst-B:locB1:pB1"]);
const optedIn = new Set(["inst-A:locA1", "inst-B:locB1"]);
const crm: Array<{ method: string; url: string; body: string | null }> = [];
const tokensFor: string[] = [];
let scopeText = "recurring-tasks.write recurring-tasks.readonly invoices.write invoices/estimate.write invoices/template.write pipelines.readonly pipelines.write emails/templates.readonly marketplace-installer-details.readonly";

vi.mock("../../src/lib/api/tenant-guard", () => ({
  ownedLocation: async (inst: string, allowed: string[] | null, v: unknown) => (typeof v === "string" && (!allowed || allowed.includes(v)) && accounts[inst]?.includes(v) ? v : null),
}));
vi.mock("../../src/lib/analytics/cleanup-config", () => ({ writeEnabledFor: async (inst: string, loc: string) => optedIn.has(`${inst}:${loc}`) }));
vi.mock("../../src/lib/ghl/http", () => ({
  ghlFetch: async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    crm.push({ method, url, body: (init.body as string | undefined) ?? null });
    const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (method === "GET" && /\/opportunities\/pipelines\/pA1$/.test(url)) return ok({ id: "pA1", name: "Sales", stages: [{ id: "sNew", name: "New", position: 0 }, { id: "sWon", name: "Won", position: 1 }] });
    if (method === "GET" && /\/recurring-tasks\/rt1$/.test(url)) return ok({ recurringTask: { title: "x" } });
    if (method === "GET" && /\/templates\?/.test(url)) return ok({ items: [{ id: "t1", name: "Welcome", type: "template", editorType: "builder", updatedAt: "2026-01-01T00:00:00Z" }], total: 1 });
    if (method === "POST" && /\/recurring-tasks$/.test(url)) return ok({ recurringTask: { id: "rt1" } }, 201);
    return ok({ _id: "new1" });
  },
}));
vi.mock("../../src/lib/db", () => {
  const f = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("from installations")) return Promise.resolve([{ scope: scopeText, plan_id: "plan9" }]);
    if (q.includes("from cached_contacts")) { const c = contacts[`${values[0]}:${values[1]}:${values[2]}`]; return Promise.resolve(c ? [{ contact_id: values[2], full_name: c.name, email: c.email, phone: c.phone }] : []); }
    if (q.includes("from pipelines")) return Promise.resolve(pipes.has(`${values[0]}:${values[1]}:${values[2]}`) || q.includes("order by") ? [{ ok: 1, pipeline_id: "pA1", name: "Sales", stages: [{ id: "sNew", name: "New" }] }] : []);
    if (q.includes("from locations")) return Promise.resolve([{ name: "Acme Roofing" }]);
    if (q.includes("insert into audit_log")) return Promise.resolve([]);
    return Promise.resolve([]);
  };
  (f as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return { sql: () => f };
});

import { handleMoreTools } from "../../src/lib/api/more-tools-routes";

type Kind = "agency" | "business" | "client";
function ctx(kind: Kind, inst: string, part: string, opts: { body?: unknown; query?: string; role?: string; flag?: boolean } = {}) {
  const limitTo = kind === "agency" ? null : accounts[inst][0];
  const method = opts.body === undefined ? "GET" : "POST";
  const url = `http://x/api/app/mt/${part}${opts.query ?? ""}`;
  return {
    session: { personRole: kind === "agency" ? "agency_owner" : kind === "business" ? "account_admin" : "account_user", userId: "u1", userName: "Pat", role: opts.role ?? (kind === "client" ? "user" : "admin"), companyId: "co1" },
    installationId: inst, plan: "pro", demo: false, kind, limitTo, entitlements: { features: { more_tools: opts.flag !== false }, locked: [] },
    request: new Request(url, { method, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), url: new URL(url), segments: ["mt", part],
  } as never;
}
const helpers = (c: { limitTo: string | null }) => ({ allowed: async () => (c.limitTo ? [c.limitTo] : null), locationToken: async (loc: string) => { tokensFor.push(loc); return "tok"; }, companyToken: async () => "ctok" });
const call = (c: ReturnType<typeof ctx>) => handleMoreTools(c, helpers(c as never));
const writes = () => crm.filter((x) => x.method !== "GET");
const fu = { title: "Call back", intervalType: "weekly", interval: 1, count: 3, startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), dueAfterHours: 24 };
const dr = { name: "Roof quote", itemName: "Repair", amount: 100, qty: 1, currency: "USD" };

beforeEach(() => { crm.length = 0; tokensFor.length = 0; delete process.env.WRITE_GHL_LIVE; });

describe("cross-tenant: another company's account, contact or pipeline is not found and nothing is sent", () => {
  it("company A cannot use company B's account for any part", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    for (const [part, body] of [["repeat", { contactId: "cB1", followUp: fu }], ["draft", { contactId: "cB1", kind: "invoice", draft: dr }], ["stage", { pipelineId: "pB1", stageId: "sNew", newName: "X" }]] as const) {
      const r = await call(ctx("agency", A, part, { body: { locationId: "locB1", step: "do", confirmed: true, ...body } }));
      expect(r.status, part).toBe(404);
    }
    for (const part of ["setup", "templates", "pipelines"]) expect((await call(ctx("agency", A, part, { query: "?locationId=locB1" }))).status, part).toBe(404);
    expect(crm).toEqual([]); expect(tokensFor).toEqual([]);
  });
  it("company A's own account with company B's contact or pipeline is not found", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const b = { locationId: "locA1", step: "do", confirmed: true };
    expect((await call(ctx("agency", A, "repeat", { body: { ...b, contactId: "cB1", followUp: fu } }))).status).toBe(404);
    expect((await call(ctx("agency", A, "draft", { body: { ...b, contactId: "cB1", kind: "estimate", draft: dr } }))).status).toBe(404);
    expect((await call(ctx("agency", A, "stage", { body: { ...b, pipelineId: "pB1", stageId: "sNew", newName: "X" } }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });
  it("a business session cannot use another account of its own company", async () => {
    expect((await call(ctx("business", A, "repeat", { body: { locationId: "locA2", step: "preview", contactId: "cA1", followUp: fu } }))).status).toBe(404);
  });
  it("the token is only minted for the account the session owns", async () => {
    await call(ctx("agency", A, "templates", { query: "?locationId=locA1" }));
    expect(new Set(tokensFor)).toEqual(new Set(["locA1"]));
  });
});

describe("who may do what, and the flag", () => {
  it("off: not found", async () => { expect((await call(ctx("agency", A, "setup", { query: "?locationId=locA1", flag: false }))).status).toBe(404); });
  it("a client's staff cannot save quotes or rename stages, and cannot read the install record", async () => {
    expect((await call(ctx("client", A, "draft", { body: { locationId: "locA1", contactId: "cA1", kind: "invoice", draft: dr, step: "preview" } }))).status).toBe(403);
    expect((await call(ctx("client", A, "stage", { body: { locationId: "locA1", pipelineId: "pA1", stageId: "sNew", newName: "X", step: "preview" } }))).status).toBe(403);
    expect((await call(ctx("client", A, "installer"))).status).toBe(403);
    expect((await call(ctx("business", A, "installer"))).status).toBe(403);
    expect(crm).toEqual([]);
  });
  it("a client's staff may preview a repeating follow-up on their own account", async () => {
    const r = await call(ctx("client", A, "repeat", { body: { locationId: "locA1", contactId: "cA1", followUp: fu, step: "preview" } }));
    expect(r.status).toBe(200);
    expect((await r.json()).preview.title).toBe("Add a repeating follow-up");
    expect(writes()).toEqual([]);
  });
});

describe("preview, confirm and practice mode", () => {
  it("a draft preview sends nothing; a confirm without the switch only says what would happen", async () => {
    const p = await call(ctx("agency", A, "draft", { body: { locationId: "locA1", contactId: "cA1", kind: "estimate", draft: dr, step: "preview" } }));
    expect((await p.json()).preview.lines.join(" ")).toContain("does not send it");
    const d = await call(ctx("agency", A, "draft", { body: { locationId: "locA1", contactId: "cA1", kind: "estimate", draft: dr, step: "do", confirmed: true } }));
    expect((await d.json()).dryRun).toBe(true);
    expect(writes()).toEqual([]);
  });
  it("do without confirmed is refused", async () => {
    expect((await call(ctx("agency", A, "repeat", { body: { locationId: "locA1", contactId: "cA1", followUp: fu, step: "do" } }))).status).toBe(409);
  });
  it("a contact without an email cannot get an invoice", async () => {
    const r = await call(ctx("agency", A, "draft", { body: { locationId: "locA1", contactId: "cNoMail", kind: "invoice", draft: dr, step: "preview" } }));
    expect(r.status).toBe(422);
  });
  it("live: the follow-up is created and read back; the stage rename sends every stage and keeps ids", async () => {
    process.env.WRITE_GHL_LIVE = "true";
    const r = await call(ctx("agency", A, "repeat", { body: { locationId: "locA1", contactId: "cA1", followUp: fu, step: "do", confirmed: true } }));
    const j = await r.json();
    expect(j.done).toBe(true); expect(j.readBack).toBe(true);
    const s = await call(ctx("agency", A, "stage", { body: { locationId: "locA1", pipelineId: "pA1", stageId: "sNew", newName: "Fresh lead", step: "do", confirmed: true } }));
    expect((await s.json()).done).toBe(true);
    const put = writes().find((w) => w.method === "PUT");
    expect(JSON.parse(put!.body!).stages.map((x: { id: string; name: string }) => [x.id, x.name])).toEqual([["sNew", "Fresh lead"], ["sWon", "Won"]]);
  });
  it("a missing permission says so and sends nothing", async () => {
    process.env.WRITE_GHL_LIVE = "true"; scopeText = "contacts.write";
    const r = await call(ctx("agency", A, "repeat", { body: { locationId: "locA1", contactId: "cA1", followUp: fu, step: "do", confirmed: true } }));
    expect(r.status).toBe(403);
    expect(writes()).toEqual([]);
    scopeText = "recurring-tasks.write recurring-tasks.readonly invoices.write invoices/estimate.write invoices/template.write pipelines.readonly pipelines.write emails/templates.readonly marketplace-installer-details.readonly";
  });
  it("the install record compares the platform's plan with SubSync's", async () => {
    process.env.GHL_APP_ID = "app1";
    const r = await call(ctx("agency", A, "installer"));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.recordedPlanId).toBe("plan9");
  });
});
