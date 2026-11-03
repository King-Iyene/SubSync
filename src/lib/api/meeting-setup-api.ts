import { installationHasScope } from "../analytics/cleanup-queries";
import { sql } from "../db";
import { listContactFieldDefinitions, type DefinitionsResult } from "../ghl/custom-fields";
import { locationAccessToken } from "../sync/engine";
import { FIELD_DEFAULT_ON, FIELD_ITEMS, FIELD_LABEL, FIELD_WARNINGS, fieldTypeOf, planFieldWrites, requestedFields, typeProblem, type FieldItem, type FieldMapping } from "../connections/contact-fields";
import { composeDelivery, previewSections, type PreviewSection } from "../connections/delivery";
import { choicesOf, COMMENT_SCOPE } from "../connections/ingest";
import { pgIngestStore } from "../connections/ingest-store";
import { can, covers, personFromSession, statusScope, type Person } from "../connections/person";
import {
  clipChoices, DEFAULT_POLICY, effectiveChoices, effectivePolicy, ITEMS, matrixFor, readFlags, type Item, type Matrix, type Preset, type PolicyFlags,
} from "../connections/policy";
import { DEFAULT_TEMPLATE, checkTemplate, MAX_TEMPLATE_CHARS, SAMPLE_NOTE_INPUT, TEMPLATE_VARIABLES } from "../connections/note-template";
import { hasEnabledMapping, loadFieldMappings, saveFieldMappings, saveMyChoices, type MappingInput, type MyChoicesPatch } from "../connections/setup-store";
import { cleanPriority } from "../connections/source-priority";
import { itemsWithField, ITEM_LABEL, optionsFor, PRESET_WORDS, type Option } from "../connections/setup-view";
import { isLive } from "../live-flags";
import { json, type AuthContext } from "./auth";

// Meeting notes setup (stage E2b): what a person saves and where, and what an admin sets for the whole account. Who the caller is comes ONLY from the signed
// session (`personFromSession`); no user id, role, company or account is read from the request. A person changes only their own choices, and only what the
// admin left open (a locked setting answers "Set by your admin"). An admin changes the rules and the field mapping of their own account only; the company
// owner sets the company defaults (that part is saved through meeting-policy, stage E0).

type Ctx = AuthContext & { request: Request; url: URL };

const LOCATION = /^[A-Za-z0-9_-]{3,64}$/;
const FIELD_ID = /^[A-Za-z0-9_-]{6,64}$/;
const personOf = (ctx: Ctx): Person | null => personFromSession(ctx.session, ctx.kind, ctx.limitTo);
const NEED_SIGN_IN = () => json({ error: "Please sign in again" }, 401);
const NOT_FOUND = () => json({ error: "Not found" }, 404);
const LOCKED = "Set by your admin.";
const zoomOn = (ctx: Ctx) => ctx.entitlements.features.zoom_meet !== false;

// ---------------- what applies to this person ----------------

type Rules = { agency: unknown; accounts: Record<string, unknown> };

async function rulesOf(installationId: string): Promise<Rules> {
  const rows = await sql()`select scope, location_id, flags from meeting_policies where installation_id = ${installationId}`;
  const out: Rules = { agency: null, accounts: {} };
  for (const r of rows) {
    if (r.scope === "agency") out.agency = r.flags;
    else if (typeof r.location_id === "string") out.accounts[r.location_id] = r.flags;
  }
  return out;
}

type Applies = {
  /** The account whose rules are shown (the person's own account; none for company staff, who see the company's rules). */
  accountId: string | null;
  policy: PolicyFlags;
  mappings: FieldMapping[];
  canComment: boolean;
};

async function appliesTo(ctx: Ctx, person: Person, locationId: string | null = null): Promise<Applies> {
  const rules = await rulesOf(ctx.installationId);
  const accountId = person.homeLocationId ?? locationId;
  const [mappings, canComment] = await Promise.all([
    accountId ? loadFieldMappings(ctx.installationId, [accountId]).then((m) => m[accountId] ?? []) : Promise.resolve([] as FieldMapping[]),
    installationHasScope(ctx.installationId, COMMENT_SCOPE),
  ]);
  return { accountId, policy: effectivePolicy(rules.agency, accountId ? rules.accounts[accountId] : null), mappings, canComment };
}

