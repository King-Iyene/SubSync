import { sql } from "../db";
import { ownedAccount } from "./pl-guard";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { dryRunWords } from "../analytics/unanswered-actions";
import {
  EMAIL_TEMPLATES_SCOPE, ESTIMATE_WRITE_SCOPE, INSTALLER_SCOPE, INVOICE_WRITE_SCOPE, RECURRING_READ_SCOPE, RECURRING_WRITE_SCOPE, TEMPLATE_WRITE_SCOPE,
  PIPELINE_READ_SCOPE, PIPELINE_WRITE_SCOPE, checkDraft, checkFollowUp, checkStageName, contactForDraft, createDraft, createFollowUp, draftTotal, followUpWords, listEmailTemplates, planStageRename, readFollowUp, readInstaller, readPipeline, renameStage,
  type DraftKind,
} from "../ghl/more-tools-gateway";
import type { SafeWriteResult } from "../ghl/safe-writes-gateway";
import { failureText } from "../ghl/workbench";
import { isLive } from "../live-flags";
import { parseGranted } from "../scope-groups";
import { json, type AuthContext } from "./auth";

// Extra tools, under /api/app/mt/<part> (flag more_tools; the one gateway is src/lib/ghl/more-tools-gateway.ts):
//   GET  setup?locationId       practice or live mode, and which permissions the install holds
//   GET  templates?locationId   the account's email templates (names and dates, read live, never stored)
//   GET  installer              the platform's installer record for this company (agency owners and admins only)
//   POST repeat                 { locationId, contactId, step, confirmed, followUp }   a repeating follow-up task on one contact, then read back
//   POST draft                  { locationId, contactId?, kind: estimate|invoice|template, step, confirmed, draft }   an unsent estimate, an unsent invoice, or an invoice template
// Who is asking and which accounts they may open come from the verified session. An id in the request is a REQUEST: used only after ownedAccount, and a contact must be one SubSync holds for
// THAT account. The contact's name, email and phone, and the account's business name, are read from SubSync's own copy here, never taken from the browser. Nothing here messages a lead.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type MoreToolsHelpers = { allowed: () => Promise<string[] | null>; locationToken: (locationId: string) => Promise<string>; companyToken: () => Promise<string> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
const isAdminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
const permissionText = (what: string) => `Needs permission: reconnect SubSync so it may ${what}. Nothing was changed.`;
const unreachable = () => json({ ok: false, message: "SubSync could not reach this account just now. Try again in a minute." }, 502);

const mode = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId).catch(() => false);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};

async function grantedList(ctx: Ctx): Promise<string[] | null> {
  if (ctx.demo) return null;
  try {
    const [r] = await sql()`select scope from installations where id = ${ctx.installationId}`;
    return typeof r?.scope === "string" && r.scope.trim() ? parseGranted(r.scope as string) : null;
  } catch { return null; }
}
/** True when the permission is granted, or when SubSync cannot tell (the platform then answers). */
const has = (list: string[] | null, scope: string) => list === null || list.includes(scope);

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}
const doing = (b: Record<string, unknown>) => b.step === "do";

function answer(r: SafeWriteResult, words: { done: string; already: string; permission: string }, extra: Record<string, unknown> = {}): Response {
  switch (r.outcome) {
    case "done": return json({ ok: true, done: true, message: words.done, ...extra });
    case "already": case "unchanged": return json({ ok: true, already: true, message: words.already });
    case "dry_run": return json({ ok: true, dryRun: true, reason: r.reason, message: `${dryRunWords(r.reason)} Here is what would have happened.` });
    case "needs_permission": return json({ ok: false, needsPermission: true, message: words.permission }, 403);
    case "rate_limited": return json({ ok: false, message: `Slow down a little: try again in ${r.retryInSeconds} seconds.`, retryInSeconds: r.retryInSeconds }, 429);
    case "blocked": return json({ ok: false, blocked: true, message: r.text }, 422);
    case "failed": return json({ ok: false, message: failureText(r.status), retry: true }, 502);
  }
}

