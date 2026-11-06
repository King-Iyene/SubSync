"use client";

import { Check, Copy, PhoneCall, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dialPlan } from "@/lib/people/dial";
import { DEFAULT_SCRIPT, fillScript, keyOf, nextIndex, noteFor, OUTCOMES, quietWarning, sessionSummary, skipReason, taskFor, type DialOutcome, type Logged, type QueueItem } from "@/lib/dial/dial";
import type { Action } from "@/lib/ghl/workbench";
import { useApiClient, useData } from "../session";
import { EmptyState, ErrorState, InlineAlert, SkeletonRows, useDialer } from "../ds";
import { announceCall } from "../ds/dial-button";
import { InfoTip } from "../ds/info-tip";
import { fmtMoney } from "../ui";

// Call mode (stage DIAL, docs/features/DIAL.md): a power dialer without telephony. The call is placed in the customer's own CRM phone; SubSync orders the list, shows the lead, and logs how the
// call went (its own record, plus a short note and for "call back later" a task through the one write gateway: a dry run until writes are switched on).

type Queue = { list: string; lists: Array<{ id: string; label: string; help: string }>; total: number; ownOnly: boolean; me: string | null; items: QueueItem[] };
type Stats = { people: Array<{ userId: string; name: string; calls: number; perHour: number | null; outcomes: Record<string, number> }>; own: boolean };
type Ctx = { mode: { live: boolean; demo: boolean }; tags: string[]; deals: Array<{ id: string; name: string | null; stageName: string | null; value: number; status: string }>; me: string | null };
type Story = { events: Array<{ at: number; kind: string; text: string }> };

