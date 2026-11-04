// The matching rules and the "which value wins" rules of the Clean-up module (stage CLEANUP). Pure: no database, no network.
//
// A person chooses how strict SubSync is when it looks for duplicates: three plain presets (Strict, Balanced, Loose) or their own mix of fields. The choice is saved
// per client account, with a default for the whole company; it only changes what SubSync SHOWS, never a contact. Balanced is exactly how SubSync matched before this
// stage existed, so nothing changes for anyone until they choose something else.

export type EmailMode = "off" | "exact" | "similar";
export type PhoneMode = "off" | "exact" | "similar" | "typo";
export type NameMode = "off" | "exact" | "similar";
export type PresetId = "strict" | "balanced" | "loose" | "custom";

export type MatchRules = {
  preset: PresetId;
  /** exact: the same text as typed. similar: also capitals, spaces, gmail dots and +tags. */
  email: EmailMode;
  /** exact: the same number as typed. similar: the same last 10 digits whatever the format. typo: also two neighbouring digits swapped. */
  phone: PhoneMode;
  /** exact: the same two words. similar: also nicknames, initials, a small typo, first and last swapped. */
  name: NameMode;
  /** A name match with nothing else may form a group on its own (Loose). Common names are never grouped this way. */
  nameAlone: boolean;
  /** Do not call a shared household phone or a shared company mailbox "almost certainly the same person". */
  guards: boolean;
  /** A pair must score at least this (0 to 100) to be linked. */
  threshold: number;
};

export const PRESETS: Record<Exclude<PresetId, "custom">, MatchRules> = {
  strict: { preset: "strict", email: "exact", phone: "exact", name: "exact", nameAlone: false, guards: true, threshold: 85 },
  balanced: { preset: "balanced", email: "similar", phone: "similar", name: "exact", nameAlone: false, guards: true, threshold: 50 },
  loose: { preset: "loose", email: "similar", phone: "typo", name: "similar", nameAlone: true, guards: true, threshold: 30 },
};

export const DEFAULT_RULES: MatchRules = PRESETS.balanced;

export const PRESET_WORDS: Record<Exclude<PresetId, "custom">, { label: string; line: string }> = {
  strict: { label: "Strict", line: "Only the same email or the same phone number, written exactly alike. Fewest groups, almost no false alarms." },
  balanced: { label: "Balanced", line: "The same email or phone number even when written differently (capitals, spaces, brackets). The usual choice." },
  loose: { label: "Loose", line: "Also similar names (Bob and Robert), numbers with two digits swapped, and names on their own. Most groups, some will be wrong." },
};

export const FIELD_WORDS = {
  email: { off: "Ignore email", exact: "Same text", similar: "Same address, any capitals, dots or +tags" },
  phone: { off: "Ignore phone", exact: "Same text", similar: "Same last 10 digits", typo: "Same digits, or two swapped" },
  name: { off: "Ignore name", exact: "Same two words", similar: "Nicknames, initials, small typos" },
} as const;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d);

/** Reads whatever was saved or sent and returns a complete, safe set of rules. Anything missing or unknown falls back to Balanced. */
export function parseRules(raw: unknown): MatchRules {
  if (!raw || typeof raw !== "object") return DEFAULT_RULES;
  const r = raw as Record<string, unknown>;
  const preset = oneOf(r.preset, ["strict", "balanced", "loose", "custom"] as const, "balanced");
  if (preset !== "custom") return PRESETS[preset];
  const t = Number(r.threshold);
  return {
    preset: "custom",
    email: oneOf(r.email, ["off", "exact", "similar"] as const, "similar"),
    phone: oneOf(r.phone, ["off", "exact", "similar", "typo"] as const, "similar"),
    name: oneOf(r.name, ["off", "exact", "similar"] as const, "exact"),
    nameAlone: r.nameAlone === true,
    guards: r.guards !== false,
    threshold: Number.isFinite(t) ? Math.min(90, Math.max(25, Math.round(t))) : 50,
  };
}

/** A custom set that happens to equal a preset is shown as that preset. */
export function presetOf(rules: MatchRules): PresetId {
  for (const id of ["strict", "balanced", "loose"] as const) {
    const p = PRESETS[id];
    if (p.email === rules.email && p.phone === rules.phone && p.name === rules.name && p.nameAlone === rules.nameAlone && p.guards === rules.guards && p.threshold === rules.threshold) return id;
  }
  return "custom";
}

