// "Send to power dialer" (docs/features/DIALQUEUE.md, section "One click to the power dialer"). Pure helpers, no network, no browser: the wording of the preview, the setup state of the
// call queue workflow, the 5 hand-built steps, and the new-tab hand-off. SubSync never places a call and never messages anyone: it tags leads, the customer's own workflow turns the tag
// into a call task, and the CRM's own Manual Actions page has the "Let's Start" power dialer.
import { CLICK_MAX } from "./callqueue.ts";

export type SetupState = "set_up" | "not_set_up" | "not_sure";
export const WORKFLOW_NAME = "Call queue (tag)";
export const WORKFLOW_NAMES = ["call queue (tag)", "call queue"]; // the hand-built name, and the name the automatic setup uses

/**
 * Is the call queue workflow in place? Order of evidence:
 * 1. the workflow list could be read (optional permission): found and published = set up; not found or not published = not set up (the list is the truth);
 * 2. it could not be read: a lead SubSync tagged lost its tag again (the workflow removes it) = set up; the person pressed "Mark as set up" = set up; otherwise not sure.
 */
export function setupState(i: { listed: "published" | "draft" | "missing" | "unreadable"; marked: boolean; observed: boolean }): SetupState {
  if (i.listed === "published") return "set_up";
  if (i.listed === "draft" || i.listed === "missing") return "not_set_up";
  if (i.observed || i.marked) return "set_up";
  return "not_sure";
}

export const stateWord = (s: SetupState) => (s === "set_up" ? "set up" : s === "not_set_up" ? "not set up" : "not sure");
export const statusLineFor = (s: SetupState) => `Call queue workflow: ${stateWord(s)}`;

/** One line for several accounts ("set up in 3 of 4 accounts"); a single account gets the plain line. */
export function summaryLine(states: readonly SetupState[]): string {
  if (states.length === 0) return "Call queue workflow: not sure";
  if (states.length === 1) return statusLineFor(states[0]);
  const up = states.filter((s) => s === "set_up").length;
  const no = states.filter((s) => s === "not_set_up").length;
  return `Call queue workflow: set up in ${up} of ${states.length} accounts${no ? `, not set up in ${no}` : ""}`;
}

/** `not_set_up` stops the send and shows the setup card; `not_sure` goes on with a warning (we cannot read the workflow, so we cannot say it is missing). */
export const gate = (s: SetupState): "setup_card" | "warn" | "go" => (s === "not_set_up" ? "setup_card" : s === "not_sure" ? "warn" : "go");

export const confirmText = (n: number, tag: string, accounts = 1) =>
  `Send ${n.toLocaleString("en-US")} ${n === 1 ? "lead" : "leads"} to your CRM call queue${accounts > 1 ? ` (${accounts} accounts)` : ""}. ${n === 1 ? "It gets" : "They get"} the tag ${tag}; your CRM adds a call task for each.`;

/** "25 of 40: one click sends at most 25. Press again for the next ones." Empty when nothing is held back. */
export const capNote = (sending: number, heldBack: number) => (heldBack > 0 ? `${sending.toLocaleString("en-US")} of ${(sending + heldBack).toLocaleString("en-US")} will go now: one click sends at most ${CLICK_MAX}. The rest wait for your next click.` : "");

export const requeueNote = (tag: string) => `A lead that already has the tag ${tag} is not sent again, because tagging a lead that has it changes nothing. Your CRM workflow removes the tag after it makes the call task, so that lead can be sent again later.`;

export const UNDO_NOTE = "Undo takes the tag off these leads. If your CRM already made a call task for one, delete that task in Manual Actions.";

/** The 5 steps to build the workflow by hand (the exact wording of the CRM's own screens). */
export function handSteps(tag: string): string[] {
  return [
    `Name the workflow ${WORKFLOW_NAME}.`,
    `Trigger: Contact Tag. Filter: Tag added includes ${tag}.`,
    "Action: Manual Action, type Call. Assign it to one person, or to everyone in turn.",
    `Action: Remove Contact Tag ${tag}. (This lets the same lead be sent again later.)`,
    "Publish the workflow, then press Mark as set up.",
  ];
}
export const stepsText = (tag: string) => handSteps(tag).map((s, i) => `${i + 1}. ${s}`).join("\n");

/** What happens after the confirm click. Opening the CRM page is pointless when nothing was tagged (writing off, nothing added, an error). */
export const shouldOpenQueue = (r: { live: boolean; added: number }) => r.live && r.added > 0;

// --- The new tab. A browser lets a page open a tab only straight from a click, not after waiting for a server answer. So the tab is reserved in the click itself (blank), and sent to
// the CRM page once the leads are tagged. If the browser refuses (a pop-up blocker, or a frame that may not open tabs), the answer is a plain link the person can press.
export type TabWin = { location: { href: string }; close: () => void; opener: unknown; closed?: boolean };
export type Opener = (url: string, target: string) => TabWin | null;

export function reserveTab(open: Opener): TabWin | null {
  try { const w = open("", "_blank"); if (w) { try { w.opener = null; } catch { /* a cross-origin tab may refuse; harmless */ } } return w ?? null; } catch { return null; }
}
/** Sends the reserved tab to `url`, or closes it when there is nothing to show. Returns whether the CRM page is open for the person. */
export function finishTab(tab: TabWin | null, url: string | null): boolean {
  if (!tab) return false;
  try {
    if (url) { tab.location.href = url; return true; }
    tab.close();
  } catch { /* ignore */ }
  return false;
}

export type SentLead = { contactId: string; name: string; url: string | null };

// --- Words for the states a click can end in. Every outcome of "Start calling" renders text: nothing is ever a silent click (source guard in powerdialer.test.ts).
/** The batch is empty: nobody can be sent. With a Call mode to go to, the sentence points there. */
export const emptyBatchText = (hasCallMode: boolean) => (hasCallMode ? "Nobody to call right now: no lead is waiting. Pick a list in Call mode." : "Nobody to call right now: nobody is waiting on this list.");
export const CHECKING_TEXT = "Checking who is ready to call...";
export const NO_ACCOUNTS_TEXT = "No client account is connected yet, so there is nobody to call.";
export const ACCOUNTS_ERROR_TEXT = "Could not load your accounts, so nothing was checked. Try again.";
export const CALL_MODE_BUTTON = "Open Call mode";
