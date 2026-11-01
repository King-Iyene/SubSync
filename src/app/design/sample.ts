import { freshnessOf } from "@/lib/sync/freshness";
import type { Api } from "../app/session";

// Made-up data for the style guide at /design, so every shared component can be shown working without anyone being signed in. Nothing here is a real
// person or business, and the page says so. It stands in for the network: the components call `get` exactly as they do in the app.
const ACCOUNTS: Array<{ id: string; name: string; test?: boolean; ignored?: boolean; industry: string; owner: string }> = [
  { id: "demoMapleDental", name: "Maple Dental", industry: "medical", owner: "Ada Okafor" }, { id: "demoHarborRealty", name: "Harbor Realty", industry: "real_estate", owner: "Ada Okafor" },
  { id: "demoNorthRoofing", name: "North Roofing", industry: "home_services", owner: "Ben Silva" }, { id: "demoSunriseSpa", name: "Sunrise Med Spa", industry: "medical", owner: "Ben Silva" },
  { id: "demoBrightSolar", name: "Bright Solar", industry: "home_services", owner: "Ada Okafor" }, { id: "demoTestSandbox", name: "Test Sandbox", test: true, industry: "real_estate", owner: "Ben Silva" },
  { id: "demoOldClient", name: "Old Client", ignored: true, industry: "medical", owner: "Ben Silva" },
];
const FIRST = ["Ada", "Ben", "Chloe", "Dmitri", "Esi", "Femi", "Grace", "Hugo", "Ines", "Jamal", "Kemi", "Liam", "Mira", "Noor", "Omar", "Priya", "Quinn", "Rosa"];
const LAST = ["Okafor", "Silva", "Meyer", "Haddad", "Tanaka", "Brown", "Nwosu", "Rossi", "Khan", "Lopez"];
export const SAMPLE_LEADS = Array.from({ length: 37 }, (_, i) => ({
  locationId: ACCOUNTS[i % 5].id, locationName: ACCOUNTS[i % 5].name, contactId: `demoContact${i}`, name: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
  waitingMinutes: 9000 - i * 230, url: "https://example.com/open", unassigned: i % 7 === 0, neverAnswered: i < 3,
}));

const person = (i: number) => ({ contactId: `demoAppt${i}`, name: `${FIRST[(i + 5) % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`, phone: "+15550100", at: Date.parse("2026-11-03T15:00:00Z") + i * 3_600_000, calendar: i % 2 ? "Discovery call" : "Showing", url: "https://example.com/open" });

// The one sentence comes from the real freshness function, so the style guide cannot word it differently from the app.
const SAMPLE_NOW = Date.parse("2026-11-01T12:00:00Z");
const SAMPLE_FRESHNESS = freshnessOf({ now: SAMPLE_NOW, demo: false, pendingJobs: 0, oldestPendingMinutes: null, connectionProblem: null, accounts: [{ locationId: "demoMapleDental", name: "Maple Dental", lastSuccessAt: new Date(SAMPLE_NOW - 7 * 60_000).toISOString(), problem: null }] });

