"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { bulkMergePhrase, deletePhrase, mergePhrase, previewLine } from "@/lib/dq/dq-core";
import { DELETE_BLOCKED_WHY } from "@/lib/dq/dupe-copies";
import { CopiesPanel, CopiesToggle, ProtectedBadge, WhyDisabled } from "./dq-copies";
import { DeleteExtras, MergeTable } from "./dq-merge";
import { EmptyState, ErrorState, LocalAccountPicker, SkeletonRows } from "../../ds";
import { InfoTip } from "../../ds/info-tip";
import { useApiClient } from "../../session";
import { fmtInt } from "../../ui";
import { BTN, FIELD, QUIET } from "../cleanup-parts";
import { sampleOn, SAMPLE, useDq, type DupeDetail, type DupesRes, type GroupRow, type Opts, type Tier } from "./dq-data";

// DUPLICATES, as data not prose. A group is one compact ROW: the person, what matched (a small badge, the reason on hover), how many copies, and three buttons: Merge, Not the same, Delete extras.
// Merge opens a side-by-side TABLE (columns = the copies, rows = Name, Phone, Email, Owner, Source, Tags, Created) with the suggested keeper already chosen and one button. Three tabs, certain first.
// Protected people (Do Not Disturb, an open deal, a coming appointment) are shown with the reason and are never deleted or merged in bulk. Delete and bulk merge need typed words naming what goes.

const Q_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary";
const P_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const D_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border border-destructive/40 bg-card px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-destructive";

