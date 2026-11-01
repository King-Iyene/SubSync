// The morning test for INTEGRATIONS_SPEC section 4 (roadmap E0 item 8): the real limits of the CRM's note, internal comment and text custom field.
// NOT RUN OVERNIGHT. Running it WRITES to a real CRM account, so it is built to be safe by construction:
//
//   node --env-file=.env.local --import tsx scripts/ghl-write-limits.ts --location <locationId> --contact <contactId> [--field <textCustomFieldId>]           (plan only)
//   WRITE_GHL_LIVE=true node --env-file=.env.local --import tsx scripts/ghl-write-limits.ts --location <id> --contact <id> [--field <id>] --run          (writes)
//
// Without --run it prints every request it WOULD send (path, method, size in characters: never content) and sends nothing.
// With --run it refuses unless ALL of these hold: WRITE_GHL_LIVE is exactly "true"; the account's name contains "KD Squares Test" (the test account King
// named); the contact belongs to that account's cached contacts; the contact's name starts with "zz". It writes only test text made of a marker and filler
// letters, tries to delete everything it created, and prints a result table (statuses, ids, sizes, whether line breaks and HTML came back unchanged).
// Paste that table into docs/features/E0.md ("GHL write limits") and set ASSUMED_LIMITS in src/lib/ghl/crm-writes.ts to what it proves (LIMITS_VERIFIED = true).
// Scopes: needs contacts.write (notes, custom fields) and conversations/message.write (internal comments). If a scope is missing the table says 401/403 and stops.

import { GHL_API } from "../src/lib/ghl/client";
import { buildComment, buildFieldUpdate, buildNote, type CrmRequest } from "../src/lib/ghl/crm-writes";
import { ghlFetch } from "../src/lib/ghl/http";
import { closeDb, sql } from "../src/lib/db";
import { isLive } from "../src/lib/live-flags";
import { locationAccessToken } from "../src/lib/sync/engine";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const RUN = process.argv.includes("--run");
const location = arg("location");
const contact = arg("contact");
const field = arg("field");
const MARK = `E0-LIMIT-TEST-${Date.now().toString(36)}`;

const NOTE_SIZES = [1_000, 5_000, 10_000, 30_000];
const COMMENT_SIZES = [500, 1_000, 2_000, 5_000];
const FIELD_SIZES = [255, 500, 1_000, 5_000];

const filler = (n: number, withBreaks = false) => {
  const unit = withBreaks ? "line one\nline two\n<b>bold</b> & <i>italic</i> 0123456789\n" : "abcdefghij";
  return (MARK + " ").concat(unit.repeat(Math.ceil(n / unit.length))).slice(0, n);
};

type Row = { step: string; chars: number; status: number | string; id: string | null; note: string };
const table: Row[] = [];
const say = (r: Row) => { table.push(r); console.log(`${String(r.status).padEnd(8)} ${r.step.padEnd(34)} ${String(r.chars).padStart(6)} chars  ${r.id ?? ""}  ${r.note}`); };

function plan() {
  const reqs: Array<[string, CrmRequest, number]> = [];
  for (const n of NOTE_SIZES) reqs.push([`note ${n}`, buildNote({ contactId: contact ?? "<contact>", body: filler(n) }), n]);
  reqs.push(["note with line breaks and HTML 1000", buildNote({ contactId: contact ?? "<contact>", body: filler(1_000, true) }), 1_000]);
  for (const n of COMMENT_SIZES) reqs.push([`internal comment ${n}`, buildComment({ contactId: contact ?? "<contact>", message: filler(n) }), n]);
  if (field) for (const n of FIELD_SIZES) reqs.push([`text field ${n}`, buildFieldUpdate({ contactId: contact ?? "<contact>", fields: [{ id: field, value: filler(n) }] }), n]);
  return reqs;
}

