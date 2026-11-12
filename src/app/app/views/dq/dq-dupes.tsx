"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { bulkMergePhrase, deletePhrase, mergePhrase, previewLine } from "@/lib/dq/dq-core";
import { DELETE_BLOCKED_WHY } from "@/lib/dq/dupe-copies";
import { CopiesPanel, CopiesToggle, ProtectedBadge, WhyDisabled } from "./dq-copies";
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

const cell = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");

function MergeTable({ g, onGone }: { g: GroupRow; onGone: (key: string, msg: string) => void }) {
  const api = useApiClient();
  const ids = useMemo(() => g.people.map((p) => p.contactId), [g]);
  const sample = sampleOn();
  const d = useDq<DupeDetail>(sample ? null : `dq/dupe?account=${g.locationId}&ids=${ids.join(",")}`, () => ({
    locationId: g.locationId, locationName: g.locationName, key: g.key, keepId: ids[0], different: false, guard: [], picks: [],
    people: g.people.map((p, i) => ({ contactId: p.contactId, name: p.name, email: p.email, phone: p.phone, tags: i ? ["new"] : ["vip"], createdAt: p.createdAt, source: p.source, ownerName: p.owner, openDeals: p.openDeals, wonDeals: 0, hasConversation: i === 1, url: p.url, protectWords: p.protectWords })),
    workflow: { set: false, optedIn: false, canAsk: true, blockers: [], goneName: g.people[1]?.name ?? null, survivorId: ids[0], switchOn: false },
  }));
  const [keep, setKeep] = useState<string | null>(null), [fields, setFields] = useState(false), [step, setStep] = useState<"idle" | "type" | "manual">("idle"), [typed, setTyped] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const det = d.data;
  const keepId = keep ?? det?.keepId ?? ids[0];
  if (d.loading && !det) return <div className="px-3 pb-4"><SkeletonRows rows={3} label="Loading the copies..." /></div>;
  if (d.error) return <div className="px-3 pb-4"><ErrorState error={d.error} onRetry={d.reload} /></div>;
  if (!det) return null;
  const wf = det.workflow;
  const canWorkflow = wf.set && wf.optedIn && wf.canAsk && wf.blockers.length === 0 && det.people.length === 2 && !det.different;
  const me = det.people.find((p) => p.contactId === keepId)!;
  const others = det.people.filter((p) => p.contactId !== keepId);
  const line = previewLine({ keep: { tags: me.tags }, others: others.map((o) => ({ tags: o.tags, openDeals: o.openDeals, wonDeals: o.wonDeals, appointments: o.appointments, hasConversation: o.hasConversation })) });
  const phrase = mergePhrase(wf.goneName ?? others[0]?.name ?? "");
  const rowsDef: Array<[string, (p: DupeDetail["people"][number]) => string]> = [
    ["Name", (p) => cell(p.name)], ["Phone", (p) => cell(p.phone)], ["Email", (p) => cell(p.email)], ["Owner", (p) => cell(p.ownerName)], ["Source", (p) => cell(p.source)], ["Tags", (p) => cell(p.tags.join(", "))], ["Created", (p) => date(p.createdAt)],
  ];
  const decide = async (decision: "keep" | "merged_in_platform" | "not_duplicate", m: string) => {
    setBusy(true); setMsg(null);
    try { if (!sample) await api.post("dq/decide", { locationId: g.locationId, contactIds: ids, decision, keepContactId: decision === "not_duplicate" ? null : keepId }); onGone(g.key, m); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ ok?: boolean; message?: string; blocked?: boolean }>("duplicates/merge-workflow", { locationId: g.locationId, contactIds: ids, keepContactId: keepId, typed, confirm: true });
      if (r.ok) onGone(g.key, r.message ?? "Sent to your merge workflow.");
      else setMsg(r.message ?? "This one cannot be merged from here.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(`Keep ${me.name} (${me.email ?? "no email"}, ${me.phone ?? "no phone"}). Merge in: ${others.map((o) => o.name).join(", ")}.`); setMsg("Copied."); } catch { setMsg("Could not copy."); } };

  return (
    <div className="border-t bg-muted/20 px-3 py-4" data-testid="dq-merge-table">
      {det.different && <p className="mb-3 text-sm text-destructive" role="alert">These look like different people (a different email and a different phone). Check before you merge.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead><tr><th className="w-24 py-1 text-left text-xs font-medium text-muted-foreground" scope="col"><span className="sr-only">Field</span></th>
            {det.people.map((p) => (
              <th key={p.contactId} scope="col" className="px-2 py-1 text-left align-bottom font-normal">
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name={`keep-${g.key}`} className="size-4" checked={keepId === p.contactId} onChange={() => setKeep(p.contactId)} data-testid={`dq-keep-${p.contactId}`} /><span className="font-semibold">{keepId === p.contactId ? "Keep this one" : "Merge in"}</span></label>
              </th>))}</tr></thead>
          <tbody>
            {rowsDef.map(([label, f]) => {
              const vals = det.people.map(f), differs = new Set(vals.filter((v) => v !== "—")).size > 1;
              return <tr key={label} className="border-t"><th scope="row" className="py-1.5 pr-2 text-left text-xs font-medium text-muted-foreground">{label}</th>{vals.map((v, i) => <td key={i} className={`px-2 py-1.5 ${differs ? "font-medium" : ""} ${v === "—" ? "text-muted-foreground" : ""}`}>{v}</td>)}</tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm" data-testid="dq-preview-line">{line} <InfoTip text="A merge cannot be undone. Conversations, notes and tasks are combined into the kept record; appointments and payments keep the kept record's values." label="What a merge does" /></p>
      {det.guard.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{det.guard.map((t) => <li key={t}>{t}</li>)}</ul>}

      {fields && (
        <div className="mt-3 rounded-lg border bg-card p-3" data-testid="dq-fields">
          <p className="mb-2 text-xs text-muted-foreground">Best value for each field. Pick these in your CRM&apos;s merge screen if the merge is finished there.</p>
          <ul className="space-y-1.5 text-sm">{det.picks.map((p) => <li key={p.field} className="flex flex-wrap gap-x-2"><b className="w-20">{p.label}</b><span>{p.value}</span><span className="text-xs text-muted-foreground">{p.reason}</span></li>)}</ul>
          {det.picks.length === 0 && <p className="text-sm text-muted-foreground">Nothing to choose: the records agree.</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canWorkflow ? (
          <button type="button" className={P_BTN} disabled={busy || det.different} onClick={() => setStep("type")} data-testid="dq-merge-go">Merge into this one</button>
        ) : (
          <button type="button" className={P_BTN} disabled={busy} onClick={() => setStep("manual")} data-testid="dq-merge-go">Merge into this one</button>
        )}
        <button type="button" className={Q_BTN} disabled={busy} onClick={() => void decide("keep", "Both kept. They will not come back.")} data-testid="dq-keepboth">Keep both</button>
        <button type="button" className={QUIET} onClick={() => setFields((f) => !f)} data-testid="dq-choose-fields">{fields ? "Hide fields" : "Choose fields"}</button>
      </div>

      {step === "type" && (
        <div className="mt-3 rounded-lg border bg-card p-3" data-testid="dq-merge-type">
          <label htmlFor={`dq-t-${g.key}`} className="mb-1 block text-xs text-muted-foreground">Type <b>{phrase}</b> to confirm. This cannot be undone.</label>
          <div className="flex flex-wrap gap-2"><input id={`dq-t-${g.key}`} className={`${FIELD} w-64`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <button type="button" className={P_BTN} disabled={busy || typed.trim().toLowerCase() !== phrase.toLowerCase()} onClick={() => void send()} data-testid="dq-merge-confirm">{busy ? "Sending..." : "Merge"}</button></div>
          {!wf.switchOn && <p className="mt-2 text-xs text-muted-foreground">Not switched on yet: SubSync records what it would do and changes nothing.</p>}
        </div>
      )}
      {step === "manual" && (
        <div className="mt-3 rounded-lg border bg-card p-3 text-sm" data-testid="dq-merge-manual">
          <p className="font-medium">Not available from the platform yet.</p>
          <p className="text-muted-foreground">{wf.blockers[0] ?? "The CRM has no merge command SubSync can use. Finish it in your CRM&apos;s own merge screen: open the copies, choose Merge, keep the record you picked."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {det.people.map((p) => <a key={p.contactId} href={p.url} target="_blank" rel="noopener noreferrer" className={Q_BTN}><ExternalLink aria-hidden className="mr-1.5 size-3.5" />Open {p.name.split(" ")[0]}</a>)}
            <button type="button" className={Q_BTN} onClick={() => void copy()}>Copy summary</button>
            <button type="button" className={Q_BTN} disabled={busy} onClick={() => void decide("merged_in_platform", "Marked as merged in your CRM.")} data-testid="dq-merged-done">I merged them</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-muted-foreground" role="status">{msg}</p>}
    </div>
  );
}

function DeleteExtras({ g, onGone }: { g: GroupRow; onGone: (key: string, msg: string) => void }) {
  const api = useApiClient();
  const ids = g.people.map((p) => p.contactId);
  const [keep, setKeep] = useState(ids[0]);
  const sample = sampleOn();
  type Pv = { requested: number; protectedSkipped: number; names: string[]; phrase: string; mode: "dry_run" | "live"; warning: string; notes: string[] };
  const [pv, setPv] = useState<Pv | null>(() => (sample ? { requested: g.people.length - 1, protectedSkipped: 0, names: g.people.slice(1).map((p) => p.name), phrase: deletePhrase(g.people.length - 1, g.people[1]?.name), mode: "dry_run", warning: "This cannot be undone.", notes: [] } : null));
  const [typed, setTyped] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const body = (step: "preview" | "do") => ({ step, locationId: g.locationId, contactIds: ids, keepContactId: keep, ...(step === "do" ? { typed } : {}) });
  useEffect(() => {
    if (sample) return;
    void api.post<Pv>("dq/delete", body("preview")).then(setPv).catch((e: Error) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keep]);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ message: string; mode: string; done: number }>("dq/delete", body("do")); if (r.mode === "live" && r.done > 0) onGone(g.key, r.message); else setMsg(r.message); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="border-t bg-muted/20 px-3 py-4" data-testid="dq-delete-panel">
      <fieldset className="mb-3"><legend className="mb-1 text-xs text-muted-foreground">Keep this one, delete the others</legend>
        <div className="flex flex-wrap gap-3">{g.people.map((p) => <label key={p.contactId} className="flex items-center gap-2 text-sm"><input type="radio" className="size-4" name={`del-${g.key}`} checked={keep === p.contactId} onChange={() => { setKeep(p.contactId); setPv(null); setTyped(""); }} />{p.name}{p.email ? <span className="text-xs text-muted-foreground">{p.email}</span> : null}</label>)}</div>
      </fieldset>
      {!pv ? <SkeletonRows rows={1} label="Checking who can be deleted..." /> : (
        <div className="space-y-2 text-sm">
          <p><b>{fmtInt(pv.requested)}</b> {pv.requested === 1 ? "contact" : "contacts"} will be deleted{pv.names.length ? `: ${pv.names.join(", ")}` : ""}. {pv.warning}</p>
          {pv.protectedSkipped > 0 && <p className="text-muted-foreground">{pv.protectedSkipped} left out because they are protected.</p>}
          {pv.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
          {pv.mode === "dry_run" && <p className="text-xs text-muted-foreground">Not switched on yet: SubSync shows the plan and deletes nothing.</p>}
          {pv.requested > 0 && (
            <div className="flex flex-wrap items-end gap-2"><div><label htmlFor={`dq-d-${g.key}`} className="mb-1 block text-xs text-muted-foreground">Type <b>{pv.phrase}</b> to confirm</label><input id={`dq-d-${g.key}`} className={`${FIELD} w-64`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div>
              <button type="button" className={D_BTN} disabled={busy || typed.trim().toLowerCase() !== pv.phrase.toLowerCase()} onClick={() => void go()} data-testid="dq-delete-confirm">{busy ? "Deleting..." : "Delete"}</button></div>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-muted-foreground" role="status">{msg}</p>}
    </div>
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
