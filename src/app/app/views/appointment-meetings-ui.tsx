"use client";

import { CalendarCheck, Link2, Loader2, PlugZap, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { ApiError, useApiClient, useData } from "../session";
import { BTN, PRIMARY } from "./appointment-actions-ui";
import { BrandIcon } from "../ds/brand-icon";
import { CallPanel, type CallRow } from "./meeting-list";

// The Meetings (Fathom) sub-section of Appointments (slice AB): `<AppointmentMeetings onOpen={(locationId, appointmentId) => ...} />`. PRIVATE to the person: it lists only their own
// calls. Connect, status and Sync now for them; calls that could not be tied to an appointment with certainty wait under "Needs matching" with a one-click match; "Meeting held, no
// follow-up" lists the calls where nobody has been in touch for 2 days. Counts equal rows. SubSync never guesses a match and never marks an outcome by itself.

type Home = { demo: boolean; connection: { id: string; status: string; email: string | null; lastOkAt: string | null; lastEventAt: string | null; errorCode: string | null } | null; counts: { linked: number; needsMatching: number; noFollowUp: number }; note?: string };
type Wait = { id: string; title: string | null; startedAt: string | null; summary: string | null; nextStep: string | null; attendeeCount: number; options: Array<{ appointmentId: string; locationId: string; name: string; calendar: string | null; startAt: string }> };
type Gap = { appointmentId: string; locationId: string; contactId: string | null; meetingId: string; startedAt: string | null; name: string; nextStep: string | null; daysAgo: number; url: string | null };
type Tab = "tied" | "matching" | "followup";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "time unknown");
const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const errText = (e: unknown) => (e instanceof ApiError ? String(e.body.message ?? e.body.error ?? "Something went wrong") : "Something went wrong. Try again.");

export function AppointmentMeetings({ onOpen }: { onOpen?: (locationId: string, appointmentId: string) => void }) {
  const api = useApiClient();
  const home = useData<Home>("appointments/meetings/home");
  const [tab, setTab] = useState<Tab>("matching");
  const [callId, setCallId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState(0);
  const reloadAll = useCallback(async () => { setVersion((v) => v + 1); await home.reload(); }, [home]);

  const sync = async () => { setBusy(true); setMsg(null); try { const r = await api.post<{ message: string }>("appointments/meetings/sync", {}); setMsg({ ok: true, text: r.message }); await reloadAll(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); } };
  const connect = async () => { setBusy(true); setMsg(null); try { const r = await api.post<{ url?: string }>("my-connections/fathom/start", {}); if (r.url) window.location.assign(r.url); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); } };

  if (home.loading && !home.data) return <SkeletonRows rows={4} label="Loading your meetings" />;
  if (home.error) return <ErrorState error={home.error} onRetry={home.reload} />;
  const d = home.data;
  if (!d) return null;
  const c = d.connection;
  const ok = c?.status === "connected";
  return (
    <div className="space-y-4" data-testid="appt-meetings">
      <section className="rounded-xl border bg-card/60 p-4 shadow-[0_0_30px_-18px_var(--primary)]" aria-label="Your meeting tool">
        <div className="flex flex-wrap items-center gap-3">
          <BrandIcon id="fathom" size={26} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className={`size-2 rounded-full ${ok ? "bg-success" : c ? "bg-warning" : "bg-muted-foreground/50"}`} />{ok ? "Your Fathom is connected" : c ? (c.status === "needs_reconnect" ? "Your Fathom needs to be connected again" : "Your Fathom is not working yet") : "Connect your Fathom"}</p>
            <p className="text-xs text-muted-foreground">{ok ? `Last call received ${ago(c?.lastEventAt ?? null)}${c?.email ? ` | ${c.email}` : ""}` : c?.errorCode ? "Fathom reported a problem. Connect again to fix it." : "Only you can see your calls. SubSync ties a call to an appointment only when it is certain."}</p>
          </div>
          {ok ? <button type="button" onClick={() => void sync()} disabled={busy} className={BTN} data-testid="appt-meetings-sync">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}Sync now</button>
            : <button type="button" onClick={() => void connect()} disabled={busy || d.demo} className={PRIMARY} data-testid="appt-meetings-connect"><PlugZap aria-hidden className="size-4" />{c ? "Connect again" : "Connect Fathom"}</button>}
        </div>
        {d.note && ok && <p className="mt-2 text-xs text-muted-foreground">{d.note}</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-destructive"}`}>{msg.text}</p>}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[{ k: "Tied to appointments", n: d.counts.linked, t: "tied" as Tab | null }, { k: "Needs matching", n: d.counts.needsMatching, t: "matching" as Tab }, { k: "Held, no follow-up", n: d.counts.noFollowUp, t: "followup" as Tab }].map((x) => (
            <button key={x.k} type="button" disabled={!x.t} onClick={() => x.t && setTab(x.t)} aria-pressed={x.t === tab} className={`ds-press min-h-11 rounded-lg border px-2 py-2 ${x.t === tab ? "border-primary bg-primary/10" : "bg-card"} disabled:cursor-default`} data-testid={`appt-meetings-count-${x.k.split(" ")[0].toLowerCase()}`}>
              <dd className="text-xl font-semibold tabular-nums">{x.n}</dd><dt className="text-[11px] text-muted-foreground">{x.k}</dt>
            </button>
          ))}
        </dl>
      </section>
      <p className="text-xs text-muted-foreground">Press a call to see its link, who was on it, the summary and the transcript. Only you can open your calls.</p>
      {tab === "tied" ? <Tied key={`t${version}`} onCall={setCallId} /> : tab === "matching" ? <Matching key={`m${version}`} onOpen={onOpen} onCall={setCallId} onChanged={reloadAll} /> : <FollowUp key={`f${version}`} onOpen={onOpen} onCall={setCallId} />}
      {callId && <CallPanel id={callId} fx={false} onClose={() => setCallId(null)} onChanged={() => void reloadAll()} onOpenAppointment={onOpen} />}
    </div>
  );
}

