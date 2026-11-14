import { ageWords, money } from "@/lib/analytics/today-queue";
import type { Cell, ReportDocInput } from "@/lib/report-share";
import type { ReportInput } from "./print-report";

// What each report screen hands to "Share report": the figures and sentences the screen already shows, in the small shape the server freezes. Names go in as `pii` cells, so the link hides
// them unless the person chose to include them. Pure functions, unit tested.

/** Today: the headline, the top of "Do this first", what was spotted, and what was caught. */
export function todayDoc(r: ReportInput, now: number): ReportDocInput {
  const sections: ReportDocInput["sections"] = [{ heading: "Where things stand", lines: [r.headline, r.breakdown ?? "", r.forecast ?? ""].filter(Boolean) }];
  sections.push(r.rows.length === 0
    ? { heading: "Do this first", lines: ["Nothing needs attention right now."] }
    : {
      heading: "Do this first",
      table: {
        columns: ["Client account", "What is wrong", "Amount", "Open for"],
        rows: r.rows.slice(0, 12).map((x): Cell[] => [{ pii: x.accountName, as: "account" }, x.text, x.dollars ? money(x.dollars) : x.estimate ? `about ${money(x.estimate)}, estimated` : x.count.toLocaleString("en-US"), x.since === null ? "" : ageWords(Math.max(0, (now - x.since) / 60_000))]),
      },
    });
  if (r.insights.length > 0) sections.push({ heading: "Worth a look", lines: r.insights });
  if (r.proof) sections.push({ heading: "What was caught", lines: [r.proof] });
  const notes = ["Counts come from your CRM data as last read. Nothing was changed in your CRM."];
  if (r.rows.length > 12) notes.unshift(`${r.rows.length - 12} more rows are in the app.`);
  if (r.setAside > 0) notes.unshift(`${r.setAside} ${r.setAside === 1 ? "item is" : "items are"} snoozed or marked done and not counted.`);
  return { title: "Today", scope: r.who === "All clients" ? "All client accounts" : { pii: r.who, as: "account" }, period: r.generatedAt, brandName: r.brandName, sections, notes };
}

type ProofIn = {
  weekStart: string; accountName: string | null; lines: string[]; clientLines: string[];
  total: { found: number; cleared: number; stillOpen: number; medianFixMinutes: number | null; enough: boolean };
  byKind: Array<{ label: string; found: number; cleared: number; stillOpen: number }>;
  rows: Array<{ name: string; found: number; cleared: number; stillOpen: number }>;
};

/** Today > Proof: the weekly receipt (found, fixed, still open), what was caught, and for an owner the figures per client account. */
export function proofDoc(p: ProofIn, brandName: string | null, withAccounts: boolean): ReportDocInput {
  const n = (v: number) => v.toLocaleString("en-US");
  const sections: ReportDocInput["sections"] = [];
  const stats = p.total.enough ? [{ label: "Found", value: n(p.total.found) }, { label: "Fixed", value: n(p.total.cleared) }, { label: "Still open", value: n(p.total.stillOpen) }] : [];
  const lines = [...p.lines, ...p.clientLines];
  sections.push({ heading: `Weekly receipt, week of ${p.weekStart}`, stats, lines });
  if (p.byKind.length > 0) sections.push({ heading: "What was caught", table: { columns: ["Kind", "Found", "Fixed", "Still open"], rows: p.byKind.map((k): Cell[] => [k.label, n(k.found), n(k.cleared), n(k.stillOpen)]) } });
  if (withAccounts && p.rows.length > 0) sections.push({ heading: "By client account", table: { columns: ["Client account", "Found", "Fixed", "Still open"], rows: p.rows.slice(0, 60).map((x): Cell[] => [{ pii: x.name, as: "account" }, n(x.found), n(x.cleared), n(x.stillOpen)]) } });
  return { title: "Weekly proof", scope: p.accountName ? { pii: p.accountName, as: "account" } : "All client accounts", period: `week of ${p.weekStart}`, brandName, sections, notes: ["Found and fixed are counted from a daily record kept by the app. Nothing was changed in your CRM."] };
}

type Receipt ={ name: string; headline: string; lines: Array<{ label: string; value: string }> };

/** Clients > Reports: the last 7 days for every client, one row per client with the same figures side by side. */
export function weeklyDoc(receipts: Receipt[], brandName: string | null): ReportDocInput {
  const labels = [...new Set(receipts.flatMap((r) => r.lines.map((l) => l.label)))].slice(0, 6);
  return {
    title: "Weekly client report", scope: "All client accounts", period: "the last 7 days", brandName,
    sections: [{
      heading: "The last 7 days for each client",
      table: { columns: ["Client account", ...labels], rows: receipts.slice(0, 60).map((r): Cell[] => [{ pii: r.name, as: "account" }, ...labels.map((l) => r.lines.find((x) => x.label === l)?.value ?? "")]) },
    }, { heading: "In a sentence", table: { columns: ["Client account", "Summary"], rows: receipts.slice(0, 60).map((r): Cell[] => [{ pii: r.name, as: "account" }, r.headline]) } }],
    notes: ["Every figure is a count from the data read from your CRM. Nothing was changed in your CRM."],
  };
}
