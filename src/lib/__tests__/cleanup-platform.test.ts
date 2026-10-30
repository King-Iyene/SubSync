import assert from "node:assert/strict";
import { test } from "node:test";
import { platformWriter, type ChangeRow } from "../analytics/cleanup-platform.ts";

type Call = { method: string; path: string; body: unknown };

// A stand-in for the platform: it holds contacts and records every request made to it.
function fake(contacts: Record<string, { firstName?: string; lastName?: string; phone?: string; tags?: string[] }>, opts: { denyWrites?: boolean; denyReads?: boolean; failStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : null;
    calls.push({ method, path: u.pathname, body });
    const m = /^\/contacts\/([^/]+)(\/tags)?$/.exec(u.pathname);
    if (!m) return new Response(null, { status: 404 });
    const c = contacts[decodeURIComponent(m[1])];
    if (method === "GET") {
      if (opts.denyReads) return new Response(null, { status: 403 });
      return c ? Response.json({ contact: { id: m[1], ...c } }) : new Response(null, { status: 404 });
    }
    if (opts.denyWrites) return new Response(null, { status: 401 });
    if (opts.failStatus) return new Response(null, { status: opts.failStatus });
    if (!c) return new Response(null, { status: 404 });
    if (m[2]) {
      const tag = body.tags[0] as string;
      c.tags = method === "POST" ? [...(c.tags ?? []), tag] : (c.tags ?? []).filter((t) => t !== tag);
    } else Object.assign(c, body);
    return Response.json({ succeeded: true });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const change = (o: Partial<ChangeRow>): ChangeRow => ({ id: 1, contactId: "c1", rule: "phone", field: "phone", before: "(555) 010-2030", after: "+15550102030", tag: null, ...o });

test("a change is applied only after the contact is read and still matches", async () => {
  const f = fake({ c1: { phone: "(555) 010-2030" } });
  const w = platformWriter("tok", f.fetchImpl);
  assert.deepEqual(await w.apply(change({})), { result: "applied" });
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "PUT"], "it reads first, then writes");
  assert.deepEqual(f.calls[1].body, { phone: "+15550102030" }, "only the one field is sent");
});

test("a contact someone edited since the preview is left alone", async () => {
  const f = fake({ c1: { phone: "+15559999999" } });
  const out = await platformWriter("tok", f.fetchImpl).apply(change({}));
  assert.equal(out.result, "skipped");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"], "nothing was written");
});

test("undo puts the original value back, but only if it is still the value we set", async () => {
  const f = fake({ c1: { phone: "+15550102030" } });
  const w = platformWriter("tok", f.fetchImpl);
  assert.deepEqual(await w.revert(change({})), { result: "applied" });
  assert.deepEqual(f.calls[1].body, { phone: "(555) 010-2030" });
  const g = fake({ c1: { phone: "+4400000000" } });
  assert.equal((await platformWriter("tok", g.fetchImpl).revert(change({}))).result, "skipped");
});

test("tags use the add and remove calls and never replace the contact's other tags", async () => {
  const f = fake({ c1: { tags: ["vip"] } });
  const w = platformWriter("tok", f.fetchImpl);
  const add = change({ rule: "tag", field: "tags", before: "without", after: "with", tag: "No Email" });
  assert.equal((await w.apply(add)).result, "applied");
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), ["GET /contacts/c1", "POST /contacts/c1/tags"]);
  assert.deepEqual(f.calls[1].body, { tags: ["No Email"] }, "only the one tag is named");
  assert.equal((await w.apply(add)).result, "skipped", "applying twice does nothing the second time");
  assert.equal((await w.revert(add)).result, "applied");
  assert.equal(f.calls[f.calls.length - 1].method, "DELETE");
});

test("removing a tag the contact does not have is skipped", async () => {
  const f = fake({ c1: { tags: [] } });
  const out = await platformWriter("tok", f.fetchImpl).apply(change({ rule: "tag", field: "tags", before: "with", after: "without", tag: "Old" }));
  assert.equal(out.result, "skipped");
});

test("a missing permission is reported as such, and nothing is written", async () => {
  const reads = fake({ c1: { phone: "(555) 010-2030" } }, { denyReads: true });
  assert.equal((await platformWriter("tok", reads.fetchImpl).apply(change({}))).result, "permission");
  const writes = fake({ c1: { phone: "(555) 010-2030" } }, { denyWrites: true });
  assert.equal((await platformWriter("tok", writes.fetchImpl).apply(change({}))).result, "permission");
});

test("a contact that no longer exists and a platform error are handled", async () => {
  assert.equal((await platformWriter("tok", fake({}).fetchImpl).apply(change({}))).result, "skipped");
  const boom = fake({ c1: { phone: "(555) 010-2030" } }, { failStatus: 422 });
  const out = await platformWriter("tok", boom.fetchImpl).apply(change({}));
  assert.equal(out.result, "failed");
  assert.match(out.detail ?? "", /422/);
});

test("the access token is sent as a bearer token on every request", async () => {
  let seen = "";
  const fetchImpl = (async (_u: string, init: RequestInit) => { seen = (init.headers as Record<string, string>).Authorization; return Response.json({ contact: { phone: "(555) 010-2030" } }); }) as unknown as typeof fetch;
  await platformWriter("secret-token", fetchImpl).apply(change({}));
  assert.equal(seen, "Bearer secret-token");
});
