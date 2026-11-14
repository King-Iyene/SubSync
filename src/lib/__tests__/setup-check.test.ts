import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { routeAllowed } from "../access.ts";
import { buildChecklist, classifyStatus, finish, headline, lastFour, STATUS_WORDS, SCOPE_OF, summarize, type Reads, type Row } from "../setup-check/model.ts";
import { demoReads } from "../setup-check/demo.ts";
import { listIn, MAX_REQUESTS, parsePipelines, readAccountSetup, totalIn } from "../setup-check/read.ts";

const ok = <T,>(value: T) => ({ state: "ok", value }) as const;
const NOW = Date.parse("2026-11-14T12:00:00Z");
const full = (): Reads => ({
  pipelines: ok({ pipelines: 2, stages: 9, thin: 0 }), objects: ok({ objects: 2 }), records: ok({ count: 214, capped: false }), customValues: ok({ count: 12, capped: false }), templates: ok({ count: 18, capped: false }),
  tasks: ok({ open: 37, overdue: 0, capped: false }), files: ok({ count: 142, capped: false }), emailBuilder: ok({ count: 6, capped: false }), emailSchedule: ok({ count: 11, capped: false }),
  numbers: ok({ count: 2, capped: false, last4: ["4821", "9037"] }), pools: ok({ pools: 1, numbers: 3 }), resources: ok({ rooms: 3, equipment: 2 }), domains: { total: 1, passing: 1, attention: 0 },
});
const row = (rows: Row[], id: string) => { const r = rows.find((x) => x.id === id); assert.ok(r, id); return r; };

test("a fully set up account: counts shown, nothing needs fixing, the always-unavailable rows say so", () => {
  const rows = buildChecklist(full());
  assert.equal(row(rows, "pipelines").status, "set_up");
  assert.equal(row(rows, "pipelines").detail, "2 pipelines, 9 stages.");
  assert.equal(row(rows, "objects").detail, "2 custom objects. 214 records in total.");
  assert.equal(row(rows, "templates").countText, "18");
  assert.equal(row(rows, "tasks").detail, "37 open, none overdue.");
  assert.equal(row(rows, "resources").detail, "3 rooms, 2 equipment.");
  assert.equal(row(rows, "domainDns").status, "set_up");
  for (const id of ["notes", "recurring", "domainPlatform", "saas", "features"]) assert.equal(row(rows, id).status, "unavailable", id);
  const s = summarize(rows);
  assert.equal(s.attention, 0);
  assert.equal(headline(s), "Nothing needs fixing in this account.");
  assert.equal(rows.every((r) => r.next.length > 0 && r.why.length > 0), true, "every row says what to do next and what it is used for");
});

test("things that need attention: thin pipelines, no pipelines, overdue tasks, failing sending records", () => {
  const rows = buildChecklist({ ...full(), pipelines: ok({ pipelines: 3, stages: 5, thin: 2 }), tasks: ok({ open: 40, overdue: 9, capped: false }), domains: { total: 2, passing: 1, attention: 1 } });
  assert.equal(row(rows, "pipelines").status, "attention");
  assert.match(row(rows, "pipelines").detail ?? "", /2 pipelines have fewer than two stages/);
  assert.equal(row(rows, "tasks").detail, "40 open, 9 overdue.");
  assert.equal(row(rows, "tasks").status, "attention");
  assert.equal(row(rows, "domainDns").status, "attention");
  assert.equal(row(buildChecklist({ ...full(), pipelines: ok({ pipelines: 0, stages: 0, thin: 0 }) }), "pipelines").status, "attention");
  assert.match(headline(summarize(rows)), /^3 things to fix/);
});

test("empty accounts: optional things are 'Nothing here yet', never a problem and never a fake zero of a permission", () => {
  const none = { count: 0, capped: false };
  const rows = buildChecklist({ ...full(), objects: ok({ objects: 0 }), records: null, customValues: ok(none), templates: ok(none), files: ok(none), emailBuilder: ok(none), emailSchedule: ok(none),
    tasks: ok({ open: 0, overdue: 0, capped: false }), numbers: ok({ ...none, last4: [] }), pools: ok({ pools: 0, numbers: 0 }), resources: ok({ rooms: 0, equipment: 0 }), domains: null });
  for (const id of ["objects", "customValues", "templates", "files", "emailBuilder", "emailSchedule", "tasks", "numbers", "pools", "resources", "domainDns"]) {
    assert.equal(row(rows, id).status, "empty", id);
    assert.equal(row(rows, id).count, 0, id);
  }
  assert.equal(summarize(rows).attention, 0);
});

