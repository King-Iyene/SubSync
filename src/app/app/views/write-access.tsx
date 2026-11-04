"use client";

import { useState } from "react";
import { InlineAlert, Section } from "../ds";
import { useApiClient, useData } from "../session";
import { BTN, FIELD, PRIMARY, QUIET } from "./cleanup-parts";

// "Changing contacts" (stage CLEANUP): the per-account opt-in for letting SubSync fix details and start merges in a client's CRM account. OFF for every account until a person
// switches it on here. Even when it is on, SubSync shows each change before it happens, needs a deliberate confirm, and sends nothing while the server's master switch is off.
// This card is drawn in Settings, Integrations, and at the bottom of the Clean-up rules.

type Acc = { locationId: string; name: string; preset: string; source: string; writeEnabled: boolean };
type Data = { ready: { rules: boolean }; demo: boolean; masterSwitchOn: boolean; accounts: { rows: Acc[]; page: number; pages: number; total: number; from: number; to: number } };

export function WriteAccessCard({ embedded = false }: { embedded?: boolean }) {
  const api = useApiClient();
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useData<Data>(`cleanup/rules?ap=${page}&aq=${encodeURIComponent(q)}`);
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = async (id: string, enabled: boolean) => {
    setBusy(true); setProblem(null);
    try { await api.post("cleanup/write", { locationId: id, enabled }); setAsking(null); await reload(); } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };

  const body = (
    <div data-testid="write-access">
      <p className="mb-3 text-sm text-muted-foreground">
        SubSync can fix phone formats, names and emails, change tags and start a merge in a client&apos;s CRM account, but only for a client you allow here. It always shows every change first, needs your confirm, keeps the old value so a fix can be undone, and writes each change to the history.
        {data ? (data.masterSwitchOn ? " Sending is on." : " Sending is switched off on the server right now, so even an allowed client is only a dry run: nothing reaches your CRM.") : ""}
      </p>
      {problem && <div className="mb-3"><InlineAlert tone="danger" onDismiss={() => setProblem(null)}>{problem}</InlineAlert></div>}
      {!data && loading ? <p className="text-sm text-muted-foreground">Loading...</p> : error ? <InlineAlert tone="danger">{error.message}</InlineAlert> : data && (
        <>
          {!data.ready.rules && <div className="mb-3"><InlineAlert tone="warning">This switch is not available yet: SubSync is finishing an update, so every client stays off.</InlineAlert></div>}
          {data.accounts.total > 8 && <input type="search" className={`${FIELD} mb-2 w-full sm:w-64`} placeholder="Find a client" aria-label="Find a client" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />}
          <ul data-testid="write-accounts">
            {data.accounts.rows.map((a) => (
              <li key={a.locationId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5" data-testid="write-row">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground" data-testid="write-state">{a.writeEnabled ? "SubSync may change this client's contacts, after you confirm each change." : "Off. SubSync only reads this client's contacts."}</p>
                  {asking === a.locationId && !a.writeEnabled && (
                    <div className="mt-2 border-l-2 border-warning py-1 pl-3 text-sm" role="group" aria-label={`Allow changes for ${a.name}`}>
                      <p>Allow SubSync to change {a.name}&apos;s contacts? It will ask you to preview and confirm every change.</p>
                      <div className="mt-2 flex gap-2"><button type="button" className={PRIMARY} disabled={busy} onClick={() => void set(a.locationId, true)} data-testid="write-confirm">Allow</button><button type="button" className={QUIET} onClick={() => setAsking(null)}>Cancel</button></div>
                    </div>
                  )}
                </div>
                {a.writeEnabled
                  ? <button type="button" className={BTN} disabled={busy} onClick={() => void set(a.locationId, false)} data-testid="write-off">Stop<span className="sr-only"> changing {a.name}</span></button>
                  : <button type="button" className={BTN} disabled={busy || !data.ready.rules} onClick={() => setAsking(a.locationId)} data-testid="write-on">Allow<span className="sr-only"> changes for {a.name}</span></button>}
              </li>
            ))}
          </ul>
          {data.accounts.pages > 1 && (
            <div className="mt-2 flex items-center justify-between text-sm"><span className="text-xs text-muted-foreground">Showing {data.accounts.from} to {data.accounts.to} of {data.accounts.total}</span>
              <span className="flex gap-2"><button type="button" className={BTN} disabled={data.accounts.page === 0} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className={BTN} disabled={data.accounts.page >= data.accounts.pages - 1} onClick={() => setPage(page + 1)}>Next</button></span></div>
          )}
        </>
      )}
    </div>
  );
  return embedded ? body : <Section title="Changing contacts" hint="Off for every client until you allow it." id="write-access">{body}</Section>;
}