function Matching({ onOpen, onCall, onChanged }: { onOpen?: (l: string, a: string) => void; onCall: (id: string) => void; onChanged: () => Promise<void> }) {
  const api = useApiClient();
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useData<{ total: number; rows: Wait[]; page: number; size: number }>(`appointments/meetings/matching?page=${page}&size=20`);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const match = async (meetingId: string, o: Wait["options"][number]) => {
    setBusyId(meetingId + o.appointmentId); setErr(null);
    try { await api.post("appointments/meetings/match", { meetingId, locationId: o.locationId, appointmentId: o.appointmentId }); await onChanged(); await reload(); }
    catch (e) { setErr(errText(e)); } finally { setBusyId(null); }
  };
  if (loading && !data) return <SkeletonRows rows={4} label="Loading calls that need matching" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || data.total === 0) return <EmptyState title="Every call is tied to an appointment" body="When a call cannot be matched with certainty it waits here for you to pick the appointment." />;
  return (
    <section aria-label="Calls that need matching" data-testid="appt-needs-matching">
      <h2 className="mb-2 text-sm font-semibold">Needs matching <span className="tabular-nums text-muted-foreground">{data.total}</span></h2>
      {err && <p role="alert" className="mb-2 text-sm text-destructive">{err}</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {data.rows.map((m) => (
          <li key={m.id} className="px-3 py-3" data-testid="appt-needs-matching-row">
            <button type="button" onClick={() => onCall(m.id)} className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium hover:underline sm:min-h-9" aria-label={`Open the call ${m.title ?? "recorded call"}`} data-testid="appt-call-open"><BrandIcon id="fathom" size={16} decorative /><span className="truncate">{m.title ?? "Recorded call"}</span><span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{when(m.startedAt)}</span></button>
            {m.options.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No appointment near this time belongs to someone on the call, so nothing can be offered. It stays here and is never guessed.</p> : (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.options.map((o) => (
                  <span key={o.appointmentId} className="inline-flex items-center gap-1">
                    <button type="button" disabled={busyId !== null} onClick={() => void match(m.id, o)} className={BTN} data-testid="appt-match"><Link2 aria-hidden className="size-4" />Match {o.name}, {when(o.startAt)}</button>
                    {onOpen && <button type="button" onClick={() => onOpen(o.locationId, o.appointmentId)} className="min-h-11 px-1 text-xs text-primary underline sm:min-h-8">view</button>}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pager page={page} total={data.total} size={data.size} onPage={setPage} />
    </section>
  );
}

function FollowUp({ onOpen, onCall }: { onOpen?: (l: string, a: string) => void; onCall: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useData<{ total: number; rows: Gap[]; page: number; size: number }>(`appointments/meetings/followup?page=${page}&size=20`);
  if (loading && !data) return <SkeletonRows rows={4} label="Loading meetings with no follow-up" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || data.total === 0) return <EmptyState title="No meeting is waiting for a follow-up" body="A meeting you held 2 to 30 days ago where nobody has been in touch since would show here." />;
  return (
    <section aria-label="Meetings held with no follow-up" data-testid="appt-no-followup">
      <h2 className="mb-2 text-sm font-semibold">Meeting held, no follow-up in 2 days <span className="tabular-nums text-muted-foreground">{data.total}</span></h2>
      <ul className="divide-y rounded-xl border bg-card">
        {data.rows.map((g) => (
          <li key={g.meetingId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5" data-testid="appt-no-followup-row">
            <CalendarCheck aria-hidden className="size-4 shrink-0 text-amber-500" />
            <button type="button" onClick={() => onOpen?.(g.locationId, g.appointmentId)} className="min-h-11 min-w-0 flex-1 text-left sm:min-h-8"><span className="block truncate text-sm font-medium">{g.name}</span><span className="block truncate text-xs text-muted-foreground">{g.daysAgo} days ago | next step: {g.nextStep ?? "none was set"}</span></button>
            <button type="button" onClick={() => onCall(g.meetingId)} className={BTN} data-testid="appt-call-open">Call details</button>
            {g.url && <a href={g.url} target="_blank" rel="noopener noreferrer" className={BTN}>Open in your CRM</a>}
          </li>
        ))}
      </ul>
      <Pager page={page} total={data.total} size={data.size} onPage={setPage} />
    </section>
  );
}

// The calls already tied to an appointment: the matched rows of the Meeting notes list. Each one opens the call panel.
function Tied({ onCall }: { onCall: (id: string) => void }) {
  const { data, error, loading, reload } = useData<{ rows: CallRow[]; total: number }>("meeting-list?state=matched");
  if (loading && !data) return <SkeletonRows rows={4} label="Loading your tied calls" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || data.total === 0) return <EmptyState title="No call is tied to an appointment yet" body="When a call is matched with certainty it appears here. Nothing is ever matched by guessing." />;
  return (
    <section aria-label="Calls tied to appointments" data-testid="appt-tied">
      <h2 className="mb-2 text-sm font-semibold">Tied to appointments <span className="tabular-nums text-muted-foreground">{data.total}</span></h2>
      <ul className="divide-y rounded-xl border bg-card">
        {data.rows.map((r) => (
          <li key={r.id} className="px-3 py-2" data-testid="appt-tied-row">
            <button type="button" onClick={() => onCall(r.id)} className="flex min-h-11 w-full items-center gap-2 text-left sm:min-h-9" aria-label={`Open the call ${r.title ?? "recorded call"}`} data-testid="appt-call-open">
              <BrandIcon id="fathom" size={16} decorative />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.title ?? "Recorded call"}</span><span className="block truncate text-xs text-muted-foreground">{when(r.startedAt ?? r.at)}{r.contactName ? ` | ${r.contactName}` : ""}{r.locationName ? ` | ${r.locationName}` : ""}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {data.total > data.rows.length && <p className="mt-2 text-xs text-muted-foreground">Showing the latest {data.rows.length} of {data.total}. The full list is in Meeting notes.</p>}
    </section>
  );
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return <div className="mt-2 flex items-center justify-between text-sm"><button type="button" className={BTN} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><span className="tabular-nums text-muted-foreground">Page {page + 1} of {pages}</span><button type="button" className={BTN} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}