const BIG = "ds-press inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-card px-4 text-[15px] font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "ds-press inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50";
const LABELS: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));
const when = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function DialMode() {
  const [list, setList] = useState("missed");
  const queue = useData<Queue>(`dial/queue?list=${encodeURIComponent(list)}`);
  const stats = useData<Stats>("dial/stats");
  // The session: the list is frozen when it starts, so the order never shuffles under the caller's hands.
  const [session, setSession] = useState<S | null>(null);

  const start = (items: QueueItem[]) => {
    const first = nextIndex(items, -1, new Set());
    setSession({ items, idx: first, done: new Set(), logged: [], skips: 0, finished: first === -1 });
  };

  if (session) return <Session s={session} setS={setSession} onExit={() => { setSession(null); void queue.reload(); void stats.reload(); }} me={queue.data?.me ?? null} />;

  const d = queue.data;
  const blocked = d ? d.items.filter((i) => skipReason(i)).length : 0;
  const ready = d ? d.items.length - blocked : 0;
  return (
    <section aria-label="Call mode" data-testid="dial-pick" className="ds-enter">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Call mode</h2>
        <InfoTip label="How calling works here" testId="dial-how" text="Calls go through your CRM's own phone, with your own number and provider. SubSync costs nothing extra for calling: it puts the people in order, shows who you are about to call, and writes down how each call went." />
      </div>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">Pick a list, press Start, and work down it one person at a time. SubSync never places a call.</p>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Choose a list">
        {(d?.lists ?? [{ id: "missed", label: "Missed calls, no callback", help: "" }]).map((l) => (
          <button key={l.id} type="button" onClick={() => setList(l.id)} aria-pressed={list === l.id} title={l.help} data-testid={`dial-list-${l.id}`}
            className={`ds-press min-h-11 rounded-full border px-4 text-sm font-medium sm:min-h-9 ${list === l.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}>{l.label}</button>
        ))}
      </div>
      {queue.error ? <ErrorState error={queue.error} onRetry={queue.reload} /> : !d ? <SkeletonRows rows={3} label="Building your call list..." /> : d.items.length === 0 ? (
        <EmptyState title={list === "missed" ? "No missed calls to call back" : "Nobody to call on this list"} body={d.ownOnly ? "Nobody assigned to you is waiting on this list. Pick another list." : "Nothing is waiting here right now. Pick another list, or check back after the next sync."} />
      ) : (
        <div className="rounded-xl border bg-card p-4" data-testid="dial-ready">
          <p className="text-base font-medium" data-testid="dial-count">{ready} {ready === 1 ? "person" : "people"} ready to call{d.total > d.items.length ? `, the top ${d.items.length} of ${d.total}` : ""}.</p>
          <p className="mt-1 text-sm text-muted-foreground">Ordered by the money riding on each person and how fresh they are.{blocked > 0 ? ` ${blocked} will be skipped (asked not to be contacted, or no phone number).` : ""}{d.ownOnly ? " Only people assigned to you." : ""}</p>
          <button type="button" className={`${PRIMARY} mt-4 w-full sm:w-auto`} onClick={() => start(d.items)} disabled={ready === 0} data-testid="dial-start">Start calling</button>
        </div>
      )}
      {stats.data && stats.data.people.length > 0 && (
        <div className="mt-6" data-testid="dial-stats">
          <h3 className="mb-1 text-sm font-semibold">{stats.data.own ? "Your calls in the last 12 hours" : "Calls logged in the last 12 hours"}</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {stats.data.people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"><span className="font-medium">{p.name}</span><span>{p.calls} {p.calls === 1 ? "call" : "calls"}</span>{p.perHour !== null && <span>{p.perHour} an hour</span>}
                <span className="text-muted-foreground">{Object.entries(p.outcomes).map(([k, n]) => `${n} ${(LABELS[k] ?? k).toLowerCase()}`).join(", ")}</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type S = { items: QueueItem[]; idx: number; done: Set<string>; logged: Logged[]; skips: number; finished: boolean };
function Session({ s, setS, onExit, me }: { s: S; setS: (f: (p: S | null) => S | null) => void; onExit: () => void; me: string | null }) {
  const api = useApiClient();
  const { choice } = useDialer();
  const item = s.idx >= 0 ? s.items[s.idx] : null;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [writeCrm, setWriteCrm] = useState(true);
  const [callback, setCallback] = useState<string | null>(null);
  const [okQuiet, setOkQuiet] = useState(false);
  const [copied, setCopied] = useState(false);

  const ctx = useData<Ctx>(item ? `workbench/context?locationId=${item.locationId}&contactId=${item.contactId}` : null);
  const story = useData<Story>(item ? `speed?part=story&loc=${item.locationId}&contact=${item.contactId}` : null);
  const scriptQ = useData<{ script: string | null; default: string; canEdit: boolean }>(item ? `dial/script?locationId=${item.locationId}` : null);
  const [draft, setDraft] = useState<{ loc: string; text: string } | null>(null);
  const localKey = item ? `subsync.dial.script.${item.locationId}` : "";
  const stored = (() => { try { return localKey ? window.localStorage.getItem(localKey) : null; } catch { return null; } })();
  const script = draft && item && draft.loc === item.locationId ? draft.text : scriptQ.data?.script ?? stored ?? DEFAULT_SCRIPT;

  const warn = item ? quietWarning(item.timeZone, new Date()) : null;
  const plan = item ? dialPlan(choice, { phone: item.phone, contactUrl: item.url }) : null;
  const key = item ? keyOf(item) : "";
  const shown = useMemo(() => (item ? fillScript(script, { name: item.name, me: ctx.data?.me ?? me, business: item.locationName }) : ""), [item, script, ctx.data?.me, me]);

  const advance = useCallback((from: number, logged: Logged[], done: Set<string>, skipsAdd: number) => {
    const n = nextIndex(s.items, from, done);
    setS((p) => (p ? { ...p, idx: n, logged, done, skips: p.skips + skipsAdd, finished: n === -1 } : p));
    setCallback(null); setOkQuiet(false); setDraft(null);
  }, [s.items, setS]);

  const crmWrite = async (it: QueueItem, outcome: DialOutcome, at: string | null): Promise<string> => {
    const base = { locationId: it.locationId, contactId: it.contactId };
    const acts: Action[] = [{ kind: "note", text: noteFor(outcome, at) }];
    const t = taskFor(outcome, it.name, at, new Date());
    if (t) acts.push({ kind: "task", title: t.title, dueDate: t.dueDate });
    let dry = false;
    try {
      for (const action of acts) {
        const pv = await api.post<{ plan: { blockers: Array<{ text: string }> } }>("workbench/preview", { ...base, action });
        if (pv.plan.blockers.length) return `Not written to your CRM: ${pv.plan.blockers[0].text}`;
        const r = await api.post<{ dryRun?: boolean }>("workbench/do", { ...base, action, confirm: true, ack: [] });
        if (r.dryRun) dry = true;
      }
    } catch (e) { return `Not written to your CRM: ${(e as Error).message}`; }
    return dry ? "Dry run: your CRM was not changed (writing is switched off)." : acts.length > 1 ? "Note and task saved in your CRM." : "Note saved in your CRM.";
  };

  const record = useCallback(async (outcome: DialOutcome, at: string | null) => {
    if (!item || busy) return;
    setBusy(true); setErr(null);
    try { await api.post("dial/outcome", { locationId: item.locationId, contactId: item.contactId, outcome, ...(at ? { callbackAt: at } : {}) }); }
    catch (e) { setErr((e as Error).message); setBusy(false); return; }
    const crm = writeCrm ? await crmWrite(item, outcome, at) : "Saved in SubSync only.";
    setStatus(`${item.name}: ${LABELS[outcome]}. ${crm}`);
    const logged = [...s.logged, { outcome, at: Date.now() }];
    const done = new Set(s.done); done.add(key);
    advance(s.idx, logged, done, 0);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, busy, api, writeCrm, s, key, advance]);

  const pick = (o: DialOutcome) => { if (o === "call_back") { setCallback((c) => c ?? new Date(Date.now() + 86_400_000 - (new Date().getTimezoneOffset() * 60_000)).toISOString().slice(0, 16)); } else void record(o, null); };
  const skip = useCallback(() => { if (item && !busy) { const done = new Set(s.done); done.add(key); advance(s.idx, s.logged, done, 1); setStatus(`Skipped ${item.name}.`); } }, [item, busy, s, key, advance]);

  // Keyboard: N skips to the next person, 1 to 7 are the outcomes. Ignored while typing.
  const latest = useRef({ pick, skip, callback });
  useEffect(() => { latest.current = { pick, skip, callback }; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || latest.current.callback !== null) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); latest.current.skip(); return; }
      const o = OUTCOMES.find((x) => x.hot === e.key);
      if (o) { e.preventDefault(); latest.current.pick(o.key); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (s.finished || !item) return <Finish s={s} onExit={onExit} />;

  const total = s.items.length;
  const position = Math.min(total, s.done.size + 1);
  const copy = async () => { try { await navigator.clipboard.writeText(item.phone ?? ""); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("Copy this number", item.phone ?? ""); } };
  const callNow = () => { if (plan?.href) { window.open(plan.href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); announceCall(); } };
  const events = (story.data?.events ?? []).slice(-5).reverse();
  const open = (ctx.data?.deals ?? []).filter((x) => x.status === "open");
  const mode = ctx.data?.mode;

  return (
    <section aria-label="Calling" data-testid="dial-session" className="ds-enter mx-auto max-w-2xl">
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between text-sm"><span className="font-medium" data-testid="dial-progress-text">{position} of {total}</span><button type="button" onClick={onExit} className="min-h-9 text-muted-foreground underline" data-testid="dial-end">End session</button></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position} aria-label="Progress through the list"><div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round((position / total) * 100)}%` }} /></div>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {status && <p className="mb-2 text-sm text-muted-foreground" data-testid="dial-status">{status}</p>}
      {err && <InlineAlert tone="danger" className="mb-2">{err}</InlineAlert>}

      <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6" data-testid="dial-card" key={key}>
        <p className="text-sm text-muted-foreground">{item.locationName ?? "Your account"}</p>
        <h3 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl" data-testid="dial-name">{item.name}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-2xl font-semibold tabular-nums tracking-wide sm:text-3xl" data-testid="dial-phone">{item.phone}</span>
          <button type="button" onClick={() => void copy()} className={BIG} data-testid="dial-copy">{copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="dial-why">{item.reasons.slice(0, 2).join(". ")}{item.openValue > 0 ? `. ${fmtMoney(item.openValue)} in open deals.` : ""}</p>

        {warn && (
          <div className="mt-3 rounded-lg border-l-4 border-warning bg-warning/10 p-3 text-sm" role="alert" data-testid="dial-quiet">
            <p>{warn}</p>
            {!okQuiet && <button type="button" onClick={() => setOkQuiet(true)} className="mt-1 min-h-9 font-medium underline" data-testid="dial-quiet-ok">I understand, show the call button</button>}
          </div>
        )}
        <div className="mt-4">
          {plan?.href ? (
            <button type="button" onClick={callNow} disabled={!!warn && !okQuiet} className={`${PRIMARY} w-full sm:w-auto`} data-testid="dial-call"><PhoneCall aria-hidden className="size-5" />{plan.label}</button>
          ) : <p className="text-sm text-muted-foreground">{plan?.note}</p>}
          <p className="mt-1 text-xs text-muted-foreground" data-testid="dial-call-note">{plan?.note} <InfoTip label="How calling works here" text="Calls go through your CRM's own phone, with your own number and provider. SubSync costs nothing extra for calling." /></p>
        </div>

        <details className="mt-4 border-t pt-3" open data-testid="dial-script">
          <summary className="min-h-9 cursor-pointer text-sm font-medium">Call script</summary>
          <p className="mt-1 whitespace-pre-wrap text-sm" data-testid="dial-script-text">{shown}</p>
          <ScriptEditor loc={item.locationId} value={script} canEdit={scriptQ.data?.canEdit !== false} onChange={(t) => setDraft({ loc: item.locationId, text: t })} onSaved={(t) => { try { window.localStorage.setItem(localKey, t); } catch { /* the script stays on screen */ } void scriptQ.reload(); }} />
        </details>

        <div className="mt-4 border-t pt-3 text-sm" data-testid="dial-story">
          <p className="mb-1 font-medium">Their story</p>
          {ctx.loading && !ctx.data ? <p className="text-muted-foreground">Loading...</p> : (
            <>
              {(ctx.data?.tags.length ?? 0) > 0 && <p className="mb-1 flex flex-wrap gap-1.5">{ctx.data!.tags.slice(0, 8).map((t) => <span key={t} className="rounded-full border px-2 py-0.5 text-xs">{t}</span>)}</p>}
              {open.length > 0 && <p className="mb-1">{open.slice(0, 3).map((x) => `${x.name ?? "Deal"}${x.stageName ? ` (${x.stageName})` : ""}, ${fmtMoney(x.value)}`).join("; ")}</p>}
              {events.length > 0 ? <ul className="space-y-0.5 text-muted-foreground">{events.map((e, i) => <li key={i}>{when(e.at)}: {e.text}</li>)}</ul> : <p className="text-muted-foreground">No earlier touches recorded.</p>}
            </>
          )}
        </div>

        <div className="mt-5 border-t pt-4">
          <p className="mb-2 text-sm font-medium">How did the call go?</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="dial-outcomes">
            {OUTCOMES.map((o) => (
              <button key={o.key} type="button" disabled={busy} onClick={() => pick(o.key)} className={`${BIG} justify-between ${o.key === "dnc" ? "col-span-2 sm:col-span-1" : ""}`} data-testid={`dial-outcome-${o.key}`} aria-keyshortcuts={o.hot}>
                <span>{o.label}</span><kbd className="hidden rounded border px-1.5 text-xs text-muted-foreground sm:inline">{o.hot}</kbd>
              </button>
            ))}
          </div>
          {callback !== null && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border p-3" data-testid="dial-callback">
              <label className="text-sm">Call back at<input type="datetime-local" value={callback} onChange={(e) => setCallback(e.target.value)} className="mt-1 block min-h-11 rounded-md border bg-background px-2" data-testid="dial-callback-time" /></label>
              <button type="button" disabled={busy || !callback} onClick={() => void record("call_back", new Date(callback).toISOString())} className={PRIMARY} data-testid="dial-callback-save">Save and next</button>
              <button type="button" onClick={() => setCallback(null)} className="min-h-11 px-2 underline">Cancel</button>
            </div>
          )}
          <label className="mt-3 flex min-h-9 items-start gap-2 text-sm"><input type="checkbox" checked={writeCrm} onChange={(e) => setWriteCrm(e.target.checked)} className="mt-1 size-4" data-testid="dial-write-crm" />
            <span>Also write a short note to your CRM{mode ? (mode.live ? "." : ". Writing is switched off, so this is a dry run and nothing in your CRM changes.") : "."}</span></label>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={skip} disabled={busy} className={BIG} data-testid="dial-skip"><SkipForward aria-hidden className="size-4" />Skip<kbd className="hidden rounded border px-1.5 text-xs text-muted-foreground sm:inline">N</kbd></button>
            <p className="hidden text-xs text-muted-foreground sm:block">Keys: N skip, 1 to 7 outcomes</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScriptEditor({ loc, value, canEdit, onChange, onSaved }: { loc: string; value: string; canEdit: boolean; onChange: (t: string) => void; onSaved: (t: string) => void }) {
  const api = useApiClient();
  const [msg, setMsg] = useState<string | null>(null);
  if (!canEdit) return null;
  const save = async () => {
    try { await api.put("dial/script", { locationId: loc, script: value }); setMsg("Saved for this account."); onSaved(value); }
    catch (e) { setMsg((e as Error).message); onSaved(value); }
  };
  return (
    <div className="mt-2">
      <label className="text-xs text-muted-foreground" htmlFor="dial-script-edit">Edit the script for this account. {"{name}"}, {"{me}"} and {"{business}"} are filled in.</label>
      <textarea id="dial-script-edit" value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" data-testid="dial-script-edit" />
      <button type="button" onClick={() => void save()} className="min-h-9 text-sm font-medium underline" data-testid="dial-script-save">Save script</button>
      {msg && <span className="ml-2 text-xs text-muted-foreground" role="status">{msg}</span>}
    </div>
  );
}

function Finish({ s, onExit }: { s: S; onExit: () => void }) {
  const skipped = s.skips + s.items.filter((i) => skipReason(i)).length;
  const sum = sessionSummary(s.logged, skipped);
  const tile = (n: string | number, label: string, id: string) => <div className="rounded-lg border p-3 text-center"><p className="text-2xl font-semibold tabular-nums" data-testid={id}>{n}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
  return (
    <section className="mx-auto max-w-xl text-center" aria-label="Session summary" data-testid="dial-summary">
      <div className="dial-pop mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden><Check className="size-8" /></div>
      <h2 className="text-2xl font-semibold tracking-tight">{sum.calls === 0 ? "Session ended" : "Nice work. The list is done."}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{sum.calls === 0 ? "No calls were logged this time." : `${sum.calls} ${sum.calls === 1 ? "call" : "calls"} logged${sum.perHour !== null ? `, about ${sum.perHour} an hour` : ""}.`}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile(sum.calls, "calls", "sum-calls")}{tile(sum.reached, "reached", "sum-reached")}{tile(sum.booked, "booked", "sum-booked")}{tile(`${sum.minutesSaved} min`, "saved (estimate)", "sum-minutes")}
      </div>
      {sum.skipped > 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="sum-skipped">{sum.skipped} skipped.</p>}
      <button type="button" onClick={onExit} className={`${PRIMARY} mt-5`} data-testid="dial-done">Back to the lists</button>
    </section>
  );
}
