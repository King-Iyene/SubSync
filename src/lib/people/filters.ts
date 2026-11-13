// Smart lists (stage F10, N20): the choices a person makes to narrow the people they can see, kept as small JSON. Pure (no database), so the rules
// are unit tested. The database side is src/lib/analytics/people-list-queries.ts. A list never holds a contact, only the choices.

export const MAX_TAGS = 5;
export const MAX_LISTS_PER_PERSON = 20;
export const PAGE_SIZE = 50;

export type SmartFilter = {
  /** Words in the name, email or phone number. */
  q?: string;
  /** Contacts that carry these tags (all of them when tagMode is "all", any of them otherwise). */
  tags?: string[];
  tagMode?: "any" | "all";
  /** Contacts that do NOT carry this tag. */
  notTag?: string;
  /** The day SubSync first saw a tag on the contact, between these two dates (YYYY-MM-DD). Only for tags seen since SubSync started watching. */
  seenFrom?: string;
  seenTo?: string;
  /** A team member's id from the CRM, or "none" for nobody. */
  owner?: string;
  /** A source as written in the CRM, or "none" for no source. */
  source?: string;
  /** No activity for at least this many days (a contact with no recorded activity counts from the day it was added). */
  quietDays?: number;
  /** Nobody has logged a call to this person in SubSync: "never", or not within this many days. */
  lastCall?: "never" | "7" | "30";
  /** "Added in range": people whose record was created between these two days (YYYY-MM-DD, Lagos days, both included), optionally from/to a time of day (HH:MM, Lagos time). Set from the date bar; absent means "Live, as of right now". */
  addedFrom?: string;
  addedTo?: string;
  addedFromTime?: string;
  addedToTime?: string;
  /** The name of a stage a deal is in. */
  stage?: string;
  /** One client account (ignored for a business or a client's staff, who only have their own). */
  location?: string;
  deal?: "open" | "none" | "won";
  hasPhone?: boolean;
  /** Working leads only, cold lists only, or both (the default). */
  cold?: "working" | "cold";
  /** Leave out people who asked not to be contacted. */
  hideDnd?: boolean;
};

const LOCATION_ID = /^[A-Za-z0-9_-]{3,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const USER_ID = /^[A-Za-z0-9_-]{3,64}$/;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function day(v: unknown): string | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v)) return "bad";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "bad" : v;
}

// Accepts a query string or saved JSON (anything), and returns clean choices or a plain-words error.
export function parseSmartFilter(input: unknown): { ok: true; filter: SmartFilter } | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const f: SmartFilter = {};
  const q = text(o.q, 100);
  if (q) f.q = q;
  const rawTags = Array.isArray(o.tags) ? o.tags : typeof o.tags === "string" && o.tags ? o.tags.split(",") : [];
  const tags = [...new Set(rawTags.map((t) => text(t, 60)).filter((t): t is string => t !== null))];
  if (tags.length > MAX_TAGS) return { ok: false, error: `Choose up to ${MAX_TAGS} tags` };
  if (tags.length) f.tags = tags;
  if (o.tagMode !== undefined && o.tagMode !== "" && o.tagMode !== null) {
    if (o.tagMode !== "any" && o.tagMode !== "all") return { ok: false, error: "Tag match must be any or all" };
    f.tagMode = o.tagMode;
  }
  const notTag = text(o.notTag, 60);
  if (notTag) f.notTag = notTag;
  const from = day(o.seenFrom);
  const to = day(o.seenTo);
  if (from === "bad" || to === "bad") return { ok: false, error: "Dates must look like 2026-10-31" };
  if (from) f.seenFrom = from;
  if (to) f.seenTo = to;
  if (from && to && from > to) return { ok: false, error: "The first date must not be after the second" };
  const af = day(o.addedFrom), at = day(o.addedTo);
  if (af === "bad" || at === "bad") return { ok: false, error: "Dates must look like 2026-10-31" };
  if ((af === null) !== (at === null)) return { ok: false, error: "Choose both the first and the last day" };
  if (af && at) {
    if (af > at) return { ok: false, error: "The first date must not be after the second" };
    f.addedFrom = af; f.addedTo = at;
    const tm = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
    const t1 = tm(o.addedFromTime), t2 = tm(o.addedToTime);
    if (t1 && t2) { f.addedFromTime = t1; f.addedToTime = t2; if (af === at && t1 > t2) return { ok: false, error: "The end time is before the start time" }; }
  }
  if ((from || to) && !f.tags) return { ok: false, error: "Choose a tag to filter by the day it was tagged" };
  if (o.owner !== undefined && o.owner !== "" && o.owner !== null) {
    if (typeof o.owner !== "string" || (o.owner !== "none" && !USER_ID.test(o.owner))) return { ok: false, error: "Unknown owner" };
    f.owner = o.owner;
  }
  const source = text(o.source, 80);
  if (source) f.source = source;
  if (o.quietDays !== undefined && o.quietDays !== "" && o.quietDays !== null) {
    const n = Number(o.quietDays);
    if (!Number.isInteger(n) || n < 0 || n > 3650) return { ok: false, error: "Days must be a whole number from 0 to 3650" };
    f.quietDays = n;
  }
  if (o.lastCall !== undefined && o.lastCall !== "" && o.lastCall !== null) {
    const v = String(o.lastCall);
    if (v !== "never" && v !== "7" && v !== "30") return { ok: false, error: "Last call must be never, 7 or 30" };
    f.lastCall = v;
  }
  const stage = text(o.stage, 80);
  if (stage) f.stage = stage;
  if (o.location !== undefined && o.location !== "" && o.location !== null) {
    if (typeof o.location !== "string" || !LOCATION_ID.test(o.location)) return { ok: false, error: "Invalid account" };
    f.location = o.location;
  }
  if (o.deal !== undefined && o.deal !== "" && o.deal !== null) {
    if (o.deal !== "open" && o.deal !== "none" && o.deal !== "won") return { ok: false, error: "Deal must be open, none or won" };
    f.deal = o.deal;
  }
  if (o.hasPhone === true || o.hasPhone === "1" || o.hasPhone === "true") f.hasPhone = true;
  if (o.hideDnd === true || o.hideDnd === "1" || o.hideDnd === "true") f.hideDnd = true;
  if (o.cold !== undefined && o.cold !== "" && o.cold !== null) {
    if (o.cold !== "working" && o.cold !== "cold") return { ok: false, error: "Cold must be working or cold" };
    f.cold = o.cold;
  }
  return { ok: true, filter: f };
}