async function accountList(ctx: Ctx, person: Person): Promise<Array<{ locationId: string; name: string }>> {
  const scope = statusScope(person, null);
  if (scope.kind === "none") return [];
  const rows = await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored order by name`;
  return rows.filter((r) => covers(scope, r.location_id as string)).map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" }));
}

const PRESET_IDS = ["recommended", "full_record", "summary_only", "custom"] as const;
const isPreset = (v: unknown): v is Preset => (PRESET_IDS as readonly unknown[]).includes(v);

/** What the person's own choices are inside the rules that apply, with the options each row may offer. */
function viewOf(settings: Awaited<ReturnType<ReturnType<typeof pgIngestStore>["settings"]>>, a: Applies) {
  const mine = choicesOf(settings);
  const eff = effectiveChoices(mine, a.policy);
  const matrix = matrixFor(eff.choices.preset, eff.choices.custom);
  const fieldItems = itemsWithField(a.mappings);
  const ctx = { policy: a.policy, fieldItems, canComment: a.canComment };
  const options = Object.fromEntries(ITEMS.map((i) => [i, optionsFor(i, ctx)])) as Record<Item, Option[]>;
  return { mine, eff, matrix, fieldItems, options };
}

/** The company's saved rule and whether one exists (with none saved, each account decides for itself). Only ever sent to the company's owner. */
async function companyBlock(installationId: string): Promise<{ company: PolicyFlags; companySaved: boolean }> {
  const { agency } = await rulesOf(installationId);
  return { company: readFlags(agency), companySaved: agency !== null };
}

/** The person's own choices inside the rules that apply to them, for the places that save one choice (the Meeting inbox's "calls nobody matches"). */
export async function myEffectiveChoices(ctx: Ctx, person: Person) {
  const [settings, a] = await Promise.all([pgIngestStore().settings(ctx.installationId, person.userId), appliesTo(ctx, person)]);
  return effectiveChoices(choicesOf(settings), a.policy);
}

export async function meetingSetupView(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const base = {
    presets: PRESET_WORDS, items: ITEMS.map((i) => ({ item: i, label: ITEM_LABEL[i] })), variables: TEMPLATE_VARIABLES, defaultTemplate: DEFAULT_TEMPLATE, maxTemplate: MAX_TEMPLATE_CHARS, moreTools: zoomOn(ctx), writeLive: isLive("WRITE_GHL_LIVE"),
  };
  if (ctx.demo) {
    const a: Applies = { accountId: null, policy: DEFAULT_POLICY, mappings: [], canComment: false };
    const v = viewOf({ masterSwitch: true, unmatchedMode: "inbox", preset: "recommended", custom: null, previewConfirmedAt: null }, a);
    return json({ ...base, demo: true, canWrite: true, canComment: false, mine: { preset: v.eff.choices.preset, custom: v.matrix, template: null, unmatchedMode: "inbox", sourcePriority: v.mine.sourcePriority }, locked: v.eff.locked, options: v.options, allowTranscripts: false, admin: { can: false, accounts: [], canSetCompany: false } });
  }
  const store = pgIngestStore();
  const [settings, a, canWrite, accounts] = await Promise.all([store.settings(ctx.installationId, person.userId), appliesTo(ctx, person), installationHasScope(ctx.installationId, "contacts.write"), accountList(ctx, person)]);
  const v = viewOf(settings, a);
  return json({
    ...base, demo: false, canWrite, canComment: a.canComment,
    mine: { preset: v.eff.choices.preset, chosen: v.mine.presetChosen, custom: matrixFor("custom", v.mine.custom), template: v.mine.template, unmatchedMode: v.eff.choices.unmatchedMode, sourcePriority: v.eff.choices.sourcePriority, masterSwitch: settings.masterSwitch },
    locked: v.eff.locked, options: v.options, allowTranscripts: a.policy.allowTranscripts,
    accountRules: a.accountId === null && ctx.kind === "agency" ? "Each client account can add its own rules. They apply when a note goes to that account." : null,
    admin: {
      can: can(person.role, "set_account_policy"), accounts, canSetCompany: can(person.role, "set_agency_policy") && ctx.kind === "agency", ownAccount: person.homeLocationId,
      // The company's own saved rule, for the owner's "company defaults" editor. Nobody else is sent it.
      ...(can(person.role, "set_agency_policy") && ctx.kind === "agency" ? await companyBlock(ctx.installationId) : { company: null, companySaved: false }),
    },
  });
}

// ---------------- a person saves their own choices ----------------

type MineBody = { preset?: unknown; custom?: unknown; template?: unknown; sourcePriority?: unknown; unmatchedMode?: unknown; masterSwitch?: unknown };

export async function meetingSetupSaveMine(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (ctx.demo) return json({ error: "Saving choices is not available in the demo." }, 400);
  const body = (await ctx.request.json().catch(() => null)) as MineBody | null;
  if (!body || typeof body !== "object") return json({ error: "Nothing to save" }, 400);
  const store = pgIngestStore();
  const [settings, a] = await Promise.all([store.settings(ctx.installationId, person.userId), appliesTo(ctx, person)]);
  const { eff } = viewOf(settings, a);
  const patch: MyChoicesPatch = {};

  if (body.preset !== undefined) {
    if (!isPreset(body.preset)) return json({ error: "Choose one of the layouts in the list." }, 400);
    // A locked layout stays the admin's. Asking for what it already is changes nothing and is allowed.
    if (eff.locked.preset && body.preset !== eff.choices.preset) return json({ error: LOCKED, locked: "preset" }, 409);
    if (eff.locked.destinations && body.preset === "custom") return json({ error: `${LOCKED} You can pick one of the ready-made layouts, not Custom.`, locked: "destinations" }, 409);
    patch.preset = body.preset;
  }
  if (body.custom !== undefined) {
    if (eff.locked.preset || eff.locked.destinations) return json({ error: LOCKED, locked: eff.locked.preset ? "preset" : "destinations" }, 409);
    const o = (body.custom && typeof body.custom === "object" ? body.custom : {}) as Record<string, unknown>;
    patch.custom = Object.fromEntries(ITEMS.map((i) => [i, matrixFor("custom", o)[i]]));
  }
  if (body.template !== undefined) {
    if (eff.locked.preset || eff.locked.destinations) return json({ error: LOCKED, locked: eff.locked.preset ? "preset" : "destinations" }, 409);
    const text = typeof body.template === "string" ? body.template : "";
    if (text.trim() === "") patch.template = null;
    else {
      const check = checkTemplate(text);
      if (!check.ok) return json({ error: check.problems.join(" "), problems: check.problems }, 400);
      patch.template = text;
    }
  }
  if (body.sourcePriority !== undefined) {
    if (eff.locked.sourcePriority) return json({ error: LOCKED, locked: "sourcePriority" }, 409);
    patch.sourcePriority = cleanPriority(body.sourcePriority);
  }
  if (body.unmatchedMode !== undefined) {
    if (body.unmatchedMode !== "inbox" && body.unmatchedMode !== "discard") return json({ error: "Choose what to do with a call nobody matches." }, 400);
    if (eff.locked.unmatchedMode && body.unmatchedMode !== eff.choices.unmatchedMode) return json({ error: LOCKED, locked: "unmatchedMode" }, 409);
    patch.unmatchedMode = body.unmatchedMode;
  }
  if (typeof body.masterSwitch === "boolean") patch.masterSwitch = body.masterSwitch;
  if (Object.keys(patch).length === 0) return json({ error: "Nothing to save" }, 400);
  await saveMyChoices(ctx.installationId, person, patch);
  return json({ ok: true });
}

// ---------------- the live preview ----------------

export type FieldPreviewRow = { item: FieldItem; label: string; status: "write" | "cut" | "skip"; text: string };

/**
 * What a sample call would become under these choices and these account rules. Pure given its inputs. A layout with an unknown word is refused with the
 * reason. Contact fields show the value that would be written, or the plain reason it would be left out or cut.
 */
export function setupPreview(a: { matrix: Matrix; template: string | null; policy: PolicyFlags; mappings: FieldMapping[]; canComment: boolean; masterSwitch?: boolean }): { ok: true; sections: PreviewSection[]; fields: FieldPreviewRow[]; remarks: string[]; clips: string[] } | { ok: false; problems: string[] } {
  if (a.template !== null) {
    const check = checkTemplate(a.template);
    if (!check.ok) return { ok: false, problems: check.problems };
  }
  const { items, clips } = clipChoices(a.matrix, a.policy, a.masterSwitch ?? true, { fieldItems: itemsWithField(a.mappings), canComment: a.canComment });
  const composed = composeDelivery({ input: { ...SAMPLE_NOTE_INPUT, transcript: SAMPLE_TRANSCRIPT, transcriptUrl: "https://fathom.video/calls/sample" }, items, template: a.template });
  const plan = planFieldWrites({ requested: requestedFields(items), mappings: a.mappings, previous: {}, source: { startedAt: SAMPLE_NOTE_INPUT.startedAt, summary: SAMPLE_NOTE_INPUT.summary, actionItems: SAMPLE_NOTE_INPUT.actionItems, recordingUrl: SAMPLE_NOTE_INPUT.recordingUrl, rep: SAMPLE_NOTE_INPUT.rep } });
  const fields: FieldPreviewRow[] = [
    ...plan.writes.map((w) => ({ item: w.item, label: FIELD_LABEL[w.item], status: (w.cut ? "cut" : "write") as FieldPreviewRow["status"], text: w.cut ? `${w.value} (cut: ${w.cut.kept} of ${w.cut.of} characters kept)` : w.value })),
    ...plan.skipped.map((s) => ({ item: s.item, label: FIELD_LABEL[s.item], status: "skip" as const, text: s.message })),
  ];
  return { ok: true, sections: previewSections(composed), fields, remarks: composed.remarks, clips: clips.map((c) => `${ITEM_LABEL[c.item]}: ${c.because}.`) };
}

const SAMPLE_TRANSCRIPT = "Alex Sample: Can you do the kitchen by the end of the month?\nYou: Yes, I can send a quote by Thursday.\nAlex Sample: Great, the budget is flexible.";

export async function meetingSetupPreview(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const body = (await ctx.request.json().catch(() => null)) as { preset?: unknown; custom?: unknown; template?: unknown; locationId?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "Nothing to preview" }, 400);
  const preset: Preset = isPreset(body.preset) ? body.preset : "recommended";
  const template = typeof body.template === "string" && body.template.trim() !== "" ? body.template : null;
  if (template !== null && template.length > MAX_TEMPLATE_CHARS * 2) return json({ ok: false, problems: ["The layout is too long."] });
  // A company person may preview under one of the accounts they can open. Anyone else previews under their own account.
  let location: string | null = null;
  if (typeof body.locationId === "string" && LOCATION.test(body.locationId) && !person.homeLocationId) {
    if (!(await accountList(ctx, person)).some((x) => x.locationId === body.locationId)) return NOT_FOUND();
    location = body.locationId;
  }
  const a = ctx.demo ? { accountId: null, policy: DEFAULT_POLICY, mappings: [] as FieldMapping[], canComment: false } : await appliesTo(ctx, person, location);
  const mine = { ...choicesOf({ masterSwitch: true, unmatchedMode: "inbox", preset, custom: body.custom, previewConfirmedAt: null, template, presetChosen: true }) };
  // The locks of the account still apply to what a person tries out: the preview shows what would really happen.
  const eff = effectiveChoices(mine, a.policy).choices;
  const result = setupPreview({ matrix: matrixFor(eff.preset, eff.custom), template: eff.template, policy: a.policy, mappings: a.mappings, canComment: a.canComment });
  return json(result);
}

// ---------------- an admin: the account's contact fields ----------------

async function adminTarget(ctx: Ctx, person: Person, locationId: string | null): Promise<{ ok: true; locationId: string } | { ok: false; res: Response }> {
  if (!can(person.role, "set_account_policy")) return { ok: false, res: json({ error: "This is for administrators", forbidden: true }, 403) };
  const loc = locationId && LOCATION.test(locationId) ? locationId : ctx.limitTo;
  if (!loc) return { ok: false, res: json({ error: "Say which client account" }, 400) };
  // An account's administrator can only reach their own account; the company's people reach the accounts their role covers.
  if (ctx.limitTo && loc !== ctx.limitTo) return { ok: false, res: NOT_FOUND() };
  if (!covers(statusScope(person, null), loc)) return { ok: false, res: NOT_FOUND() };
  const [known] = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${loc}`;
  if (!known) return { ok: false, res: NOT_FOUND() };
  return { ok: true, locationId: loc };
}

