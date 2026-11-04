// Data Health rules. Pure: no database, no network. One written definition per rule (docs/METRICS.md, "Data health").

export type DhContact = {
  contactId: string; locationId: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null;
  source: string | null; dnd: boolean; assignedTo: string | null; dateAdded: number | null; lastActivityAt: number | null;
  hasDeal: boolean; hasOpenDeal: boolean; hasConversation: boolean; hasUpcomingAppt: boolean; touchedBySubSync: boolean;
};
export type RuleId = "duplicate" | "missing_phone" | "missing_email" | "bad_phone" | "bad_email" | "junk" | "no_owner" | "no_source" | "stale" | "orphan";
export type Settings = { junkWords: string[]; staleDays: number; phoneRegion: string; spikeMin: number };
export const DEFAULTS: Settings = { junkWords: [], staleDays: 180, phoneRegion: "1", spikeMin: 10 };
export const MIN_CONTACTS = 50;

/** Label, plain meaning, weight (the weights add up to 100) and the share of flagged contacts at which the whole weight is lost. */
export const RULES: Array<{ id: RuleId; label: string; plain: string; weight: number; cap: number }> = [
  { id: "duplicate", label: "Duplicates", plain: "extra copies of the same person (same email or phone)", weight: 20, cap: 0.15 },
  { id: "junk", label: "Junk and test records", plain: "names or emails like test, asdf, xxx or example.com", weight: 15, cap: 0.05 },
  { id: "bad_phone", label: "Invalid phone numbers", plain: "a phone number that is too short, too long, repeated digits or has letters", weight: 10, cap: 0.2 },
  { id: "bad_email", label: "Invalid emails", plain: "an email that is malformed or has a common typo in the domain", weight: 10, cap: 0.1 },
  { id: "missing_phone", label: "No phone", plain: "no phone number on the contact", weight: 10, cap: 0.5 },
  { id: "missing_email", label: "No email", plain: "no email address on the contact", weight: 10, cap: 0.5 },
  { id: "stale", label: "No activity for a long time", plain: "no activity for the number of days you set", weight: 10, cap: 0.6 },
  { id: "no_owner", label: "No owner", plain: "nobody is assigned to the contact", weight: 5, cap: 0.6 },
  { id: "no_source", label: "No source", plain: "we cannot tell where the contact came from", weight: 5, cap: 0.5 },
  { id: "orphan", label: "No deal and no conversation", plain: "the contact has no deal and no conversation", weight: 5, cap: 0.6 },
];
export const RULE_IDS = RULES.map((r) => r.id);
export const ruleOf = (id: string) => RULES.find((r) => r.id === id);

const JUNK_NAME = /^(test\w*|asdf\w*|qwer\w*|zxcv\w*|xxx+|x+|abc\w*|aaa+|bbb+|fake|dummy|sample|demo|none|null|undefined|unknown|n\/?a|na|no ?name|lorem|ipsum|john doe|jane doe|test test|a+|\.+|-+|\?+|\d+)$/i;
const JUNK_EMAIL_DOMAIN = /@(example\.(com|org|net)|test\.com|mailinator\.com|fake\.com|none\.com|noemail\.com|asdf\.com|email\.com)$/i;
const JUNK_EMAIL_USER = /^(test\w*|asdf\w*|xxx+|fake|noreply|none|no ?email|a+|abc\w*)@/i;
const TYPO_DOMAINS = new Set(["gmial.com", "gmai.com", "gmal.com", "gmail.co", "gmail.con", "gnail.com", "yaho.com", "yahooo.com", "yahoo.con", "hotmial.com", "hotmai.com", "hotmail.con", "outlok.com", "icloud.con"]);

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
const clean = (s: string | null | undefined) => (s ?? "").trim();

