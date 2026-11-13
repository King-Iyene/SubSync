"use client";

import { useEffect, useState } from "react";
import { useApiClient, useData } from "../../session";

// Settings, Integrations, AI: which team and client AI jobs are on for which client account, the writing tone, and whether lead names show on the lead stories page. This sits under the connection card.
// A job runs only when every switch allows it: the feature, the connection's own job switch above, and the choice here. Coaching notes and meeting summaries are opt-in: they stay off until switched on.

type Job = { id: string; title: string; optIn: boolean; on?: boolean };
type Tone = { id: string; label: string };
type Row = { locationId: string; name: string; jobs: Record<string, boolean>; effectiveJobs: Record<string, boolean>; leadNames: boolean | null };
type Prefs = { rows: Row[]; total: number; size: number; company: { jobs: Record<string, boolean>; leadNames: boolean | null; tone: string | null }; jobs: Job[]; tones: Tone[]; level: "all" | "account" | "self" };
type Status = { flags: Record<string, boolean>; jobs: Job[] };

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed.");

export function TeamAiSettings() {
  const api = useApiClient();
  const status = useData<Status>("ai-team?part=status");
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [page, setPage] = useState(0), [rev, setRev] = useState(0), [note, setNote] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const prefs = useData<Prefs>(status.data ? `ai-team?${new URLSearchParams({ part: "prefs", q: dq, page: String(page), v: String(rev) })}` : null);
  if (status.error || !status.data || !prefs.data) return null;
  const p = prefs.data, live = p.jobs.filter((j) => status.data?.jobs.find((s) => s.id === j.id)?.on);
  if (live.length === 0) return null;
  const save = async (location: string, patch: Record<string, unknown>) => {
    setNote(null);
    try { await api.post("ai-team/act/prefs", { location, ...patch }); setRev((n) => n + 1); } catch (e) { setNote(msg(e)); }
  };
  const company = p.level === "all";
  const defaultOf = (j: Job) => p.company.jobs[j.id] ?? !j.optIn;
  const pages = Math.max(1, Math.ceil(p.total / p.size));
  return (
    <section className="mt-6" aria-labelledby="ai-team-h" data-testid="ai-team-settings">
      <h3 id="ai-team-h" className="text-sm font-semibold">Team and client AI jobs</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">Choose which AI jobs may run for which client account. They write words around figures SubSync worked out; you read and send everything yourself. Coaching notes and meeting summaries are opt-in and stay off until you switch them on. Lead names are never sent to the AI.</p>
      {company && (
        <div className="mt-3 grid gap-2 rounded-xl border p-3" data-testid="ai-team-company">
          <p className="text-sm font-medium">For all client accounts (each account can differ below)</p>
          <label className="flex items-center gap-2 text-sm">Writing tone
            <select className="ap-field" value={p.company.tone ?? "plain"} onChange={(e) => void save("", { tone: e.target.value })} data-testid="ai-team-tone">{p.tones.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          {live.map((j) => (
            <label key={j.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={defaultOf(j)} onChange={(e) => void save("", { jobs: { [j.id]: e.target.checked } })} data-testid={`ai-team-default-${j.id}`} />
              <span><b>{j.title}</b>{j.optIn ? " (opt-in)" : ""}</span></label>
          ))}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={p.company.leadNames === true} onChange={(e) => void save("", { leadNames: e.target.checked })} data-testid="ai-team-default-names" /><span><b>Show lead names</b> on the lead stories page (the page you print for a client). The AI never sees them.</span></label>
        </div>
      )}
      <div className="mt-3">
        <label className="grid gap-1 text-sm font-medium">Find a client account<input className="ap-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="ai-team-search" /></label>
        <div className="ap-scroll mt-2">
          <table className="ap-t" data-testid="ai-team-table"><thead><tr><th>Client account</th>{live.map((j) => <th key={j.id}>{j.title}</th>)}<th>Lead names</th><th /></tr></thead>
            <tbody>{p.rows.map((r) => (
              <tr key={r.locationId} data-testid="ai-team-row">
                <td>{r.name}</td>
                {live.map((j) => <td key={j.id}><input type="checkbox" aria-label={`${j.title} for ${r.name}`} checked={r.effectiveJobs[j.id] === true} onChange={(e) => void save(r.locationId, { jobs: { [j.id]: e.target.checked } })} /></td>)}
                <td><input type="checkbox" aria-label={`Show lead names for ${r.name}`} checked={r.leadNames ?? p.company.leadNames === true} onChange={(e) => void save(r.locationId, { leadNames: e.target.checked })} /></td>
                <td>{(Object.keys(r.jobs).length > 0 || r.leadNames !== null) && <button type="button" className="ap-link" onClick={() => void save(r.locationId, { jobs: Object.fromEntries(Object.keys(r.jobs).map((k) => [k, null])), leadNames: null })}>Use the default</button>}</td>
              </tr>
            ))}</tbody></table>
        </div>
        {pages > 1 && <p className="mt-2 flex items-center gap-2 text-sm"><button type="button" className="ap-link" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>Page {page + 1} of {pages}<button type="button" className="ap-link" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></p>}
        <p aria-live="polite" className="mt-1 min-h-5 text-sm text-red-600">{note}</p>
      </div>
    </section>
  );
}
