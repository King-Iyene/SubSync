import { closeDb, sql } from "../src/lib/db";
import { locationAccessToken } from "../src/lib/sync/engine";
import { httpClient } from "../src/lib/workflows-setup/client";
import { DEFAULT_FOLDER } from "../src/lib/workflows-setup/naming";
import { missingSetupScopes, SETUP_SCOPES } from "../src/lib/workflows-setup/provisioner";
import { resolveSteps } from "../src/lib/workflows-setup/steps";
import { CALL_QUEUE } from "../src/lib/workflows-setup/templates";
import { isLive, outward } from "../src/lib/live-flags";
import { parseGranted } from "../src/lib/scope-groups";

// Probe for automatic call queue workflow setup (docs/WORKFLOWS_PROBE.md). Read mostly.
//   node --env-file=.env.local --import tsx scripts/probe-workflows.ts --location <locationId>            (read only: scopes, step types, validate)
//   node --env-file=.env.local --import tsx scripts/probe-workflows.ts --location <locationId> --create   (also makes a throwaway draft "SubSync probe", then deletes only that draft)
// --create needs WRITE_GHL_LIVE=true; without it the create is only described. Prints plain lines. Never prints a token.
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const say = (ok: boolean | null, line: string) => console.log(`${ok === null ? "[info]" : ok ? "[ OK ]" : "[FAIL]"} ${line}`);

async function main() {
  const locationId = arg("--location");
  if (!locationId) { console.log("Usage: --location <locationId> [--create]"); process.exitCode = 1; return; }
  const create = process.argv.includes("--create");
  const [r] = await sql()`select i.id, i.company_id, i.scope from locations l join installations i on i.id = l.installation_id where l.location_id = ${locationId} and i.uninstalled_at is null limit 1`;
  if (!r) { say(false, "This location is not installed (or not synced yet)."); process.exitCode = 1; return; }
  const granted = typeof r.scope === "string" && r.scope.trim() ? parseGranted(r.scope as string) : null;
  say(null, `Permissions granted: ${granted ? granted.length : "not known"}`);
  for (const s of SETUP_SCOPES) say(granted ? granted.includes(s) : null, `${s}: ${granted ? (granted.includes(s) ? "granted" : "NOT granted (reinstall and allow the optional workflow permissions)") : "unknown"}`);
  if (missingSetupScopes(granted)) { say(false, "Stopping: without both permissions the platform will refuse every call."); process.exitCode = 1; return; }

  const token = await locationAccessToken(r.company_id as string, locationId);
  const c = httpClient(token, locationId);

  const types = await c.stepTypes();
  if (!types.ok) { say(false, `Get Step Types failed (${types.kind}, HTTP ${types.status}).${types.kind === "not_enabled" ? " The Workflows API is not enabled for this location yet: send docs/WORKFLOWS_API_SUPPORT_MESSAGE.md to support." : ""}`); process.exitCode = 1; return; }
  say(true, `Get Step Types: ${types.value.length} step types`);
  const steps = resolveSteps(types.value);
  if (!steps.ok) { say(false, `Missing step types: ${steps.missing.join(", ")}. Paste the list below back to SubSync.`); console.log(types.value.map((t) => `  ${t.kind || "?"} | ${t.id} | ${t.name}`).join("\n")); process.exitCode = 1; return; }
  say(true, `Found: trigger "${steps.trigger.name}" (${steps.trigger.id}), action "${steps.manualCall.name}" (${steps.manualCall.id}), action "${steps.removeTag.name}" (${steps.removeTag.id})`);

  const list = await c.list();
  say(list.ok, list.ok ? `Workflow list: ${list.value.length} workflows${list.value.some((w) => w.name === CALL_QUEUE.name) ? ` (one is already named "${CALL_QUEUE.name}")` : ""}` : `Workflow list failed (${list.kind}, HTTP ${list.status})`);

  const def = CALL_QUEUE.build({ folderName: DEFAULT_FOLDER, tag: CALL_QUEUE.defaultTag, assign: { mode: "round_robin" }, steps });
  const v = await c.validate(def);
  say(v.ok, v.ok ? "Validate Workflow Definition: accepted" : `Validate Workflow Definition: refused (${v.kind}, HTTP ${v.status}). Paste this output back to SubSync.`);
  if (!v.ok) { process.exitCode = 1; return; }

  if (!create) { say(null, "Read-only run finished. Add --create to also make and remove a throwaway draft."); return; }
  // No folder: the probe must not leave one behind.
  const probeDef: Record<string, unknown> = { ...def, name: "SubSync probe" };
  delete probeDef.folderName;
  delete probeDef.createFolderIfMissing;
  const made = await outward({ flag: "WRITE_GHL_LIVE", verb: "CREATE", what: "workflow.probe.create", installationId: r.id as string, ids: { locationId } }, () => c.create(probeDef));
  if (!made.live) { say(null, `Would create a draft "SubSync probe". Nothing was sent: WRITE_GHL_LIVE is ${isLive("WRITE_GHL_LIVE") ? "on" : "off"}.`); return; }
  if (!made.result.ok) { say(false, `Create refused (${made.result.kind}, HTTP ${made.result.status}).`); process.exitCode = 1; return; }
  const id = made.result.value.id;
  say(true, `Created draft "SubSync probe" (${id}).`);
  // Only the draft this run just made, by its own id, and only if it still has the probe name.
  const again = await c.list();
  const mine = again.ok ? again.value.find((w) => w.id === id) : undefined;
  if (!c.remove || !mine || mine.name !== "SubSync probe") { say(false, `Not deleting automatically. Delete the draft "SubSync probe" in your CRM by hand.`); return; }
  const del = await outward({ flag: "WRITE_GHL_LIVE", verb: "DELETE", what: "workflow.probe.delete", installationId: r.id as string, ids: { locationId, workflowId: id } }, () => c.remove!(id));
  say(del.live && del.result.ok, del.live ? (del.result.ok ? "Deleted the probe draft." : `Could not delete the probe draft (${del.result.kind}). Delete "SubSync probe" in your CRM by hand.`) : "Delete skipped.");
}

main().catch((e) => { console.error("Probe failed:", e instanceof Error ? e.message : "error"); process.exitCode = 1; }).finally(() => closeDb());
