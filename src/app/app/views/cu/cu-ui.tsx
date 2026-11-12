"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LocalAccountPicker, OpenLeadButton, SkeletonRows } from "../../ds";
import { useApiClient, useData } from "../../session";
import { fmtInt } from "../../ui";
import { BTN, FIELD, PRIMARY, QUIET, ScoreRing } from "../cleanup-parts";
import { SAMPLE, sampleOn } from "./cu-fixtures";

// Clean-up: the "Fix lists" and "Health" tabs (docs/features/CLEANUP_BRIEF.md). Real data by default; sample data only with ?cufx, labelled. Every count opens exactly its rows, a page is a keyset
// page ("Show more"), protected contacts show why and are never selected, and every change needs the person to TYPE words naming the count. Plain words.

type Opts = {
  flags: { fix: boolean; health: boolean; bulk: boolean; confirm: boolean }; canChange: boolean; switchOn: boolean; accounts: Array<{ id: string; name: string }>;
  kinds: Array<{ id: string; label: string; plain: string; todo: string; group: string; deal: boolean }>; caps: { tag: number; remove: number }; formula: string; notKnown: string; hourly: number;
  rules: { version: string; date: string };
};
type Cell = { n: number; capped: boolean };
type Home = {
  source: "daily" | "live"; day: string | null; accounts: number | null; counts: Record<string, Cell>; contacts: number | null; dealsOpen: number | null; protectedContacts: number | null;
  health: { score: number | null; word: string | null; why: string; evidence: Array<{ id: string; label: string; count: number; share: number; lost: number }>; note: string | null; version: string } | null;
  trend: Array<{ day: string; score: number | null }>; weekly: Array<{ id: string; label: string; count: number; hours: number; dollars: number; todo: string }>; weeklyHours: number; weeklyDollars: number; formula: string;
};
type Row = {
  rowId: string; kind: string; locationId: string; locationName: string | null; contactId: string | null; dealId: string | null; name: string; email: string | null; phone: string | null; owner: string | null;
  source: string | null; dnd: boolean; value: number | null; stage: string | null; since: string | null; protect: string | null; protectWords: string | null; url: string | null;
};
type ListRes = { kind: string; label: string; plain: string; todo: string; total: Cell | null; rows: Row[]; next: string | null; deal: boolean };
type Preview = { requested: number; cap: number; protectedSkipped: number; protectedByReason: Array<{ reason: string; n: number; words: string }>; sample: string[]; phrase: string; mode: "dry_run" | "live"; modeWords: string; irreversible: boolean; warning: string; notKnown: string };
type Api = ReturnType<typeof useApiClient>;

const num = (c: Cell | undefined) => (c ? (c.capped ? `${fmtInt(c.n)}+` : fmtInt(c.n)) : "0");

