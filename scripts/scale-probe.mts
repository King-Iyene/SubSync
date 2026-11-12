// Dev helper: call a list of endpoints as the seeded agency and print status, time and the top-level keys of the answer.
// Usage: BASE_URL=http://localhost:3190 node --env-file=.env.local --env-file=scripts/scale.env --import tsx scripts/scale-probe.mts "speed" "appointments?part=overview"
import { assertThrowawayDb, SCALE } from "./scale-guard.ts";
import postgres from "postgres";
import { signSession } from "../src/lib/session.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3190";
const db = postgres(assertThrowawayDb(), { max: 1, ssl: false });
void db;
const token = signSession({ companyId: SCALE.companyA, userId: "u-owner", role: "admin", userName: "Scale", demo: false, kind: "agency", locationId: null, dataOwner: false, personRole: "agency_owner" } as never, 3600);
for (const p of process.argv.slice(2)) {
  const t = performance.now();
  const res = await fetch(`${BASE}/api/app/${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let keys = "";
  try { const j = JSON.parse(text); keys = Array.isArray(j) ? `[array ${j.length}]` : Object.keys(j).slice(0, 25).join(","); } catch { keys = text.slice(0, 80); }
  console.log(`${String(Math.round(performance.now() - t)).padStart(6)} ms ${res.status} ${p}\n         ${process.env.DUMP ? text.slice(0, Number(process.env.DUMP)) : keys}`);
}
await db.end();
