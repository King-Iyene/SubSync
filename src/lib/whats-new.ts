// What's new: one line per new page or feature, with its date. Pure data plus the rule for the "New" badge. Only things that are live may be listed.
export type NewsEntry = {
  id: string; date: string; title: string; line: string;
  /** The menu page it belongs to (the badge goes on that entry) and the feature switch that must be on for it to show. */
  view: string | null; feature: string | null;
};

/** A page carries the "New" badge for this many days after its entry date, and only while its feature is on and the person has not opened or dismissed it. */
export const NEW_WINDOW_DAYS = 14;

export const NEWS: readonly NewsEntry[] = [
  { id: "mn-meetings", date: "2026-11-12", title: "Meeting notes, finished", line: "Your recorded calls in one list, each on the right contact or waiting for you to pick, with next steps, follow-up lists and coaching.", view: "meetings", feature: "mn_list" },
  { id: "br-brief", date: "2026-11-11", title: "Your 7 am brief", line: "The five things that need you today, each with one line of why and a button to the exact list. By email at your hour, and at the top of Today.", view: "today", feature: "br_brief" },
  { id: "wg-wallet", date: "2026-11-11", title: "Credit balance watchlist", line: "Every client account's credit balance, lowest days left first, with alerts before it runs out or spending jumps.", view: "clients", feature: "wg_wallet" },
  { id: "st-settings", date: "2026-11-11", title: "Settings, rearranged", line: "Ten plain sections with a search box, real tool logos, and a Permissions page that says what each permission is for.", view: "settings", feature: "st_settings" },
  { id: "st-guides", date: "2026-11-11", title: "Guides for every page", line: "A 60-second guide for each page, a checklist that tracks your real progress, and a ? button on every page.", view: "help", feature: "st_guides" },
  { id: "cf-save", date: "2026-11-10", title: "Save this account, every morning", line: "A short email listing the client accounts most likely to leave, with the reason for each.", view: "clients", feature: "cf_save" },
  { id: "pm-module", date: "2026-11-10", title: "Payments", line: "Failed, late and disputed payments in one place, so you can chase the money.", view: "payments", feature: "pm_module" },
  { id: "pp-roles", date: "2026-11-09", title: "Team roles", line: "Give each person a label (Setter, Closer, Both, Support, Manager). Kept only in SubSync.", view: "team", feature: "pp_roles" },
  { id: "fl-find", date: "2026-11-09", title: "Find a lead", line: "Search every contact in every client account, with filters and lists.", view: "people", feature: "fl_find" },
  { id: "td-module", date: "2026-11-08", title: "A new Today", line: "What needs you first, what you cleared, and the numbers behind it.", view: "today", feature: "td_module" },
  { id: "ap-module", date: "2026-11-07", title: "Appointments", line: "Appointments with no outcome, no-shows to win back, and how each calendar performs.", view: "appointments", feature: "appt_module" },
  { id: "au-history", date: "2026-11-06", title: "Account audit history", line: "See how an account changed since its first audit, and send a one-page summary to a client.", view: "audit", feature: "au_history" },
  { id: "cl2", date: "2026-11-05", title: "Client accounts, managed", line: "Notes, plans and next steps for each client account.", view: "clients", feature: "cl2_accounts" },
  { id: "wf", date: "2026-11-04", title: "Workflows", line: "Which automations failed or sat idle in each client account.", view: "workflows", feature: null },
  { id: "cleanup", date: "2026-11-03", title: "Clean-up", line: "Duplicates, data quality, history and rules in one page, always with a preview first.", view: "cleanup", feature: "cleanup" },
];

const DAY = 86_400_000;
export const isFresh = (e: NewsEntry, now: number): boolean => now - Date.parse(`${e.date}T00:00:00Z`) <= NEW_WINDOW_DAYS * DAY && now >= Date.parse(`${e.date}T00:00:00Z`);

/** Pages with a "New" badge: the entry is recent, its feature is on, and the person has not dismissed it. */
export function newViews(now: number, on: (feature: string) => boolean, seen: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of NEWS) if (e.view && isFresh(e, now) && (e.feature === null || on(e.feature)) && !seen.has(e.id) && !out.has(e.view)) out.set(e.view, e.id);
  return out;
}

export const NEWS_IDS: ReadonlySet<string> = new Set(NEWS.map((e) => e.id));
