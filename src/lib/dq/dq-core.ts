// Clean-up v2 (stage DQ): the pure rules. No database, no network. Every definition is written once here and in docs/METRICS.md ("Data quality: duplicate tiers, quality score, lead intake").
//
// What lives here: how duplicate candidates are joined into groups and given a tier (certain, likely, possible) with a one-line reason, the quality score with its four parts, the plain words
// and typed phrases, the lead-intake maths (rates, the best and worst source, the low-rate, dead-source and heavy-duplicate rules) and the dialer-hours estimate (an estimate, with its formula).

export const DQ_VERSION = "dq-1";
export const DQ_DATE = "20 Dec 2026";

// ------------------------------------------------------------------------------------------------ duplicate tiers
export type Tier = "certain" | "likely" | "possible";
export const TIERS: readonly Tier[] = ["certain", "likely", "possible"];
export const TIER_RANK: Record<Tier, number> = { certain: 3, likely: 2, possible: 1 };
export const TIER_LABEL: Record<Tier, string> = { certain: "Certain", likely: "Likely", possible: "Possible" };
export const TIER_HINT: Record<Tier, string> = {
  certain: "Same phone number or same email. Almost always the same person.",
  likely: "Same name and a close phone or email.",
  possible: "A very similar name and nothing else in common. Check before you merge.",
};
export const isTier = (v: unknown): v is Tier => v === "certain" || v === "likely" || v === "possible";

export type EdgeKind = "email" | "phone" | "name_phone" | "name_email" | "name";
export const EDGE_TIER: Record<EdgeKind, Tier> = { email: "certain", phone: "certain", name_phone: "likely", name_email: "likely", name: "possible" };
export const EDGE_BADGE: Record<EdgeKind, string> = { email: "Same email", phone: "Same phone", name_phone: "Same name, close phone", name_email: "Same name, close email", name: "Similar name" };
export const EDGE_WHY: Record<EdgeKind, string> = {
  email: "Both records have the same email address (capital letters and spaces ignored).",
  phone: "Both records have the same last 10 phone digits, so a +1 in front or a space does not hide it.",
  name_phone: "The names are the same and the last 7 phone digits are the same.",
  name_email: "The names are the same and the part of the email before the @ is the same.",
  name: "The same words in a different order or spelling, and nothing else in common. Common names are left out.",
};
export const MAX_GROUP = 10; // the platform's own merge screen takes at most 10 records

export type RawGroup = { kind: EdgeKind; ids: string[] };
export type Component = { ids: string[]; tier: Tier; kinds: EdgeKind[]; badge: string; trimmed: boolean };

/** The words for what a group has in common. Both a phone and an email in common is said once. */
export function badgeOf(kinds: readonly EdgeKind[]): string {
  const k = new Set(kinds);
  if (k.has("email") && k.has("phone")) return "Same phone and email";
  for (const x of ["phone", "email", "name_phone", "name_email", "name"] as const) if (k.has(x)) return EDGE_BADGE[x];
  return EDGE_BADGE.name;
}

export const pairId = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Joins candidate groups (each from ONE blocking key) into people-groups: contacts that share any key end in one group (union-find, linear in the number of ids). The tier is the strongest
 * link inside the group. `rejected` holds pairs a person already said are not the same: a group whose every pair was rejected is dropped. A group over MAX_GROUP keeps its first
 * MAX_GROUP ids (the caller sorts oldest first) and says it was trimmed.
 */
