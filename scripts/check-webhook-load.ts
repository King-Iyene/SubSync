// Burst test for the platform webhook route (the 13 Nov 2026 incident: ~59,000 events in hours, most deliveries failed before they were recorded).
// Sends N signed events (default 5,000) at src/app/api/webhooks/ghl/route.ts, many at once, against a THROWAWAY database, then reports p50/p95/p99 latency and any non-2xx,
// then drains the inbox and checks that nothing was lost. Targets: 0 non-2xx, p95 under 300 ms.
//
// Usage (throwaway Postgres on localhost, see docs/QA_SCALE.md):
//   node --env-file=scripts/scale.env --import tsx scripts/check-webhook-load.ts
// Env: WEBHOOK_LOAD_N (events, default 5000), WEBHOOK_LOAD_CONCURRENCY (at once, default 100), DB_POOL_MAX (default 4 here, as in production),
//      BASE_URL (send over HTTP to a running server started with the same WEBHOOK_TEST_PUBLIC_KEY printed below; default is in-process calls to the route handler).
import { generateKeyPairSync, sign } from "node:crypto";
import { assertThrowawayDb } from "./scale-guard";

assertThrowawayDb();
process.env.DB_POOL_MAX ||= "4";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.WEBHOOK_TEST_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();

const N = Number(process.env.WEBHOOK_LOAD_N ?? 5000), CONC = Number(process.env.WEBHOOK_LOAD_CONCURRENCY ?? 100), BASE = process.env.BASE_URL;
const CO = "xload-co", LOC = "xloadLoc", P = "xload-";

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

function event(i: number): Record<string, unknown> {
  const webhookId = `${P}${i}`;
  const k = i % 10;
  // What a bulk delete and a busy account look like: mostly deletes, some updates, messages, notes (the last three for an account we do not hold: they close fast).
  if (k < 5) return { type: "ContactDelete", id: `c${i}`, locationId: LOC, companyId: CO, webhookId };
  if (k < 7) return { type: "OpportunityDelete", id: `o${i}`, locationId: LOC, companyId: CO, webhookId };
  if (k === 7) return { type: "NoteCreate", id: `n${i}`, locationId: "xloadNobody", webhookId };
  if (k === 8) return { type: "ContactUpdate", contactId: `c${i}`, locationId: "xloadNobody", webhookId };
  return { type: "InboundMessage", contactId: `c${i}`, locationId: "xloadNobody", webhookId, direction: "inbound" };
}

async function main() {
  const { sql, closeDb } = await import("../src/lib/db");
  const db = sql();
  const route = BASE ? null : await import("../src/app/api/webhooks/ghl/route");
  await db`delete from installations where company_id = ${CO}`;
  await db`delete from webhook_inbox where webhook_id like ${P + "%"}`;
  await db`delete from webhook_events where webhook_id like ${P + "%"}`;
  const [inst] = await db`insert into installations (company_id, company_name, plan) values (${CO}, 'zzLoad', 'pro') returning id`;
  await db`insert into locations (installation_id, location_id, name) values (${inst.id}, ${LOC}, 'zzLoad')`;
  const seedRows = Array.from({ length: N }, (_, i) => ({ installation_id: inst.id, location_id: LOC, contact_id: `c${i}` }));
  for (let o = 0; o < seedRows.length; o += 2000) await db`insert into cached_contacts ${db(seedRows.slice(o, o + 2000) as never)}`;
  const [{ n: before }] = await db`select count(*)::int n from cached_contacts where installation_id = ${inst.id}`;

  const lat: number[] = [], bad: Array<{ i: number; status: number }> = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (;;) {
      const i = next++;
      if (i >= N) return;
      const raw = JSON.stringify(event(i));
      const sig = sign(null, Buffer.from(raw), privateKey).toString("base64");
      const s = performance.now();
      let status = 0;
      try {
        const res = BASE
          ? await fetch(`${BASE}/api/webhooks/ghl`, { method: "POST", headers: { "x-ghl-signature": sig, "content-type": "application/json" }, body: raw })
          : await route!.POST(new Request("http://localhost/api/webhooks/ghl", { method: "POST", headers: { "x-ghl-signature": sig }, body: raw }));
        status = res.status;
      } catch { status = 0; }
      lat.push(performance.now() - s);
      if (status < 200 || status > 299) bad.push({ i, status });
    }
  }));
  const wall = performance.now() - t0;
  lat.sort((a, b) => a - b);
  const [{ n: queued }] = await db`select count(*)::int n from webhook_inbox where webhook_id like ${P + "%"}`;
  console.log(`\nSENT ${N} signed events, ${CONC} at once, ${BASE ? "over HTTP" : "in-process"}, pool ${process.env.DB_POOL_MAX}, in ${(wall / 1000).toFixed(1)} s (${Math.round(N / (wall / 1000))}/s)`);
  console.log(`LATENCY ms  p50 ${pct(lat, 50).toFixed(1)}  p95 ${pct(lat, 95).toFixed(1)}  p99 ${pct(lat, 99).toFixed(1)}  max ${lat[lat.length - 1].toFixed(1)}`);
  console.log(`NON-2XX ${bad.length}${bad.length ? " e.g. " + JSON.stringify(bad.slice(0, 5)) : ""}`);
  console.log(`QUEUED ${queued} of ${N} (none handled in the request: contacts still stored ${(await db`select count(*)::int n from cached_contacts where installation_id = ${inst.id}`)[0].n} of ${before})`);

  // Drain: the worker handles everything the route queued.
  const { drainWebhookInbox } = await import("../src/lib/ghl/webhook-inbox");
  const d0 = performance.now();
  let rounds = 0, last = null as null | Awaited<ReturnType<typeof drainWebhookInbox>>;
  for (; rounds < 200; rounds++) { last = await drainWebhookInbox({ budgetMs: 30_000, batch: 500 }); if (!last.pending) break; }
  const [{ n: left }] = await db`select count(*)::int n from webhook_inbox where webhook_id like ${P + "%"} and processed_at is null`;
  const [{ n: contactsLeft }] = await db`select count(*)::int n from cached_contacts where installation_id = ${inst.id}`;
  const [{ n: failed }] = await db`select count(*)::int n from webhook_inbox where webhook_id like ${P + "%"} and outcome like 'failed%'`;
  console.log(`DRAIN ${((performance.now() - d0) / 1000).toFixed(1)} s in ${rounds + 1} runs, pending ${left}, failed ${failed}, last run ${JSON.stringify(last)}`);
  console.log(`CHECK  contacts left ${contactsLeft} of ${before} (expected ${before - Math.ceil(N / 2)}), events still pending ${left} (expected 0)`);

  const ok = bad.length === 0 && pct(lat, 95) < 300 && queued === N && left === 0 && failed === 0 && contactsLeft === before - Math.ceil(N / 2);
  await db`delete from installations where company_id = ${CO}`;
  await db`delete from webhook_inbox where webhook_id like ${P + "%"}`;
  await db`delete from webhook_events where webhook_id like ${P + "%"}`;
  await closeDb();
  console.log(ok ? "\nPASS (0 non-2xx, p95 under 300 ms, nothing lost)" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
