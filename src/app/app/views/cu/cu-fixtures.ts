// Sample data for ?cufx only. The real screens never read this file's data unless the address carries ?cufx, and then they say "Sample data".
export const sampleOn = (): boolean => typeof window !== "undefined" && /[?&]cufx(=|&|#|$)/.test(window.location.href);

const kinds = [
  ["junk", "Junk and test contacts", "Junk and tests"], ["bad_phone", "Phone numbers that cannot work", "Cannot work"], ["bad_email", "Emails that cannot work", "Cannot work"], ["no_phone", "No phone number", "Missing details"],
  ["no_email", "No email address", "Missing details"], ["no_owner", "No owner", "Missing details"], ["no_source", "No source", "Missing details"], ["stale_deals", "Stale open deals", "Deals"],
  ["ownerless_deals", "Open deals with no owner", "Deals"], ["orphan_deals", "Deals with no contact", "Deals"],
] as const;
const n: Record<string, number> = { junk: 14, bad_phone: 31, bad_email: 9, no_phone: 212, no_email: 88, no_owner: 340, no_source: 120, stale_deals: 17, ownerless_deals: 6, orphan_deals: 2 };

export const SAMPLE = {
  options: {
    flags: { fix: true, health: true, bulk: true, confirm: true }, canChange: false, switchOn: false, accounts: [{ id: "s1", name: "Sample Roofing" }, { id: "s2", name: "Sample Dental" }],
    kinds: kinds.map(([id, label, group]) => ({ id, label, plain: "Sample description.", todo: "Sample next step.", group, deal: id.endsWith("deals") })), caps: { tag: 200, remove: 25 }, formula: "Sample formula.",
    notKnown: "Not available from the platform yet: unsubscribed state, active payments and active workflows.", hourly: 25, rules: { version: "cu-health-1", date: "11 Nov 2026" },
  },
  home: {
    source: "daily", day: "2026-11-11", accounts: 2, counts: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { n: v, capped: false }])), contacts: 2400, dealsOpen: 120, protectedContacts: 40,
    health: { score: 78, word: "Fair", why: "Mostly because of no owner (340) and no phone number (212).", evidence: [{ id: "no_owner", label: "No owner", count: 340, share: 0.14, lost: 3.1 }, { id: "no_phone", label: "No phone number", count: 212, share: 0.09, lost: 2.4 }], note: null, version: "cu-health-1" },
    trend: [70, 72, 71, 75, 77, 78].map((s, i) => ({ day: `2026-11-0${i + 1}`, score: s })), weekly: [{ id: "no_phone", label: "No phone number", count: 212, hours: 3.5, dollars: 88, todo: "Ask for a number." }], weeklyHours: 3.5, weeklyDollars: 88, formula: "Sample formula.",
  },
  accounts: [
    { locationId: "s1", name: "Sample Roofing", score: 61, word: "Needs work", why: "Sample.", contacts: 1200, top: { label: "No owner", count: 300 } },
    { locationId: "s2", name: "Sample Dental", score: 90, word: "Healthy", why: "Sample.", contacts: 1200, top: null },
  ],
  list: (kind: string) => ({
    kind, label: kind, plain: "", todo: "", total: { n: 2, capped: false }, next: null, deal: kind.endsWith("deals"),
    rows: [
      { rowId: "s1:a", kind, locationId: "s1", locationName: "Sample Roofing", contactId: "a", dealId: null, name: "Test Test", email: "test@example.com", phone: null, owner: null, source: null, dnd: false, value: null, stage: null, since: null, protect: null, protectWords: null, url: null },
      { rowId: "s1:b", kind, locationId: "s1", locationName: "Sample Roofing", contactId: "b", dealId: null, name: "Asdf", email: null, phone: "12", owner: null, source: null, dnd: true, value: null, stage: null, since: null, protect: "dnd", protectWords: "Asked not to be contacted. Never removed or merged.", url: null },
    ],
  }),
};
