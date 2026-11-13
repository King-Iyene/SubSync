"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApiClient, useData } from "../../session";
import { printReport } from "../pr/actions";

// Printing from here shows only this page, and printing the report shows only the report, even when both are open.
const PRINT_CSS = "@media print { html:not([data-lead-printing]) body > .lead-portal.pr-portal { display: none !important; } html[data-lead-printing] body > .pr-portal:not(.lead-portal) { display: none !important; } }";
function printLeads() {
  const root = document.documentElement;
  root.setAttribute("data-lead-printing", "");
  const done = () => { root.removeAttribute("data-lead-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  printReport();
  setTimeout(done, 1600);
}

// Clients, Proof: "What happened to each lead". One account's recent leads, each with its recorded journey in plain words (when it arrived, how fast a person replied, any booking, how it ended),
// for the agency to show a client who says the leads are bad. Every fact comes from our own records. The AI only writes the one sentence per lead, from facts labelled L1, L2 and so on: it never
// sees a name, email or phone number. Names show on this page only when the account opted in (Settings, AI). You print it or copy it yourself; there is no public link and nothing is sent to anyone.

type Row = { contactId: string; name: string | null; arrivedOn: string; firstReplyMinutes: number | null; inTarget: boolean | null };
type Page = { rows: Row[]; total: number; page: number; size: number; targetMinutes: number; account: string; names: boolean; jobOn: boolean; days: number; stories: string[]; aiLines: boolean[]; note: string | null };
type Wrote = { ok: boolean; stories?: string[]; aiLines?: boolean[]; error?: string };
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed.");

function PrintCopy({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const el = document.createElement("div"); el.className = "pr-portal lead-portal"; document.body.appendChild(el); setHost(el); return () => { el.remove(); }; }, []);
  return host ? createPortal(children, host) : null;
}

export function LeadStoriesButton({ locationId, accountName, sample }: { locationId: string; accountName: string; sample: boolean }) {
  const status = useData<{ flags: { leads: boolean } }>(sample ? null : "ai-team?part=status");
  const [open, setOpen] = useState(false);
  if (sample || status.error || !status.data?.flags.leads) return null;
  return (
    <div className="print:hidden mt-3" data-testid="pr-leads">
      <button type="button" className="s6-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="pr-leads-btn">{open ? "Hide the lead stories" : "What happened to each lead"}</button>
      {open && <LeadStories locationId={locationId} accountName={accountName} />}
    </div>
  );
}

function LeadStories({ locationId, accountName }: { locationId: string; accountName: string }) {
  const api = useApiClient();
  const [days, setDays] = useState(30), [page, setPage] = useState(0), [rev, setRev] = useState(0);
  const r = useData<Page>(`ai-team?${new URLSearchParams({ part: "leads", account: locationId, days: String(days), page: String(page), v: String(rev) })}`);
  const [wroteFor, setWrote] = useState<(Wrote & { key: string }) | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  const d = r.data, key = `${locationId}:${days}:${page}`, wrote = wroteFor?.key === key ? wroteFor : null;
  if (r.error) return <p className="ap-fine mt-2" role="alert">{r.error.message}</p>;
  if (!d) return <p className="ap-fine mt-2">Loading the leads...</p>;
  const stories = wrote?.stories ?? d.stories, ai = wrote?.aiLines ?? d.aiLines;
  const label = (row: Row, i: number) => (d.names && row.name ? row.name : `Lead ${page * d.size + i + 1}`);
  const textOf = () => [`What happened to each lead: ${accountName}`, `Leads that arrived in the last ${d.days} days (page ${d.page + 1})`, "", ...d.rows.map((row, i) => `${label(row, i)}: ${stories[i] ?? ""}`)].join("\n");
  const write = async () => {
    setBusy(true); setNote(null);
    try { const w = await api.post<Wrote>("ai-team/act/lead-stories", { account: locationId, days, page }); if (w.ok) { setWrote({ ...w, key }); setNote("Written. Each sentence only repeats what our records show."); } else setNote(w.error ?? "The AI could not write these."); }
    catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const pages = Math.max(1, Math.ceil(d.total / d.size));
  const table = (
    <table className="ap-t" data-testid="pr-leads-table"><thead><tr><th>Arrived</th><th>Lead</th><th>What happened</th></tr></thead>
      <tbody>{d.rows.map((row, i) => <tr key={row.contactId} data-testid="pr-lead-row"><td>{row.arrivedOn}</td><td>{label(row, i)}</td><td>{stories[i]}{ai[i] ? <span className="ap-fine"> (AI wording)</span> : null}</td></tr>)}</tbody></table>
  );
  return (
    <section className="cl-drill mt-2" aria-label="What happened to each lead" data-testid="pr-leads-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">What happened to each lead: {accountName}</h3>
        <select className="ap-field" aria-label="How far back" value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(0); }}>{[7, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select>
      </div>
      <p className="ap-fine mt-1">Counted from this account&apos;s own records ({d.total.toLocaleString("en-US")} {d.total === 1 ? "lead" : "leads"}; reply target {d.targetMinutes} min). {d.names ? "Lead names are shown because this account allows it." : "Lead names are hidden. You can show them for this account in Settings, AI."} The AI never sees a name, email or phone number.</p>
      {d.note && !wrote && <p className="ap-fine mt-1" role="status" data-testid="pr-leads-note">{d.note} The plain sentences below are written by SubSync from the same records.</p>}
      {d.rows.length === 0 ? <p className="mt-2 text-sm">No leads arrived in this period.</p> : <div className="ap-scroll mt-2">{table}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="s6-btn" disabled={busy || !d.jobOn || d.rows.length === 0} onClick={() => void write()} data-testid="pr-leads-write">Write the one-line stories with AI</button>
        <button type="button" className="s6-btn" disabled={d.rows.length === 0} onClick={() => void navigator.clipboard.writeText(textOf()).then(() => setNote("Copied as text."), () => setNote("Could not copy. Use Print instead."))} data-testid="pr-leads-copy">Copy as text</button>
        <button type="button" className="s6-btn" disabled={d.rows.length === 0} onClick={printLeads} data-testid="pr-leads-print">Download or print (PDF)</button>
        {pages > 1 && <><button type="button" className="ap-link" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button><span className="ap-fine">Page {page + 1} of {pages}</span><button type="button" className="ap-link" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Older</button></>}
        <button type="button" className="ap-link" onClick={() => setRev((n) => n + 1)}>Refresh</button>
      </div>
      {!d.jobOn && <p className="ap-fine mt-1">The AI sentences are switched off for this client account in Settings, AI. The plain sentences still show.</p>}
      <div aria-live="polite" className="mt-1 min-h-5 text-sm" data-testid="pr-leads-msg">{note}</div>
      <PrintCopy>
        <div style={{ fontFamily: "system-ui, sans-serif", color: "#111", padding: 24 }}>
          <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
          <h1 style={{ fontSize: 22 }}>What happened to each lead</h1>
          <p>{accountName}. Leads that arrived in the last {d.days} days. Counted from this account&apos;s own records.</p>
          {table}
          <p style={{ fontSize: 12, marginTop: 16 }}>These facts describe the past and are not a promise about the future.</p>
        </div>
      </PrintCopy>
    </section>
  );
}
