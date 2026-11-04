// Data cleanup planning: work out exactly what would change, before anything is changed. Pure (no
// database or network imports) so it can be unit tested. Nothing here writes anything.
//
// Rules:
//   phone  - write a phone number in one standard form (+<digits>)
//   name   - fix first and last names typed in ALL CAPS or all lower case
//   tag    - add or remove one tag on the contacts that match a filter

export type RuleId = "phone" | "name" | "tag" | "email";

export type ContactLite = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  lastActivityAt: number | null;
  dateAdded: number | null;
  source: string | null;
};

export type TagParams = {
  action: "add" | "remove";
  name: string;
  where: { missing?: "email" | "phone" | "either"; idleDays?: number; hasTag?: string; source?: string };
};

import { emailFix } from "./email-fix.ts";

export type Params = { rules: RuleId[]; defaultCountryCode: string | null; tag: TagParams | null };

export type Change = {
  contactId: string;
  rule: RuleId;
  field: "phone" | "firstName" | "lastName" | "tags" | "email";
  before: string | null;
  after: string | null;
  /** For tag changes, the tag being added or removed. */
  tag?: string;
};

export const MAX_CHANGES = 5_000;

// ---------- formatting ----------

// One standard form for a phone number: "+" and digits. A number with a country code is only tidied.
// A bare local number (no "+") gets the default country code only when one is given, because guessing
// the country would damage real numbers. Anything that cannot be sure is left alone (null).
export function formatPhone(raw: string | null, defaultCountryCode: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  let result: string;
  if (text.startsWith("+")) result = "+" + digits;
  else if (text.startsWith("00") && digits.length > 9) result = "+" + digits.slice(2);
  else if (defaultCountryCode) {
    const cc = defaultCountryCode.replace(/[^0-9]/g, "");
    if (!cc) return null;
    if (digits.startsWith(cc) && digits.length >= cc.length + 7) result = "+" + digits; // already carries its country code
    else result = "+" + cc + digits.replace(/^0+/, "");
  } else return null;
  return result === raw ? null : result;
}

const SMALL = new Set(["van", "von", "der", "den", "du", "de", "da", "di", "del", "la", "le", "bin", "al", "el"]);