export async function handleMoreTools(ctx: Ctx, h: MoreToolsHelpers): Promise<Response> {
  const part = ctx.segments[1], m = ctx.request.method;
  if (ctx.entitlements.features.more_tools !== true || ctx.entitlements.locked.includes("more_tools")) return json({ error: "This is not switched on for your account" }, 404);
  if (m === "GET" && part === "installer") return installerRoute(ctx, h);
  if (m === "GET") {
    const locationId = await ownedAccount(ctx.installationId, await h.allowed(), ctx.url.searchParams.get("locationId"));
    if (!locationId) return json({ error: "That account is not available" }, 404);
    if (part === "setup") return setupRoute(ctx, locationId);
    if (part === "templates") return templatesRoute(ctx, h, locationId);
    if (part === "pipelines") return pipelinesRoute(ctx, locationId);
    return json({ error: "Unknown action" }, 404);
  }
  if (m !== "POST") return json({ error: "Unknown action" }, 404);
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send the details" }, 400);
  const locationId = await ownedAccount(ctx.installationId, await h.allowed(), b.locationId);
  if (!locationId) return json({ error: "That account is not available" }, 404);
  // Making a follow-up is for everyone who can open the contact; quotes and invoices are for the account's administrators and the agency.
  if (part === "repeat") return repeatRoute(ctx, h, locationId, b);
  if (!isAdminSide(ctx)) return json({ error: "Ask your administrator to make this change." }, 403);
  if (part === "draft") return draftRoute(ctx, h, locationId, b);
  if (part === "stage") return stageRoute(ctx, h, locationId, b);
  return json({ error: "Unknown action" }, 404);
}

async function setupRoute(ctx: Ctx, locationId: string): Promise<Response> {
  const [md, list] = await Promise.all([mode(ctx, locationId), grantedList(ctx)]);
  return json({
    canEdit: isAdminSide(ctx), mode: md,
    permissions: { stage: has(list, PIPELINE_WRITE_SCOPE) && has(list, PIPELINE_READ_SCOPE), repeat: has(list, RECURRING_WRITE_SCOPE), estimate: has(list, ESTIMATE_WRITE_SCOPE), invoice: has(list, INVOICE_WRITE_SCOPE), template: has(list, TEMPLATE_WRITE_SCOPE), templates: has(list, EMAIL_TEMPLATES_SCOPE) },
  });
}

// ---------------- email templates (read) ----------------

async function templatesRoute(ctx: Ctx, h: MoreToolsHelpers, locationId: string): Promise<Response> {
  if (ctx.demo) return json({ ok: true, demo: true, templates: [{ id: "demo1", name: "Welcome email", type: "builder", updatedAt: new Date().toISOString() }], folders: 1, plainText: 0, truncated: false, stale: 0 });
  const list = await grantedList(ctx);
  if (!has(list, EMAIL_TEMPLATES_SCOPE)) return json({ ok: false, needsPermission: true, message: permissionText("read your email templates") }, 403);
  const t = await h.locationToken(locationId).catch(() => null);
  if (!t) return unreachable();
  const r = await listEmailTemplates({ locationId, token: t });
  if (!r.ok) return r.reason === "needs_permission" ? json({ ok: false, needsPermission: true, message: permissionText("read your email templates") }, 403) : json({ ok: false, message: "SubSync could not read your email templates just now. Try again in a minute." }, 502);
  // A template nobody has edited for a year is worth a look. Counted here so the screen needs no date maths.
  const cutoff = Date.now() - 365 * 86_400_000;
  const stale = r.value.templates.filter((x) => x.updatedAt && Date.parse(x.updatedAt) < cutoff).length;
  return json({ ok: true, ...r.value, stale });
}

// ---------------- installer check (read) ----------------

