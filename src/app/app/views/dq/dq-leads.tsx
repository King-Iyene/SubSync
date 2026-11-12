"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorState, OpenLeadButton, SkeletonRows } from "../../ds";
import { portalRoot } from "../../ds/portal-root";
import { useApiClient } from "../../session";
import { fmtInt } from "../../ui";
import { sampleOn, SAMPLE, type LeadRow, type LeadsRes } from "./dq-data";

// Clean-up v2: a side sheet, and the list of people behind any number. The number you clicked and the rows you get are the same set (the server counts and lists with one definition). Keyset
// paging ("Show more"), never an offset. Every row has the shared Open button.

export function Sheet({ title, sub, onClose, children, testId = "dq-sheet" }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    head.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose} data-testid={`${testId}-overlay`}>
      <section role="dialog" aria-modal="true" aria-labelledby="dq-sheet-h" className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l bg-background shadow-xl" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0"><h2 id="dq-sheet-h" ref={head} tabIndex={-1} className="truncate text-base font-semibold outline-none">{title}</h2>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="ds-press inline-flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card hover:bg-accent/50"><X aria-hidden className="size-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </section>
    </div>,
    portalRoot(),
  );
}

const FLAG_WORD: Record<string, string> = { duplicate: "Duplicate", junk: "Junk", answered: "Answered", booked: "Booked", won: "Won" };
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/** The people behind a number. `query` is the part after "dq/leads?" (source, flag, range, account). The parent gives it a key, so a new query is a new list. */
export function LeadsList({ query }: { query: string }) {
  const api = useApiClient();
  type S = { key: string; rows: LeadRow[]; next: string | null; total: LeadsRes["total"]; label: string; err: Error | null };
  const [s, setS] = useState<S | null>(null), [nonce, setNonce] = useState(0), [more, setMore] = useState(false);
  const key = `${query}|${nonce}`;
  useEffect(() => {
    let off = false;
    const run = sampleOn() ? Promise.resolve(SAMPLE.leads) : api.get<LeadsRes>(`dq/leads?${query}`);
    run.then((r) => { if (!off) setS({ key, rows: r.rows, next: r.next, total: r.total, label: r.label, err: null }); }).catch((e: Error) => { if (!off) setS({ key, rows: [], next: null, total: null, label: "", err: e }); });
    return () => { off = true; };
  }, [api, query, key]);
  const cur = s && s.key === key ? s : null;
  const showMore = async () => {
    if (!cur?.next) return;
    setMore(true);
    try { const r = await api.get<LeadsRes>(`dq/leads?${query}&after=${encodeURIComponent(cur.next)}`); setS((p) => (p ? { ...p, rows: [...p.rows, ...r.rows], next: r.next } : p)); } catch (e) { setS((p) => (p ? { ...p, err: e as Error } : p)); } finally { setMore(false); }
  };
  if (cur?.err) return <ErrorState error={cur.err} onRetry={() => setNonce((n) => n + 1)} />;
  if (!cur) return <SkeletonRows rows={6} label="Loading the people..." />;
  const { rows, next, total, label } = cur;
  return (
    <div data-testid="dq-leads">
      <p className="mb-3 text-sm"><b data-testid="dq-leads-total">{total ? `${fmtInt(total.n)}${total.capped ? "+" : ""}` : rows.length}</b> <span className="text-muted-foreground">{label.toLowerCase()}</span></p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nobody here in this range.</p> : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="dq-leads-rows">
          {rows.map((r) => (
            <li key={`${r.locationId}:${r.contactId}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">{[r.source ?? "No source", date(r.createdAt), r.locationName].filter(Boolean).join(" · ")}</p>
                {r.flags.length > 0 && <p className="mt-0.5 flex flex-wrap gap-1">{r.flags.map((f) => <span key={f} className="rounded border px-1.5 text-[11px] text-muted-foreground">{FLAG_WORD[f] ?? f}</span>)}</p>}
              </div>
              <OpenLeadButton seed={{ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, phone: r.phone, email: r.email, owner: r.owner, unassigned: !r.owner, url: r.url, dnd: r.dnd }} crmUrl={r.url} name={r.name} />
            </li>
          ))}
        </ul>
      )}
      {next && <button type="button" disabled={more} onClick={() => void showMore()} className="ds-press mt-3 inline-flex min-h-11 items-center rounded-lg border bg-card px-4 text-sm font-medium hover:bg-accent/50" data-testid="dq-leads-more">{more ? "Loading..." : "Show more"}</button>}
    </div>
  );
}

export type LeadsPick = { title: string; query: string; sub?: string } | null;
export function LeadsSheet({ pick, onClose }: { pick: LeadsPick; onClose: () => void }) {
  if (!pick) return null;
  return <Sheet title={pick.title} sub={pick.sub} onClose={onClose}><LeadsList key={pick.query} query={pick.query} /></Sheet>;
}