export function components(groups: readonly RawGroup[], opts: { rejected?: ReadonlySet<string>; maxSize?: number } = {}): Component[] {
  const max = opts.maxSize ?? MAX_GROUP;
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const order: string[] = [];
  for (const g of groups) for (const id of g.ids) if (!parent.has(id)) { parent.set(id, id); order.push(id); }
  for (const g of groups) for (let i = 1; i < g.ids.length; i++) { const a = find(g.ids[0]), b = find(g.ids[i]); if (a !== b) parent.set(b, a); }
  const byRoot = new Map<string, { ids: string[]; kinds: Set<EdgeKind> }>();
  for (const id of order) { const r = find(id); const c = byRoot.get(r) ?? byRoot.set(r, { ids: [], kinds: new Set() }).get(r)!; c.ids.push(id); }
  for (const g of groups) if (g.ids.length) byRoot.get(find(g.ids[0]))!.kinds.add(g.kind);
  const out: Component[] = [];
  for (const c of byRoot.values()) {
    if (c.ids.length < 2) continue;
    const kinds = [...c.kinds];
    const trimmed = c.ids.length > max;
    const ids = trimmed ? c.ids.slice(0, max) : c.ids;
    if (opts.rejected && opts.rejected.size > 0) {
      let all = true;
      for (let i = 0; i < ids.length && all; i++) for (let j = i + 1; j < ids.length; j++) if (!opts.rejected.has(pairId(ids[i], ids[j]))) { all = false; break; }
      if (all) continue;
    }
    const tier = kinds.reduce<Tier>((t, k) => (TIER_RANK[EDGE_TIER[k]] > TIER_RANK[t] ? EDGE_TIER[k] : t), "possible");
    out.push({ ids, tier, kinds, badge: badgeOf(kinds), trimmed });
  }
  return out.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.ids.length - a.ids.length || a.ids[0].localeCompare(b.ids[0]));
}

// ---- SQL predicates for the blocking keys (constants only: nothing a person typed ever reaches SQL text)
export const NEVER_EMAIL = "^(noemail|none|na|n/a|unknown|noreply|no-reply|nobody|info|sales|contact|support|hello|admin|office|mail|email|test)@";
export const NEVER_PHONE = "^(.)\\1+$|^1234567890$|^0123456789$|^0000";
/** Letters only, the words sorted: "Smith, John" and "john smith" become the same key. */
export const NAME_TOKENS_SQL = "(select string_agg(w, ' ' order by w) from regexp_split_to_table(lower(regexp_replace(btrim(coalesce(c.full_name, '')), '[^a-zA-Z ]', ' ', 'g')), '\\s+') w where length(w) > 1)";
/** A key shared by more than this many records is a switchboard or a common name, not a duplicate. */
export const MAX_SHARED = 12;
export const MAX_SHARED_NAME = 5;

// ------------------------------------------------------------------------------------------------ words and typed phrases
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const mergePhrase = (name: string): string => `merge ${clean(name) || "these contacts"}`;
export const deletePhrase = (n: number, name?: string | null): string => (n === 1 && name ? `delete ${clean(name)}` : `delete ${n} ${n === 1 ? "contact" : "contacts"}`);
export const bulkMergePhrase = (n: number): string => `merge ${n} ${n === 1 ? "group" : "groups"}`;
export const DELETE_CAP = 25;
export const BULK_MERGE_CAP = 50;

