"use client";

import { useEffect, useState } from "react";
import { useApiClient, useData } from "../../session";

// Clients, Proof: the AI-written summary of one monthly client report. SubSync works out every figure; the AI only writes the words around them and a check throws away any answer with a figure
// we did not give it. What it writes is a DRAFT FOR YOUR REVIEW: it is never shown to a client. You read it, change anything, and choose to use it; only then does it appear in the report you copy,
// print or share. SubSync does not send reports to your client for you: you share them yourself.

type State = { draft: string | null; draftAt: string | null; summary: string | null; summaryAt: string | null; builtAt: string | null; ready: boolean; jobOn: boolean; tone: string; shared: boolean };
type Run = { ok: boolean; text?: string; error?: string; code?: string };
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed.");

export function SummaryBlock({ locationId, month, sample, refreshKey, onChange }: { locationId: string; month: string; sample: boolean; refreshKey: number; onChange: (summary: string | null) => void }) {
  const api = useApiClient();
  const [rev, setRev] = useState(0);
  const st = useData<State>(sample ? null : `ai-team?${new URLSearchParams({ part: "report", account: locationId, period: month, v: `${rev}.${refreshKey}` })}`);
  const [text, setText] = useState<string | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  const d = st.data;
  useEffect(() => { if (d) onChange(d.summary); }, [d?.summary]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sample || st.error || !d) return null;

  const shown = text ?? d.draft ?? d.summary ?? "";
  const isDraft = text !== null ? text !== (d.summary ?? "") : d.draft !== null && d.draft !== "";
  const stale = d.summary && d.summaryAt && d.builtAt && Date.parse(d.builtAt) > Date.parse(d.summaryAt);
  const nothingRecorded = d.draft === "" && !d.summary;
  const write = async (fresh: boolean) => {
    setBusy(true); setNote(null);
    try {
      const r = await api.post<Run>("ai-team/act/report-summary", { account: locationId, month, fresh });
      if (r.ok && r.text) { setText(null); setRev((n) => n + 1); setNote("Draft written. Read it, change anything, then choose Use in this report."); } else setNote(r.error ?? "The AI could not write this one.");
    } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const save = async (value: string) => {
    setBusy(true); setNote(null);
    try { await api.post("ai-team/act/save-summary", { account: locationId, month, text: value }); setText(null); setRev((n) => n + 1); setNote(value.trim() ? "Saved. This text is now part of the report you copy, print or share." : "Removed from the report."); }
    catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };

  return (
    <section className="cl-drill print:hidden mt-3" aria-label="AI-written summary" data-testid="pr-ai-summary">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Summary for the report</h3>
        {isDraft && <span className="ap-chip" data-tone="amber" data-testid="pr-ai-draft-chip">Draft for your review</span>}
        {!isDraft && d.summary && <span className="ap-chip" data-tone="green" data-testid="pr-ai-used-chip">In this report</span>}
      </div>
      <p className="ap-fine">The AI writes the words from your recorded figures (tone: {d.tone}). It is never shown to your client until you use it and share the report. SubSync does not send reports to your client for you: you share them yourself.</p>
      {!d.jobOn && <p className="ap-fine mt-1" role="status">This is switched off for this client account in Settings, AI.</p>}
      {!d.ready && !d.summary && <p className="ap-fine mt-1" role="status" data-testid="pr-ai-notready">Not enough has been recorded this month to write a fair summary.</p>}
      {nothingRecorded && <p className="ap-fine mt-1">The draft was skipped because too little was recorded this month.</p>}
      {stale && <p className="ap-fine mt-1" role="status" data-testid="pr-ai-stale">The figures were refreshed after this summary was written. Check it again or write a new draft.</p>}
      <textarea className="ap-field mt-2 w-full" style={{ padding: 10, minHeight: 190 }} maxLength={2500} value={shown} disabled={d.shared || busy} onChange={(e) => setText(e.target.value)} aria-label="Summary text, editable" placeholder="No summary yet. Choose Write a draft, or type your own." data-testid="pr-ai-text" />
      {d.shared ? <p className="ap-fine mt-1">This report is shared. Take it back to a draft to change the summary.</p> : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="s6-btn" data-kind={d.draft || d.summary ? undefined : "primary"} disabled={busy || !d.jobOn || !d.ready} onClick={() => void write(Boolean(d.draft || d.summary))} data-testid="pr-ai-write">{d.draft || d.summary ? "Write a new draft" : "Write a draft"}</button>
          <button type="button" className="s6-btn" data-kind="primary" disabled={busy || !shown.trim() || (!isDraft && Boolean(d.summary))} onClick={() => void save(shown)} data-testid="pr-ai-use">Use in this report</button>
          {d.summary && <button type="button" className="ap-link" disabled={busy} onClick={() => void save("")} data-testid="pr-ai-remove">Remove from the report</button>}
        </div>
      )}
      <div aria-live="polite" className="mt-1 min-h-5 text-sm" data-testid="pr-ai-note">{note}</div>
    </section>
  );
}

/** "Draft all summaries" for the month: a few accounts at a time, each kept as a draft to review. Nothing is shared or sent. */
export function DraftAll({ month, onDone }: { month: string; onDone: () => void }) {
  const api = useApiClient();
  const status = useData<{ flags: { report: boolean } }>("ai-team?part=status");
  const [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  if (status.error || !status.data?.flags.report) return null;
  const go = async () => {
    setBusy(true); setNote(null);
    let drafted = 0, skipped = 0;
    try {
      for (let i = 0; i < 60; i++) {
        const r = await api.post<{ drafted: number; skipped: number; remaining: number; stopped: { code: string; message: string } | null }>("ai-team/act/report-summary-all", { month });
        drafted += r.drafted; skipped += r.skipped;
        setNote(`Drafted ${drafted}${r.remaining > 0 ? `, ${r.remaining} to go` : ""}...`);
        if (r.stopped) {
          if (r.stopped.code === "rate") { await new Promise((res) => setTimeout(res, 20_000)); continue; }
          setNote(`${drafted} drafted. Stopped: ${r.stopped.message}`); onDone(); return;
        }
        if (r.remaining <= 0 || (r.drafted === 0 && r.skipped === 0)) break;
      }
      setNote(drafted || skipped ? `Drafted ${drafted} ${drafted === 1 ? "summary" : "summaries"}${skipped ? `, skipped ${skipped} with too little recorded` : ""}. Open each report to read, edit and use it.` : "Nothing to draft. Prepare the reports first, or every report already has a summary.");
      onDone();
    } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="s6-btn" disabled={busy} onClick={() => void go()} data-testid="pr-ai-draft-all">Draft all summaries</button>
      {note && <span className="ap-fine" role="status" data-testid="pr-ai-draft-all-note">{note}</span>}
    </>
  );
}