async function main() {
  if (!location || !contact) { console.error("Give --location <locationId> and --contact <contactId>."); process.exit(1); }
  if (!RUN) {
    console.log("PLAN ONLY (nothing is sent). Add --run, with the WRITE_GHL_LIVE switch set to the word true, to write to the test account.");
    for (const [step, r, n] of plan()) console.log(`WOULD WRITE  ${r.method} ${r.path}  ${step}  ${n} chars  scope ${r.scope}  version ${r.version}`);
    console.log("Then it reads each note back (GET /contacts/{id}/notes/{noteId}) and deletes what it made (DELETE ...), and reports whether line breaks and HTML survived.");
    return;
  }
  if (!isLive("WRITE_GHL_LIVE")) { console.error("Refusing: WRITE_GHL_LIVE is not exactly \"true\"."); process.exit(1); }
  const db = sql();
  const [loc] = await db`select l.name, i.company_id from locations l join installations i on i.id = l.installation_id and i.uninstalled_at is null where l.location_id = ${location}`;
  if (!loc || !/KD Squares Test/i.test(String(loc.name ?? ""))) { console.error("Refusing: that account is not named \"KD Squares Test\"."); process.exit(1); }
  const [c] = await db`select first_name, last_name from cached_contacts where location_id = ${location} and contact_id = ${contact}`;
  if (!c || !/^zz/i.test(`${c.first_name ?? ""}`)) { console.error("Refusing: the contact is not one of the test contacts (first name starting with zz)."); process.exit(1); }

  const token = await locationAccessToken(String(loc.company_id), location);
  const headers = (version: string) => ({ Authorization: `Bearer ${token}`, Version: version, Accept: "application/json", "Content-Type": "application/json" });
  const call = async (r: CrmRequest) => {
    const res = await ghlFetch(`${GHL_API}${r.path}`, { method: r.method, headers: headers(r.version), body: JSON.stringify(r.body), cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  };
  const idOf = (j: Record<string, unknown>) => String((j.note as { id?: string } | undefined)?.id ?? j.id ?? j.messageId ?? "") || null;
  const created: Array<{ kind: "note" | "comment"; id: string }> = [];

  // 1. Notes: sizes, then line breaks and HTML, each read back.
  for (const [step, r, n] of plan().filter(([s]) => s.startsWith("note"))) {
    const out = await call(r);
    const id = idOf(out.json);
    let note = "";
    if (out.status < 300 && id) {
      created.push({ kind: "note", id });
      const back = await ghlFetch(`${GHL_API}/contacts/${encodeURIComponent(contact)}/notes/${encodeURIComponent(id)}`, { headers: headers("2021-07-28"), cache: "no-store" });
      const bj = (await back.json().catch(() => ({}))) as { note?: { body?: string } };
      const text = bj.note?.body ?? "";
      note = `stored ${text.length} of ${n} chars; line breaks ${text.includes("\n") ? "kept" : "lost"}; HTML ${text.includes("<b>") ? "kept as typed" : text.includes("bold") ? "changed" : "n/a"}`;
    } else note = `refused: ${typeof out.json.message === "string" ? out.json.message.slice(0, 80) : "no message"}`;
    say({ step, chars: n, status: out.status, id, note });
  }

  // 2. Internal comments: the plain form (contactId and message), sizes, and what happens when the contact has no conversation.
  for (const [step, r, n] of plan().filter(([s]) => s.startsWith("internal"))) {
    const out = await call(r);
    const id = idOf(out.json);
    if (out.status < 300 && id) created.push({ kind: "comment", id });
    say({ step, chars: n, status: out.status, id, note: out.status < 300 ? "created (check in the CRM that it is internal, not sent to the contact)" : `refused: ${typeof out.json.message === "string" ? out.json.message.slice(0, 80) : "no message"}` });
  }

  // 3. A text custom field's real maximum length.
  if (field) for (const [step, r, n] of plan().filter(([s]) => s.startsWith("text field"))) {
    const out = await call(r);
    say({ step, chars: n, status: out.status, id: null, note: out.status < 300 ? "accepted (read the field in the CRM to see whether it was cut)" : "refused" });
  }

  // 4. Clean up what was made, and say whether deletion works at all.
  for (const x of created) {
    const path = x.kind === "note" ? `/contacts/${encodeURIComponent(contact)}/notes/${encodeURIComponent(x.id)}` : `/conversations/messages/${encodeURIComponent(x.id)}`;
    const res = await ghlFetch(`${GHL_API}${path}`, { method: "DELETE", headers: headers(x.kind === "note" ? "2021-07-28" : "2021-04-15"), cache: "no-store" });
    say({ step: `delete ${x.kind}`, chars: 0, status: res.status, id: x.id, note: res.status < 300 ? "deleted" : "could not delete: remove it by hand in the test account" });
  }
  console.log(`\nDone. ${table.length} lines. Paste the table into docs/features/E0.md under "GHL write limits". Test marker: ${MARK}`);
}

main().then(() => closeDb(), (e) => { console.error("failed:", (e as Error).message.slice(0, 200)); void closeDb().then(() => process.exit(1)); });