test("a declined permission says 'Needs permission: reconnect', has no count and is never shown as zero", () => {
  const p = { state: "permission" } as const;
  const rows = buildChecklist({ ...full(), pipelines: p, templates: p, numbers: p, tasks: p, resources: p, files: p });
  for (const id of ["pipelines", "templates", "numbers", "tasks", "resources", "files"]) {
    const r = row(rows, id);
    assert.equal(r.status, "permission", id);
    assert.equal(r.count, null, id);
    assert.equal(r.countText, null, id);
    assert.equal(STATUS_WORDS[r.status], "Needs permission: reconnect");
    assert.match(r.next, /Reconnect SubSync/);
  }
  assert.match(headline(summarize(buildChecklist({ ...full(), numbers: p }))), /need a permission|needs a permission/);
  // The records need their own permission: the object row stays set up and says so.
  const objs = row(buildChecklist({ ...full(), records: p }), "objects");
  assert.equal(objs.status, "set_up");
  assert.match(objs.detail ?? "", /Record counts: Needs permission: reconnect\./);
});

test("an error is 'Could not read just now' with a retry line, and a platform refusal despite the permission is 'not available'", () => {
  const rows = buildChecklist({ ...full(), customValues: { state: "error" }, pools: { state: "unavailable" } });
  assert.equal(row(rows, "customValues").status, "error");
  assert.equal(row(rows, "customValues").next, "Press Check again in a minute.");
  assert.equal(row(rows, "pools").status, "unavailable");
  assert.match(headline(summarize(rows)), /could not be read just now/);
  assert.equal(classifyStatus(403, true), "unavailable", "refused although the permission was granted: the platform's own limit");
  assert.equal(classifyStatus(403, false), "permission");
  assert.equal(classifyStatus(401, null), "permission", "unknown grants: a refusal is treated as a missing permission");
  assert.equal(classifyStatus(404, true), "unavailable");
  assert.equal(classifyStatus(500, true), "error");
  assert.equal(classifyStatus(200, null), "ok");
});

test("capped counts read '500+' and phone numbers show only the last four digits", () => {
  const r = buildChecklist({ ...full(), files: ok({ count: 500, capped: true }), numbers: ok({ count: 2, capped: false, last4: [lastFour("+1 (555) 010-4821")!, lastFour("+234 803 123 9037")!] }) });
  assert.equal(row(r, "files").countText, "500+");
  assert.deepEqual(row(r, "numbers").samples, ["ending 4821", "ending 9037"]);
  assert.equal(JSON.stringify(r).includes("5550104821"), false);
  assert.equal(lastFour("12"), null);
  assert.equal(lastFour(null), null);
});

test("the demo goes through the same checklist and holds no permission wording (the demo smoke counts that as a failure)", () => {
  for (const seed of [0, 1, 2]) {
    const res = finish(demoReads(seed), NOW);
    assert.equal(res.rows.length, 17);
    assert.equal(/needs[ _]permission/i.test(JSON.stringify(res)), false);
  }
  assert.equal(finish(demoReads(1), NOW).summary.attention >= 1, true, "one demo account shows something to fix");
});

// ---- the live reads, with a fake platform ----
type Answer = { status?: number; body?: unknown };
function platform(answers: Record<string, Answer>) {
  const seen: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    const key = Object.keys(answers).find((k) => url.includes(k));
    const a = key ? answers[key] : { status: 404 };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const ALL_SCOPES = Object.values(SCOPE_OF);
const list = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));

