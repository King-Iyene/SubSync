// Account policy: limits, not choices (INTEGRATIONS_SPEC section 6). The company owner sets a default, a client account's administrator can only
// make it stricter, and a person's own choice is clipped by both. The effective rule is always the MOST RESTRICTIVE of the three. Pure.

export const DESTINATIONS = ["note", "comment", "field"] as const;
export type Destination = (typeof DESTINATIONS)[number];
export const PROVIDERS_FOR_POLICY = ["fathom", "zoom", "google_meet"] as const;

export type PolicyFlags = {
  allowCrmWrites: boolean;
  allowTranscripts: boolean;
  destinations: Destination[];
  /** How many days a meeting nobody could be matched to waits in the person's private inbox. */
  inboxRetentionDays: number;
  providers: string[];
  /** Email domains that belong to the company itself (never matched as a contact). A domain listed by either layer stays excluded. */
  internalDomains: string[];
  dailyCapPerUser: number;
  dailyCapPerAccount: number;
  /** Settings the admin fixed: a person sees the value and "Set by your admin". */
  locked: string[];
  /** What a person who never chose gets, and what a locked setting is fixed to (stage E2b). Null means "not set here". */
  defaults: SetupDefaults;
};

/** The account's (or the company's) default choices for people. A locked setting is fixed to its value here. */
export type SetupDefaults = { preset: Exclude<Preset, "custom"> | null; unmatchedMode: "inbox" | "discard" | null; sourcePriority: string[] | null };
export const NO_DEFAULTS: SetupDefaults = { preset: null, unmatchedMode: null, sourcePriority: null };

/**
 * The settings an admin can lock. "preset": the person uses the account's default layout and cannot change it. "destinations": the person cannot edit
 * the table by hand (no Custom), only pick a ready-made layout. "unmatchedMode" and "sourcePriority": fixed to the default value.
 */
export const LOCKABLE = ["preset", "destinations", "unmatchedMode", "sourcePriority"] as const;
export type Lockable = (typeof LOCKABLE)[number];
export const SOURCE_ORDER = ["fathom", "zoom", "google_meet"] as const;

export const MAX_RETENTION_DAYS = 30;

/** The spec's defaults. Contact fields are not allowed until the admin has set the field mapping (E2b). */
export const DEFAULT_POLICY: PolicyFlags = {
  allowCrmWrites: true,
  allowTranscripts: false,
  destinations: ["note", "comment"],
  inboxRetentionDays: 14,
  providers: [...PROVIDERS_FOR_POLICY],
  internalDomains: [],
  dailyCapPerUser: 50,
  dailyCapPerAccount: 200,
  locked: [],
  defaults: NO_DEFAULTS,
};

const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : null);
const strs = (v: unknown, allowed: readonly string[]): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && allowed.includes(x)) : null);

/** A stored policy, with anything missing or wrong replaced by the default. Never trusts the shape of stored JSON. */
export function readFlags(raw: unknown): PolicyFlags {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    allowCrmWrites: typeof o.allowCrmWrites === "boolean" ? o.allowCrmWrites : DEFAULT_POLICY.allowCrmWrites,
    allowTranscripts: typeof o.allowTranscripts === "boolean" ? o.allowTranscripts : DEFAULT_POLICY.allowTranscripts,
    destinations: (strs(o.destinations, DESTINATIONS) as Destination[] | null) ?? [...DEFAULT_POLICY.destinations],
    inboxRetentionDays: int(o.inboxRetentionDays, 1, MAX_RETENTION_DAYS) ?? DEFAULT_POLICY.inboxRetentionDays,
    providers: strs(o.providers, PROVIDERS_FOR_POLICY) ?? [...DEFAULT_POLICY.providers],
    internalDomains: Array.isArray(o.internalDomains) ? [...new Set(o.internalDomains.filter((d): d is string => typeof d === "string" && /^[a-z0-9.-]{3,100}$/i.test(d.trim())).map((d) => d.trim().toLowerCase()))].slice(0, 50) : [],
    dailyCapPerUser: int(o.dailyCapPerUser, 0, 1000) ?? DEFAULT_POLICY.dailyCapPerUser,
    dailyCapPerAccount: int(o.dailyCapPerAccount, 0, 5000) ?? DEFAULT_POLICY.dailyCapPerAccount,
    locked: strs(o.locked, ["destinations", "allowTranscripts", "preset", "unmatchedMode", "sourcePriority"]) ?? [],
    defaults: readDefaults(o.defaults),
  };
}

const PRESET_CHOICES = ["recommended", "full_record", "summary_only"] as const;

/** Stored defaults, with anything missing or wrong turned into "not set". */
export function readDefaults(raw: unknown): SetupDefaults {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const order = Array.isArray(o.sourcePriority) ? [...new Set(o.sourcePriority.filter((x): x is string => typeof x === "string" && (SOURCE_ORDER as readonly string[]).includes(x)))] : null;
  return {
    preset: (PRESET_CHOICES as readonly unknown[]).includes(o.preset) ? (o.preset as SetupDefaults["preset"]) : null,
    unmatchedMode: o.unmatchedMode === "inbox" || o.unmatchedMode === "discard" ? o.unmatchedMode : null,
    sourcePriority: order && order.length ? order : null,
  };
}

