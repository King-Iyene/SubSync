import { SOURCE_ORDER } from "./policy.ts";

// When several tools recorded the same meeting (INTEGRATIONS_SPEC section 5.2 C, stage E2b item 5). Pure.
//
// Only Fathom is built today, so nothing here can fire yet; the rule is built now so that Zoom and Google Meet, when they arrive, cannot double up
// a note. The rule, in one line: never two notes for one meeting. The preferred tool wins while that is still possible, and a note that is already in
// the CRM is never doubled. The meeting that loses is kept as a "duplicate" row (without its content), so the choice is visible and a retry is recognised.

export type SeenMeeting = { id: string; provider: string; startedAt: string | null; attendeeEmails: string[]; title: string | null; status: string };

/** Two recordings starting this close together, by the same person, are looked at as possibly the same meeting. */
export const SAME_MEETING_MINUTES = 10;

/** Statuses that mean the meeting's note is already in the CRM (or, in test mode, would have been). */
const WRITTEN = new Set(["saved", "dry_run"]);

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Is `b` the same meeting as `a`, recorded by a different tool? It needs a start within 10 minutes of each other AND somebody in common who is not the
 * person themselves (or, when neither call lists an outsider, the same title). A same-tool pair is never judged here: the tool's own meeting id says.
 */
export function isSameMeeting(a: Omit<SeenMeeting, "id" | "status">, b: Omit<SeenMeeting, "id" | "status">, ownEmails: readonly string[] = []): boolean {
  if (a.provider === b.provider) return false;
  if (!a.startedAt || !b.startedAt) return false;
  const gap = Math.abs(Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (!Number.isFinite(gap) || gap > SAME_MEETING_MINUTES * 60_000) return false;
  const own = new Set(ownEmails.map(norm));
  const outsiders = (m: Omit<SeenMeeting, "id" | "status">) => new Set(m.attendeeEmails.map(norm).filter((e) => e && !own.has(e)));
  const x = outsiders(a);
  const y = outsiders(b);
  if (x.size > 0 && y.size > 0) return [...x].some((e) => y.has(e));
  return norm(a.title) !== "" && norm(a.title) === norm(b.title);
}

/** Lower is preferred. A tool not in the list comes last. */
export const rankOf = (provider: string, priority: readonly string[]): number => {
  const i = priority.indexOf(provider);
  return i === -1 ? priority.length : i;
};

/** A priority list made safe: only known tools, no repeats, and every known tool present (unlisted ones follow in the default order). */
export function cleanPriority(list: unknown): string[] {
  const given = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && (SOURCE_ORDER as readonly string[]).includes(x)) : [];
  const seen = [...new Set(given)];
  return [...seen, ...SOURCE_ORDER.filter((s) => !seen.includes(s))];
}

export type SourceDecision =
  | { action: "write"; supersedes: string[] }
  | { action: "duplicate"; of: string; reason: "preferred_tool_has_it" | "already_in_crm" };

/**
 * What to do with a meeting that arrived, given the person's other meetings around that time.
 *   - Nothing else looks the same: write it.
 *   - Another tool's copy was already written: this one is a duplicate (never two notes).
 *   - A preferred (or equal) tool's copy is waiting in the inbox: this one is a duplicate.
 *   - Only less-preferred copies that are still waiting exist: write this one, and those become duplicates.
 */
export function decideSource(incoming: Omit<SeenMeeting, "id" | "status">, seen: readonly SeenMeeting[], priority: readonly string[], ownEmails: readonly string[] = []): SourceDecision {
  const same = seen.filter((m) => isSameMeeting(incoming, m, ownEmails) && m.status !== "duplicate" && m.status !== "skipped");
  if (same.length === 0) return { action: "write", supersedes: [] };
  const written = same.find((m) => WRITTEN.has(m.status));
  if (written) return { action: "duplicate", of: written.id, reason: "already_in_crm" };
  const mine = rankOf(incoming.provider, priority);
  const better = same.find((m) => rankOf(m.provider, priority) <= mine);
  if (better) return { action: "duplicate", of: better.id, reason: "preferred_tool_has_it" };
  return { action: "write", supersedes: same.map((m) => m.id) };
}

export const DUPLICATE_WORDS: Record<"preferred_tool_has_it" | "already_in_crm", string> = {
  preferred_tool_has_it: "The same call was also recorded by a tool you prefer, so this copy was not used.",
  already_in_crm: "The same call was already added to your CRM from another tool, so this copy was not added again.",
};