/** The rules in one plain sentence, for the screen and the history. */
export function describeRules(rules: MatchRules): string {
  const bits: string[] = [];
  if (rules.email !== "off") bits.push(rules.email === "exact" ? "the same email, as typed" : "the same email");
  if (rules.phone !== "off") bits.push(rules.phone === "exact" ? "the same phone number, as typed" : rules.phone === "similar" ? "the same phone number in any format" : "the same phone number, even with two digits swapped");
  if (rules.name !== "off") bits.push(rules.name === "exact" ? "the same name (as extra proof)" : "a similar name");
  if (rules.nameAlone && rules.name !== "off") bits.push("a name on its own");
  return `Matches on ${bits.length ? bits.join(", ") : "nothing"}. A pair needs a score of ${rules.threshold} or more.`;
}

/** What each choice does to the number of groups, in words: used under the controls. */
export function strictnessWord(rules: MatchRules): "fewest" | "usual" | "most" {
  return rules.threshold >= 80 ? "fewest" : rules.threshold <= 35 ? "most" : "usual";
}

// ---------- which value wins ----------

export type Winner = "kept" | "recent" | "complete" | "oldest";
export type FieldKey = "name" | "email" | "phone" | "owner" | "source";
export type Survivorship = Record<FieldKey, Winner>;

export const DEFAULT_SURVIVORSHIP: Survivorship = { name: "complete", email: "kept", phone: "kept", owner: "kept", source: "oldest" };

export const WINNER_WORDS: Record<Winner, string> = {
  kept: "The record you keep, unless it is empty",
  recent: "The record used most recently",
  complete: "The longest, fullest value",
  oldest: "The oldest record",
};

export function parseSurvivorship(raw: unknown): Survivorship {
  const out = { ...DEFAULT_SURVIVORSHIP };
  if (raw && typeof raw === "object") for (const k of Object.keys(out) as FieldKey[]) out[k] = oneOf((raw as Record<string, unknown>)[k], ["kept", "recent", "complete", "oldest"] as const, out[k]);
  return out;
}

export type SurvivorPerson = {
  contactId: string; name: string; email: string | null; phone: string | null; ownerId?: string | null; ownerName?: string | null; source: string | null;
  createdAt: string | null; lastActivityAt: string | null;
};

export type FieldPick = { field: FieldKey; label: string; value: string; from: string; reason: string; conflict: boolean; values: string[] };

const LABEL: Record<FieldKey, string> = { name: "Name", email: "Email", phone: "Phone", owner: "Belongs to", source: "Came from" };
const valueOf = (p: SurvivorPerson, f: FieldKey): string => {
  const v = f === "owner" ? (p.ownerName ?? p.ownerId ?? "") : f === "name" ? (p.name === "Unnamed contact" ? "" : p.name) : (p[f] ?? "");
  return v.trim();
};
const time = (s: string | null) => (s ? Date.parse(s) : 0);

/**
 * For each field, the value that should survive the merge under the chosen rules, whose record it comes from and why, in words. `keepId` is the record that is kept.
 * A field where the records agree, or only one has a value, is not a conflict. Pure, so the screen and the written summary say the same thing.
 */
export function pickFields(people: readonly SurvivorPerson[], keepId: string, rules: Survivorship): FieldPick[] {
  const keep = people.find((p) => p.contactId === keepId);
  if (!keep) return [];
  const out: FieldPick[] = [];
  for (const field of Object.keys(LABEL) as FieldKey[]) {
    const have = people.map((p) => ({ p, v: valueOf(p, field) })).filter((x) => x.v);
    if (have.length === 0) continue;
    const distinct = [...new Set(have.map((x) => x.v.toLowerCase().replace(/[^a-z0-9@+]/g, "")))];
    const mine = valueOf(keep, field);
    let win = have.find((x) => x.p.contactId === keepId) ?? have[0];
    let reason = mine ? "from the record you keep" : "the record you keep has none";
    if (distinct.length > 1) {
      const rule = rules[field];
      const sorted = [...have];
      if (rule === "recent") { sorted.sort((a, b) => time(b.p.lastActivityAt) - time(a.p.lastActivityAt) || time(b.p.createdAt) - time(a.p.createdAt)); if (time(sorted[0].p.lastActivityAt) > 0 || time(sorted[0].p.createdAt) > 0) { win = sorted[0]; reason = "from the most recently used record"; } }
      else if (rule === "complete") { sorted.sort((a, b) => b.v.length - a.v.length); win = sorted[0]; reason = win.p.contactId === keepId ? "the fullest value, and it is on the record you keep" : "the fullest value"; }
      else if (rule === "oldest") { sorted.sort((a, b) => (time(a.p.createdAt) || Infinity) - (time(b.p.createdAt) || Infinity)); win = sorted[0]; reason = "from the oldest record"; }
    }
    out.push({ field, label: LABEL[field], value: win.v, from: win.p.contactId, reason, conflict: distinct.length > 1, values: have.map((x) => x.v) });
  }
  return out;
}
