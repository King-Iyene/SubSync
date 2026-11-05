"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, useApiClient } from "../session";
import { Skeleton } from "../ds";
import { WhatIs } from "../ds/what-is";
import { fmtInt } from "../ui";

// The list of email leads under Growth: one person once per client (the same rules as the counters above), newest first, with a search, a client filter and a download of
// exactly what is on screen. People marked do not contact or unsubscribed stay in the list, marked, and are left out of the download. Server: src/lib/api/growth-emails.ts.

type Row = { id: string; locationId: string; client: string; name: string; email: string; source: string | null; at: number; dnd: boolean; url: string };
type Res = { total: number; doNotContact: number; page: number; pageSize: number; rows: Row[]; clients: Array<{ id: string; name: string }> };
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const field = "min-h-9 rounded-[4px] border border-[var(--t-rule2)] bg-[var(--t-raise)] px-2 py-1 text-sm outline-none hover:border-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

export function EmailLeads() {
  const api = useApiClient();
  const [typed, setTyped] = useState(""), [q, setQ] = useState(""), [client, setClient] = useState(""), [page, setPage] = useState(1);
  const [res, setRes] = useState<Res | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [typed]);
  const query = `q=${encodeURIComponent(q)}&client=${encodeURIComponent(client)}`;
  const load = useCallback(async () => {
    setError(null);
    try { setRes(await api.get<Res>(`today/growth/emails?${query}&page=${page}`)); }
    catch (e) { setError(e instanceof ApiError && e.status !== 500 ? e.message : "The email list could not be read. Please try again."); }
  }, [api, query, page]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const download = async () => {
    setBusy(true); setSaveError(null);
    try { await api.download(`today/growth/emails?${query}&format=csv`, "email-leads.csv"); }
    catch (e) { setSaveError(e instanceof ApiError ? e.message : "The download did not work. Please try again."); }
    finally { setBusy(false); }
  };
  const pages = res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  return (
    <section aria-labelledby="growth-emails-h" className="mb-10" data-testid="email-leads">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div><h3 id="growth-emails-h" className="t-title">Email leads <WhatIs text="Every person counted as an email lead, one per client, with where they came from and when they were added. You can search and download the list." /></h3>
          <p className="t-small t-quiet mt-0.5">One person once per client, newest first.</p></div>
        <button type="button" onClick={() => void download()} disabled={busy || !res || res.total === 0} data-testid="emails-download"
          className="ds-press inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm font-medium hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"><Download aria-hidden className="size-4" />{busy ? "Preparing" : "Download CSV"}</button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search email, name or source" aria-label="Search email leads" className={`${field} w-64 max-w-full`} data-testid="emails-search" />
        {res && res.clients.length > 1 && (
          <select value={client} onChange={(e) => { setClient(e.target.value); setPage(1); }} aria-label="Show one client" className={`${field} cursor-pointer`} data-testid="emails-client">
            <option value="">All clients</option>{res.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {res && <span className="t-small t-quiet" data-testid="emails-count">{fmtInt(res.total)} {res.total === 1 ? "person" : "people"}{q || client ? " match" : ""}</span>}
      </div>
      {error && <p className="t-small mb-2" role="alert">{error} <button type="button" className="ds-press cursor-pointer underline underline-offset-4" onClick={() => void load()}>Try again</button></p>}
      {saveError && <p className="t-small mb-2" role="alert">{saveError}</p>}
      {!res && !error && <div role="status" aria-busy="true" aria-label="Loading email leads"><Skeleton className="h-32 w-full" /></div>}
      {res && res.total === 0 && <p className="t-small t-quiet" data-testid="emails-none">{q || client ? "Nobody matches. Try another word or all clients." : "No email leads yet."}</p>}
      {res && res.total > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="emails-table">
              <thead><tr className="t-label border-b border-[var(--t-rule2)]"><th className="py-2 pr-3 font-normal">Email</th><th className="py-2 pr-3 font-normal">Name</th><th className="py-2 pr-3 font-normal">Client</th><th className="py-2 pr-3 font-normal">Source</th><th className="py-2 text-right font-normal">Added</th></tr></thead>
              <tbody>{res.rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--t-rule)] last:border-0" data-testid="emails-row">
                  <td className="max-w-[16rem] truncate py-2 pr-3">{r.email}{r.dnd && <span className="t-small t-quiet ml-2" title="Marked do not contact or unsubscribed. Left out of the download.">Do not contact</span>}</td>
                  <td className="max-w-[12rem] truncate py-2 pr-3">{r.name}</td><td className="max-w-[12rem] truncate py-2 pr-3">{r.client}</td>
                  <td className="max-w-[10rem] truncate py-2 pr-3">{r.source || "No source recorded"}</td><td className="t-num py-2 text-right whitespace-nowrap">{day(r.at)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 t-small">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="ds-press h-8 cursor-pointer rounded-[4px] border border-[var(--t-rule2)] px-2.5 disabled:cursor-not-allowed disabled:opacity-40" data-testid="emails-prev">Previous</button>
            <span className="t-quiet" aria-live="polite">Page {page} of {fmtInt(pages)}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="ds-press h-8 cursor-pointer rounded-[4px] border border-[var(--t-rule2)] px-2.5 disabled:cursor-not-allowed disabled:opacity-40" data-testid="emails-next">Next</button>
          </div>
          <p className="t-small t-quiet mt-2">The download has everyone who matches, not only this page.{res.doNotContact > 0 ? ` ${fmtInt(res.doNotContact)} marked do not contact or unsubscribed ${res.doNotContact === 1 ? "is" : "are"} left out of it.` : ""}</p>
        </>
      )}
    </section>
  );
}