test("reads reduce every answer to counts and never keep a name, text or whole number", async () => {
  const { fetchImpl, seen } = platform({
    "/opportunities/pipelines": { body: { pipelines: [{ id: "a", name: "Secret Pipeline", stages: [{ name: "x" }, { name: "y" }] }, { id: "b", name: "Other", stages: [{ name: "z" }] }] } },
    "/objects/?": { body: { objects: [{ key: "custom_objects.pets", standard: false, labels: { singular: "Pet" } }, { key: "contact", standard: true }] } },
    "/records/search": { body: { total: 7, records: [{ properties: { name: "Rex the Private Dog" } }] } },
    "/customValues": { body: { customValues: list(3, (i) => ({ name: `cv${i}`, value: "secret value" })) } },
    "/templates": { body: { totalCount: 5, templates: list(5, () => ({ name: "t", body: "secret body" })) } },
    "/tasks/search": { body: { tasks: [{ title: "Call Sam", dueDate: "2026-11-01T00:00:00Z" }, { title: "Email", dueDate: "2026-12-01T00:00:00Z" }, { title: "No date" }] } },
    "/medias/files": { body: { files: list(4, () => ({ name: "secret.pdf" })) } },
    "/emails/builder": { body: { builders: list(2, () => ({ name: "Design" })), total: 2 } },
    "/emails/schedule": { body: { schedules: list(3, () => ({ name: "Newsletter" })), total: [{ total: 3 }], traceId: "t" } },
    "/phone-system/numbers/location": { body: { numbers: [{ phoneNumber: "+15550104821" }, { phoneNumber: "+15550109037" }], page: 1 } },
    "/phone-system/number-pools": { body: { success: true, data: [{ id: "p", name: "Pool", numbers: [{ phoneNumber: "+15550101111" }, { phoneNumber: "+15550102222" }] }], total: 1 } },
    "/calendars/resources/rooms": { body: [{ name: "Room A" }, { name: "Room B" }] },
    "/calendars/resources/equipments": { body: [{ name: "Chair" }] },
  });
  const r = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: ALL_SCOPES, now: NOW, fetchImpl });
  assert.deepEqual(r.pipelines, { state: "ok", value: { pipelines: 2, stages: 3, thin: 1 } });
  assert.deepEqual(r.objects, { state: "ok", value: { objects: 1 } });
  assert.deepEqual(r.records, { state: "ok", value: { count: 7, capped: false } });
  assert.deepEqual(r.customValues, { state: "ok", value: { count: 3, capped: false } });
  assert.deepEqual(r.templates, { state: "ok", value: { count: 5, capped: false } });
  assert.deepEqual(r.tasks, { state: "ok", value: { open: 3, overdue: 1, capped: false } });
  assert.deepEqual(r.files, { state: "ok", value: { count: 4, capped: false } });
  assert.deepEqual(r.emailBuilder, { state: "ok", value: { count: 2, capped: false } });
  assert.deepEqual(r.emailSchedule, { state: "ok", value: { count: 3, capped: false } });
  assert.deepEqual(r.numbers, { state: "ok", value: { count: 2, capped: false, last4: ["4821", "9037"] } });
  assert.deepEqual(r.pools, { state: "ok", value: { pools: 1, numbers: 2 } });
  assert.deepEqual(r.resources, { state: "ok", value: { rooms: 2, equipment: 1 } });
  const text = JSON.stringify(r);
  for (const secret of ["Secret", "secret", "Rex", "Call Sam", "5550104821", "Room A", "Pet"]) assert.equal(text.includes(secret), false, secret);
  // Only two reads are POSTs (the platform defines them as searches); every other call is a GET. Every call carries the one account.
  assert.deepEqual([...new Set(seen.filter((s) => s.method === "POST").map((s) => s.url.replace(/^.*(?=\/(locations|objects))/, "").replace(/\/locations\/LOC1/, "/locations/<id>")))].sort(), ["/locations/<id>/tasks/search", "/objects/custom_objects.pets/records/search"]);
  assert.equal(seen.every((s) => /LOC1/.test(s.url) || s.body?.includes("LOC1") === true || s.url.includes("/records/search")), true);
  assert.equal(seen.length <= MAX_REQUESTS, true);
});

test("a permission the install never granted is not even asked, and a refusal is reported as needing permission, not as zero", async () => {
  const { fetchImpl, seen } = platform({ "/phone-system/numbers/location": { status: 403 }, "/opportunities/pipelines": { body: { pipelines: [] } } });
  const granted = ALL_SCOPES.filter((s) => s !== SCOPE_OF.templates && s !== SCOPE_OF.files);
  const r = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: granted.filter((s) => s !== SCOPE_OF.numbers), now: NOW, fetchImpl });
  assert.equal(r.templates.state, "permission");
  assert.equal(r.files.state, "permission");
  assert.equal(r.numbers.state, "permission");
  assert.equal(seen.some((s) => s.url.includes("/templates") || s.url.includes("/medias/") || s.url.includes("/phone-system/numbers")), false, "no request for a permission we know is missing");
  // Grants unknown (null): the call is made, and a 403 means a missing permission.
  const unknown = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: null, now: NOW, fetchImpl });
  assert.equal(unknown.numbers.state, "permission");
  // Granted but the platform still refuses: the platform's own limit.
  const refused = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: ALL_SCOPES, now: NOW, fetchImpl });
  assert.equal(refused.numbers.state, "unavailable");
});

test("the file storage read is allowed by either name of its permission (medias.readonly or the app's files.readonly)", async () => {
  const { fetchImpl, seen } = platform({ "/medias/files": { body: { files: [{}, {}] } } });
  const only = ALL_SCOPES.filter((s) => s !== SCOPE_OF.files).concat("files.readonly");
  const r = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: only, now: NOW, fetchImpl });
  assert.deepEqual(r.files, { state: "ok", value: { count: 2, capped: false } });
  assert.equal(seen.some((s) => s.url.includes("/medias/files")), true);
});

