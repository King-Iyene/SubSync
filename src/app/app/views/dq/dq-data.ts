"use client";

import { useData } from "../../session";

// Clean-up v2: the shapes the /api/app/dq/... answers have, and the sample data behind ?cufx (labelled "Sample data" on screen). The real screens never read the sample unless the address carries ?cufx.

export const sampleOn = (): boolean => typeof window !== "undefined" && /[?&]cufx(=|&|#|$)/.test(window.location.href);

export type Tier = "certain" | "likely" | "possible";
export type Opts = {
  flags: { module: boolean; dupes: boolean; intake: boolean; gate: boolean; score: boolean; alerts: boolean }; canChange: boolean; switchOn: boolean; accounts: Array<{ id: string; name: string }>;
  tiers: Array<{ id: Tier; label: string; hint: string }>; why: Record<string, string>; caps: { delete: number; bulkMerge: number }; minLeads: number; rules: { version: string; date: string }; formula: string; notKnown: string;
  flagLabels: Record<string, string>;
};
export type Part = { id: string; label: string; weight: number; share: number; lost: number; line: string };
export type Overview = {
  asOf: string | null; accounts: number | null; headline: string | null; hours: number; formula: string;
  numbers: { groups: number; extra: number; badPhones: number; junk: number; badEmail: number; contacts: number };
  tiers: Record<Tier, { groups: number; extra: number }>;
  quality: { score: number | null; word: string | null; why: string; parts: Part[]; note: string | null; version: string } | null; trend: Array<{ day: string; score: number | null }>;
  worst: Array<{ locationId: string; name: string | null; score: number | null; contacts: number }>; worstTotal: number;
  gate: { lanes: Array<{ key: string; label: string; leads: number; dups: number; junk: number }>; groups: number; days: number } | null;
  best: { line: string; best: string | null; worst: string | null; note: string | null } | null;
  alerts: Array<{ kind: string; title: string; account: string | null; locationId: string; key: string }>; alertCount: number;
};
export type Person = {
  contactId: string; name: string; email: string | null; phone: string | null; owner: string | null; source: string | null; createdAt: string | null; dnd: boolean; protect: string | null; openDeals: number; url: string; protectWords: string | null;
};
export type GroupRow = { key: string; locationId: string; locationName: string | null; tier: Tier; badge: string; kinds: string[]; trimmed: boolean; shared: string | null; people: Person[]; protectedCount: number; why: string[] };
export type DupesRes = { tier: Tier; counts: Record<Tier, { groups: number; extra: number }> | null; next: string | null; rows: GroupRow[] };
export type DupeDetail = {
  locationId: string; locationName: string | null; key: string; keepId: string; different: boolean;
  people: Array<{ contactId: string; name: string; email: string | null; phone: string | null; tags: string[]; createdAt: string | null; source: string | null; ownerName: string | null; ownerId?: string | null; openDeals: number; wonDeals: number; hasConversation: boolean; appointments?: number; nextAppointmentAt?: string | null; openValue?: number; lastActivityAt?: string | null; dnd?: boolean; url: string; protectWords: string | null }>;
  guard: string[]; picks: Array<{ field: string; label: string; value: string; from: string; reason: string; conflict: boolean; values: string[] }>;
  workflow: { set: boolean; optedIn: boolean; canAsk: boolean; blockers: string[]; goneName: string | null; survivorId: string; switchOn: boolean };
};
export type Counts = { leads: number; dups: number; junk: number; answered: number; quality: number; booked: number; showed: number; won: number; wonValue: number; touchSecs: number; touched: number };
export type SourceRow = { key: string; label: string } & Counts;
export type FormRow = { kind: "form" | "survey"; id: string; name: string; locationId: string; locationName: string | null; submissions: number; people: number; repeat: number; dups: number; junk: number; answered: number; booked: number; won: number; wonValue: number; lastAt: string | null; first: string | null };
export type AlertRow = { kind: "low_rate" | "dead" | "dup_heavy" | "junk_heavy"; key: string; label: string; severity: "info" | "warning"; title: string; numbers: Record<string, number>; locationId: string; locationName: string | null; muted: boolean };
export type IntakeRes = {
  range: string; days: number; asOf: string | null; minLeads: number; total: number; sources: SourceRow[]; best: string | null; worst: string | null; line: string; note: string | null;
  forms: FormRow[]; funnels: Array<{ id: string; name: string; steps: number | null; locationId: string; locationName: string | null; leads: number }>; formsStatus: { forms: "ok" | "needs_permission" | "never"; at: string | null };
  alerts: AlertRow[]; mutes: Array<{ locationId: string; src: string; until: string | null }>; canMute: boolean; funnelNote: string; matchNote: string;
};
export type SourceDetail = { key: string; label: string; counts: Counts; trend: Array<{ day: string; leads: number; dups: number; junk: number }>; perAccount: Array<{ locationId: string; name: string | null } & Counts>; alerts: AlertRow[]; days: number };
export type LeadRow = { contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; owner: string | null; source: string | null; createdAt: string | null; dnd: boolean; flags: string[]; url: string };
export type LeadsRes = { flag: string; label: string; total: { n: number; capped: boolean } | null; next: string | null; rows: LeadRow[] };

const c = (leads: number, dups: number, junk: number, answered: number, booked: number, won: number, wonValue: number): Counts => ({ leads, dups, junk, answered, quality: Math.max(0, Math.min(answered, leads - dups - junk)), booked, showed: Math.round(booked * 0.7), won, wonValue, touchSecs: answered * 540, touched: answered });
const SOURCES: SourceRow[] = [
  { key: "facebook ads", label: "Facebook Ads", ...c(412, 38, 31, 301, 96, 22, 41800) }, { key: "website form", label: "Website form", ...c(268, 31, 9, 219, 70, 17, 30100) }, { key: "google ads", label: "Google Ads", ...c(190, 9, 4, 160, 61, 15, 28900) },
  { key: "quote request", label: "Quote request", ...c(120, 51, 18, 40, 9, 1, 1900) }, { key: "phone call", label: "Phone call", ...c(88, 6, 0, 80, 30, 9, 12400) }, { key: "import", label: "Import", ...c(61, 22, 12, 8, 2, 0, 0) },
];
const person = (i: number, name: string, email: string | null, phone: string | null, extra: Partial<Person> = {}): Person => ({ contactId: `s${i}`, name, email, phone, owner: i % 2 ? "Dana" : null, source: i % 2 ? "Website form" : "Facebook Ads", createdAt: `2026-1${i % 2}-0${i + 1}T10:00:00Z`, dnd: false, protect: null, openDeals: 0, url: "#", protectWords: null, ...extra });
const group = (n: number, tier: Tier, badge: string, shared: string, ps: Person[]): GroupRow => ({ key: `0000000${n}-${ps.length}`, locationId: "s1", locationName: "Sample Roofing", tier, badge, kinds: [badge.includes("phone") ? "phone" : badge.includes("email") ? "email" : "name"], trimmed: false, shared, people: ps, protectedCount: ps.filter((p) => p.protect).length, why: ["Sample reason."] });
export const SAMPLE = {
  options: { flags: { module: true, dupes: true, intake: true, gate: true, score: true, alerts: true }, canChange: true, switchOn: false, accounts: [{ id: "s1", name: "Sample Roofing" }, { id: "s2", name: "Sample Dental" }],
    tiers: [{ id: "certain", label: "Certain", hint: "Same phone or same email." }, { id: "likely", label: "Likely", hint: "Same name and a close phone or email." }, { id: "possible", label: "Possible", hint: "A very similar name." }], why: {}, caps: { delete: 25, bulkMerge: 50 }, minLeads: 20,
    rules: { version: "dq-1", date: "20 Dec 2026" }, formula: "Estimate: each bad number wastes 2 minutes a month, each extra duplicate 2 minutes.", notKnown: "Not available from the platform yet: unsubscribed state, active payments and active workflows.", flagLabels: { all: "All leads", ok: "Clean leads", dup: "Duplicates", junk: "Junk", clean: "Good leads", answered: "Answered", waiting: "Waiting for a first touch", booked: "Booked", showed: "Showed up", won: "Won" } } as Opts,
  overview: { asOf: "2026-12-20T06:00:00Z", accounts: 2, headline: "12 duplicate groups, 340 bad numbers: fixing them saves about 12.3 dialer hours a month.", hours: 12.3, formula: "Estimate: each bad number wastes 2 minutes a month, each extra duplicate 2 minutes.",
    numbers: { groups: 12, extra: 30, badPhones: 340, junk: 14, badEmail: 9, contacts: 2400 }, tiers: { certain: { groups: 7, extra: 8 }, likely: { groups: 3, extra: 3 }, possible: { groups: 2, extra: 2 } },
    quality: { score: 74, word: "Fair", why: "Mostly duplicates (30 extra records) and completeness (18% of details missing).", parts: [{ id: "duplicates", label: "Duplicates", weight: 30, share: 0.05, lost: 15, line: "30 extra records" }, { id: "completeness", label: "Completeness", weight: 25, share: 0.18, lost: 9, line: "18% of details missing" }, { id: "validity", label: "Validity", weight: 25, share: 0.02, lost: 1.5, line: "23 junk or unusable" }, { id: "intake", label: "New leads", weight: 20, share: 0.12, lost: 0.5, line: "12 of 100 new leads had a problem" }], note: null, version: "dq-1" },
    trend: [70, 71, 73, 72, 74].map((s, i) => ({ day: `2026-12-0${i + 1}`, score: s })), worst: [{ locationId: "s1", name: "Sample Roofing", score: 61, contacts: 1200 }, { locationId: "s2", name: "Sample Dental", score: 87, contacts: 1200 }], worstTotal: 2,
    gate: { lanes: SOURCES.map((s) => ({ key: s.key, label: s.label, leads: s.leads, dups: s.dups, junk: s.junk })), groups: 12, days: 30 }, best: { line: "Best: Google Ads (80% good leads, $28,900 won). Weakest: Import (13% good leads, 36% duplicates).", best: "Google Ads", worst: "Import", note: null },
    alerts: [{ kind: "low_rate", title: "Website form sent 2 leads in 3 days, usually about 24", account: "Sample Roofing", locationId: "s1", key: "website form" }], alertCount: 1 } as Overview,
  dupes: (tier: Tier): DupesRes => ({ tier, counts: { certain: { groups: 7, extra: 8 }, likely: { groups: 3, extra: 3 }, possible: { groups: 2, extra: 2 } }, next: null,
    rows: tier === "certain" ? [group(1, "certain", "Same phone", "+1 555 0100", [person(1, "Ann Lee", "ann@example.org", "+1 555 0100"), person(2, "Ann Lee", null, "(555) 010-0100")]), group(2, "certain", "Same email", "bo@example.org", [person(3, "Bo Chan", "bo@example.org", null, { protect: "open_deal", protectWords: "Has an open deal. Never removed or merged in bulk.", openDeals: 1 }), person(4, "Bo C.", "bo@example.org", "555 0111")])] : tier === "likely" ? [group(3, "likely", "Same name, close phone", "Cy Diaz", [person(5, "Cy Diaz", null, "555 0122"), person(6, "Cy Diaz", "cy@example.org", "+1 555 0122")])] : [group(4, "possible", "Similar name", "Di Evans", [person(7, "Di Evans", null, null), person(8, "Evans, Di", "di@example.org", null)])] }),
  intake: { range: "30", days: 30, asOf: "2026-12-20T06:00:00Z", minLeads: 20, total: SOURCES.reduce((s, r) => s + r.leads, 0), sources: SOURCES, best: "Google Ads", worst: "Import", line: "Best: Google Ads (80% good leads, $28,900 won). Weakest: Import (13% good leads, 36% duplicates).", note: null,
    forms: [{ kind: "form", id: "f1", name: "Free quote", locationId: "s1", locationName: "Sample Roofing", submissions: 120, people: 96, repeat: 20, dups: 31, junk: 4, answered: 70, booked: 22, won: 6, wonValue: 9100, lastAt: "2026-12-19T10:00:00Z", first: "2026-11-20T10:00:00Z" }],
    funnels: [{ id: "u1", name: "Roof checklist", steps: 3, locationId: "s1", locationName: "Sample Roofing", leads: 40 }], formsStatus: { forms: "ok", at: "2026-12-20T05:30:00Z" }, alerts: [{ kind: "low_rate", key: "website form", label: "Website form", severity: "warning", title: "Website form sent 2 leads in 3 days, usually about 24", numbers: {}, locationId: "s1", locationName: "Sample Roofing", muted: false }],
    mutes: [], canMute: true, funnelNote: "Views, opt-ins and conversion rates of funnels: Not available from the platform yet.", matchNote: "Money is counted from won deals linked to the person." } as IntakeRes,
  source: (key: string): SourceDetail => ({ key, label: SOURCES.find((s) => s.key === key)?.label ?? key, counts: SOURCES.find((s) => s.key === key) ?? SOURCES[0], trend: Array.from({ length: 35 }, (_, i) => ({ day: `d${i}`, leads: 6 + ((i * 7) % 9), dups: i % 4, junk: i % 6 === 0 ? 1 : 0 })), perAccount: [{ locationId: "s1", name: "Sample Roofing", ...SOURCES[0] }], alerts: [], days: 30 }),
  leads: { flag: "dup", label: "Duplicates", total: { n: 2, capped: false }, next: null, rows: [{ contactId: "s9", locationId: "s1", locationName: "Sample Roofing", name: "Eli Fox", email: "eli@example.org", phone: "555 0133", owner: null, source: "Website form", createdAt: "2026-12-19T10:00:00Z", dnd: false, flags: ["duplicate"], url: "#" }] } as LeadsRes,
  events: { rows: [{ id: 2, at: "2026-12-19T10:00:00Z", location: "Sample Roofing", kind: "dup_decided", ref: null, detail: { decision: "not_duplicate", size: 2 }, actor: "Sample" }], next: null },
};

/** Reads an endpoint, or hands back the sample (never both) when the address carries ?cufx. */
export function useDq<T>(path: string | null, sample?: () => unknown) {
  const fx = sampleOn();
  const live = useData<T>(fx ? null : path);
  if (fx && sample) return { data: sample() as T, error: null, loading: false, reload: () => undefined };
  return live;
}