/** Reads an account's contact field definitions. The real one asks the CRM (a read); tests pass a fake, so nothing real is ever called from a test. */
export type DefinitionsReader = (a: { companyKey: string; locationId: string }) => Promise<DefinitionsResult>;
const liveReader: DefinitionsReader = ({ companyKey, locationId }) => listContactFieldDefinitions({ locationId, token: () => locationAccessToken(companyKey, locationId) });

const NEEDS_PERMISSION = "Needs permission: reconnect. SubSync cannot read your contact fields until you accept the permission to read them.";

export type DefinitionRow = { id: string; name: string; type: string; fits: FieldItem[] };

/** The account's own fields, each with the SubSync items it could hold. */
export function definitionRows(fields: Array<{ id: string; name: string; dataType: string }>): DefinitionRow[] {
  return fields.map((f) => {
    const t = fieldTypeOf(f.dataType);
    return { id: f.id, name: f.name, type: t === "date" ? "Date" : t === "text" ? "Text" : t === "large_text" ? "Long text" : "Other", fits: FIELD_ITEMS.filter((i) => typeProblem(i, t) === null) };
  });
}

export async function meetingSetupFieldsView(ctx: Ctx, readDefinitions: DefinitionsReader = liveReader): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (ctx.demo) return json({ demo: true, locationId: null, mappings: [], items: [], warnings: FIELD_WARNINGS, definitions: { ok: false, message: "Not available in the demo." } });
  const target = await adminTarget(ctx, person, ctx.url.searchParams.get("account"));
  if (!target.ok) return target.res;
  const mappings = (await loadFieldMappings(ctx.installationId, [target.locationId]))[target.locationId] ?? [];
  const granted = await installationHasScope(ctx.installationId, "locations/customFields.readonly");
  let definitions: { ok: true; fields: DefinitionRow[] } | { ok: false; message: string };
  if (!granted) definitions = { ok: false, message: NEEDS_PERMISSION };
  else {
    const read = await readDefinitions({ companyKey: person.companyKey, locationId: target.locationId });
    definitions = read.ok ? { ok: true, fields: definitionRows(read.fields) } : { ok: false, message: read.reason === "needs_permission" ? NEEDS_PERMISSION : "We could not read your contact fields just now. Try again in a moment." };
  }
  return json({
    demo: false, locationId: target.locationId, mappings,
    items: FIELD_ITEMS.map((i) => ({ item: i, label: FIELD_LABEL[i], defaultOn: FIELD_DEFAULT_ON[i] })), warnings: FIELD_WARNINGS, definitions,
  });
}