/**
 * Two layers combined: a flag stays on only if both allow it, a list keeps only what both allow, a number takes the smaller. `a` is the company's
 * layer and `b` the account's. A default the company LOCKED is the company's; otherwise the account's own default wins and the company's fills a gap.
 */
export function stricter(a: PolicyFlags, b: PolicyFlags): PolicyFlags {
  const pick = <K extends keyof SetupDefaults>(key: K, lock: Lockable): SetupDefaults[K] => (a.locked.includes(lock) ? a.defaults[key] : b.defaults[key] ?? a.defaults[key]);
  return {
    allowCrmWrites: a.allowCrmWrites && b.allowCrmWrites,
    allowTranscripts: a.allowTranscripts && b.allowTranscripts,
    destinations: a.destinations.filter((d) => b.destinations.includes(d)),
    inboxRetentionDays: Math.min(a.inboxRetentionDays, b.inboxRetentionDays),
    providers: a.providers.filter((p) => b.providers.includes(p)),
    internalDomains: [...new Set([...a.internalDomains, ...b.internalDomains])],
    dailyCapPerUser: Math.min(a.dailyCapPerUser, b.dailyCapPerUser),
    dailyCapPerAccount: Math.min(a.dailyCapPerAccount, b.dailyCapPerAccount),
    locked: [...new Set([...a.locked, ...b.locked])],
    defaults: { preset: pick("preset", "preset"), unmatchedMode: pick("unmatchedMode", "unmatchedMode"), sourcePriority: pick("sourcePriority", "sourcePriority") },
  };
}

/**
 * The company layer when the company has set NO rule: it limits nothing, so an account's own administrator can decide for the account (this is also how a
 * business that installed the app for itself, which has no company owner above it, can ever allow a contact field or a transcript). The account's own
 * defaults stay the careful ones in the spec. Once a company rule is saved it is a ceiling, and an account can only make it stricter.
 */
const NO_COMPANY_RULE: PolicyFlags = {
  allowCrmWrites: true, allowTranscripts: true, destinations: [...DESTINATIONS], inboxRetentionDays: MAX_RETENTION_DAYS, providers: [...PROVIDERS_FOR_POLICY],
  internalDomains: [], dailyCapPerUser: 1000, dailyCapPerAccount: 5000, locked: [], defaults: NO_DEFAULTS,
};

/** The rule that applies to one client account: the company default and the account's own policy, most restrictive wins. */
export const effectivePolicy = (agency: unknown, account: unknown): PolicyFlags => stricter(agency === null || agency === undefined ? NO_COMPANY_RULE : readFlags(agency), readFlags(account));

// ---------------- what a person chose, and how it is clipped ----------------

export const ITEMS = ["summary", "action_items", "recording_link", "attendees_and_date", "transcript"] as const;
export type Item = (typeof ITEMS)[number];
export type ItemDestination = Destination | "subsync_only" | "off";
export type Matrix = Record<Item, ItemDestination>;
export type Preset = "recommended" | "full_record" | "summary_only" | "custom";

/** Spec 5.2 A: the presets. The transcript is never saved by default. */
export const PRESETS: Record<Exclude<Preset, "custom">, Matrix> = {
  recommended: { summary: "note", action_items: "note", recording_link: "note", attendees_and_date: "note", transcript: "off" },
  full_record: { summary: "note", action_items: "note", recording_link: "note", attendees_and_date: "note", transcript: "comment" },
  summary_only: { summary: "note", action_items: "off", recording_link: "off", attendees_and_date: "note", transcript: "off" },
};

const DEST_VALUES: ItemDestination[] = [...DESTINATIONS, "subsync_only", "off"];

export function matrixFor(preset: Preset, custom: unknown): Matrix {
  if (preset !== "custom") return { ...PRESETS[preset] };
  const o = (custom && typeof custom === "object" ? custom : {}) as Record<string, unknown>;
  const out = { ...PRESETS.recommended };
  for (const item of ITEMS) if (typeof o[item] === "string" && DEST_VALUES.includes(o[item] as ItemDestination)) out[item] = o[item] as ItemDestination;
  return out;
}

export type Clip = { item: Item; wanted: ItemDestination; got: ItemDestination; because: string };

/**
 * A person's choices, clipped by the effective policy. Nothing is written to the CRM at all when the policy or the person's master switch says
 * no. A destination the policy does not allow becomes "SubSync only". The transcript is written to the CRM only when the person turned it on AND
 * the policy allows transcripts. Every clip is returned with its reason, so the write log can say when a choice was overruled and why.
 */