export function DupesTab({ opts, account, setAccount }: { opts: Opts; account: string | null; setAccount: (v: string | null) => void }) {
  const api = useApiClient();
  const [tier, setTier] = useState<Tier>("certain");
  type S = { key: string; rows: GroupRow[]; next: string | null; counts: DupesRes["counts"]; err: Error | null };
  const [bulk, setBulk] = useState(false), [note, setNote] = useState<string | null>(null), [res, setRes] = useState<S | null>(null), [nonce, setNonce] = useState(0), [more, setMore] = useState(false);
  const fx = sampleOn();
  const query = `tier=${tier}${account ? `&account=${account}` : ""}`;
  const key = `${query}|${nonce}`;
  useEffect(() => {
    let off = false;
    const run = fx ? Promise.resolve(SAMPLE.dupes(tier)) : api.get<DupesRes>(`dq/dupes?${query}`);
    run.then((r) => { if (!off) setRes((p) => ({ key, rows: r.rows, next: r.next, counts: r.counts ?? p?.counts ?? null, err: null })); }).catch((e: Error) => { if (!off) setRes((p) => ({ key, rows: [], next: null, counts: p?.counts ?? null, err: e })); });
    return () => { off = true; };
  }, [api, query, tier, fx, key]);
  const cur = res && res.key === key ? res : null;
  const rows = cur?.rows ?? [], next = cur?.next ?? null, err = cur?.err ?? null, busy = !cur || more, counts = res?.counts ?? null;
  const showMore = async () => {
    if (!next) return;
    setMore(true);
    try { const r = await api.get<DupesRes>(`dq/dupes?${query}&after=${encodeURIComponent(next)}`); setRes((p) => (p ? { ...p, rows: [...p.rows, ...r.rows], next: r.next } : p)); } catch (e) { setRes((p) => (p ? { ...p, err: e as Error } : p)); } finally { setMore(false); }
  };
  const gone = (k: string, msg: string) => { setRes((p) => (p ? { ...p, rows: p.rows.filter((r) => r.key !== k) } : p)); setNote(msg); setNonce((n) => n + 1); };
  const tiers: Tier[] = ["certain", "likely", "possible"];
  const total = counts ? counts.certain.groups + counts.likely.groups + counts.possible.groups : null;

  return (
    <div className="space-y-4" data-testid="dq-dupes">
      {fx && <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="dq-sample">Sample data: these are not your real contacts.</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-semibold tabular-nums" data-testid="dq-dupes-total">{total === null ? "…" : fmtInt(total)}</p>
          <p className="text-sm text-muted-foreground">groups{counts ? ` · ${fmtInt(counts.certain.extra + counts.likely.extra + counts.possible.extra)} extra records` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {opts.accounts.length > 1 && <LocalAccountPicker accounts={opts.accounts} picked={account ? [account] : []} onChange={(ids) => setAccount(ids.length ? ids[ids.length - 1] : null)} label="Client account" />}
          {opts.canChange && counts && counts.certain.groups > 0 && <button type="button" className={Q_BTN} onClick={() => setBulk((b) => !b)} data-testid="dq-bulk-open">Merge all certain matches ({fmtInt(counts.certain.groups)})</button>}
        </div>
      </div>
      {bulk && <BulkMerge account={account} onClose={() => setBulk(false)} onDone={(m) => { setBulk(false); setNote(m); setNonce((n) => n + 1); }} />}
      {note && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status" data-testid="dq-note">{note}</p>}

      <div role="tablist" aria-label="How sure" className="flex gap-1 border-b">
        {tiers.map((t) => {
          const info = opts.tiers.find((x) => x.id === t);
          return (
            <button key={t} type="button" role="tab" aria-selected={tier === t} onClick={() => setTier(t)} data-testid={`dq-tier-${t}`}
              className={`ds-press -mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${tier === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {info?.label ?? t}<span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{counts ? fmtInt(counts[t].groups) : "…"}</span>
            </button>
          );
        })}
        <span className="ml-auto self-center pr-1"><InfoTip text={opts.tiers.find((x) => x.id === tier)?.hint ?? ""} label="What this tab means" /></span>
      </div>

      {err ? <ErrorState error={err} onRetry={() => setNonce((n) => n + 1)} /> : busy && rows.length === 0 ? <SkeletonRows rows={5} label="Loading duplicates..." /> : rows.length === 0 ? (
        <EmptyState title={tier === "certain" ? "No certain duplicates" : `No ${tier} duplicates`} body="Nothing to merge here. SubSync checks again every night." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="dq-dupe-rows">
          {rows.map((g) => <GroupItem key={`${g.locationId}:${g.key}`} g={g} opts={opts} onGone={gone} multi={opts.accounts.length > 1} />)}
        </ul>
      )}
      {next && <button type="button" className={BTN} disabled={busy} onClick={() => void showMore()} data-testid="dq-dupes-more">{busy ? "Loading..." : "Show more"}</button>}
      <p className="text-xs text-muted-foreground">{opts.notKnown}</p>
    </div>
  );
}

function GroupItem({ g, opts, onGone, multi }: { g: GroupRow; opts: Opts; onGone: (key: string, msg: string) => void; multi: boolean }) {
  const api = useApiClient();
  const [mode, setMode] = useState<"merge" | "delete" | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false), panelId = useId();
  const first = g.people[0];
  const ids = g.people.map((p) => p.contactId);
  const label = g.shared && g.shared !== first.name ? g.shared : "";
  const notSame = async () => {
    setBusy(true); setErr(null);
    try { if (!sampleOn()) await api.post("dq/decide", { locationId: g.locationId, contactIds: ids, decision: "not_duplicate" }); onGone(g.key, `Remembered: ${first.name} and the other record are not the same person. They will not come back.`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const allExtrasProtected = g.people.slice(1).every((p) => p.protect);
  return (
    <li data-testid="dq-dupe-row" data-tier={g.tier}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-2 text-sm"><b className="truncate">{first.name}</b>
            <span className="rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs" data-testid="dq-badge" title={g.why[0] ?? ""}>{g.badge}</span>
            <CopiesToggle g={g} open={show} onToggle={() => setShow((s) => !s)} panelId={panelId} />
            {g.protectedCount > 0 && <ProtectedBadge />}
          </p>
          <p className="truncate text-xs text-muted-foreground">{[label, multi ? g.locationName : ""].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={P_BTN} aria-expanded={mode === "merge"} onClick={() => setMode(mode === "merge" ? null : "merge")} data-testid="dq-merge">Merge</button>
          <button type="button" className={Q_BTN} disabled={busy} onClick={() => void notSame()} data-testid="dq-notsame">Not the same</button>
          {opts.canChange && <WhyDisabled disabled={allExtrasProtected} why={DELETE_BLOCKED_WHY}><button type="button" className={D_BTN} disabled={allExtrasProtected} title={allExtrasProtected ? DELETE_BLOCKED_WHY : "Delete the other copies"} aria-expanded={mode === "delete"} onClick={() => setMode(mode === "delete" ? null : "delete")} data-testid="dq-delete">Delete extras</button></WhyDisabled>}
        </div>
      </div>
      {err && <p className="px-3 pb-2 text-sm text-destructive" role="alert">{err}</p>}
      {show && <CopiesPanel g={g} panelId={panelId} />}
      {mode === "merge" && <MergeTable g={g} onGone={onGone} />}
      {mode === "delete" && <DeleteExtras g={g} onGone={onGone} />}
    </li>
  );
}


function BulkMerge({ account, onClose, onDone }: { account: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const api = useApiClient();
  const [pv, setPv] = useState<{ ready: number; blocked: number; cap: number; phrase: string; mode: "dry_run" | "live"; sample: Array<{ name: string; account: string | null; shared: string | null }>; blockedWhy: Array<{ text: string; n: number }>; note: string } | null>(() => (sampleOn() ? { ready: 5, blocked: 2, cap: 50, phrase: bulkMergePhrase(5), mode: "dry_run" as const, sample: [{ name: "Ann Lee", account: "Sample Roofing", shared: "+1 555 0100" }], blockedWhy: [{ text: "Someone here has an open deal", n: 2 }], note: "Only certain matches, pairs, nobody protected." } : null));
  const [typed, setTyped] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sampleOn()) return;
    void api.post<NonNullable<typeof pv>>("dq/bulk-merge", { step: "preview", account }).then(setPv).catch((e: Error) => setMsg(e.message));
  }, [api, account]);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ message: string }>("dq/bulk-merge", { step: "do", account, typed }); onDone(r.message); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Merge all certain matches" data-testid="dq-bulk">
      {!pv ? <SkeletonRows rows={2} label="Checking the certain matches..." /> : (
        <div className="space-y-2 text-sm">
          <p className="text-base"><b className="tabular-nums">{fmtInt(pv.ready)}</b> pairs ready to merge · <span className="text-muted-foreground">{fmtInt(pv.blocked)} left for you to check · up to {pv.cap} at a time</span></p>
          {pv.sample.length > 0 && <p className="text-muted-foreground">e.g. {pv.sample.map((s) => `${s.name}${s.shared ? ` (${s.shared})` : ""}`).join(", ")}</p>}
          {pv.blockedWhy.length > 0 && <ul className="list-disc pl-5 text-xs text-muted-foreground">{pv.blockedWhy.map((w) => <li key={w.text}>{w.n} × {w.text}</li>)}</ul>}
          <p className="text-xs text-muted-foreground">{pv.note}</p>
          {pv.mode === "dry_run" && <p className="text-xs text-muted-foreground">Not switched on yet: this shows the plan and changes nothing.</p>}
          {pv.ready > 0 && (
            <div className="flex flex-wrap items-end gap-2"><div><label htmlFor="dq-bulk-t" className="mb-1 block text-xs text-muted-foreground">Type <b>{pv.phrase}</b> to confirm</label><input id="dq-bulk-t" className={`${FIELD} w-64`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div>
              <button type="button" className={P_BTN} disabled={busy || typed.trim().toLowerCase() !== pv.phrase.toLowerCase()} onClick={() => void go()} data-testid="dq-bulk-go">{busy ? "Sending..." : `Merge ${pv.ready}`}</button></div>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-destructive" role="alert">{msg}</p>}
      <button type="button" className={`${QUIET} mt-2`} onClick={onClose}>Close</button>
    </section>
  );
}