type FieldsBody = { locationId?: unknown; mappings?: unknown; acknowledged?: unknown };

/**
 * Saves an account's field mapping. Only an administrator of that account (or the company's owner or administrators). Each chosen field must really exist in
 * that account and be of a type that can hold the item; the type is read from the account, never taken from the request. Turning a field on needs the two
 * warnings to have been read.
 */
export async function meetingSetupFieldsSave(ctx: Ctx, readDefinitions: DefinitionsReader = liveReader): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (ctx.demo) return json({ error: "Saving is not available in the demo." }, 400);
  const body = (await ctx.request.json().catch(() => null)) as FieldsBody | null;
  if (!body || !Array.isArray(body.mappings)) return json({ error: "Nothing to save" }, 400);
  const target = await adminTarget(ctx, person, typeof body.locationId === "string" ? body.locationId : null);
  if (!target.ok) return target.res;

  const wanted: Array<{ item: FieldItem; customFieldId: string | null; enabled: boolean }> = [];
  for (const raw of body.mappings.slice(0, FIELD_ITEMS.length)) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!(FIELD_ITEMS as readonly unknown[]).includes(o.item)) return json({ error: "That is not something SubSync can fill in." }, 400);
    const id = o.customFieldId === null || o.customFieldId === "" ? null : typeof o.customFieldId === "string" && FIELD_ID.test(o.customFieldId) ? o.customFieldId : undefined;
    if (id === undefined) return json({ error: "Choose a field from the list." }, 400);
    wanted.push({ item: o.item as FieldItem, customFieldId: id, enabled: o.enabled !== false });
  }
  if (wanted.length === 0) return json({ error: "Nothing to save" }, 400);
  if (wanted.some((w) => w.customFieldId !== null && w.enabled) && body.acknowledged !== true) return json({ error: "Read the two warnings and tick the box first." }, 400);

  const rows: MappingInput[] = [];
  const chosen = wanted.filter((w) => w.customFieldId !== null);
  if (chosen.length > 0) {
    if (!(await installationHasScope(ctx.installationId, "locations/customFields.readonly"))) return json({ error: NEEDS_PERMISSION, code: "needs_permission" }, 403);
    const read = await readDefinitions({ companyKey: person.companyKey, locationId: target.locationId });
    if (!read.ok) return read.reason === "needs_permission" ? json({ error: NEEDS_PERMISSION, code: "needs_permission" }, 403) : json({ error: "We could not read your contact fields just now. Try again in a moment." }, 502);
    for (const w of chosen) {
      const def = read.fields.find((f) => f.id === w.customFieldId);
      if (!def) return json({ error: `${FIELD_LABEL[w.item]}: that field was not found in this account.` }, 400);
      const type = fieldTypeOf(def.dataType);
      const problem = typeProblem(w.item, type);
      if (problem) return json({ error: `${FIELD_LABEL[w.item]}: "${def.name}" cannot be used. ${problem}`, code: "type_mismatch" }, 400);
      rows.push({ item: w.item, customFieldId: def.id, fieldName: def.name, fieldType: type, enabled: w.enabled });
    }
  }
  for (const w of wanted) if (w.customFieldId === null) rows.push({ item: w.item, customFieldId: null, fieldName: "", fieldType: "text", enabled: false });
  await saveFieldMappings(ctx.installationId, target.locationId, rows, person.userId);

  // Contact fields stay allowed only while at least one field is mapped and on.
  if (!(await hasEnabledMapping(ctx.installationId, target.locationId))) await removeFieldDestination(ctx.installationId, target.locationId);
  return json({ ok: true, mappings: (await loadFieldMappings(ctx.installationId, [target.locationId]))[target.locationId] ?? [] });
}

