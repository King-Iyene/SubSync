"use client";

import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DataList, EmptyState, ErrorState, SkeletonRows, type Column } from "../ds";
import { BrandIcon } from "../ds/brand-icon";
import { OpenLeadButton } from "../ds/open-lead-button";
import { ApiError, useApiClient, useData } from "../session";
import { BTN, PRIMARY } from "./appointment-actions-ui";
import { FX_COACH, FX_FOLLOW, fxHome, mnFx } from "./meeting-fixtures";
import { whenOf } from "./meeting-list";

// The rest of Meeting notes (slices 1, 2 and 6): the connect strip for the person's own Fathom, the follow-up lists ("held, then nothing happened") and the coaching view.
// A connection belongs to the person who made it (one each, tokens never visible to anyone else); only they can connect, sync or disconnect it. The follow-up lists are the person's own
// calls. Coaching shows counts and averages, never what was said, and an administrator reads only that.

export type Home = {
  demo?: boolean; flags: { followups: boolean; tasks: boolean; coach: boolean; logged: boolean; outcomes: boolean };
  connection: { id: string; status: string; email: string | null; lastOkAt: string | null; lastEventAt: string | null; errorCode: string | null } | null;
  follow: { no_followup: number; no_next_step: number; deal_not_moved: number } | null; waiting: number; week: { held: number; logged: number; noNextStep: number; waiting: number; line: string | null } | null;
};
const errText = (e: unknown) => (e instanceof ApiError ? String(e.body.message ?? e.body.error ?? "Something went wrong") : "Something went wrong. Try again.");
const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export function useMnHome() {
  const fx = mnFx();
  const d = useData<Home>(fx ? null : "meeting-list/home");
  const sample = fx ? (fxHome() as Home) : null;
  return { ...d, data: sample ?? d.data, loading: fx ? false : d.loading, fx };
}