async function installerRoute(ctx: Ctx, h: MoreToolsHelpers): Promise<Response> {
  if (ctx.kind !== "agency" || !isAdminSide(ctx)) return json({ error: "This is for company owners and administrators" }, 403);
  if (ctx.demo) return json({ ok: true, demo: true, planId: "demo-plan", isWhitelabel: false, installedAt: null, fields: ["planId"] });
  const list = await grantedList(ctx);
  if (!has(list, INSTALLER_SCOPE)) return json({ ok: false, needsPermission: true, message: permissionText("read the install record") }, 403);
  const appId = process.env.GHL_APP_ID;
  if (!appId) return json({ ok: false, message: "Not available from the platform yet: the app id is not set on the server." }, 503);
  const token = await h.companyToken().catch(() => null);
  if (!token) return unreachable();
  const r = await readInstaller({ appId, token });
  if (!r.ok) return r.reason === "needs_permission" ? json({ ok: false, needsPermission: true, message: permissionText("read the install record") }, 403) : json({ ok: false, message: "Not available from the platform yet: the install record could not be read just now." }, 502);
  // Compare with what SubSync holds: the plan id the platform reports versus the one SubSync recorded for this install.
  const [row] = await sql()`select plan_id from installations where id = ${ctx.installationId}`.catch(() => []);
  const ours = typeof row?.plan_id === "string" ? (row.plan_id as string) : null;
  const matches = r.value.planId && ours ? r.value.planId === ours : null;
  return json({ ok: true, planId: r.value.planId, recordedPlanId: ours, matches, isWhitelabel: r.value.isWhitelabel, installedAt: r.value.installedAt, fields: r.value.fields });
}

// ---------------- repeating follow-up ----------------

async function ownContact(ctx: Ctx, locationId: string, contactId: unknown) {
  if (typeof contactId !== "string" || !ID.test(contactId)) return null;
  const [c] = await sql()`select contact_id, full_name, email, phone from cached_contacts where installation_id = ${ctx.installationId} and location_id = ${locationId} and contact_id = ${contactId} limit 1`;
  return c ? { id: c.contact_id as string, name: (c.full_name as string | null) ?? "", email: (c.email as string | null) ?? null, phone: (c.phone as string | null) ?? null } : null;
}

async function repeatRoute(ctx: Ctx, h: MoreToolsHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const contact = await ownContact(ctx, locationId, b.contactId);
  if (!contact) return json({ error: "That contact is not available" }, 404);
  const c = checkFollowUp(b.followUp);
  if (!c.ok) return json({ ok: false, blocked: true, message: c.text }, 422);
  const [md, list] = await Promise.all([mode(ctx, locationId), grantedList(ctx)]);
  const perm = has(list, RECURRING_WRITE_SCOPE);
  const words = { done: "Saved. Your CRM will now create this task on its own schedule.", already: "That follow-up already exists.", permission: permissionText("create repeating tasks") };
  const preview = {
    title: "Add a repeating follow-up",
    lines: [`Task: "${c.value.title}"`, `For: ${contact.name || "this contact"}`, `Repeats ${followUpWords(c.value)}. Each task is due ${c.value.dueAfterHours} ${c.value.dueAfterHours === 1 ? "hour" : "hours"} after it appears.`, "It ends by itself after the last repeat. Nothing is sent to the contact."],
    canConfirm: true, typeToConfirm: null as string | null,
  };
  if (!doing(b)) return json({ ok: true, preview, mode: md, needsPermission: !perm });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !perm) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const token = () => h.locationToken(locationId);
  const base = { installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token };
  const r = await createFollowUp({ ...base, contactId: contact.id, followUp: c.value }, ctx.demo ? { env: {} } : {});
  if (r.outcome !== "done") return answer(r, words);
  // Read it back, so "Saved" means the platform really has it. A read that cannot be done says so; the follow-up was still saved.
  let check: { confirmed: boolean | null; note: string } = { confirmed: null, note: "SubSync could not read it back just now, but the platform accepted it." };
  if (r.id && has(list, RECURRING_READ_SCOPE)) {
    const t = await token().catch(() => null);
    const back = t ? await readFollowUp({ locationId, token: t, id: r.id }) : null;
    if (back?.ok) check = back.value.found ? { confirmed: true, note: "Checked: it is in your CRM." } : { confirmed: false, note: "The platform accepted it but did not show it when SubSync looked. Check your CRM." };
  } else if (r.id) check = { confirmed: null, note: "Needs permission: reconnect SubSync to read it back. The platform accepted it." };
  return json({ ok: true, done: true, message: `${words.done} ${check.note}`, readBack: check.confirmed });
}