/** An account with no field left mapped no longer allows the "Contact field" place. */
async function removeFieldDestination(installationId: string, locationId: string): Promise<void> {
  const [r] = await sql()`select flags from meeting_policies where installation_id = ${installationId} and scope = 'account' and location_id = ${locationId}`;
  if (!r) return;
  const flags = readFlags(r.flags);
  if (!flags.destinations.includes("field")) return;
  const next = { ...flags, destinations: flags.destinations.filter((d) => d !== "field") };
  const db = sql();
  await db`update meeting_policies set flags = ${db.json(next as never)}, set_at = now() where installation_id = ${installationId} and scope = 'account' and location_id = ${locationId}`;
}

// ---------------- an admin: the account's rules and defaults (read) ----------------

export async function meetingSetupAccountView(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (ctx.demo) return json({ demo: true });
  const target = await adminTarget(ctx, person, ctx.url.searchParams.get("account"));
  if (!target.ok) return target.res;
  const [rules, hasMap, names] = await Promise.all([
    rulesOf(ctx.installationId), hasEnabledMapping(ctx.installationId, target.locationId),
    sql()`select name from locations where installation_id = ${ctx.installationId} and location_id = ${target.locationId}`,
  ]);
  const own = readFlags(rules.accounts[target.locationId]);
  return json({
    demo: false, locationId: target.locationId, accountName: (names[0]?.name as string | null) ?? "This account",
    company: readFlags(rules.agency), set: own, effective: effectivePolicy(rules.agency, rules.accounts[target.locationId]), hasMapping: hasMap,
    // What the company owner locked cannot be changed here: the screen shows it as "Set by your admin".
    companyLocked: readFlags(rules.agency).locked,
  });
}