export function ConnectStrip({ home, reload, fx, onShowWeek }: { home: Home; reload: () => void | Promise<unknown>; fx: boolean; /** Opens the Meetings list on exactly the calls the card counts (the last 7 days). */ onShowWeek?: () => void }) {
  const api = useApiClient();
  const c = home.connection;
  const ok = c?.status === "connected";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  // Once Fathom is connected the polling stops; the strip itself then says so.
  useEffect(() => { if (ok && timer.current) { clearInterval(timer.current); timer.current = null; } }, [ok]);

  const connect = async () => {
    setBusy(true); setMsg(null);
    try {
      const { url } = await api.post<{ url: string }>("my-connections/fathom/start");
      const win = window.open(url, "subsync-connect", "width=560,height=720");
      if (!win) { setMsg({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); return; }
      setWaiting(true);
      const t0 = Date.now();
      timer.current = setInterval(() => { if (Date.now() - t0 > 120_000) { if (timer.current) clearInterval(timer.current); setWaiting(false); } else void reload(); }, 2500);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  const sync = async () => { setBusy(true); setMsg(null); try { const r = await api.post<{ message: string }>("meeting-list/sync", {}); setMsg({ ok: true, text: r.message }); await reload(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); } };
  const disconnect = async () => { if (!c) return; setBusy(true); setMsg(null); try { await api.del(`my-connections/${c.id}`); setAsking(false); setTyped(""); setMsg({ ok: true, text: "Disconnected. SubSync no longer has access to your Fathom." }); await reload(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); } };

  return (
    <section aria-label="Your Fathom" className="rounded-xl border bg-card/60 p-3 sm:p-4" data-testid="mn-connect">
      <div className="flex flex-wrap items-center gap-3">
        <BrandIcon id="fathom" size={24} decorative />
        <span aria-hidden className={`size-2.5 rounded-full ${ok ? "bg-emerald-500 shadow-[0_0_10px_#408971]" : c ? "bg-amber-500" : "bg-muted-foreground/50"}`} />
        <div className="min-w-0 flex-1" data-testid="mn-connect-status">
          <p className="text-sm font-semibold">{ok ? "Your Fathom is connected" : c ? (c.status === "needs_reconnect" ? "Your Fathom needs to be connected again" : "Your Fathom is not working yet") : "Connect your Fathom"}</p>
          <p className="text-xs text-muted-foreground">{ok ? `Last call received ${ago(c?.lastEventAt ?? null)}${c?.email ? ` | ${c.email}` : ""}` : c?.errorCode ? "Fathom reported a problem. Connect again to fix it." : "Only you can see your calls. A call goes on a contact only when it is certain."}</p>
        </div>
        {ok ? (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={BTN} disabled={busy || fx} onClick={() => void sync()} data-testid="mn-sync">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}Sync now</button>
            <button type="button" className={BTN} disabled={busy || fx} onClick={() => setAsking(true)} data-testid="mn-disconnect">Disconnect</button>
          </span>
        ) : <button type="button" className={PRIMARY} disabled={busy || home.demo || fx} onClick={() => void connect()} data-testid="mn-connect-btn"><PlugZap aria-hidden className="size-4" />{waiting && !ok ? "Waiting for Fathom..." : c ? "Connect again" : "Connect Fathom"}</button>}
      </div>
      {asking && (
        <div className="mt-3 rounded-lg border border-destructive/30 p-3" role="group" aria-label="Disconnect Fathom">
          <label className="block text-sm">Type <b>Fathom</b> to disconnect it. SubSync stops receiving your calls. Calls already saved stay where they are.
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="mt-1 min-h-11 w-full rounded-lg border bg-card px-3 text-sm sm:min-h-10" data-testid="mn-disconnect-typed" /></label>
          <div className="mt-2 flex gap-2"><button type="button" className={PRIMARY} disabled={busy || typed.trim().toLowerCase() !== "fathom"} onClick={() => void disconnect()} data-testid="mn-disconnect-confirm">Disconnect Fathom</button><button type="button" className={BTN} onClick={() => { setAsking(false); setTyped(""); }}>Keep it</button></div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-destructive"}`}>{msg.text}</p>}
      {home.week?.line && <p className="mt-2 text-xs text-muted-foreground" data-testid="mn-week">{home.week.line}{onShowWeek && home.week.held > 0 && <> <button type="button" className="underline" onClick={onShowWeek} data-testid="mn-week-show">Show these {home.week.held} {home.week.held === 1 ? "call" : "calls"}</button></>}</p>}
    </section>
  );
}

// ---------------- follow-up lists ----------------

type FollowKind = "no_followup" | "no_next_step" | "deal_not_moved";
type FollowRow = { meetingId: string; title: string | null; startedAt: string; daysAgo: number; locationId: string; locationName: string; contactId: string; contactName: string; nextStep: string | null; deal: { name: string | null; value: number | null } | null; url: string | null };
type FollowAnswer = { rows: FollowRow[]; total: number; next: string | null; days: number };
const KINDS: Array<{ key: FollowKind; label: string; empty: [string, string]; title: string }> = [
  { key: "no_followup", label: "No follow-up", title: "Held, and nobody has been in touch since", empty: ["No call is waiting for a follow-up", "A call you held 2 to 30 days ago, where nobody has messaged or called that contact since, would show here."] },
  { key: "no_next_step", label: "No next step", title: "Held, and no next step was set", empty: ["Every recent call has a next step", "A call from the last 30 days with no action item and no task made from it would show here."] },
  { key: "deal_not_moved", label: "Deal not moved", title: "Held, and the deal has not moved", empty: ["No deal is stuck after a call", "A call held 7 to 45 days ago where the contact's open deal has not changed stage since would show here."] },
];

export function FollowUps({ home, onOpenCall }: { home: Home | null; onOpenCall: (id: string) => void }) {
  const [kind, setKind] = useState<FollowKind>("no_followup");
  const k = KINDS.find((x) => x.key === kind) ?? KINDS[0];
  return (
    <div className="space-y-4" data-testid="mn-follow">
      <div role="group" aria-label="Which list" className="grid grid-cols-3 gap-2">
        {KINDS.map((x) => (
          <button key={x.key} type="button" aria-pressed={x.key === kind} onClick={() => setKind(x.key)} className={`ds-press min-h-11 rounded-lg border px-2 py-2 text-center ${x.key === kind ? "border-primary bg-primary/10" : "bg-card"}`} data-testid={`mn-follow-${x.key}`}>
            <span className="block text-xl font-semibold tabular-nums">{home?.follow ? home.follow[x.key] : "-"}</span><span className="block text-[11px] text-muted-foreground">{x.label}</span>
          </button>
        ))}
      </div>
      <FollowList key={kind} kind={kind} title={k.title} empty={k.empty} onOpenCall={onOpenCall} />
    </div>
  );
}

function FollowList({ kind, title, empty, onOpenCall }: { kind: FollowKind; title: string; empty: [string, string]; onOpenCall: (id: string) => void }) {
  const api = useApiClient();
  const fx = mnFx();
  const [rows, setRows] = useState<FollowRow[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(async () => {
    setPhase("loading"); setError(null);
    if (fx) { const r = FX_FOLLOW[kind]; setRows(r as FollowRow[]); setTotal(r.length); setNext(null); setPhase("ready"); return; }
    try { const a = await api.get<FollowAnswer>(`meeting-list/follow?kind=${kind}`); setRows(a.rows); setTotal(a.total); setNext(a.next); setPhase("ready"); } catch (e) { setError(e as ApiError); setPhase("error"); }
  }, [api, kind, fx]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const showMore = async () => { if (!next) return; setMore(true); try { const a = await api.get<FollowAnswer>(`meeting-list/follow?kind=${kind}&cursor=${encodeURIComponent(next)}`); setRows((r) => [...r, ...a.rows.filter((x) => !r.some((y) => y.meetingId === x.meetingId))]); setNext(a.next); } catch (e) { setError(e as ApiError); } finally { setMore(false); } };
  if (phase === "loading") return <SkeletonRows rows={4} label="Loading the list" />;
  if (phase === "error" && error) return <ErrorState error={error} onRetry={() => void load()} />;
  if (rows.length === 0) return <EmptyState title={empty[0]} body={empty[1]} />;
  return (
    <section aria-label={title}>
      {fx && <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" role="note">Sample data. These are made up.</p>}
      <h2 className="mb-2 text-sm font-semibold">{title} <span className="tabular-nums text-muted-foreground" data-testid="mn-follow-count">{total}</span></h2>
      <ul className="divide-y rounded-xl border bg-card" data-testid="mn-follow-rows">
        {rows.map((r) => (
          <li key={r.meetingId} className="grid gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="mn-follow-row">
            <button type="button" onClick={() => onOpenCall(r.meetingId)} className="min-h-11 min-w-0 text-left sm:min-h-9">
              <span className="block truncate text-sm font-medium">{r.contactName || r.title || "Recorded call"}</span>
              <span className="block truncate text-xs text-muted-foreground">{whenOf(r.startedAt)} | {r.daysAgo === 0 ? "today" : `${r.daysAgo} ${r.daysAgo === 1 ? "day" : "days"} ago`}{r.locationName ? ` | ${r.locationName}` : ""}</span>
              <span className="block truncate text-xs">{r.deal ? `Deal: ${r.deal.name ?? "Open deal"}${r.deal.value ? `, ${Math.round(r.deal.value).toLocaleString("en-US")}` : ""}` : r.nextStep ? `Next step: ${r.nextStep}` : kind === "no_next_step" ? "No next step set" : "No next step on the call"}</span>
            </button>
            <span className="justify-self-start sm:justify-self-end"><OpenLeadButton seed={r.contactId ? { contactId: r.contactId, locationId: r.locationId, name: r.contactName || "Contact", locationName: r.locationName } : null} crmUrl={r.url} reason={r.contactId ? null : "Pick the contact first"} testId="mn-follow-open" /></span>
          </li>
        ))}
      </ul>
      {next && <div className="mt-3 flex items-center justify-between text-sm"><span className="text-muted-foreground">Showing {rows.length} of {total}</span><button type="button" className={BTN} disabled={more} onClick={() => void showMore()}>{more ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Show more</button></div>}
    </section>
  );
}

// ---------------- coaching ----------------

type Coach = { name: string; isMe: boolean; role: string | null; calls: number; enough: boolean; avgMinutes: number | null; avgTalkPct: number | null; nextStepRate: number | null; showToClose: number | null; closed: number };
type CoachAnswer = { demo?: boolean; scope: string; rows: Coach[]; team: Coach | null };
const ROLE_WORDS: Record<string, string> = { setter: "Setter", closer: "Closer", both: "Setter and closer", support: "Support", manager: "Manager", other: "Other" };
const dash = <span className="text-muted-foreground">Not enough yet</span>;

export function CoachView() {
  const fx = mnFx();
  const d = useData<CoachAnswer>(fx ? null : "meeting-list/coach");
  const [role, setRole] = useState<"all" | "setter" | "closer">("all");
  const data: CoachAnswer | null = fx ? (FX_COACH as unknown as CoachAnswer) : d.data;
  if (!fx && d.loading && !data) return <SkeletonRows rows={4} label="Loading coaching" />;
  if (!fx && d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  if (!data) return null;
  const rows = data.rows.filter((r) => role === "all" || r.role === role || r.role === "both");
  if (data.rows.length === 0) return <EmptyState title="No calls to coach on yet" body="Coaching appears once people connect their meeting tool and calls are recorded. It shows numbers about calls, never what was said." />;
  const person: Column<Coach> = { key: "who", header: "Person", primary: true, width: "minmax(0,2fr)", cell: (r) => <span>{r.name}{r.isMe ? " (you)" : ""}{r.role ? <span className="text-muted-foreground"> | {ROLE_WORDS[r.role] ?? r.role}</span> : null}</span> };
  const cols: Array<Column<Coach>> = [
    person,
    { key: "calls", header: "Calls, 90 days", width: "7rem", align: "right", cell: (r) => r.calls },
    { key: "len", header: "Average length", width: "7rem", align: "right", cell: (r) => (r.avgMinutes === null ? dash : `${r.avgMinutes} min`) },
    { key: "talk", header: "Talk share", width: "6rem", align: "right", cell: (r) => (r.avgTalkPct === null ? dash : `${r.avgTalkPct}%`) },
    { key: "next", header: "Next step set", width: "7rem", align: "right", cell: (r) => (r.nextStepRate === null ? dash : `${r.nextStepRate}%`) },
    { key: "close", header: "Showed, then closed", width: "8rem", align: "right", cell: (r) => (r.showToClose === null ? dash : `${r.showToClose}%`) },
  ];
  return (
    <div className="space-y-4" data-testid="mn-coach">
      {fx && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" role="note">Sample data. These people are made up.</p>}
      <div role="group" aria-label="Which people" className="flex flex-wrap gap-2">
        {([["all", "Everyone"], ["setter", "Setters"], ["closer", "Closers"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={role === k} onClick={() => setRole(k)} className={`ds-press min-h-11 rounded-lg border px-3 text-sm sm:min-h-9 ${role === k ? "border-primary bg-primary/10" : "bg-card"}`}>{l}</button>)}
      </div>
      {data.team && (
        <p className="text-sm" data-testid="mn-coach-team">Team: {data.team.calls} calls, average {data.team.avgMinutes ?? "?"} min{data.team.nextStepRate !== null ? `, a next step on ${data.team.nextStepRate}%` : ""}{data.team.showToClose !== null ? `, ${data.team.showToClose}% of those who showed went on to close` : ""}.</p>
      )}
      <DataList title={data.scope === "team" ? "By person" : "You"} rows={rows} columns={cols} rowKey={(r) => r.name + r.calls} empty="Nobody has that role label yet. Give people a label in Team." caption="Numbers about calls, never what was said. Talk share needs the transcript option in What to save and where. A rate needs at least 5 calls. Role labels come from Team." />
    </div>
  );
}