// ---------------- rename a pipeline stage ----------------

/** The pipelines and stages SubSync already holds for the account (its own copy: no call to the CRM). */
async function pipelinesRoute(ctx: Ctx, locationId: string): Promise<Response> {
  const rows = await sql()`select pipeline_id, name, stages from pipelines where installation_id = ${ctx.installationId} and location_id = ${locationId} order by name limit 50`.catch(() => []);
  const pipelines = rows.map((r) => ({
    id: r.pipeline_id as string, name: (r.name as string | null) ?? "Pipeline",
    stages: (Array.isArray(r.stages) ? (r.stages as Array<{ id?: unknown; name?: unknown }>) : []).filter((s) => typeof s.id === "string" && typeof s.name === "string").map((s) => ({ id: s.id as string, name: s.name as string })),
  }));
  return json({ ok: true, canEdit: isAdminSide(ctx), pipelines });
}

async function stageRoute(ctx: Ctx, h: MoreToolsHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const pipelineId = typeof b.pipelineId === "string" && ID.test(b.pipelineId) ? b.pipelineId : null;
  const stageId = typeof b.stageId === "string" && ID.test(b.stageId) ? b.stageId : null;
  if (!pipelineId || !stageId) return json({ error: "Choose the stage" }, 400);
  // The pipeline must be one SubSync holds for THIS account.
  const [mine] = await sql()`select 1 ok from pipelines where installation_id = ${ctx.installationId} and location_id = ${locationId} and pipeline_id = ${pipelineId} limit 1`.catch(() => []);
  if (!mine) return json({ error: "That pipeline is not available" }, 404);
  const n = checkStageName(b.newName);
  if (!n.ok) return json({ ok: false, blocked: true, message: n.text }, 422);
  const [md, list] = await Promise.all([mode(ctx, locationId), grantedList(ctx)]);
  const readOk = has(list, PIPELINE_READ_SCOPE), writeOk = has(list, PIPELINE_WRITE_SCOPE);
  const words = { done: "Renamed. The new name shows in your CRM, and in SubSync after the next sync. No deal moved.", already: "That stage already has this name. Nothing was changed.", permission: permissionText("edit pipelines") };
  if (ctx.demo) return doing(b) ? answer({ outcome: "dry_run", line: "", reason: "account" }, words) : json({ ok: true, preview: { title: "Rename this stage", lines: [`New name: "${n.name}"`, "No deal moves and no other stage changes."], canConfirm: true, typeToConfirm: null }, mode: md, needsPermission: false });
  if (!readOk) return json({ ok: false, needsPermission: true, message: permissionText("read your pipelines") }, 403);
  const token = () => h.locationToken(locationId);
  const t = await token().catch(() => null);
  if (!t) return unreachable();
  const live = await readPipeline({ pipelineId, token: t });
  if (!live.ok) return live.reason === "needs_permission" ? json({ ok: false, needsPermission: true, message: permissionText("read your pipelines") }, 403) : json({ ok: false, message: "SubSync could not read this pipeline just now. Try again in a minute." }, 502);
  if (!live.value) return json({ ok: false, message: "That pipeline is not in your CRM any more." }, 404);
  const plan = planStageRename(live.value, stageId, n.name);
  if (plan.kind === "blocked") return json({ ok: false, blocked: true, message: plan.text }, 422);
  if (plan.kind === "same") return json({ ok: true, unchanged: true, message: words.already });
  if (!doing(b)) return json({ ok: true, preview: { title: "Rename this stage", lines: [`Pipeline: "${live.value.name}"`, `Stage: "${plan.from}" becomes "${n.name}"`, "Stage order stays the same. No deal moves and no other stage changes."], canConfirm: true, typeToConfirm: null as string | null }, mode: md, needsPermission: !writeOk });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !writeOk) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const r = await renameStage({
    installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token, pipelineId, stageId, newName: n.name, current: live.value,
    recheck: async () => { const x = await readPipeline({ pipelineId, token: await token() }); return x.ok ? x.value : undefined; },
  }, {});
  return answer(r, words);
}