export function sampleApi(): Api {
  const get = async (path: string): Promise<unknown> => {
    if (path.startsWith("freshness")) return { freshness: SAMPLE_FRESHNESS };
    if (path.startsWith("segments")) return { total: ACCOUNTS.filter((a) => !a.ignored).length, testAccounts: 1, accounts: ACCOUNTS, industries: [{ key: "medical", label: "Medical", accounts: 2 }, { key: "real_estate", label: "Real estate", accounts: 2 }, { key: "home_services", label: "Home services", accounts: 2 }], owners: [{ name: "Ada Okafor", accounts: 3 }, { name: "Ben Silva", accounts: 3 }] };
    if (path.startsWith("speed")) return { waiting: SAMPLE_LEADS.slice(0, 12), overall: { stillWaiting: 12 }, neverAnswered: 3, access: { ok: 5, total: 5 } };
    if (path.startsWith("appointments")) return { unconfirmed: [0, 1, 2].map(person), unconfirmedTotal: 3, recover: [3, 4].map(person), recoverTotal: 2, unmarkedTotal: 4 };
    if (path.startsWith("contact/")) {
      return {
        contact: { contactId: "demoContact0", locationId: "demoMapleDental", locationName: "Maple Dental", name: "Ada Okafor", email: "ada@example.com", phone: "+15550123", tags: ["new lead", "facebook form", "whitening"], source: "Facebook lead form", dnd: false, lastActivityAt: "2026-10-30T09:00:00Z" },
        deals: [{ id: "d1", name: "Whitening package", status: "open", value: 450, stage: "Booked" }],
        unread: 2,
        timeline: [
          { at: "2026-10-30T09:00:00Z", kind: "message", title: "Last message was from them", detail: "sms" },
          { at: "2026-10-29T16:00:00Z", kind: "move", title: "Whitening package moved to Booked" },
          { at: "2026-10-29T15:40:00Z", kind: "contact", title: "Added as a contact", detail: "Source: Facebook lead form" },
        ],
        url: "https://example.com/open",
      };
    }
    throw new Error(`The style guide has no sample for ${path}`);
  };
  const api: Api = {
    demo: true, get: get as Api["get"], filtered: () => api,
    post: (async () => ({})) as Api["post"], put: (async () => ({})) as Api["put"], del: (async () => ({})) as Api["del"], download: async () => undefined,
  };
  return api;
}

// Eight weeks of sample trend with the leads behind each bar, built so the count on a bar is exactly the number of leads in its list (what the real screen does).
const STATUS = ["within", "late", "waiting"] as const;
export const SAMPLE_TREND = Array.from({ length: 8 }, (_, k) => {
  const leads = 6 + ((k * 5) % 9);
  const members = Array.from({ length: leads }, (_, j) => {
    const status = STATUS[(j * 7 + k) % 3 === 0 ? 1 : (j + k) % 5 === 0 ? 2 : 0];
    const l = SAMPLE_LEADS[(k * 11 + j) % SAMPLE_LEADS.length];
    return { locationId: l.locationId, locationName: l.locationName, contactId: `${l.contactId}-w${k}-${j}`, name: l.name, status, minutes: status === "within" ? 6 : status === "late" ? 95 : 4000, url: l.url };
  });
  const within = members.filter((m) => m.status === "within").length;
  return { weekStart: Date.parse("2026-09-07T00:00:00Z") + k * 7 * 86_400_000, leads, withinTarget: within, hitRate: leads >= 5 ? within / leads : null, members };
});

export const SAMPLE_WEEKS = [
  { label: "Sep 14", value: 55, detail: "9 leads that week" }, { label: "Sep 21", value: 48, detail: "11 leads that week" }, { label: "Sep 28", value: null, detail: "3 leads that week" },
  { label: "Oct 5", value: 62, detail: "13 leads that week" }, { label: "Oct 12", value: 71, detail: "10 leads that week" }, { label: "Oct 19", value: 68, detail: "12 leads that week" },
  { label: "Oct 26", value: 83, detail: "14 leads that week" }, { label: "Nov 2", value: 90, detail: "8 leads that week" },
];
export const SAMPLE_OPTIONS = {
  accounts: ACCOUNTS,
  industries: [{ key: "medical", label: "Medical", count: 2 }, { key: "real_estate", label: "Real estate", count: 2 }, { key: "home_services", label: "Home services", count: 2 }],
  owners: [{ key: "Ada Okafor", label: "Ada Okafor", count: 3 }, { key: "Ben Silva", label: "Ben Silva", count: 3 }],
  users: [{ key: "u1", label: "Ada Okafor" }, { key: "u2", label: "Ben Silva" }, { key: "u3", label: "Chloe Meyer" }],
  calendars: [{ key: "c1", label: "Discovery call" }, { key: "c2", label: "Showing" }],
  pipelines: [{ key: "p1", label: "Sales" }, { key: "p2", label: "Rentals" }],
  sources: [{ key: "meta", label: "Facebook and Instagram" }, { key: "web", label: "Web form" }, { key: "portal", label: "Portals" }],
  testAccounts: 1, ranges: true,
};
