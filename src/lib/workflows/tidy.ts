// Workflows module, round 2: the pain points that need only SubSync's own copy and history. Pure.
//   turned off or changed   a published workflow that went back to draft or paused, noticed between two updates
//   compare across accounts the same-named workflow in several client accounts, and where they differ
//   names                   naming problems and the one-tap fixes that go with them
//   duplicates              the same or nearly the same name inside one client account
//   review due              items the person marked Review that nobody looked at again
import type { Finding } from "./health.ts";
import { entityOf, type WfItem } from "./model.ts";
import type { RenameRule } from "./rename.ts";
import type { LabelRow } from "./store-types.ts";

const DAY = 86_400_000;
const live = (items: WfItem[]) => items.filter((w) => !w.removedSeenAt);

// ---------------------------------------------------------------- turned off

export type SeenChange = { locationId: string; workflowId: string; kind: string; source: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: number };
export const TURNED_OFF_DAYS = 7;
/** A workflow noticed going from published to draft or paused, and not by SubSync, in the last week and still not published. */
export function turnedOff(changes: SeenChange[], items: WfItem[], now: number): Finding[] {
  const by = new Map(items.map((w) => [`${w.locationId}|${w.workflowId}`, w]));
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const c of [...changes].sort((a, b) => b.at - a.at)) {
    if (c.source !== "observed" || c.kind !== "status" || now - c.at > TURNED_OFF_DAYS * DAY) continue;
    const k = `${c.locationId}|${c.workflowId}`;
    const w = by.get(k);
    if (seen.has(k) || !w || w.removedSeenAt || c.before?.status !== "published" || c.after?.status === "published" || w.status === "published") continue;
    seen.add(k);
    out.push({
      key: `off:${k}`, kind: "turned_off", severity: entityOf(w.workflowId) === "campaign" ? "info" : "warning", workflowId: w.workflowId, locationId: w.locationId, estimate: false,
      title: `"${w.name}" was turned off`, why: `It was published and is now ${w.status === "draft" ? "a draft" : w.status}. SubSync noticed this ${Math.max(0, Math.floor((now - c.at) / DAY)) === 0 ? "today" : `${Math.floor((now - c.at) / DAY)} days ago`}. Nobody is told when this happens in the CRM.`,
      next: "If it was on purpose, mark it fixed. If not, open it and publish it again.",
    });
  }
  return out;
}

// ---------------------------------------------------------------- compare

