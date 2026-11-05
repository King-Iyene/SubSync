// One plain name, one line saying what the tab tells you, and one tag for every tab under "Break it down". "To do" means something you act on; "Report" means something
// you read. The words are listed in the glossary in docs/features/TODAY.md. Tested in src/lib/__tests__/today-tabs.test.ts (every tab has all three).

export type TabTag = "To do" | "Report";
export const TAB_META = {
  Forecast: { tag: "To do", subtitle: "What is about to go wrong later today if nobody acts, in a sentence and a short list." },
  Proof: { tag: "Report", subtitle: "How many problems SubSync found this week, how many are fixed and how many still need you." },
  People: { tag: "Report", subtitle: "How the people waiting for a reply are shared between your team." },
  Sources: { tag: "Report", subtitle: "How fast each source of leads gets a first reply." },
  Coverage: { tag: "Report", subtitle: "Which hours of the day leads wait the longest for a reply." },
  Growth: { tag: "Report", subtitle: "How many new email leads each client gets, and whether that is rising or falling." },
  "Lead flow": { tag: "Report", subtitle: "Where new leads end up: replied to, booked, showed up, or lost along the way." },
  "Clients coming and going": { tag: "Report", subtitle: "Clients added and clients removed each week." },
} as const satisfies Record<string, { tag: TabTag; subtitle: string }>;

export type TabName = keyof typeof TAB_META;
export const tabMeta = (name: string): { tag: TabTag; subtitle: string } | null => (name in TAB_META ? TAB_META[name as TabName] : null);

/** The page sections outside the tabs, with the same two labels. */
export const SECTION_META = {
  "Do this first": { tag: "To do", subtitle: "The people and clients that need you now, most urgent first." },
  "Where the work sits": { tag: "Report", subtitle: "How much waiting work each client has. Select a bar to see the people." },
  "This week": { tag: "Report", subtitle: "Reply time, people waiting and quiet deals over the last 7 days." },
} as const satisfies Record<string, { tag: TabTag; subtitle: string }>;

/** The one word for each idea, used on every Today screen, menu, palette entry, alert and email. */
export const GLOSSARY: Array<{ idea: string; word: string; neverSay: string }> = [
  { idea: "Someone whose message nobody answered", word: "waiting for a reply", neverSay: "unanswered, pending, unreplied" },
  { idea: "A contact added in the last days", word: "new lead", neverSay: "fresh lead, new contact" },
  { idea: "A lead with a usable email address", word: "email lead", neverSay: "email contact, subscriber" },
  { idea: "Someone who missed their appointment", word: "no-show", neverSay: "no show, missed" },
  { idea: "A deal that has not moved", word: "quiet deal", neverSay: "stale deal, dead deal" },
  { idea: "A business we serve", word: "client", neverSay: "the platform's own words for it" },
];
