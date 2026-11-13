import { ACTION_KEYS, CALL_CAP_PER_MINUTE, answer, idempotencyKey, isActionKey, isId, parseCall, type ActionKey, type ActionResult, type CallBody } from "./core";

// The two actions a customer's workflow can call (flag wf_module, default off). Every call, in this order:
//   1. the tenant is the account named in the VERIFIED body (extras.locationId) and nothing else; an account SubSync does not know is refused;
//   2. the account must have switched THIS action on in Settings, Integrations, Workflow blocks (off by default);
//   3. a small per-minute cap per account;
//   4. idempotency: the same call twice does nothing the second time;
//   5. the action's own safety rules, then the one write gateway (WRITE_GHL_LIVE master switch + the account's write opt-in; otherwise a dry run).
// Nothing here replies to a lead or sends a message. Contacts on Do Not Disturb are left alone.

export type ContactFact = { exists: boolean; dnd: boolean; tags: string[] };
export type ApptFact = { appointmentId: string; contactId: string | null; status: string | null; startAt: string | null; contactName: string };
export type WriteOutcome = "done" | "dry_run" | "needs_permission" | "failed";

export type ActionDeps = {
  tenantOf: (locationId: string) => Promise<{ installationId: string; companyId: string } | null>;
  flagOn: (installationId: string) => Promise<boolean>;
  enabled: (installationId: string, locationId: string, key: ActionKey) => Promise<boolean>;
  recentCalls: (installationId: string, locationId: string) => Promise<number>;
  claim: (installationId: string, locationId: string, key: ActionKey, idem: string, contactId: string | null) => Promise<boolean>;
  finish: (installationId: string, locationId: string, key: ActionKey, idem: string, result: string) => Promise<void>;
  contact: (installationId: string, locationId: string, contactId: string) => Promise<ContactFact>;
  queueTag: (installationId: string, locationId: string) => Promise<string>;
  /** Adds the tag through the one write gateway. Returns "dry_run" unless the master switch and the account's opt-in are both on. */
  addTag: (a: { installationId: string; companyId: string; locationId: string; contactId: string; tag: string }) => Promise<WriteOutcome>;
  appointment: (installationId: string, locationId: string, appointmentId: string) => Promise<ApptFact | null>;
  latestPastAppointment: (installationId: string, locationId: string, contactId: string, now: number) => Promise<string | null>;
  setOutcome: (a: { installationId: string; companyId: string; locationId: string; appointmentId: string; contactId: string | null; status: "showed" | "noshow" }) => Promise<WriteOutcome>;
  now?: () => number;
};

export type Handled = { status: number; body: ActionResult & { action: string | null } };
const out = (status: number, action: string | null, r: ActionResult): Handled => ({ status, body: { ...r, action } });
const OUTCOMES: Record<string, "showed" | "noshow"> = { showed: "showed", show: "showed", noshow: "noshow", "no-show": "noshow", no_show: "noshow", "no show": "noshow" };

export async function handleAction(raw: unknown, deps: ActionDeps): Promise<Handled> {
  const call: CallBody = parseCall(raw);
  if (!isActionKey(call.key)) return out(400, null, answer("bad_input", false));
  const key = call.key;
  if (!call.locationId) return out(400, key, answer("bad_input", false));
  const tenant = await deps.tenantOf(call.locationId);
  if (!tenant) return out(403, key, answer("unknown_account", false));
  const { installationId, companyId } = tenant, locationId = call.locationId;
  if (!(await deps.flagOn(installationId))) return out(404, key, answer("off", false));
  if (!(await deps.enabled(installationId, locationId, key))) return out(403, key, answer("not_enabled", false));
  if ((await deps.recentCalls(installationId, locationId)) >= CALL_CAP_PER_MINUTE) return out(429, key, answer("limit", false));
  const idem = idempotencyKey(call);
  if (!(await deps.claim(installationId, locationId, key, idem, call.contactId))) return out(200, key, answer("already", true));
  let result: ActionResult;
  try {
    result = key === "subsync_add_to_call_queue" ? await addToQueue(call, installationId, companyId, deps) : await markOutcome(call, installationId, companyId, deps);
  } catch {
    result = answer("failed", false);
  }
  await deps.finish(installationId, locationId, key, idem, result.result).catch(() => undefined);
  return out(200, key, result);
}

const fromWrite = (w: WriteOutcome): ActionResult => (w === "done" ? answer("done", true) : w === "dry_run" ? answer("dry_run", true) : w === "needs_permission" ? answer("needs_permission", false) : answer("failed", false));

async function addToQueue(call: CallBody, installationId: string, companyId: string, deps: ActionDeps): Promise<ActionResult> {
  const locationId = call.locationId!;
  if (!isId(call.contactId)) return answer("bad_input", false);
  const c = await deps.contact(installationId, locationId, call.contactId); // scoped to THIS account: a contact id from another account is simply not found
  if (!c.exists) return answer("not_found", false);
  if (c.dnd) return answer("dnd", false);
  const tag = await deps.queueTag(installationId, locationId);
  if (c.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return answer("already", true);
  return fromWrite(await deps.addTag({ installationId, companyId, locationId, contactId: call.contactId, tag }));
}

async function markOutcome(call: CallBody, installationId: string, companyId: string, deps: ActionDeps): Promise<ActionResult> {
  const locationId = call.locationId!, now = (deps.now ?? Date.now)();
  const want = OUTCOMES[String(call.data.outcome ?? "").trim().toLowerCase()];
  if (!want) return answer("bad_input", false);
  let apptId = isId(call.data.appointmentId) ? call.data.appointmentId : null;
  if (!apptId && isId(call.contactId)) apptId = await deps.latestPastAppointment(installationId, locationId, call.contactId, now);
  if (!apptId) return answer("not_found", false);
  const a = await deps.appointment(installationId, locationId, apptId); // scoped to this account
  if (!a) return answer("not_found", false);
  if (call.contactId && a.contactId && a.contactId !== call.contactId) return answer("not_found", false);
  const same = (a.status ?? "").toLowerCase().replace(/[\s_-]/g, "") === want;
  if (same) return answer("already", true);
  if (!a.startAt || Date.parse(a.startAt) >= now) return answer("future", false); // the same preview rule the app uses: an appointment that has not happened cannot have an outcome
  return fromWrite(await deps.setOutcome({ installationId, companyId, locationId, appointmentId: apptId, contactId: a.contactId, status: want }));
}

export const ACTION_KEY_LIST = ACTION_KEYS;