test("a failing platform gives 'error' rows, an odd answer is not counted as zero, and the whole check stops at its request limit", async () => {
  const boom = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  const r = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: ALL_SCOPES, now: NOW, fetchImpl: boom });
  for (const v of [r.pipelines, r.objects, r.customValues, r.templates, r.tasks, r.files, r.emailBuilder, r.emailSchedule, r.numbers, r.pools, r.resources]) assert.equal(v.state, "error");
  assert.equal(buildChecklist({ ...r, domains: null }).filter((x) => x.status === "error").length, 11);
  // An answer with no list in it is "could not read", not "0".
  const odd = platform({ "/opportunities/pipelines": { body: { nope: true } } });
  assert.equal((await readAccountSetup({ token: "tok", locationId: "LOC1", granted: ALL_SCOPES, now: NOW, fetchImpl: odd.fetchImpl })).pipelines.state, "error");
  // 500 custom objects' worth of paging cannot become a flood.
  let calls = 0;
  const endless = (async () => { calls++; return new Response(JSON.stringify({ files: list(100, () => ({})), tasks: list(100, () => ({})), templates: list(100, () => ({})), builders: list(100, () => ({})), schedules: list(100, () => ({})) }), { status: 200 }); }) as unknown as typeof fetch;
  const capped = await readAccountSetup({ token: "tok", locationId: "LOC1", granted: ALL_SCOPES, now: NOW, fetchImpl: endless });
  assert.ok(calls <= MAX_REQUESTS, `${calls} requests`);
  assert.deepEqual(capped.files, { state: "ok", value: { count: 500, capped: true } });
});

test("parsers: totals and lists in the shapes the platform uses", () => {
  assert.equal(totalIn({ total: "12" }, ["total"]), 12);
  assert.equal(totalIn({ total: [{ total: 4 }] }, ["total"]), 4);
  assert.equal(totalIn({ total: ["9"] }, ["total"]), 9);
  assert.equal(totalIn({ total: [] }, ["total"]), null);
  assert.equal(totalIn({ total: -1 }, ["total"]), null);
  assert.deepEqual(listIn([1, 2], ["x"]), [1, 2]);
  assert.equal(listIn({ data: [1] }, ["x", "data"])?.length, 1);
  assert.equal(listIn({ data: "no" }, ["data"]), null);
  assert.deepEqual(parsePipelines({ pipelines: [{ stages: [] }, { stages: [1, 2] }] }), { pipelines: 2, stages: 2, thin: 1 });
  assert.equal(parsePipelines("x"), null);
});

test("who may open it: an agency and a business, never a client's own staff, and only by GET", () => {
  assert.equal(routeAllowed("agency", "GET", ["setup-check"]), true);
  assert.equal(routeAllowed("business", "GET", ["setup-check"]), true);
  assert.equal(routeAllowed("client", "GET", ["setup-check"]), false);
  assert.equal(routeAllowed("business", "POST", ["setup-check"]), false);
  assert.equal(routeAllowed("business", "PUT", ["setup-check"]), false);
});

test("tenant isolation in the route: the account id is checked against the caller's installation and own list, before anything is read", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/api/setup-check-routes.ts"), "utf8");
  assert.match(src, /ownedLocation\(ctx\.installationId, allowed, asked\)/);
  assert.match(src, /where installation_id = \$\{ctx\.installationId\}/, "the account list is limited to this installation");
  assert.ok(src.indexOf("ownedLocation(") < src.indexOf("runSetupCheck("), "the id is checked before the platform is asked");
  const run = readFileSync(join(process.cwd(), "src/lib/setup-check/run.ts"), "utf8");
  assert.match(run, /where installation_id = \$\{installationId\} and location_id = \$\{locationId\}/, "our own DNS table is read with the installation");
  assert.match(run, /held\.get\(`?key|const key = `\$\{installationId\}:\$\{locationId\}`/, "the saved copy is keyed by installation AND account");
  assert.doesNotMatch(run, /insert into|update |delete from/i, "nothing is written to the database");
});

test("no brand or internal word in anything a person reads", () => {
  const all = JSON.stringify(finish(full(), NOW)) + JSON.stringify(Object.values(STATUS_WORDS));
  assert.doesNotMatch(all, /gohighlevel|highlevel|leadconnector|\bghl\b|agenc|sub-?account|location/i);
});
