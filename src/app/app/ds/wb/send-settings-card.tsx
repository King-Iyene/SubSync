"use client";

import { useState } from "react";
import { useData } from "../../session";
import { INPUT, wbButtons } from "./runner";
import { SendRules } from "./send-panels";

type AcctRow = { locationId: string; name: string; optedIn: boolean };

/** Settings > Safety > Sending rules: every account with its sending switch (turned on by typing the account name) and its rules. Owners and administrators change; others read. Hidden when sending is not available. */
export function SendingRulesCard() {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const d = useData<{ ready: boolean; canEdit: boolean; masterOn: boolean; killed: boolean; page: number; hasMore: boolean; accounts: AcctRow[] }>(`workbench/send-accounts?ap=${page}&aq=${encodeURIComponent(q)}`);
  const [open, setOpen] = useState<string | null>(null);
  if (d.error || (!d.data && !d.loading)) return null;
  if (!d.data) return <p className="text-sm text-muted-foreground">Loading...</p>;
  const v = d.data;
  return (
    <div id="send-rules-card" data-testid="send-rules-card">
      <p className="mb-3 text-sm text-muted-foreground">Texts and emails from SubSync are off for every account until an owner or administrator turns them on here. Even then, SubSync sends only when a person presses Send after a preview, and never to someone who asked not to be contacted.{!v.masterOn ? " SubSync's own live switch is still off, so for now every send is only recorded as a preview." : ""}</p>
      {!v.ready && <p className="mb-3 text-sm text-muted-foreground">This switch is not available yet: SubSync is finishing an update, so every account stays off.</p>}
      <input type="search" className={`${INPUT} mb-2 !w-full sm:!w-64`} placeholder="Find an account" aria-label="Find an account" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
      <ul>
        {v.accounts.map((a) => (
          <li key={a.locationId} className="border-t py-2.5 text-sm" data-testid="send-account-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{a.name}</span>
              <span className="inline-flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${a.optedIn ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{a.optedIn ? "Sending on" : "Sending off"}</span>
                <button type="button" className={wbButtons.BTN} aria-expanded={open === a.locationId} onClick={() => setOpen(open === a.locationId ? null : a.locationId)}>{open === a.locationId ? "Close" : v.canEdit ? "Open" : "View"}<span className="sr-only"> sending rules for {a.name}</span></button>
              </span>
            </div>
            {open === a.locationId && (v.canEdit
              ? <div className="mt-2 space-y-2"><SendRules locationId={a.locationId} startOpen onChanged={() => void d.reload()} /></div>
              : <p className="mt-2 text-muted-foreground">{a.optedIn ? "Sending is on for this account." : "Sending is off for this account."} Only an owner or administrator can change it.</p>)}
          </li>
        ))}
      </ul>
      {(page > 0 || v.hasMore) && <div className="mt-2 flex gap-2"><button type="button" className={wbButtons.BTN} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className={wbButtons.BTN} disabled={!v.hasMore} onClick={() => setPage(page + 1)}>Next</button></div>}
    </div>
  );
}
