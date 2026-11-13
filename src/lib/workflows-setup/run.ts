import { sql } from "../db";
import { isLive } from "../live-flags";
import { getSettings as companySettings } from "../analytics/queries";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { resolveBrand } from "../brand-resolve";
import { parseGranted } from "../scope-groups";
import { locationAccessToken } from "../sync/engine";
import { getSettings as callQueueSettings } from "../dial/callqueue-run";
import { httpClient, type WfClient } from "./client";
import { handSteps } from "./hand-steps";
import { folderNameFor, neutralName } from "./naming";
import { checkOnly, DEFAULT_SETUP, missingSetupScopes, provision, type Result, type Row, type Store } from "./provisioner";
import { CALL_QUEUE } from "./templates";

// Server side of workflow setup (docs/features/WORKFLOW_SETUP.md). Tables come from the not-yet-applied migration 20261117090000: until it runs, `ready` is false and nothing is read or written.
const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export type SetupSettings = { folderName: string; autoSetup: boolean; autoPublish: boolean; assignMode: "round_robin" | "user"; assignUserId: string | null };
export async function getSetupSettings(installationId: string, locationId: string): Promise<{ ready: boolean; s: SetupSettings; brandFolder: string }> {
  const brand = resolveBrand(await companySettings(installationId).catch(() => null));
  const brandFolder = folderNameFor({ brand });
  const base: SetupSettings = { folderName: brandFolder, ...DEFAULT_SETUP, assignMode: "round_robin", assignUserId: null };
  const shape = (r: Record<string, unknown>, publish: boolean): SetupSettings => ({ folderName: folderNameFor({ custom: r.folder_name as string | null, brand }), autoSetup: r.auto_setup === true, autoPublish: publish, assignMode: r.assign_mode === "user" ? "user" : "round_robin", assignUserId: (r.assign_user_id as string | null) ?? null });
  try {
    let r: Record<string, unknown> | undefined;
    try { [r] = await sql()`select folder_name, auto_setup, auto_publish, assign_mode, assign_user_id from workflow_setup_settings where installation_id = ${installationId} and location_id = ${locationId}`; }
    catch (e) {
      // Before the 20261231170000 migration there is no auto_publish column: read the old shape and publish by default.
      if ((e as { code?: string })?.code !== "42703") throw e;
      [r] = await sql()`select folder_name, auto_setup, assign_mode, assign_user_id from workflow_setup_settings where installation_id = ${installationId} and location_id = ${locationId}`;
    }
    if (!r) return { ready: true, s: base, brandFolder };
    return { ready: true, brandFolder, s: shape(r, r.auto_publish !== false) };
  } catch (e) { if (missing(e)) return { ready: false, s: base, brandFolder }; throw e; }
}

/** Scopes this install was granted, or null when unknown (nothing is blocked on a guess). */
export async function grantedFor(installationId: string): Promise<string[] | null> {
  try {
    const [r] = await sql()`select scope from installations where id = ${installationId}`;
    return typeof r?.scope === "string" && r.scope.trim() ? parseGranted(r.scope) : null;
  } catch { return null; }
}

export async function saveSetupSettings(installationId: string, locationId: string, p: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  const cur = await getSetupSettings(installationId, locationId);
  if (!cur.ready) return { ok: false, message: "Saving this needs the latest database update, which has not run yet." };
  let folder: string | null = cur.s.folderName === cur.brandFolder ? null : cur.s.folderName;
  if (p.folderName !== undefined) {
    if (p.folderName === "" || p.folderName === null) folder = null;
    else { folder = neutralName(p.folderName); if (!folder) return { ok: false, message: "Use a plain folder name (letters and numbers), without the product or platform name." }; }
  }
  const mode = p.assignMode === "user" ? "user" : p.assignMode === "round_robin" ? "round_robin" : cur.s.assignMode;
  const uid = p.assignUserId === undefined ? cur.s.assignUserId : typeof p.assignUserId === "string" && /^[A-Za-z0-9_-]{3,64}$/.test(p.assignUserId) ? p.assignUserId : null;
  if (mode === "user" && !uid) return { ok: false, message: "Choose which person gets the calls." };
  const auto = typeof p.autoSetup === "boolean" ? p.autoSetup : cur.s.autoSetup;
  const publish = typeof p.autoPublish === "boolean" ? p.autoPublish : cur.s.autoPublish;
  await sql()`insert into workflow_setup_settings (installation_id, location_id, folder_name, auto_setup, auto_publish, assign_mode, assign_user_id, updated_at)
    values (${installationId}, ${locationId}, ${folder}, ${auto}, ${publish}, ${mode}, ${mode === "user" ? uid : null}, now())
    on conflict (installation_id, location_id) do update set folder_name = excluded.folder_name, auto_setup = excluded.auto_setup, auto_publish = excluded.auto_publish, assign_mode = excluded.assign_mode, assign_user_id = excluded.assign_user_id, updated_at = now()`;
  return { ok: true };
}

