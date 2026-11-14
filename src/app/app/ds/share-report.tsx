"use client";

import { useCallback, useEffect, useState } from "react";
import { REPORT_SHARE_CHOICES, REPORT_SHARE_DEFAULT_DAYS, expiryWords, type ReportDocInput, type ReportKind } from "@/lib/report-share";
import { useApiClient } from "../session";
import { Btn } from "../ui";

// "Share report": makes a read-only link to a frozen copy of what this report shows, on our own address (not the CRM's). The person chooses how long it lasts and whether names are
// included (hidden by default), copies the link, and sees every link they have made for this kind of report with a button to switch each one off. Only owners and administrators get the button.
type Link = { id: string; url: string; title: string; kind: string; namesIncluded: boolean; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean; views: number };
const short = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The visible print button of a report screen. The browser's print dialog is also where "Save as PDF" is; the page switches to light colours for paper by itself (print-support.tsx). */
export function PrintPdfButton({ label = "Download PDF / Print" }: { label?: string }) {
  return <span className="print:hidden" data-noprint><Btn onClick={() => window.print()} testId="print-pdf-btn" title="Opens your browser's print window. Choose Save as PDF there to download it.">{label}</Btn></span>;
}

export function ShareReport({ kind, build, canShare = true }: { kind: ReportKind; build: () => ReportDocInput | null; canShare?: boolean }) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number>(REPORT_SHARE_DEFAULT_DAYS);
  const [names, setNames] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => { api.get<{ links: Link[] }>(`report-share?kind=${kind}`).then((r) => setLinks(r.links)).catch(() => setLinks([])); }, [api, kind]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open && canShare) load(); }, [open, canShare, load]);
  if (!canShare) return null;

  const create = async () => {
    const doc = build();
    if (!doc) { setError("There is nothing to share yet. Wait for the numbers to load."); return; }
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await api.post<{ url: string; expiresAt: string }>("report-share", { kind, doc, includeNames: names, days });
      setMade(r); load();
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Could not create the link. Nothing was shared."); } finally { setBusy(false); }
  };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setNote("Link copied."); } catch { window.prompt("Copy this link", url); } };
  const revoke = async (id: string) => {
    setConfirming(null);
    try { await api.post("report-share/revoke", { id }); setNote("Link switched off. Anyone who opens it now sees nothing."); if (made?.url.endsWith(id)) setMade(null); load(); } catch { setError("Could not switch it off. Try again."); }
  };
  const active = (links ?? []).filter((l) => !l.revoked && !l.expired);

  return (
    <div className="relative print:hidden" data-noprint data-testid="share-report">
      <Btn onClick={() => { setOpen((v) => !v); setMade(null); setError(null); setNote(null); }} testId="share-report-btn">Share report</Btn>
      {open && (
        <div role="group" aria-label="Share report" className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] space-y-3 rounded-xl border bg-card p-4 text-sm shadow-[var(--shadow-lift)]">
          <p className="text-muted-foreground">Makes a link to a read-only copy of this report as it is right now. The figures in it do not update, and it opens without signing in.</p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`share-days-${kind}`} className="font-medium">Link works for</label>
            <select id={`share-days-${kind}`} value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border bg-card px-2 py-1.5">
              {REPORT_SHARE_CHOICES.map((d) => <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} className="mt-1" />
            <span>Include names of people and client accounts<span className="block text-xs text-muted-foreground">Off by default. Names are replaced with &quot;Client account 1&quot; and the like.</span></span></label>
          <Btn variant="primary" onClick={() => void create()} disabled={busy} testId="share-report-create">{busy ? "Creating link..." : "Create link"}</Btn>
          <div aria-live="polite" className="min-h-5">
            {error && <p role="alert" className="text-destructive">{error}</p>}
            {note && <p className="text-muted-foreground">{note}</p>}
          </div>
          {made && (
            <div className="space-y-2 rounded-lg border p-2" data-testid="share-report-made">
              <input readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label="Report link" className="w-full rounded-md border bg-card px-2 py-1.5 text-xs" />
              <div className="flex flex-wrap gap-2"><Btn onClick={() => void copy(made.url)}>Copy link</Btn><a href={made.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-lg border bg-card px-3.5 py-1.5 font-medium hover:bg-accent/50">Open</a></div>
              <p className="text-xs text-muted-foreground">Works until {short(made.expiresAt)}. Switch it off below at any time.</p>
            </div>
          )}
          <div>
            <p className="mb-1 font-medium">Links you have made</p>
            {links === null ? <p className="text-xs text-muted-foreground">Loading...</p> : active.length === 0 ? <p className="text-xs text-muted-foreground">None are open right now.</p> : (
              <ul className="divide-y rounded-lg border" data-testid="share-report-list">
                {active.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
                    <span className="min-w-0 text-xs"><span className="block truncate font-medium">{l.title}</span>
                      <span className="text-muted-foreground">Made {short(l.createdAt)}, {expiryWords(new Date(l.expiresAt))}, opened {l.views} {l.views === 1 ? "time" : "times"}{l.namesIncluded ? ", names shown" : ""}</span></span>
                    <span className="flex gap-1">
                      <Btn onClick={() => void copy(l.url)}>Copy</Btn>
                      {confirming === l.id ? <Btn variant="primary" onClick={() => void revoke(l.id)}>Yes, switch off</Btn> : <Btn onClick={() => setConfirming(l.id)}>Switch off</Btn>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
