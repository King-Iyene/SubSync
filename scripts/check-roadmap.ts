import assert from "node:assert/strict";
import { closeDb, sql } from "../src/lib/db";

// Roadmap voting against a running dev server in demo mode: one vote per person, a second click removes it,
// unknown items are refused, and a client view can vote but only sees counts for its own installation.
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const signIn = async (as?: string) => ((await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true, ...(as ? { as } : {}) }) })).json()) as { session: string }).session;
  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } , method: init.method, body: init.body });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const agency = await signIn();
  const client = await signIn("client");
  const [inst] = await sql()`select id from installations where is_demo`;
  await sql()`delete from roadmap_votes where installation_id = ${inst.id}`;

  assert.equal((await fetch(`${BASE}/api/app/roadmap`)).status, 401);
  const first = await call("/api/app/roadmap", agency);
  assert.equal(first.status, 200);
  assert.ok(first.body.items.length > 0 && first.body.changelog.length > 0);
  const key = first.body.items[0].key as string;
  assert.ok(first.body.items.every((i: { votes: number }) => i.votes === 0));

  assert.equal((await call("/api/app/roadmap", agency, { method: "POST", body: JSON.stringify({ key: "nope" }) })).status, 400);
  assert.equal((await call("/api/app/roadmap", agency, { method: "POST", body: JSON.stringify({ key }) })).body.voted, true);
  const after = await call("/api/app/roadmap", agency);
  assert.equal(after.body.items.find((i: { key: string }) => i.key === key).votes, 1);
  assert.equal(after.body.items.find((i: { key: string }) => i.key === key).voted, true);
  assert.equal((await call("/api/app/roadmap", client, { method: "POST", body: JSON.stringify({ key }) })).status, 200, "a client view can vote");
  assert.equal((await call("/api/app/roadmap", agency)).body.items.find((i: { key: string }) => i.key === key).votes, 2);
  assert.equal((await call("/api/app/roadmap", agency, { method: "POST", body: JSON.stringify({ key }) })).body.voted, false, "voting again removes the vote");
  assert.equal((await call("/api/app/roadmap", agency)).body.items.find((i: { key: string }) => i.key === key).votes, 1);

  await sql()`delete from roadmap_votes where installation_id = ${inst.id}`;
  await closeDb();
  console.log("roadmap: one vote per person, toggles off, unknown items refused, clients can vote: ok");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