export const storeFor = (installationId: string, locationId: string): Store => ({
  async get(templateKey) {
    const [r] = await sql()`select folder_id, workflow_id, template_version, status, last_error from workflow_setup where installation_id = ${installationId} and location_id = ${locationId} and template_key = ${templateKey}`;
    return r ? { templateKey, folderId: (r.folder_id as string | null) ?? null, workflowId: (r.workflow_id as string | null) ?? null, templateVersion: r.template_version as number, status: r.status as Row["status"], lastError: (r.last_error as string | null) ?? null } : null;
  },
  async save(r) {
    await sql()`insert into workflow_setup (installation_id, location_id, template_key, folder_id, workflow_id, template_version, status, last_error, updated_at)
      values (${installationId}, ${locationId}, ${r.templateKey}, ${r.folderId}, ${r.workflowId}, ${r.templateVersion}, ${r.status}, ${r.lastError}, now())
      on conflict (installation_id, location_id, template_key) do update set folder_id = excluded.folder_id, workflow_id = excluded.workflow_id, template_version = excluded.template_version,
        status = excluded.status, last_error = excluded.last_error, updated_at = now()`;
  },
});

export type SetupView = { ready: boolean; state: Row["status"] | "none"; workflowId: string | null; updateAvailable: boolean; lastError: string | null; settings: SetupSettings; folderDefault: string; live: boolean; tag: string; users: Array<{ id: string; name: string }> };

/** What the card shows. Reads only our own table. */
export async function setupView(installationId: string, locationId: string): Promise<SetupView> {
  const [st, cq] = await Promise.all([getSetupSettings(installationId, locationId), callQueueSettings(installationId, locationId)]);
  const live = isLive("WRITE_GHL_LIVE") && (await writeEnabledFor(installationId, locationId));
  let row: Row | null = null;
  if (st.ready) row = await storeFor(installationId, locationId).get(CALL_QUEUE.key);
  const users = st.ready ? await sql()`select user_id, name from location_users where installation_id = ${installationId} and location_id = ${locationId} order by name limit 100`.then((r) => r.map((u) => ({ id: u.user_id as string, name: u.name as string }))).catch(() => []) : [];
  return { users, ready: st.ready, state: row?.status ?? "none", workflowId: row?.workflowId ?? null, updateAvailable: !!row && row.templateVersion < CALL_QUEUE.version, lastError: row?.lastError ?? null, settings: st.s, folderDefault: st.brandFolder, live, tag: cq.s.tag };
}

const NO_CLIENT: WfClient = { async stepTypes() { return { ok: false, kind: "failed", status: 0 }; }, async list() { return { ok: false, kind: "failed", status: 0 }; }, async validate() { return { ok: false, kind: "failed", status: 0 }; }, async create() { return { ok: false, kind: "failed", status: 0 }; }, async publish() { return { ok: false, kind: "failed", status: 0 }; } };

export async function runSetup(a: { installationId: string; companyId: string; locationId: string; manual: boolean }): Promise<Result> {
  const [st, cq] = await Promise.all([getSetupSettings(a.installationId, a.locationId), callQueueSettings(a.installationId, a.locationId)]);
  if (!st.ready) return { state: "unavailable", code: "failed", message: "Setup needs the latest database update, which has not run yet.", lines: [] };
  const granted = await grantedFor(a.installationId);
  // Without the two workflow permissions no key is minted and no request is made: the provisioner answers "needs permission" at once.
  let client = NO_CLIENT;
  if (!missingSetupScopes(granted)) {
    try { client = httpClient(await locationAccessToken(a.companyId, a.locationId), a.locationId); }
    catch { return { state: "unavailable", code: "failed", message: "SubSync could not reach this account just now. Try again in a minute, or use the steps below.", lines: [], steps: handSteps(cq.s.tag, st.s.assignMode === "user" && st.s.assignUserId ? { mode: "user", userId: st.s.assignUserId } : { mode: "round_robin" }, st.s.folderName, CALL_QUEUE.name) }; }
  }
  const optedIn = await writeEnabledFor(a.installationId, a.locationId);
  return provision(CALL_QUEUE, {
    client, store: storeFor(a.installationId, a.locationId), installationId: a.installationId, locationId: a.locationId, optedIn, manual: a.manual, granted, autoPublish: st.s.autoPublish,
    settings: { folderName: st.s.folderName, tag: cq.s.tag, assign: st.s.assignMode === "user" && st.s.assignUserId ? { mode: "user", userId: st.s.assignUserId } : { mode: "round_robin" } },
  });
}

/** The INSTALL hook (location installs, and each account of a bulk install): on unless the account switched automatic setup off, a dry run until the account opts in, and never able to stop an install. */
export async function autoSetupOnInstall(installationId: string, companyId: string, locationId: string): Promise<void> {
  try {
    const st = await getSetupSettings(installationId, locationId);
    if (!st.ready || !st.s.autoSetup) return;
    await runSetup({ installationId, companyId, locationId, manual: false });
  } catch (e) { console.error("Automatic workflow setup failed", e instanceof Error ? e.message : "error"); }
}

/** "I did it": the read-only check. Without the workflow permission it falls back to counting contacts that carry the call tag. */
export async function checkSetupNow(a: { installationId: string; companyId: string; locationId: string }): Promise<{ state: string; message: string }> {
  const token = await locationAccessToken(a.companyId, a.locationId);
  const cq = await callQueueSettings(a.installationId, a.locationId);
  const r = await checkOnly(CALL_QUEUE, { client: httpClient(token, a.locationId), store: storeFor(a.installationId, a.locationId) });
  if (r.state !== "unverified") return r;
  const [t] = await sql()`select count(*)::int n from cached_contacts where installation_id = ${a.installationId} and location_id = ${a.locationId} and exists (select 1 from unnest(tags) x where lower(x) = ${cq.s.tag.toLowerCase()})`;
  return { state: "unverified", message: `${r.message} Right now ${t?.n ?? 0} contact${t?.n === 1 ? "" : "s"} carry the tag "${cq.s.tag}".` };
}
