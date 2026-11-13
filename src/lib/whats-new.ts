// What's new: one line per new page or feature, with its date. Pure data plus the rule for the "New" badge. Only things that are live may be listed.
export type NewsEntry = {
  id: string; date: string; title: string; line: string;
  /** The menu page it belongs to (the badge goes on that entry) and the feature switch that must be on for it to show. */
  view: string | null; feature: string | null;
};

/** A page carries the "New" badge for this many days after its entry date, and only while its feature is on and the person has not opened or dismissed it. */
export const NEW_WINDOW_DAYS = 14;

export const NEWS: readonly NewsEntry[] = [
  { id: "ai-byo", date: "2026-11-13", title: "AI wording for your brief (your own AI)", line: "Connect your own AI account (OpenRouter, an API key from Anthropic, OpenAI or Google) and get a short plain-English note on your 7 am brief. You set the monthly limit and see exactly what was sent. It only suggests.", view: "settings", feature: "ai_brief" },
  { id: "sy-power-dialer", date: "2026-11-13", title: "Start calling opens your power dialer", line: "In Speed to lead, Start calling sends up to 25 waiting leads to your CRM call queue after one preview and one confirm, then opens your CRM call queue in a new tab. Skips anyone who asked not to be contacted or who is outside calling hours, lists who was sent, and has Undo. SubSync never places a call.", view: "speed", feature: null },
  { id: "sy-auto", date: "2026-11-13", title: "Syncs by itself, in seconds", line: "SubSync now checks for new changes when you open it, when you come back to the tab and about once a minute, and shows Live and Updated seconds ago. Only what changed is read, so a big account no longer slows the rest. Sync now is still there, and so is a Full re-sync.", view: null, feature: null },
  { id: "st-sale-basis", date: "2026-11-12", title: "How a sale is counted", line: "Pick how your team counts a sale, including whether a sale with no dollar value counts. Every Sold figure follows your choice and says which one it used. It is in Settings.", view: "settings", feature: null },
  { id: "pl-trust-deals", date: "2026-11-12", title: "Deals you can trust", line: "Test deals, deals with no value and deals nobody owns are left out of the money, and the screen says how many and why. A quiet deal is judged against its own pipeline step.", view: "today", feature: null },
  { id: "pl-funnel", date: "2026-11-12", title: "Pipeline funnel", line: "Money flow is now a funnel: the money in each step, how much moved on, and the biggest leak. Click a band to open exactly those deals. Pipelines pages are grouped under five plain names.", view: "pipeline", feature: null },
  { id: "pp-call-panel", date: "2026-11-12", title: "Call panel with Fathom", line: "Open a lead and see their recorded calls, call, text or email from one panel. Nothing is sent until you review and confirm it.", view: "people", feature: null },
  { id: "pp-deals", date: "2026-11-12", title: "A richer Deals section", line: "In a lead's panel, see their deals with value, step, owner and age, and add a new deal after a preview and a confirm.", view: "people", feature: null },
  { id: "ap-people", date: "2026-11-12", title: "Appointments, by person", line: "A table of bookings per person, week over week, with colours for each result. Every number opens the appointments behind it.", view: "appointments", feature: null },
  { id: "dq-safe-merge", date: "2026-11-12", title: "Safer duplicate merging", line: "Merge all certain matches now lists what it will merge and what it skipped, and why. It skips anyone protected, any pair that looks like two people, and any pair it cannot rank with certainty. The comparison also shows each contact's last conversation, deals with pipeline and stage, and calendars.", view: "cleanup", feature: "dq_dupes" },
  { id: "sp-ignored", date: "2026-11-12", title: "Clients not answering leads", line: "See which client accounts are ignoring the leads you send them: leads nobody answered, customers with no reply or only an automatic one, and missed calls nobody returned. Every number opens the people, and you are told once.", view: "speed", feature: "sp_ignored_leads" },
  { id: "pl-history-funnel", date: "2026-11-12", title: "Step history and stuck deals", line: "How many deals entered each pipeline step, how many moved on, and the money stuck longer than usual for its step. Every number opens its deals.", view: "pipeline", feature: "pl_history_funnel" },
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