// Only a name that is entirely upper case or entirely lower case is touched. Mixed case ("McDonald",
// "DeShawn") was typed on purpose and stays as it is.
export function formatName(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!/[A-Za-z]/.test(text)) return null;
  const upper = text === text.toUpperCase();
  const lower = text === text.toLowerCase();
  if (!upper && !lower) return text === raw ? null : text;
  const fixed = text.toLowerCase().split(" ").map((word, i) => {
    if (i > 0 && SMALL.has(word)) return word;
    return word.replace(/(^|[-'’])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  }).join(" ");
  return fixed === raw ? null : fixed;
}

// ---------- tag filter ----------

export function matchesTagFilter(c: ContactLite, where: TagParams["where"], now: number): boolean {
  if (where.missing === "email" && c.email) return false;
  if (where.missing === "phone" && c.phone) return false;
  if (where.missing === "either" && c.email && c.phone) return false;
  if (where.idleDays !== undefined) {
    const last = c.lastActivityAt ?? c.dateAdded;
    if (last === null || last > now - where.idleDays * 86_400_000) return false;
  }
  if (where.hasTag && !c.tags.some((t) => t.toLowerCase() === where.hasTag!.toLowerCase())) return false;
  if (where.source && (c.source ?? "").toLowerCase() !== where.source.toLowerCase()) return false;
  return true;
}

// ---------- the plan ----------

export function planChanges(contacts: ContactLite[], params: Params, now = Date.now()): { changes: Change[]; truncated: boolean } {
  const changes: Change[] = [];
  const push = (c: Change) => { if (changes.length < MAX_CHANGES) changes.push(c); };
  for (const c of contacts) {
    if (params.rules.includes("phone")) {
      const after = formatPhone(c.phone, params.defaultCountryCode);
      if (after) push({ contactId: c.id, rule: "phone", field: "phone", before: c.phone, after });
    }
    if (params.rules.includes("email")) {
      const after = emailFix(c.email);
      if (after && after !== c.email) push({ contactId: c.id, rule: "email", field: "email", before: c.email, after });
    }
    if (params.rules.includes("name")) {
      const first = formatName(c.firstName);
      if (first && first !== c.firstName) push({ contactId: c.id, rule: "name", field: "firstName", before: c.firstName, after: first });
      const last = formatName(c.lastName);
      if (last && last !== c.lastName) push({ contactId: c.id, rule: "name", field: "lastName", before: c.lastName, after: last });
    }
    if (params.rules.includes("tag") && params.tag) {
      const has = c.tags.some((t) => t.toLowerCase() === params.tag!.name.toLowerCase());
      const wanted = params.tag.action === "add" ? !has : has;
      if (wanted && matchesTagFilter(c, params.tag.where, now)) {
        push({ contactId: c.id, rule: "tag", field: "tags", before: params.tag.action === "add" ? "without" : "with", after: params.tag.action === "add" ? "with" : "without", tag: params.tag.name });
      }
    }
  }
  return { changes, truncated: changes.length >= MAX_CHANGES };
}

export function summarise(changes: Change[]): { phone: number; email: number; name: number; tagAdd: number; tagRemove: number; contacts: number } {
  return {
    email: changes.filter((c) => c.rule === "email").length,
    phone: changes.filter((c) => c.rule === "phone").length,
    name: changes.filter((c) => c.rule === "name").length,
    tagAdd: changes.filter((c) => c.rule === "tag" && c.after === "with").length,
    tagRemove: changes.filter((c) => c.rule === "tag" && c.after === "without").length,
    contacts: new Set(changes.map((c) => c.contactId)).size,
  };
}

// ---------- validating what the user sent ----------

const TAG_NAME = /^[^\n\r,;<>]{1,60}$/;

export function parseParams(input: unknown): { ok: true; params: Params } | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rules = Array.isArray(o.rules) ? [...new Set(o.rules.filter((r): r is RuleId => r === "phone" || r === "name" || r === "tag" || r === "email"))] : [];
  if (rules.length === 0) return { ok: false, error: "Choose at least one clean-up" };
  let cc: string | null = null;
  if (o.defaultCountryCode !== undefined && o.defaultCountryCode !== null && o.defaultCountryCode !== "") {
    const digits = String(o.defaultCountryCode).replace(/[^0-9]/g, "");
    if (digits.length < 1 || digits.length > 4) return { ok: false, error: "A country code looks like +1 or +234" };
    cc = digits;
  }
  let tag: TagParams | null = null;
  if (rules.includes("tag")) {
    const t = (o.tag && typeof o.tag === "object" ? o.tag : {}) as Record<string, unknown>;
    if (t.action !== "add" && t.action !== "remove") return { ok: false, error: "Choose whether to add or remove the tag" };
    if (typeof t.name !== "string" || !TAG_NAME.test(t.name.trim())) return { ok: false, error: "Enter a tag name (up to 60 characters, no commas)" };
    const w = (t.where && typeof t.where === "object" ? t.where : {}) as Record<string, unknown>;
    const where: TagParams["where"] = {};
    if (w.missing === "email" || w.missing === "phone" || w.missing === "either") where.missing = w.missing;
    if (w.idleDays !== undefined && w.idleDays !== "" && w.idleDays !== null) {
      const n = Number(w.idleDays);
      if (!Number.isInteger(n) || n < 1 || n > 3650) return { ok: false, error: "Days idle must be a whole number from 1 to 3650" };
      where.idleDays = n;
    }
    if (typeof w.hasTag === "string" && w.hasTag.trim()) where.hasTag = w.hasTag.trim().slice(0, 60);
    if (typeof w.source === "string" && w.source.trim()) where.source = w.source.trim().slice(0, 60);
    if (Object.keys(where).length === 0) return { ok: false, error: "Choose who gets the tag: for example contacts with no email, or idle for 90 days. A tag is never applied to everyone at once" };
    tag = { action: t.action, name: t.name.trim(), where };
  }
  return { ok: true, params: { rules, defaultCountryCode: cc, tag } };
}
