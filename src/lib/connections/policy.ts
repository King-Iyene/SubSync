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
};

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
  };
}

/** Two layers combined: a flag stays on only if both allow it, a list keeps only what both allow, a number takes the smaller. */
export function stricter(a: PolicyFlags, b: PolicyFlags): PolicyFlags {
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
  };
}

/** The rule that applies to one client account: the company default and the account's own policy, most restrictive wins. */
export const effectivePolicy = (agency: unknown, account: unknown): PolicyFlags => stricter(readFlags(agency), readFlags(account));

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
export function clipChoices(matrix: Matrix, policy: PolicyFlags, masterSwitch: boolean): { items: Matrix; clips: Clip[]; writesAllowed: boolean } {
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
    }
    items[item] = got;
    if (got !== wanted) clips.push({ item, wanted, got, because });
  }
  return { items, clips, writesAllowed };
}
