"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shortWords } from "@/lib/analytics/unanswered-v2";
import { useData } from "../session";
import { EmptyState, ErrorState, LeadDrawer, SkeletonRows, type LeadSeed } from "../ds";
import { SidePopup } from "./speed-popup";

// "Find anyone": one search across every client account the person may read, by name, phone, email or client. Server-side and paged (20, 50 or 100); each row says where the person
// stands (waiting for us, new, we replied, gone quiet) and opens the lead panel. It looks only at people who have a conversation, and says so. Read only.

type FindRow = {
  key: string; locationId: string; locationName: string; contactId: string | null; name: string; phone: string | null; email: string | null; channel: string;
  state: "waiting" | "new" | "we_replied" | "quiet"; hours: number; owner: { label: string } | null; dnd: boolean; timeZone: string | null; contactUrl: string;
};
type FindData = { total: number; page: number; pages: number; from: number; to: number; rows: FindRow[] };
const STATE: Record<FindRow["state"], { label: (h: number) => string; tone: string }> = {
  waiting: { label: (h) => `Waiting ${shortWords(h)}`, tone: "amber" }, new: { label: () => "Wrote just now", tone: "cyan" },
  we_replied: { label: () => "We replied", tone: "green" }, quiet: { label: (h) => `Quiet for ${shortWords(h)}`, tone: "violet" },
};
const n = (v: number) => v.toLocaleString("en-US");

export function FindBox({ multi }: { multi: boolean }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState<string | null>(null);
  return (
    <>
      <form role="search" className="ur-find" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 2) setQ(text.trim()); }}>
        <label className="ur-search">
          <Search aria-hidden className="size-4" />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={multi ? "Find anyone in any client" : "Find anyone"} aria-label="Find a person by name, phone or email" className="ur-search-in" data-testid="find-input" />
        </label>
        <button type="submit" className="s6-btn" disabled={text.trim().length < 2} data-testid="find-go">Find</button>
      </form>
      {q && <SidePopup label={`People matching ${q}`} onClose={() => setQ(null)}><FindResults key={q} q={q} multi={multi} /></SidePopup>}
    </>
  );
}

function FindResults({ q, multi }: { q: string; multi: boolean }) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState<20 | 50 | 100>(20);
  const { data, error, loading, reload } = useData<FindData>(`inbox?${new URLSearchParams({ part: "find", q, page: String(page), size: String(size) })}`);
  const [open, setOpen] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const rows = (data?.rows ?? []).filter((r) => r.contactId);
  const seeds: LeadSeed[] = rows.map((r) => ({
    contactId: r.contactId as string, locationId: r.locationId, name: r.name, locationName: r.locationName, url: r.contactUrl, phone: r.phone, email: r.email, dnd: r.dnd, timeZone: r.timeZone,
    owner: r.owner?.label ?? null, unassigned: r.owner === null, note: STATE[r.state].label(r.hours),
  }));
  return (
    <section aria-label={`People matching ${q}`} data-testid="find-results">
      <h2 ref={heading} tabIndex={-1} className="ur-count mt-2" data-testid="find-title">{data ? <><span className="tnum" data-testid="find-count">{n(data.total)}</span> {data.total === 1 ? "person" : "people"} match &ldquo;{q}&rdquo;</> : "Searching..."}</h2>
      <p className="s6-label mb-3">Looks at people who have a conversation, in every client you can see.</p>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={4} label="Searching..." />
        : data.rows.length === 0 ? <EmptyState compact title="Nobody found." body="Try part of a name, the last digits of a phone number, or an email." />
        : (
          <div className={loading ? "opacity-70" : ""}>
            <ul className="ur-list" data-testid="find-rows">
              {data.rows.map((r) => {
                const idx = rows.findIndex((x) => x.key === r.key);
                return (
                  <li key={r.key} className="ur-row ur-row-find">
                    <button type="button" className="ur-main" disabled={!r.contactId} onClick={() => setOpen(idx)} data-testid="find-row">
                      <span className="ur-name">{r.name}</span>
                      <span className="ur-why">{[multi ? r.locationName : null, r.phone, r.email, r.owner ? `Owner ${r.owner.label}` : "No owner"].filter(Boolean).join(" · ")}</span>
                    </button>
                    <span className="ur-chips"><span className="s6-chip" data-tone={STATE[r.state].tone}>{STATE[r.state].label(r.hours)}</span></span>
                  </li>
                );
              })}
            </ul>
            <div className="ur-foot">
              <span className="s6-label" aria-live="polite">{n(data.from)} to {n(data.to)} of {n(data.total)}</span>
              <label className="ur-sel ur-size"><span className="s6-label">Per page</span>
                <select value={size} onChange={(e) => { setSize(Number(e.target.value) as 20 | 50 | 100); setPage(0); }} className="ur-field" aria-label="People per page"><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label>
              {data.pages > 1 && <span className="ur-pager">
                <button type="button" className="s6-btn" disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>Previous</button>
                <span className="tnum s6-label">Page {n(data.page + 1)} of {n(data.pages)}</span>
                <button type="button" className="s6-btn" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)}>Next</button>
              </span>}
            </div>
          </div>
        )}
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </section>
  );
}