// ---------------- estimate, invoice, template drafts ----------------

const DRAFT_SCOPE: Record<DraftKind, string> = { estimate: ESTIMATE_WRITE_SCOPE, invoice: INVOICE_WRITE_SCOPE, template: TEMPLATE_WRITE_SCOPE };
const DRAFT_WORDS: Record<DraftKind, { what: string; done: string; title: string }> = {
  estimate: { what: "an estimate", done: "Saved as an estimate in your CRM. It was not sent to anyone.", title: "Save an estimate (not sent)" },
  invoice: { what: "an invoice", done: "Saved as an invoice in your CRM. It was not sent to anyone.", title: "Save an invoice (not sent)" },
  template: { what: "an invoice template", done: "Saved as an invoice template in your CRM.", title: "Save an invoice template" },
};

async function draftRoute(ctx: Ctx, h: MoreToolsHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const kind = b.kind === "estimate" || b.kind === "invoice" || b.kind === "template" ? b.kind : null;
  if (!kind) return json({ error: "Choose what to save" }, 400);
  const d = checkDraft(b.draft);
  if (!d.ok) return json({ ok: false, blocked: true, message: d.text }, 422);
  const contact = kind === "template" ? null : await ownContact(ctx, locationId, b.contactId);
  if (kind !== "template") {
    if (!contact) return json({ error: "That contact is not available" }, 404);
    const ok = contactForDraft({ id: contact.id, name: contact.name, email: contact.email, phone: contact.phone });
    if (!ok.ok) return json({ ok: false, blocked: true, message: ok.text }, 422);
  }
  const [md, list, loc] = await Promise.all([mode(ctx, locationId), grantedList(ctx), sql()`select name from locations where installation_id = ${ctx.installationId} and location_id = ${locationId} limit 1`.catch(() => [])]);
  const perm = has(list, DRAFT_SCOPE[kind]);
  const businessName = typeof loc[0]?.name === "string" && loc[0].name ? (loc[0].name as string) : "Your business";
  const w = DRAFT_WORDS[kind];
  const words = { done: w.done, already: "That was just saved. Nothing was added twice.", permission: permissionText(`save ${w.what}`) };
  const total = draftTotal(d.value);
  const preview = {
    title: w.title,
    lines: [
      `Name: "${d.value.name}"`, ...(contact ? [`For: ${contact.name}`] : []),
      `Line: ${d.value.itemName}, ${d.value.qty} x ${d.value.amount} ${d.value.currency} = ${total} ${d.value.currency}`,
      kind === "template" ? "Other quotes and invoices can start from it." : "It is only saved. SubSync does not send it: you review and send it from your CRM.",
    ],
    canConfirm: true, typeToConfirm: null as string | null,
  };
  if (!doing(b)) return json({ ok: true, preview, mode: md, needsPermission: !perm });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !perm) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const okContact = contact ? contactForDraft({ id: contact.id, name: contact.name, email: contact.email, phone: contact.phone }) : null;
  const r = await createDraft({
    installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token: () => h.locationToken(locationId),
    kind, draft: d.value, businessName, contact: okContact && okContact.ok ? okContact.value : null,
  }, ctx.demo ? { env: {} } : {});
  return answer(r, words);
}