export type PreviewIn = { keep: { tags: readonly string[] }; others: ReadonlyArray<{ tags: readonly string[]; openDeals: number; wonDeals: number; appointments?: number; hasConversation: boolean }> };
/** "Keeps 1 record. Moves 2 tags, 1 deal and 1 conversation." One short line. */
export function previewLine(p: PreviewIn): string {
  const have = new Set(p.keep.tags.map((t) => t.trim().toLowerCase()));
  const tags = new Set(p.others.flatMap((o) => o.tags).map((t) => t.trim().toLowerCase()).filter((t) => t && !have.has(t))).size;
  const deals = p.others.reduce((s, o) => s + o.openDeals + o.wonDeals, 0);
  const appts = p.others.reduce((s, o) => s + (o.appointments ?? 0), 0);
  const convs = p.others.filter((o) => o.hasConversation).length;
  const bits = [tags && `${tags} ${tags === 1 ? "tag" : "tags"}`, deals && `${deals} ${deals === 1 ? "deal" : "deals"}`, appts && `${appts} ${appts === 1 ? "appointment" : "appointments"}`, convs && `${convs} ${convs === 1 ? "conversation" : "conversations"}`].filter(Boolean) as string[];
  const join = bits.length <= 1 ? bits.join("") : `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
  return `Keeps 1 record.${join ? ` Moves ${join}.` : " Nothing else to move."}`;
}

// ------------------------------------------------------------------------------------------------ the dialer-hours estimate
export const DIAL_MIN_PER_BAD_NUMBER = 2; // two wasted dial attempts a month, a minute each
export const DIAL_MIN_PER_DUPLICATE = 2; // one extra call or text a month to a person already reached
export const FORMULA_HOURS = "Estimate: each bad number wastes 2 minutes a month (two dial attempts), each extra duplicate record 2 minutes a month (one repeat call). Minutes divided by 60. A guess, not a measurement.";
export function dialerHours(o: { badPhones: number; dupExtra: number }): number {
  return Math.round(((o.badPhones * DIAL_MIN_PER_BAD_NUMBER + o.dupExtra * DIAL_MIN_PER_DUPLICATE) / 60) * 10) / 10;
}
export function headlineOf(o: { groups: number; badPhones: number; dupExtra: number }): string {
  const parts: string[] = [];
  if (o.groups > 0) parts.push(`${n(o.groups)} duplicate ${o.groups === 1 ? "group" : "groups"}`);
  if (o.badPhones > 0) parts.push(`${n(o.badPhones)} bad ${o.badPhones === 1 ? "number" : "numbers"}`);
  if (parts.length === 0) return "No duplicates or bad numbers found.";
  const h = dialerHours(o);
  return `${parts.join(", ")}: fixing them saves ${h < 1 ? "under an hour of" : `about ${h}`} dialer ${h < 1 ? "time" : h === 1 ? "hour" : "hours"} a month.`;
}
const n = (v: number) => v.toLocaleString("en-US");

// ------------------------------------------------------------------------------------------------ the quality score
export type QualityIn = {
  contacts: number; dupExtra: number; junk: number; badPhone: number; badEmail: number; noPhone: number; noEmail: number; noOwner: number; noSource: number;
  /** Leads that came in during the last 30 days, and what became of them. */
  recent: { leads: number; dups: number; junk: number; noSource: number };
};
export type QualityPart = { id: "duplicates" | "completeness" | "validity" | "intake"; label: string; weight: number; share: number; fullAt: number; lost: number; line: string };
export type Quality = { score: number | null; word: string | null; parts: QualityPart[]; note: string | null; version: string };
export const MIN_CONTACTS = 50;
export const MIN_RECENT_LEADS = 20;
const WEIGHTS = { duplicates: 30, completeness: 25, validity: 25, intake: 20 } as const;
const FULL_AT = { duplicates: 0.1, completeness: 0.5, validity: 0.05, intake: 0.3 } as const;
export const qualityWord = (s: number): string => (s >= 85 ? "Healthy" : s >= 70 ? "Fair" : s >= 50 ? "Needs work" : "Poor");
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

/**
 * One score per account, 0 to 100, from four parts. Each part is a share of records with a problem and loses its weight in proportion to that share, in full at `fullAt`:
 * duplicates (extra records, full loss at 10%), completeness (a missing phone, email, owner or source, full at 50% of the four checked), validity (junk, bad phone, bad email, full at 5%),
 * intake hygiene (the last 30 days of leads that were duplicates, junk or had no source, full at 30%; left out until there are 20 recent leads, and the rest share the weight).
 */
export function qualityOf(i: QualityIn): Quality {
  if (i.contacts < MIN_CONTACTS) return { score: null, word: null, parts: [], note: `Not enough data yet: a score needs at least ${MIN_CONTACTS} contacts.`, version: DQ_VERSION };
  const c = i.contacts;
  const miss = (i.noPhone + i.noEmail + i.noOwner + i.noSource) / (4 * c);
  const hasIntake = i.recent.leads >= MIN_RECENT_LEADS;
  const defs: Array<Omit<QualityPart, "lost"> & { on: boolean }> = [
    { id: "duplicates", label: "Duplicates", weight: WEIGHTS.duplicates, share: Math.min(1, i.dupExtra / c), fullAt: FULL_AT.duplicates, line: `${n(i.dupExtra)} extra records`, on: true },
    { id: "completeness", label: "Completeness", weight: WEIGHTS.completeness, share: Math.min(1, miss), fullAt: FULL_AT.completeness, line: `${pct(miss)} of details missing`, on: true },
    { id: "validity", label: "Validity", weight: WEIGHTS.validity, share: Math.min(1, (i.junk + i.badPhone + i.badEmail) / c), fullAt: FULL_AT.validity, line: `${n(i.junk + i.badPhone + i.badEmail)} junk or unusable`, on: true },
    { id: "intake", label: "New leads", weight: WEIGHTS.intake, share: hasIntake ? Math.min(1, (i.recent.dups + i.recent.junk + i.recent.noSource) / i.recent.leads) : 0, fullAt: FULL_AT.intake,
      line: hasIntake ? `${n(i.recent.dups + i.recent.junk + i.recent.noSource)} of ${n(i.recent.leads)} new leads had a problem` : "Not enough new leads yet", on: hasIntake },
  ];
  const total = defs.filter((d) => d.on).reduce((s, d) => s + d.weight, 0);
  const parts: QualityPart[] = defs.filter((d) => d.on).map((d) => ({ id: d.id, label: d.label, weight: d.weight, share: d.share, fullAt: d.fullAt, line: d.line, lost: Math.round((100 * d.weight * Math.min(1, d.share / d.fullAt)) / total * 10) / 10 }));
  const score = Math.max(0, Math.min(100, Math.round(100 - parts.reduce((s, p) => s + p.lost, 0))));
  return { score, word: qualityWord(score), parts: parts.sort((a, b) => b.lost - a.lost), note: hasIntake ? null : "New leads are not scored yet: fewer than 20 in 30 days.", version: DQ_VERSION };
}
export function qualityWhy(q: Quality): string {
  if (q.score === null) return q.note ?? "Not enough data yet.";
  const top = q.parts.filter((p) => p.lost >= 1).slice(0, 2);
  return top.length === 0 ? "No real problems found." : `Mostly ${top.map((p) => `${p.label.toLowerCase()} (${p.line})`).join(" and ")}.`;
}

// ------------------------------------------------------------------------------------------------ lead intake
export const MIN_LEADS = 20; // fewer leads than this in the window and no rate is shown for a source
export type SrcCounts = { leads: number; dups: number; junk: number; answered: number; quality: number; booked: number; showed: number; won: number; wonValue: number; touchSecs: number; touched: number };
export const ZERO: SrcCounts = { leads: 0, dups: 0, junk: 0, answered: 0, quality: 0, booked: 0, showed: 0, won: 0, wonValue: 0, touchSecs: 0, touched: 0 };
export const add = (a: SrcCounts, b: SrcCounts): SrcCounts => ({ leads: a.leads + b.leads, dups: a.dups + b.dups, junk: a.junk + b.junk, answered: a.answered + b.answered, quality: a.quality + b.quality, booked: a.booked + b.booked, showed: a.showed + b.showed, won: a.won + b.won, wonValue: a.wonValue + b.wonValue, touchSecs: a.touchSecs + b.touchSecs, touched: a.touched + b.touched });
/** A rate, or null when the sample is too small to say anything. */
export const rate = (part: number, whole: number, min = MIN_LEADS): number | null => (whole >= min ? part / whole : null);
export const pctOf = (r: number | null): string => (r === null ? "not enough leads" : `${Math.round(r * 100)}%`);
/** Average minutes from a new lead to the first person's touch, among leads that got one. */
export const avgTouchMin = (c: SrcCounts): number | null => (c.touched >= 5 ? Math.round(c.touchSecs / c.touched / 60) : null);

export type SourceRow = { key: string; label: string } & SrcCounts;
export type Best = { best: SourceRow | null; worst: SourceRow | null; note: string | null };
export const MIN_SOURCE_LEADS = 10; // a source needs this many leads in the window before a percentage or a best/weakest verdict is shown
/** Clean leads: not a duplicate and not junk. duplicates + junk + clean = leads, always (junk never counts a duplicate twice). */
export const cleanOf = (c: Pick<SrcCounts, "leads" | "dups" | "junk">): number => Math.max(0, c.leads - c.dups - c.junk);
/** The share of leads that are good = the clean share, or null under MIN_SOURCE_LEADS. The same leads the "Clean leads" list opens. */
export const goodRate = (c: SrcCounts): number | null => rate(cleanOf(c), c.leads, MIN_SOURCE_LEADS);
/** The tally of a set of sources must add up: duplicates + junk + clean = leads. Returns the first problem in words, or null. */
export const tallyProblem = (rows: ReadonlyArray<Pick<SrcCounts, "leads" | "dups" | "junk">>): string | null => {
  for (const r of rows) if (r.dups < 0 || r.junk < 0 || r.dups + r.junk > r.leads) return `A source has ${r.dups} duplicates and ${r.junk} junk but only ${r.leads} leads.`;
  return null;
};
/** The best and the worst source: only sources with at least MIN_LEADS leads count, and at least two of them, or there is nothing to compare. */
export function bestWorst(rows: readonly SourceRow[]): Best {
  const ok = rows.filter((r) => r.leads >= MIN_SOURCE_LEADS);
  if (ok.length < 2) return { best: null, worst: null, note: `Not enough leads: a source needs ${MIN_SOURCE_LEADS} leads to be compared, and two sources are needed.` };
  const score = (r: SourceRow) => (goodRate(r) ?? 0) + (r.wonValue > 0 ? 0.0000001 * r.wonValue : 0);
  const sorted = [...ok].sort((a, b) => score(b) - score(a) || b.leads - a.leads);
  return { best: sorted[0], worst: sorted[sorted.length - 1], note: null };
}
const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
export function bestWorstLine(b: Best): string {
  if (!b.best || !b.worst) return b.note ?? "";
  const one = (r: SourceRow) => `${r.label} (${pctOf(goodRate(r))} good leads${r.wonValue > 0 ? `, ${money(r.wonValue)} won` : ""}${r.dups > 0 && rate(r.dups, r.leads, MIN_SOURCE_LEADS) !== null ? `, ${Math.round((r.dups / r.leads) * 100)}% duplicates` : ""})`;
  return `Best: ${one(b.best)}. Weakest: ${one(b.worst)}.`;
}

export type DayCount = { day: string; leads: number; dups: number; junk: number };
export type IntakeAlert = { kind: "low_rate" | "dead" | "dup_heavy" | "junk_heavy"; key: string; label: string; severity: "info" | "warning"; title: string; numbers: Record<string, number> };
export const BASELINE_DAYS = 28;
export const RECENT_DAYS = 3;
const MIN_BASE_TOTAL = 20; // leads in the 28 baseline days before a source has "a normal"

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Fills missing days with zero so a quiet day counts as a quiet day. `days` is oldest first and ends on `today` (a YYYY-MM-DD). */
export function zeroFill(rows: readonly DayCount[], today: string, span: number): DayCount[] {
  const by = new Map(rows.map((r) => [r.day, r]));
  const out: DayCount[] = [];
  const t = Date.parse(today + "T00:00:00Z");
  for (let i = span - 1; i >= 0; i--) { const d = new Date(t - i * 86_400_000).toISOString().slice(0, 10); out.push(by.get(d) ?? { day: d, leads: 0, dups: 0, junk: 0 }); }
  return out;
}

/**
 * The three intake rules, each against the source's OWN history (a baseline, never a fixed number), each needing enough samples:
 *  - low rate: the last 3 days (leads per day) are under half of the usual day (mean of the 28 days before, with at least 20 leads in them) and at least 5 leads short;
 *  - dead: no lead for max(3, 4 x the usual gap) days (and never fewer than 3), when the source normally sends at least 8 leads in 28 days;
 *  - heavy duplicates or junk: 40% duplicates (30% junk) of the last 30 days, with at least 20 leads.
 */
export function intakeAlerts(key: string, label: string, series: readonly DayCount[], opts: { deadDays?: number } = {}): IntakeAlert[] {
  const out: IntakeAlert[] = [];
  if (series.length < BASELINE_DAYS + RECENT_DAYS) return out;
  const recent = series.slice(-RECENT_DAYS), base = series.slice(-(BASELINE_DAYS + RECENT_DAYS), -RECENT_DAYS);
  const baseTotal = base.reduce((s, d) => s + d.leads, 0), recentTotal = recent.reduce((s, d) => s + d.leads, 0);
  const usual = baseTotal / base.length;
  const nonZeroMedian = median(base.map((d) => d.leads).filter((x) => x > 0));
  if (baseTotal >= MIN_BASE_TOTAL && recentTotal / RECENT_DAYS < usual * 0.5 && usual * RECENT_DAYS - recentTotal >= 5 && recentTotal > 0) {
    out.push({ kind: "low_rate", key, label, severity: "warning", title: `${label} sent ${recentTotal} ${recentTotal === 1 ? "lead" : "leads"} in 3 days, usually about ${Math.round(usual * 3)}`, numbers: { recent: recentTotal, usual3: Math.round(usual * 3), usualDay: Math.round(usual * 10) / 10, typicalDay: nonZeroMedian } });
  }
  if (baseTotal >= 8) {
    let gap = 0;
    for (let i = series.length - 1; i >= 0 && series[i].leads === 0; i--) gap++;
    const typicalGap = base.length / Math.max(1, baseTotal);
    const need = Math.max(opts.deadDays ?? 3, Math.ceil(typicalGap * 4), 3);
    if (gap >= need) out.push({ kind: "dead", key, label, severity: "warning", title: `${label} has sent no leads for ${gap} days`, numbers: { gapDays: gap, usual28: baseTotal } });
  }
  const last30 = series.slice(-30), leads30 = last30.reduce((s, d) => s + d.leads, 0);
  if (leads30 >= MIN_LEADS) {
    const dups = last30.reduce((s, d) => s + d.dups, 0), junk = last30.reduce((s, d) => s + d.junk, 0);
    if (dups / leads30 >= 0.4) out.push({ kind: "dup_heavy", key, label, severity: "info", title: `${label}: ${Math.round((dups / leads30) * 100)}% of its leads were already in your list`, numbers: { leads: leads30, dups } });
    if (junk / leads30 >= 0.3) out.push({ kind: "junk_heavy", key, label, severity: "info", title: `${label}: ${Math.round((junk / leads30) * 100)}% of its leads look like junk`, numbers: { leads: leads30, junk } });
  }
  return out;
}

/** The source key used everywhere (the SQL uses the same expression): lower case, single spaces, "(none)" for a blank. */
export function sourceKey(v: string | null | undefined): string { const s = (v ?? "").replace(/\s+/g, " ").trim().toLowerCase(); return s === "" ? "(none)" : s.slice(0, 80); }
export function sourceLabel(v: string | null | undefined): string { const s = (v ?? "").replace(/\s+/g, " ").trim(); return s === "" ? "No source" : s.slice(0, 60); }
export const NONE_KEY = "(none)";
export const SRC_KEY_SQL = "coalesce(nullif(left(lower(btrim(regexp_replace(coalesce(c.source, ''), '\\s+', ' ', 'g'))), 80), ''), '(none)')";

// ------------------------------------------------------------------------------------------------ cursors
const SHAPE = /^[A-Za-z0-9_|:.\- ]{1,200}$/;
export function encodeCur(parts: Array<string | number>): string { return Buffer.from(JSON.stringify(parts)).toString("base64url"); }
export function decodeCur(v: unknown, len: number): Array<string | number> | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 400) return null;
  try {
    const a = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(a) || a.length !== len || a.some((x) => !(typeof x === "number" ? Number.isFinite(x) : typeof x === "string" && SHAPE.test(x)))) return null;
    return a as Array<string | number>;
  } catch { return null; }
}
export const PAGE = 25;

// ------------------------------------------------------------------------------------------------ the lead-intake window
export const RANGES = { "7": 7, "30": 30, "90": 90 } as const;
export type RangeKey = keyof typeof RANGES;
export const parseRange = (v: unknown): RangeKey => (v === "7" || v === "90" ? v : "30");