export function phoneState(phone: string | null): "missing" | "ok" | "bad" {
  const raw = clean(phone);
  if (!raw) return "missing";
  if (/[a-z]/i.test(raw.replace(/\b(ext|x)\.?\s*\d+$/i, ""))) return "bad";
  const d = digits(raw);
  if (d.length === 0) return "missing";
  if (d.length < 7 || d.length > 15) return "bad";
  if (/^(\d)\1+$/.test(d) || d === "1234567890" || d === "12345678" || d === "1234567") return "bad";
  return "ok";
}
export function emailState(email: string | null): "missing" | "ok" | "bad" {
  const e = clean(email).toLowerCase();
  if (!e) return "missing";
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@.,;]{2,}$/.test(e) || e.includes("..") || e.startsWith(".")) return "bad";
  if (TYPO_DOMAINS.has(e.split("@")[1])) return "bad";
  return "ok";
}
export function isJunk(c: Pick<DhContact, "firstName" | "lastName" | "email" | "phone">, extraWords: string[] = []): boolean {
  const extra = new Set(extraWords.map((w) => w.trim().toLowerCase()).filter(Boolean));
  const names = [clean(c.firstName), clean(c.lastName), `${clean(c.firstName)} ${clean(c.lastName)}`.trim()].filter(Boolean);
  if (names.some((n) => JUNK_NAME.test(n) || extra.has(n.toLowerCase()))) return true;
  const e = clean(c.email).toLowerCase();
  if (e && (JUNK_EMAIL_DOMAIN.test(e) || JUNK_EMAIL_USER.test(e) || extra.has(e) || extra.has(e.split("@")[1] ?? "~"))) return true;
  const d = digits(c.phone);
  return d.length >= 7 && /^(\d)\1+$/.test(d);
}

/** Which rules one contact breaks. `dup` is true for the extra copies (every member of a group but the oldest). */
export function flagsOf(c: DhContact, dup: boolean, s: Settings, now: number): RuleId[] {
  const out: RuleId[] = [];
  if (dup) out.push("duplicate");
  const p = phoneState(c.phone), e = emailState(c.email);
  if (p === "missing") out.push("missing_phone"); else if (p === "bad") out.push("bad_phone");
  if (e === "missing") out.push("missing_email"); else if (e === "bad") out.push("bad_email");
  if (isJunk(c, s.junkWords)) out.push("junk");
  if (!clean(c.assignedTo)) out.push("no_owner");
  if (!clean(c.source)) out.push("no_source");
  if (!c.touchedBySubSync) {
    const last = c.lastActivityAt ?? c.dateAdded;
    if (last !== null && now - last > s.staleDays * 86_400_000) out.push("stale");
  }
  if (!c.hasDeal && !c.hasConversation) out.push("orphan");
  return out;
}

/** The contacts an automatic change must never touch. We cannot see payments or workflows from the platform yet, so the rule is conservative on what we can see. */
export function protectedReason(c: DhContact): string | null {
  if (c.dnd) return "Do not disturb";
  if (c.hasOpenDeal) return "Open deal";
  if (c.hasUpcomingAppt) return "Upcoming appointment";
  return null;
}

export function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (_, x: string) => "Mc" + x.toUpperCase());
}
/** A name is only touched when it is all lower case or all upper case. Mixed case is left alone, because a person typed it. */
export function fixName(name: string | null): string | null {
  const n = clean(name);
  if (!n || !/[a-zà-ÿ]/i.test(n)) return null;
  if (n !== n.toLowerCase() && n !== n.toUpperCase()) return null;
  if (n.length === 2 && n === n.toUpperCase()) return null; // initials such as "JD"
  const t = titleCase(n);
  return t === n ? null : t;
}
/** E.164 only when it is certain: 10 digits (or 11 starting with the region), or a number already written with +. Anything else is left alone. */
export function fixPhone(phone: string | null, region = "1"): string | null {
  const raw = clean(phone);
  if (!raw || phoneState(raw) !== "ok" || /\b(ext|x)\.?\s*\d+$/i.test(raw)) return null;
  const d = digits(raw);
  let out: string | null = null;
  if (raw.startsWith("+")) out = `+${d}`;
  else if (region === "1" && d.length === 10) out = `+1${d}`;
  else if (region === "1" && d.length === 11 && d.startsWith("1")) out = `+${d}`;
  else if (region !== "1" && d.startsWith(region) && d.length >= 8) out = `+${d}`;
  return out && out !== raw ? out : null;
}