function useOpts() {
  const fx = sampleOn();
  const live = useData<Opts>(fx ? null : "cu/options");
  return fx ? { data: SAMPLE.options as Opts, error: null, loading: false, reload: () => undefined } : live;
}
const SampleNote = () => (sampleOn() ? <p className="mb-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="cu-sample">Sample data: these are not your real contacts.</p> : null);

function AccountSelect({ opts, value, onChange }: { opts: Opts; value: string | null; onChange: (v: string | null) => void }) {
  if (opts.accounts.length < 2) return null;
  return <LocalAccountPicker accounts={opts.accounts} picked={value ? [value] : []} onChange={(ids) => onChange(ids.length ? ids[ids.length - 1] : null)} label="Client account" />;
}

function Spark({ pts }: { pts: Array<{ day: string; score: number | null }> }) {
  const p = pts.filter((x) => x.score !== null) as Array<{ day: string; score: number }>;
  if (p.length < 2) return <p className="text-sm text-muted-foreground" data-testid="cu-trend-empty">The trend starts after two daily scans. SubSync keeps this record from now on.</p>;
  const w = 320, h = 70, lo = Math.min(...p.map((x) => x.score)) - 5, hi = Math.max(...p.map((x) => x.score)) + 5;
  const d = p.map((x, i) => `${i ? "L" : "M"}${((i / (p.length - 1)) * w).toFixed(1)},${(h - ((x.score - lo) / (hi - lo || 1)) * h).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full max-w-md text-primary" role="img" aria-label={`Health score from ${p[0].score} to ${p[p.length - 1].score} over ${p.length} days`}><path d={d} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

// ------------------------------------------------------------------------------------------ Health
export function HealthTab() {
  const fx = sampleOn(), api = useApiClient();
  const o = useOpts();
  const [acct, setAcct] = useState<string | null>(null);
  const home = useData<Home>(fx ? null : `cu/home${acct ? `?account=${acct}` : ""}`);
  const accs = useData<{ rows: Array<{ locationId: string; name: string | null; score: number | null; word: string | null; why: string; contacts: number }>; total: number }>(fx ? null : "cu/accounts");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const h = (fx ? SAMPLE.home : home.data) as Home | null;
  const rows = fx ? SAMPLE.accounts : accs.data?.rows ?? [];
  const scan = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ scanned: number; pending: number }>("cu/scan", {}); setMsg(`Scanned ${r.scanned} account${r.scanned === 1 ? "" : "s"}${r.pending ? `, ${r.pending} left for the next run` : ""}.`); home.reload(); accs.reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (!fx && home.loading && !home.data) return <SkeletonRows rows={5} label="Loading health..." />;
  if (!fx && home.error) return <ErrorState error={home.error} onRetry={home.reload} />;
  if (!h) return null;
  return (
    <div className="space-y-5" data-testid="cu-health">
      <SampleNote />
      <div className="flex flex-wrap items-center gap-3">
        {o.data && <AccountSelect opts={o.data} value={acct} onChange={setAcct} />}
        {o.data?.canChange && !fx && <button type="button" className={BTN} disabled={busy} onClick={() => void scan()} data-testid="cu-scan">{busy ? "Scanning..." : "Scan now"}</button>}
        {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
      </div>
      {h.source === "live" && <p className="text-sm text-muted-foreground" data-testid="cu-first-scan">The first full scan has not run yet. Numbers are live and stop at 10,000. Press Scan now, or wait for tonight.</p>}
      {h.health && (
        <section className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-[auto_1fr]" aria-label="Health score">
          <ScoreRing score={h.health.score} word={h.health.word} label="Contact list health" testId="cu-score" />
          <div className="space-y-3">
            <p className="text-base" data-testid="cu-why">{h.health.why}</p>
            <ul className="space-y-1 text-sm" data-testid="cu-evidence">{h.health.evidence.map((e) => <li key={e.id}><b>{fmtInt(e.count)}</b> {e.label.toLowerCase()} <span className="text-muted-foreground">({(e.share * 100).toFixed(1)}% of records, costs {e.lost} points)</span></li>)}</ul>
            <Spark pts={h.trend} />
            <p className="text-xs text-muted-foreground">Score rules {h.health.version}, {o.data?.rules.date ?? ""}. Each problem costs points, up to the full amount when a quarter of the records are affected.</p>
          </div>
        </section>
      )}
      <section aria-label="What to clean this week" data-testid="cu-weekly">
        <h3 className="text-base font-semibold">What to clean this week</h3>
        {h.weekly.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to clean right now.</p> : (
          <>
            <p className="text-sm text-muted-foreground">About {h.weeklyHours} hours of work, roughly ${fmtInt(h.weeklyDollars)} at ${o.data?.hourly ?? 25} an hour. <i>Estimate.</i> <span title={h.formula}>How is this worked out?</span></p>
            <ol className="mt-2 divide-y rounded-xl border bg-card">{h.weekly.map((w) => <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span><b>{fmtInt(w.count)}</b> {w.label.toLowerCase()}<span className="block text-muted-foreground">{w.todo}</span></span><span className="text-muted-foreground">{w.hours} h</span></li>)}</ol>
          </>
        )}
      </section>
      <section aria-label="Client accounts, worst first">
        <h3 className="text-base font-semibold">Client accounts, worst first</h3>
        {rows.length === 0 ? <EmptyState title="No scores yet" body="Scores appear after the first scan." /> : (
          <ul className="mt-2 divide-y rounded-xl border bg-card" data-testid="cu-accounts">{rows.map((r) => (
            <li key={r.locationId}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-accent/50" onClick={() => setAcct(r.locationId)}>
              <span className="min-w-0"><b>{r.name ?? "Unnamed account"}</b><span className="block text-muted-foreground">{r.why}</span></span>
              <span className="whitespace-nowrap"><b>{r.score ?? "n/a"}</b> {r.word ?? "not enough data"}</span></button></li>
          ))}</ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{o.data?.notKnown}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ Fix lists
function TypedConfirm({ kind, account, action, onDone, onCancel }: { kind: string; account: string; action: "tag" | "remove"; onDone: () => void; onCancel: () => void }) {
  const api = useApiClient();
  const [p, setP] = useState<Preview | null>(null), [typed, setTyped] = useState(""), [err, setErr] = useState<string | null>(null), [res, setRes] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { void api.post<Preview>("cu/bulk", { step: "preview", kind, action, account }).then(setP).catch((e: Error) => setErr(e.message)); }, [api, kind, action, account]);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<{ message: string }>("cu/bulk", { step: "do", kind, action, account, typed }); setRes(r.message); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={action === "remove" ? "Remove contacts" : "Tag contacts"} className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" data-testid="cu-confirm">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-auto rounded-xl border bg-card p-5">
        <h3 className="text-lg font-semibold">{action === "remove" ? "Remove these contacts?" : "Tag these contacts?"}</h3>
        {!p && !err && <SkeletonRows rows={3} label="Checking..." />}
        {p && !res && (
          <>
            <p className="text-sm"><b>{p.requested}</b> {p.requested === 1 ? "contact" : "contacts"} will be {action === "remove" ? "removed" : "tagged"} (at most {p.cap} per run). {p.sample.length > 0 && <span className="text-muted-foreground">For example: {p.sample.join(", ")}.</span>}</p>
            {p.protectedSkipped > 0 && <div className="rounded-lg border px-3 py-2 text-sm" data-testid="cu-protected"><b>{p.protectedSkipped} left out, protected:</b><ul className="list-disc pl-5">{p.protectedByReason.map((r) => <li key={r.reason}>{r.n}: {r.words}</li>)}</ul></div>}
            <p className="text-sm font-medium">{p.warning}</p>
            <p className="text-sm text-muted-foreground">{p.modeWords}</p>
            <p className="text-xs text-muted-foreground">{p.notKnown}</p>
            {p.requested > 0 && <label className="block text-sm">To go on, type <code className="rounded bg-muted px-1" data-testid="cu-phrase">{p.phrase}</code><input className={`${FIELD} mt-1 w-full`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="cu-typed" /></label>}
          </>
        )}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        {res && <p className="text-sm" role="status" data-testid="cu-result">{res}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={QUIET} onClick={onCancel}>{res ? "Close" : "Cancel"}</button>
          {p && !res && p.requested > 0 && <button type="button" className={PRIMARY} disabled={busy || typed.trim().toLowerCase() !== p.phrase.toLowerCase()} onClick={() => void go()} data-testid="cu-go">{action === "remove" ? "Remove" : "Tag"}</button>}
        </div>
      </div>
    </div>
  );
}

export function FixTab() {
  const fx = sampleOn(), api = useApiClient();
  const o = useOpts();
  const [acct, setAcct] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const home = useData<Home>(fx ? null : `cu/home${acct ? `?account=${acct}` : ""}`);
  const h = (fx ? SAMPLE.home : home.data) as Home | null;
  if (!fx && home.loading && !home.data) return <SkeletonRows rows={6} label="Counting..." />;
  if (!fx && home.error) return <ErrorState error={home.error} onRetry={home.reload} />;
  if (!o.data || !h) return null;
  const opts = o.data;
  const groups = [...new Set(opts.kinds.map((k) => k.group))];
  return (
    <div className="space-y-5" data-testid="cu-fix">
      <SampleNote />
      <div className="flex flex-wrap items-center gap-3"><AccountSelect opts={opts} value={acct} onChange={(v) => { setAcct(v); setKind(null); }} /></div>
      {kind === null ? groups.map((g) => (
        <section key={g} aria-label={g}>
          <h3 className="text-sm font-semibold text-muted-foreground">{g}</h3>
          <ul className="mt-2 divide-y rounded-xl border bg-card">{opts.kinds.filter((k) => k.group === g).map((k) => (
            <li key={k.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/50" onClick={() => setKind(k.id)} data-testid={`cu-kind-${k.id}`}>
              <span className="min-w-0"><b>{k.label}</b><span className="block text-sm text-muted-foreground">{k.plain}</span></span>
              <span className="text-lg font-semibold tabular-nums" data-testid={`cu-count-${k.id}`}>{num(h.counts[k.id])}</span></button></li>
          ))}</ul>
        </section>
      )) : <KindList key={`${kind}-${acct}`} kind={kind} acct={acct} opts={opts} fx={fx} api={api} onBack={() => setKind(null)} />}
      <p className="text-xs text-muted-foreground">{opts.notKnown}</p>
    </div>
  );
}

function KindList({ kind, acct, opts, fx, api, onBack }: { kind: string; acct: string | null; opts: Opts; fx: boolean; api: Api; onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([]), [next, setNext] = useState<string | null>(null), [meta, setMeta] = useState<ListRes | null>(null), [err, setErr] = useState<Error | null>(null), [loading, setLoading] = useState(true), [confirm, setConfirm] = useState<"tag" | "remove" | null>(null);
  const q = useCallback((after: string | null) => `cu/list?kind=${kind}${acct ? `&account=${acct}` : ""}${after ? `&after=${encodeURIComponent(after)}` : ""}`, [kind, acct]);
  const load = useCallback(async (after: string | null) => {
    setLoading(true);
    try {
      const r = fx ? (SAMPLE.list(kind) as unknown as ListRes) : await api.get<ListRes>(q(after));
      if (!after) setMeta(r);
      setRows((x) => (after ? [...x, ...r.rows] : r.rows)); setNext(r.next); setErr(null);
    } catch (e) { setErr(e as Error); } finally { setLoading(false); }
  }, [api, fx, kind, q]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(null); }, [load]);
  const info = opts.kinds.find((k) => k.id === kind);
  const protectedCount = useMemo(() => rows.filter((r) => r.protect).length, [rows]);
  const isContact = info ? !info.deal : true;
  return (
    <div className="space-y-3" data-testid="cu-list">
      <button type="button" className={QUIET} onClick={onBack}>Back to all lists</button>
      <div>
        <h3 className="text-lg font-semibold">{info?.label}</h3>
        <p className="text-sm text-muted-foreground">{info?.plain} {info?.todo}</p>
        {meta?.total && <p className="mt-1 text-sm" data-testid="cu-total"><b>{num(meta.total)}</b> in total. Showing {fmtInt(rows.length)}{meta.total.capped ? " (the count stops at 10,000)" : ""}.</p>}
      </div>
      {opts.flags.bulk && opts.canChange && isContact && acct && !fx && rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => setConfirm("tag")} data-testid="cu-tag">Tag these for review</button>
          {kind === "junk" && <button type="button" className={BTN} onClick={() => setConfirm("remove")} data-testid="cu-remove">Remove junk contacts</button>}
        </div>
      )}
      {opts.flags.bulk && opts.canChange && isContact && !acct && opts.accounts.length > 1 && <p className="text-xs text-muted-foreground">Choose one client account to tag or remove. Bulk changes never cross accounts.</p>}
      {err && <ErrorState error={err} onRetry={() => void load(null)} />}
      {!err && !loading && rows.length === 0 && <EmptyState title="Nothing here" body="No contacts match. That is good." />}
      <ul className="divide-y rounded-xl border bg-card">{rows.map((r) => (
        <li key={r.rowId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm" data-testid="cu-row">
          <span className="min-w-0"><b>{r.name}</b>{r.locationName && <span className="text-muted-foreground"> in {r.locationName}</span>}
            <span className="block text-muted-foreground">{[r.email, r.phone, r.stage, r.value !== null ? `$${fmtInt(r.value)}` : null].filter(Boolean).join(" | ") || "No details"}</span>
            {r.protectWords && <span className="block text-xs font-medium" data-testid="cu-protect-row">Protected: {r.protectWords}</span>}</span>
          <OpenLeadButton seed={r.contactId ? { contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, email: r.email, phone: r.phone, dnd: r.dnd, url: r.url ?? undefined } : null} crmUrl={r.url} reason={r.contactId ? null : "No person is linked to this deal."} name={r.name} />
        </li>
      ))}</ul>
      {protectedCount > 0 && <p className="text-xs text-muted-foreground">{protectedCount} on this page are protected and can never be removed in bulk.</p>}
      {loading && <SkeletonRows rows={2} label="Loading..." />}
      {next && !loading && <button type="button" className={BTN} onClick={() => void load(next)} data-testid="cu-more">Show more</button>}
      {confirm && acct && <TypedConfirm kind={kind} account={acct} action={confirm} onCancel={() => setConfirm(null)} onDone={() => void load(null)} />}
    </div>
  );
}