/** The choices as a query string for the address and for the API (only the ones that are set). */
export function filterToParams(f: SmartFilter): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === false) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v));
  }
  return p;
}

export const isEmptyFilter = (f: SmartFilter) => Object.keys(f).length === 0;

/** The choices in plain words, for a list's name line and the "what is this list" sentence. `names` turns an owner id or account id into a name. */
export function describeFilter(f: SmartFilter, names: { owner?: (id: string) => string; account?: (id: string) => string } = {}): string {
  const parts: string[] = [];
  if (f.q) parts.push(`matches "${f.q}"`);
  if (f.tags?.length) parts.push(`${f.tagMode === "all" ? "has all of the tags" : f.tags.length > 1 ? "has any of the tags" : "has the tag"} ${f.tags.join(", ")}`);
  if (f.notTag) parts.push(`does not have the tag ${f.notTag}`);
  if (f.seenFrom || f.seenTo) parts.push(`tag first seen ${f.seenFrom ? `from ${f.seenFrom} ` : ""}${f.seenTo ? `to ${f.seenTo}` : ""}`.trim());
  if (f.addedFrom && f.addedTo) parts.push(`was added ${f.addedFrom === f.addedTo && !f.addedFromTime ? `on ${f.addedFrom}` : `from ${f.addedFrom}${f.addedFromTime ? ` ${f.addedFromTime}` : ""} to ${f.addedTo}${f.addedToTime ? ` ${f.addedToTime}` : ""}`}, Lagos time`);
  if (f.owner) parts.push(f.owner === "none" ? "has no owner" : `owner ${names.owner ? names.owner(f.owner) : f.owner}`);
  if (f.source) parts.push(f.source === "none" ? "has no source" : `source ${f.source}`);
  if (f.quietDays !== undefined) parts.push(`no activity for ${f.quietDays}+ days`);
  if (f.lastCall) parts.push(f.lastCall === "never" ? "never called from SubSync" : `not called from SubSync in ${f.lastCall} days`);
  if (f.stage) parts.push(`has a deal in ${f.stage}`);
  if (f.location) parts.push(`in ${names.account ? names.account(f.location) : "one client account"}`);
  if (f.deal) parts.push(f.deal === "open" ? "has an open deal" : f.deal === "won" ? "is a customer" : "has no deal");
  if (f.hasPhone) parts.push("has a phone number");
  if (f.cold) parts.push(f.cold === "cold" ? "is on a cold list" : "is a working lead");
  if (f.hideDnd) parts.push("is not marked do not disturb");
  return parts.length ? `People who ${parts.join(", ")}.` : "Everyone.";
}

// A list a person saved (or the team shares). The id and name are what the person sees; the choices are above.
export function listName(v: unknown): string | null {
  const s = text(v, 40);
  return s && s.length >= 1 ? s : null;
}

/** A client's own staff only ever see their own account: whatever account they chose is replaced by theirs (never trusted from the browser). */
export function scopeFilterTo(f: SmartFilter, limitTo: string | null): SmartFilter {
  return limitTo ? { ...f, location: limitTo } : f;
}