export function clipChoices(
  matrix: Matrix, policy: PolicyFlags, masterSwitch: boolean,
  /** Stage E2b: the items an admin mapped to an enabled contact field, and whether the permission to add conversation comments is held. Left out, nothing extra is checked. */
  extra?: { fieldItems?: readonly Item[]; canComment?: boolean },
): { items: Matrix; clips: Clip[]; writesAllowed: boolean } {
  const clips: Clip[] = [];
  const writesAllowed = policy.allowCrmWrites && masterSwitch;
  const items = { ...matrix };
  for (const item of ITEMS) {
    const wanted = matrix[item];
    let got = wanted;
    let because = "";
    if (wanted === "note" || wanted === "comment" || wanted === "field") {
      if (!writesAllowed) { got = "subsync_only"; because = policy.allowCrmWrites ? "you switched writing to the CRM off" : "writing to the CRM is switched off by your admin"; }
      else if (!policy.destinations.includes(wanted)) { got = "subsync_only"; because = `${wanted === "note" ? "notes" : wanted === "comment" ? "conversation comments" : "contact fields"} are not allowed by your admin`; }
      else if (item === "transcript" && !policy.allowTranscripts) { got = "subsync_only"; because = "transcripts in the CRM are not allowed by your admin"; }
      else if (wanted === "field" && item === "transcript") { got = "subsync_only"; because = "a transcript is too long for a contact field"; }
      else if (wanted === "field" && extra?.fieldItems && !extra.fieldItems.includes(item)) { got = "subsync_only"; because = "your admin has not set up a contact field for this"; }
      else if (wanted === "comment" && extra?.canComment === false) { got = "subsync_only"; because = "Needs permission: reconnect (adding comments to the conversation)"; }
    }
    items[item] = got;
    if (got !== wanted) clips.push({ item, wanted, got, because });
  }
  return { items, clips, writesAllowed };
}

// ---------------- the person's choices under the account's setup (stage E2b) ----------------

export type PersonChoices = {
  preset: Preset;
  /** Did the person ever pick a layout? A person who never did gets the account's default. */
  presetChosen: boolean;
  /** The table of a Custom layout. */
  custom: unknown;
  /** The person's own text layout. Used only with the Custom layout. */
  template: string | null;
  unmatchedMode: "inbox" | "discard";
  sourcePriority: string[];
};

export const DEFAULT_CHOICES: PersonChoices = { preset: "recommended", presetChosen: false, custom: null, template: null, unmatchedMode: "inbox", sourcePriority: [...SOURCE_ORDER] };

export type LockInfo = Record<Lockable, boolean>;

/**
 * What a person's choices really are inside one account's rules (company default above account setup, both already merged in `policy`).
 * A locked setting is the admin's value and the person's own is ignored; a person who never chose a layout gets the default layout. The text layout
 * counts only for the Custom layout.
 */
export function effectiveChoices(mine: PersonChoices, policy: PolicyFlags): { choices: PersonChoices; locked: LockInfo } {
  const locked: LockInfo = { preset: policy.locked.includes("preset"), destinations: policy.locked.includes("destinations"), unmatchedMode: policy.locked.includes("unmatchedMode"), sourcePriority: policy.locked.includes("sourcePriority") };
  const fallback: Preset = policy.defaults.preset ?? "recommended";
  let preset: Preset = mine.presetChosen ? mine.preset : fallback;
  if (locked.preset) preset = fallback;
  else if (locked.destinations && preset === "custom") preset = fallback;
  return {
    choices: {
      preset, presetChosen: mine.presetChosen || locked.preset, custom: preset === "custom" ? mine.custom : null, template: preset === "custom" ? mine.template : null,
      unmatchedMode: locked.unmatchedMode ? policy.defaults.unmatchedMode ?? "inbox" : mine.unmatchedMode,
      sourcePriority: locked.sourcePriority ? policy.defaults.sourcePriority ?? [...SOURCE_ORDER] : mine.sourcePriority,
    },
    locked,
  };
}

/**
 * What to ask the meeting tool to put in each delivery (data minimisation, spec section 8): only what the person chose to keep. Summary and action items
 * count while they go anywhere, SubSync only included. The transcript is asked for only when it is going into the CRM, never to keep it in SubSync.
 */
export function wantedContent(items: Matrix): { summary: boolean; actionItems: boolean; transcript: boolean } {
  return { summary: items.summary !== "off", actionItems: items.action_items !== "off", transcript: items.transcript === "note" || items.transcript === "comment" };
}

/**
 * What to ask the meeting tool for when a person connects: the union over every account they can reach of what their choices would save there (after
 * that account's rules). Nothing the person could never save anywhere is asked for, and the transcript only when some account would take it.
 */
export function wantedAcrossAccounts(mine: PersonChoices, masterSwitch: boolean, policies: readonly PolicyFlags[]): { summary: boolean; actionItems: boolean; transcript: boolean } {
  const out = { summary: false, actionItems: false, transcript: false };
  for (const policy of policies.length ? policies : [DEFAULT_POLICY]) {
    const eff = effectiveChoices(mine, policy).choices;
    const w = wantedContent(clipChoices(matrixFor(eff.preset, eff.custom), policy, masterSwitch).items);
    out.summary ||= w.summary;
    out.actionItems ||= w.actionItems;
    out.transcript ||= w.transcript;
  }
  return out;
}
