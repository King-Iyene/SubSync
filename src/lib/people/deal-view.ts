// Pure helpers for the deals section of the contact panel: the summary, days in stage against the usual, the history labels, the value warning and the "why this needs
// attention" line. No database and no vendor names here, so every rule is unit-tested.

export const MIN_STAYS_FOR_USUAL = 20; // same floor the pipeline views use before they call a stage's usual stay a fact
export const DAY_MS = 86_400_000;

export type SummaryDeal = { status: string; value: number };
export type DealSummary = { openValue: number; wonValue: number; open: number; won: number; lost: number; total: number; testNote: boolean };

/** Obvious test values: placeholders no real deal has (1, 1234, 12345, 123456, 9999, 1111) or a million and up. */
export function looksLikeTestValue(v: number): boolean {
  if (!Number.isFinite(v) || v <= 0) return false;
  const s = String(Math.round(v));
  return v >= 1_000_000 || s === "1" || /^(123|1234|12345|123456|1111|11111|2222|9{4,})$/.test(s);
}

export function summarize(deals: SummaryDeal[]): DealSummary {
  let openValue = 0, wonValue = 0, open = 0, won = 0, lost = 0, testNote = false;
  for (const d of deals) {
    const v = Number.isFinite(d.value) ? d.value : 0;
    if (d.status === "open") { open++; openValue += v; if (looksLikeTestValue(v)) testNote = true; }
    else if (d.status === "won") { won++; wonValue += v; if (looksLikeTestValue(v)) testNote = true; }
    else if (d.status === "lost" || d.status === "abandoned") lost++;
  }
  return { openValue, wonValue, open, won, lost, total: deals.length, testNote };
}

export type Usual = { days: number | null; note: string };
/** The usual stay in a stage: the 75th percentile of finished stays, only with enough of them. */
export function usualStay(p75Days: number | null | undefined, stays: number | null | undefined): Usual {
  if (p75Days == null || !Number.isFinite(p75Days) || (stays ?? 0) < MIN_STAYS_FOR_USUAL) return { days: null, note: "Not enough history" };
  const d = Math.max(1, Math.round(p75Days));
  return { days: d, note: `usual ${d} days` };
}

export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

export type StageTone = "ok" | "slow" | "unknown";
export type Dwell = { days: number | null; usual: Usual; tone: StageTone; text: string };
export function stageDwell(sinceIso: string | null | undefined, p75Days: number | null | undefined, stays: number | null | undefined, now: number): Dwell {
  const days = daysSince(sinceIso, now);
  const usual = usualStay(p75Days, stays);
  if (days === null) return { days, usual, tone: "unknown", text: "Time in this stage is not known yet" };
  const dayWord = days === 1 ? "day" : "days";
  if (usual.days === null) return { days, usual, tone: "unknown", text: `${days} ${dayWord} in this stage. ${usual.note}` };
  return { days, usual, tone: days > usual.days ? "slow" : "ok", text: `${days} ${dayWord} in this stage, ${usual.note}` };
}

/** Where the current stage sits among the pipeline's stages (1-based), for the small step bar. */
export function stageProgress(stages: Array<{ id: string }>, stageId: string | null): { index: number; total: number } | null {
  const i = stageId ? stages.findIndex((s) => s.id === stageId) : -1;
  return i < 0 ? null : { index: i + 1, total: stages.length };
}

/** A value change this large is more often a typo (an extra zero) than a real change. */
export function valueChangeWarning(before: number, next: number): string | null {
  if (!Number.isFinite(next) || next < 0) return null;
  if (before > 0 && next >= before * 10) return `This is ${Math.round(next / before)} times the current value. Check for an extra zero.`;
  if (next > 0 && before >= next * 10) return `This is ${Math.round(before / next)} times smaller than the current value. Check for a missing zero.`;
  return null;
}

export const fmtMoneyExact = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** Digits and one dot only, at most two decimals. */
export function cleanMoneyInput(raw: string): string {
  const s = raw.replace(/[^0-9.]/g, "");
  const [a, ...rest] = s.split(".");
  return rest.length ? `${a}.${rest.join("").slice(0, 2)}` : a;
}
/** Thousands commas for display only. */
export function groupThousands(raw: string): string {
  const [a, b] = raw.split(".");
  const g = a.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return b !== undefined ? `${g}.${b}` : g;
}

export type Attention = { why: string; next: string } | null;
/** One plain reason and one next step. Only for open deals; the most important reason wins. */
export function attentionFor(d: { status: string; value: number; ownerId: string | null; dwell: Dwell; quietDays: number | null }): Attention {
  if (d.status !== "open") return null;
  if (!d.ownerId) return { why: "Nobody owns this deal.", next: "Choose an owner below." };
  if (d.dwell.tone === "slow") return { why: `Stuck: ${d.dwell.text}.`, next: "Contact them today, or move the deal if it has changed." };
  if (d.quietDays !== null && d.quietDays >= 14) return { why: `Quiet: no activity for ${d.quietDays} days.`, next: "Send a follow-up or mark the deal lost." };
  if (!(d.value > 0)) return { why: "No value is set, so it does not count in your totals.", next: "Add the value." };
  return null;
}

export type HistoryRow = { id: number | string; kind: string; at: string; from: string | null; to: string | null; fromName: string | null; toName: string | null; value: number | null; actor: string | null; byUs: boolean };
/** Newest first. A plain sentence per event; kinds we do not describe are left out rather than guessed. */
export function historyLines(rows: HistoryRow[], money: (n: number) => string = fmtMoneyExact): Array<{ id: string; at: string; text: string }> {
  const out: Array<{ id: string; at: string; text: string }> = [];
  const sorted = [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
  for (const r of sorted) {
    let t: string | null = null;
    if (r.kind === "created") t = `Deal created${r.toName ? ` in ${r.toName}` : ""}`;
    else if (r.kind === "stage") t = `Moved ${r.fromName ? `from ${r.fromName} ` : ""}to ${r.toName ?? "a new stage"}`;
    else if (r.kind === "status") t = r.to === "won" ? "Marked won" : r.to === "lost" ? "Marked lost" : r.to === "open" ? "Reopened" : `Status changed to ${r.to ?? "unknown"}`;
    else if (r.kind === "value") t = `Value changed${r.from ? ` from ${money(Number(r.from))}` : ""} to ${money(Number(r.to ?? r.value ?? 0))}`;
    else if (r.kind === "owner") t = r.toName || r.to ? `Owner changed to ${r.toName ?? "a new owner"}` : "Owner removed";
    else if (r.kind === "lost_reason") t = `Lost reason: ${r.toName ?? r.to ?? "recorded"}`;
    if (!t) continue;
    const w = r.byUs ? "SubSync" : r.actor ?? "";
    out.push({ id: String(r.id), at: r.at, text: w ? `${t} (${w})` : t });
  }
  return out;
}
export const historyStarts = (rows: Array<{ at: string }>): string | null => (rows.length ? rows.reduce((m, r) => (Date.parse(r.at) < Date.parse(m) ? r.at : m), rows[0].at) : null);

/** Open deals first, then won, then lost; within each, largest value first. */
export function orderDeals<T extends SummaryDeal>(deals: T[]): T[] {
  const rank = (s: string) => (s === "open" ? 0 : s === "won" ? 1 : 2);
  return [...deals].sort((a, b) => rank(a.status) - rank(b.status) || b.value - a.value);
}