export const norm = (s: string) => s.toLowerCase().replace(/\(copy\)|copy of|\bcopy\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

export type Group = { name: string; items: WfItem[]; accounts: number; states: string[]; drift: string[] };
/** Same name (ignoring case, punctuation and "copy") in at least two client accounts. Drift = states differ, versions differ, or it is missing from some accounts. */
export function compareAcross(items: WfItem[], accountIds: string[]): Group[] {
  const by = new Map<string, WfItem[]>();
  for (const w of live(items)) if (entityOf(w.workflowId) === "workflow") by.set(norm(w.name), [...(by.get(norm(w.name)) ?? []), w]);
  const out: Group[] = [];
  for (const [n, list] of by) {
    const accs = new Set(list.map((w) => w.locationId));
    if (accs.size < 2 || !n) continue;
    const states = [...new Set(list.map((w) => w.status))];
    const versions = new Set(list.map((w) => w.version).filter(Boolean));
    const drift: string[] = [];
    if (states.length > 1) drift.push("Published in some accounts and not in others");
    if (versions.size > 1) drift.push("Edited to different versions");
    const missing = accountIds.length - accs.size;
    if (missing > 0 && accs.size >= 2) drift.push(`Missing from ${missing} account${missing === 1 ? "" : "s"}`);
    out.push({ name: list[0].name, items: list, accounts: accs.size, states, drift });
  }
  return out.sort((a, b) => b.drift.length - a.drift.length || b.accounts - a.accounts || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- names

export type NameIssue = { workflowId: string; locationId: string; name: string; issue: "spaces" | "copy" | "default" | "case"; words: string };
const DEFAULT_NAME = /^(new workflow|untitled|workflow|test|new automation|my workflow)\s*\d*$/i;
export function lintNames(items: WfItem[]): NameIssue[] {
  const out: NameIssue[] = [];
  for (const w of live(items)) {
    if (entityOf(w.workflowId) !== "workflow") continue;
    const base = { workflowId: w.workflowId, locationId: w.locationId, name: w.name };
    if (w.name !== w.name.trim() || /\s{2,}/.test(w.name)) out.push({ ...base, issue: "spaces", words: "Extra spaces" });
    if (/\(copy\)|^copy of\b|\bcopy\s*\d*$/i.test(w.name.trim())) out.push({ ...base, issue: "copy", words: "Looks like a leftover copy" });
    if (DEFAULT_NAME.test(w.name.trim())) out.push({ ...base, issue: "default", words: "Still has a default name" });
    if (w.name.length > 3 && (w.name === w.name.toUpperCase() || w.name === w.name.toLowerCase()) && /[a-z]/i.test(w.name) && /\s/.test(w.name.trim())) out.push({ ...base, issue: "case", words: w.name === w.name.toUpperCase() ? "All capitals" : "All lower case" });
  }
  return out;
}
/** The one-tap fixes: each is a rename rule the preview then shows, row by row. "default" names need a human, so they have none. */
export const FIX: Partial<Record<NameIssue["issue"], RenameRule & { tidyOnly?: boolean }>> = {
  spaces: { tidy: true, tidyOnly: true },
  copy: { find: "(copy)", replace: "", tidy: true },
  case: { casing: "title", tidy: true },
};

// ---------------------------------------------------------------- duplicates

const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 1));
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}
export type Dupes = { locationId: string; items: WfItem[]; exact: boolean };
/** Inside one client account: the same name, or names that share at least 80% of their words. Union of pairs, so a chain of near names is one group. */
export function findDuplicates(items: WfItem[]): Dupes[] {
  const out: Dupes[] = [];
  const perAccount = new Map<string, WfItem[]>();
  for (const w of live(items)) if (entityOf(w.workflowId) === "workflow") perAccount.set(w.locationId, [...(perAccount.get(w.locationId) ?? []), w]);
  for (const [loc, list] of perAccount) {
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    let exactAny = new Set<number>();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const same = norm(list[i].name) === norm(list[j].name);
      if (same || similarity(list[i].name, list[j].name) >= 0.8) { parent[find(i)] = find(j); if (same) { exactAny.add(i); exactAny.add(j); } }
    }
    const groups = new Map<number, number[]>();
    list.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
    for (const idx of groups.values()) if (idx.length > 1) out.push({ locationId: loc, items: idx.map((i) => list[i]), exact: idx.every((i) => exactAny.has(i)) });
    exactAny = new Set();
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}

// ---------------------------------------------------------------- review due

export const REVIEW_DAYS = 14;
/** Items the person marked Review more than two weeks ago and has not touched since. They come back as a prompt. */
export function reviewDue(items: WfItem[], labels: Map<string, LabelRow>, now: number): Finding[] {
  const out: Finding[] = [];
  for (const w of live(items)) {
    const l = labels.get(`${w.locationId}|${w.workflowId}`);
    if (l?.decision !== "review" || !l.updatedAt || now - l.updatedAt < REVIEW_DAYS * DAY) continue;
    out.push({ key: `review:${w.locationId}:${w.workflowId}`, kind: "review_due", severity: "info", workflowId: w.workflowId, locationId: w.locationId, estimate: false, title: `"${w.name}" is still waiting for your review`, why: `You marked it Review ${Math.floor((now - l.updatedAt) / DAY)} days ago.`, next: "Decide: keep it, or retire it. Marking it Keep or Retire clears this." });
  }
  return out;
}
