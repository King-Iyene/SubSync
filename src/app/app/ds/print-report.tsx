"use client";

import { ageWords, money, type QueueRow } from "@/lib/analytics/today-queue";

// The printable report of Today: only drawn when printing (hidden on screen), so "Print report" is the browser's own print or Save as PDF of this plain page and the rest of the
// page is left out. Black on white, no colour needed, every figure in words and numbers. It holds what Today shows (the headline, the top of Fix first, what was spotted, what will
// go wrong if nobody acts, what SubSync caught) and nothing that is not on the screen; it carries the sender's own name when one is set, never ours.
export type ReportInput = {
  /** The company's own brand name when it set one, else "Today". */
  brandName: string | null;
  who: string;
  generatedAt: string;
  headline: string;
  breakdown: string | null;
  rows: QueueRow[];
  insights: string[];
  forecast: string | null;
  proof: string | null;
  setAside: number;
  note?: string | null;
};

export function PrintReport({ r, now }: { r: ReportInput; now: number }) {
  return (
    <article className="hidden print:block" data-testid="today-print" aria-hidden>
      <header className="mb-5 border-b-2 border-black pb-3">
        <p className="text-sm">{r.brandName ?? "Today"}</p>
        <h1 className="text-2xl font-semibold">Today: {r.who}</h1>
        <p className="text-sm">{r.generatedAt}</p>
      </header>
      <h2 className="text-xl font-semibold">{r.headline}</h2>
      {r.breakdown && <p className="mt-1 text-sm">{r.breakdown}</p>}
      {r.forecast && <p className="mt-2 text-sm">{r.forecast}</p>}
      <h3 className="mb-1 mt-6 text-base font-semibold">Fix first</h3>
      {r.rows.length === 0 ? <p className="text-sm">Nothing needs you right now.</p> : (
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b border-black text-left"><th className="py-1 pr-2">Client account</th><th className="py-1 pr-2">What is wrong</th><th className="py-1 pr-2 text-right">At stake</th><th className="py-1">Wrong for</th></tr></thead>
          <tbody>
            {r.rows.slice(0, 12).map((x) => (
              <tr key={x.key} className="border-b border-gray-400 align-top">
                <td className="py-1 pr-2 font-medium">{x.accountName}</td><td className="py-1 pr-2">{x.text}</td>
                <td className="py-1 pr-2 text-right">{x.dollars ? money(x.dollars) : x.estimate ? `about ${money(x.estimate)} (estimate)` : x.count.toLocaleString("en-US")}</td>
                <td className="py-1">{x.since === null ? "" : ageWords(Math.max(0, (now - x.since) / 60_000))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.rows.length > 12 && <p className="mt-1 text-xs">{r.rows.length - 12} more rows are in SubSync.</p>}
      {r.insights.length > 0 && (<><h3 className="mb-1 mt-6 text-base font-semibold">Spotted today</h3><ul className="list-disc pl-5 text-sm">{r.insights.map((t) => <li key={t}>{t}</li>)}</ul></>)}
      {r.proof && (<><h3 className="mb-1 mt-6 text-base font-semibold">What SubSync caught</h3><p className="text-sm">{r.proof}</p></>)}
      {r.setAside > 0 && <p className="mt-4 text-xs">{r.setAside} {r.setAside === 1 ? "item is" : "items are"} set aside (snoozed or marked Done) and not counted above.</p>}
      {r.note && <p className="mt-2 text-xs">{r.note}</p>}
      <p className="mt-6 border-t border-gray-400 pt-2 text-xs">Counts come from your CRM data as last read. SubSync changed nothing in your CRM.</p>
    </article>
  );
}
