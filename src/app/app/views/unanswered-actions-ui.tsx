"use client";

import { Check, ChevronDown, EyeOff, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { SNOOZE_DURATIONS, SNOOZE_DURATION_WORDS, SNOOZE_REASONS, SNOOZE_REASON_WORDS, type SnoozeDuration, type SnoozeReason } from "@/lib/analytics/unanswered-actions";
import type { UnansweredOutcome } from "@/lib/analytics/unanswered-advanced";
import { ApiError, useApiClient, useData } from "../session";
import type { MenuItem } from "../ds";
import type { WaitRow } from "./unanswered-rows";

// The actions on a waiting person (round 3, slice B), as NEW components for the screen to wire in (the screen itself, inbox.tsx, is being redesigned elsewhere):
//
//   const wa = useWaitingActions({ rows, onChanged: reload, openLead: actions.show });
//   <li {...wa.rowProps(r)}> ... {wa.select(r)} ... <PopMenu items={[...actions.menu(r, showAccount), ...wa.menuItems(r)]} /> ... {wa.strip(r)} </li>
//   {wa.batchBar()}            // appears when people are ticked (one client account at a time)
//   <HiddenPeople onChanged={reload} account={accountId} />   // "N set aside, N hidden, show"
//
// Nothing here decides whether something is allowed: the server answers with what may be shown (caps), a preview, the reasons something is refused, and whether it is a dry run
// (changes from SubSync are switched off) or live. Every change to the CRM shows a preview and waits for a click; clearing conversations also needs the typed count.
// No message text is read or kept; a note you write is held in this browser only until you confirm it.

export type Caps = { openLead: boolean; claim: boolean; assign: boolean; note: boolean; outcome: boolean; clearJunk: boolean; snooze: boolean; hide: boolean; canChangeHiding: boolean; me: string | null; caps: { assign: number; clear: number } };
export type Kind = "snooze" | "assign" | "claim" | "note" | "outcome" | "clear";
type Mode = { masterOn: boolean; optedIn: boolean; live: boolean; demo: boolean };
type Blocker = { id: string; text: string };

const NO_CAPS: Caps = { openLead: false, claim: false, assign: false, note: false, outcome: false, clearJunk: false, snooze: false, hide: false, canChangeHiding: false, me: null, caps: { assign: 20, clear: 10 } };

const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-9";
const PRIMARY = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-9";
const DANGER = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-destructive px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-9";
const CHIP = (on: boolean) => `ds-press inline-flex min-h-11 items-center rounded-full border px-3 text-sm sm:min-h-8 ${on ? "border-primary bg-primary/10 font-semibold text-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`;

const msgOf = (e: unknown) => (e instanceof ApiError && typeof e.body.message === "string" ? e.body.message : e instanceof Error ? e.message : "Something went wrong. Try again.");
const blockersOf = (e: unknown): Blocker[] | null => (e instanceof ApiError && Array.isArray(e.body.blockers) ? (e.body.blockers as Blocker[]) : null);

/** What this person may do on a waiting list. Loaded once; a failed load simply shows no extra buttons. */
let capsResolved: Caps | null = null;
/** The answer already loaded by any row (null before it arrives): lets a key press say honestly whether claiming or setting aside is available. */
export const peekActionCaps = () => capsResolved;
let capsShared: { api: unknown; at: number; p: Promise<Caps> } | null = null;
export function useActionCaps(): Caps {
  // One request shared by every row on the screen (each row asks, the answer is kept for a minute).
  const api = useApiClient();
  const [caps, setCaps] = useState<Caps>(NO_CAPS);
  useEffect(() => {
    if (!capsShared || capsShared.api !== api || Date.now() - capsShared.at > 60_000) capsShared = { api, at: Date.now(), p: api.get<Caps>("inbox/act/caps").catch(() => NO_CAPS) };
    let live = true;
    void capsShared.p.then((c) => { capsResolved = c; if (live) setCaps(c); });
    return () => { live = false; };
  }, [api]);
  return caps;
}

// ---------------- small shared pieces ----------------

function Frame({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId: string }) {
  return (
    <div className="col-span-full my-1 rounded-lg border border-l-2 border-l-primary/60 bg-card/60 px-3 py-3 text-sm" role="group" aria-label={title} data-testid={testId} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="font-semibold">{title}</p>
        <button type="button" onClick={onClose} className="-mr-2 -mt-1 min-h-11 px-2 text-muted-foreground underline sm:min-h-8" data-testid="act-close">Close</button>
      </div>
      {children}
    </div>
  );
}

function Notice({ tone, children, testId }: { tone: "info" | "warn" | "done"; children: ReactNode; testId?: string }) {
  const cls = tone === "warn" ? "border-warning text-foreground" : tone === "done" ? "border-primary/60" : "border-border text-muted-foreground";
  return <p className={`mt-2 border-l-2 py-1 pl-3 ${cls}`} role="status" data-testid={testId}>{children}</p>;
}

/** The sentence that says whether a change really goes to the CRM. Honest in both directions. */
function ModeLine({ mode }: { mode: Mode | null }) {
  if (!mode) return null;
  if (mode.demo) return <Notice tone="info">This is the demo: nothing is ever sent to a CRM.</Notice>;
  if (!mode.optedIn) return <Notice tone="info" testId="act-mode">Changes from SubSync are not allowed for this account yet, so this is a preview only. An administrator can allow them in Settings.</Notice>;
  if (!mode.masterOn) return <Notice tone="info" testId="act-mode">Changes from SubSync are switched off for now. This shows what would happen and sends nothing.</Notice>;
  return null;
}

function Blockers({ list }: { list: readonly Blocker[] }) {
  if (list.length === 0) return null;
  return <ul className="mt-2 space-y-1" data-testid="act-blockers">{list.map((b) => <li key={b.id + b.text} className="border-l-2 border-warning pl-3">{b.text}</li>)}</ul>;
}

type Done = { tone: "done" | "dry" | "error"; text: string; undo?: () => void };
function DoneLine({ done }: { done: Done | null }) {
  if (!done) return null;
  return (
    <p className={`mt-2 flex flex-wrap items-center gap-x-3 border-l-2 py-1 pl-3 ${done.tone === "error" ? "border-destructive" : done.tone === "dry" ? "border-warning" : "border-primary"}`} role="status" data-testid="act-done">
      {done.tone === "done" && <Check aria-hidden className="size-4 text-primary" />}
      <span>{done.text}</span>
      {done.undo && <button type="button" onClick={done.undo} className="inline-flex min-h-11 items-center gap-1 font-medium underline sm:min-h-8" data-testid="act-undo"><Undo2 aria-hidden className="size-3.5" />Undo</button>}
    </p>
  );
}

// ---------------- the panel for one action on one or more people (one client account) ----------------

type PanelProps = { kind: Kind; targets: readonly WaitRow[]; caps: Caps; onClose: () => void; onChanged: () => void };

export function ActionPanel({ kind, targets, caps, onClose, onChanged }: PanelProps) {
  const first = targets[0];
  const name = targets.length === 1 ? first.name : `${targets.length} people`;
  const conversationIds = useMemo(() => targets.map((t) => t.conversationId), [targets]);
  const titles: Record<Kind, string> = {
    snooze: `Set ${name} aside`, assign: targets.length === 1 ? `Who should own ${name}?` : `Who should own these ${targets.length} people?`, claim: `Make ${name} yours`,
    note: `Add a note about ${name}`, outcome: `What happened with ${name}?`, clear: `Clear ${name}`,
  };
  const props = { targets, conversationIds, caps, onChanged };
  return (
    <Frame title={titles[kind]} onClose={onClose} testId={`act-${kind}`}>
      {kind === "snooze" && <SnoozeBody {...props} onClose={onClose} />}
      {(kind === "assign" || kind === "claim") && <AssignBody {...props} claim={kind === "claim"} />}
      {kind === "note" && <NoteBody {...props} />}
      {kind === "outcome" && <OutcomeBody {...props} onClose={onClose} />}
      {kind === "clear" && <ClearBody {...props} />}
    </Frame>
  );
}
type BodyProps = { targets: readonly WaitRow[]; conversationIds: string[]; caps: Caps; onChanged: () => void };

function SnoozeBody({ targets, conversationIds, onChanged, onClose }: BodyProps & { onClose: () => void }) {
  const api = useApiClient();
  const [reason, setReason] = useState<SnoozeReason>("call_back_later");
  const [duration, setDuration] = useState<SnoozeDuration>("tomorrow");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const locationId = targets[0].locationId;
  const apply = async () => {
    setBusy(true);
    try {
      await api.post("inbox/act/snooze", { locationId, conversationIds, reason, duration });
      onChanged();
      setDone({ tone: "done", text: "Set aside in SubSync. It comes back by itself, and nothing changed in your CRM.", undo: async () => { try { await api.post("inbox/act/unsnooze", { locationId, conversationIds }); onChanged(); onClose(); } catch (e) { setDone({ tone: "error", text: msgOf(e) }); } } });
    } catch (e) { setDone({ tone: "error", text: msgOf(e) }); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="mb-1 text-muted-foreground">Why?</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Why">{SNOOZE_REASONS.map((r) => <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={CHIP(reason === r)}>{SNOOZE_REASON_WORDS[r]}</button>)}</div>
      <p className="mb-1 mt-3 text-muted-foreground">Bring it back in</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How long">{SNOOZE_DURATIONS.map((d) => <button key={d} type="button" role="radio" aria-checked={duration === d} onClick={() => setDuration(d)} className={CHIP(duration === d)}>{SNOOZE_DURATION_WORDS[d]}</button>)}</div>
      <div className="mt-3 flex gap-2"><button type="button" onClick={() => void apply()} disabled={busy || done?.tone === "done"} className={PRIMARY} data-testid="act-snooze-apply">Set aside</button></div>
      <DoneLine done={done} />
    </div>
  );
}

type Team = { members: Array<{ id: string; name: string }>; needsPermission: boolean; me: string | null };
type AssignPlan = { blockers: Blocker[]; change?: Array<{ name: string; from: string }>; same?: number; overCap?: number; summary?: string; undoNote?: string };

function AssignBody({ targets, conversationIds, caps, onChanged, claim }: BodyProps & { claim: boolean }) {
  const api = useApiClient();
  const locationId = targets[0].locationId;
  const { data: team, error } = useData<Team>(claim ? null : `inbox/act/team?locationId=${encodeURIComponent(locationId)}`);
  const [owner, setOwner] = useState("");
  const [plan, setPlan] = useState<{ plan: AssignPlan; mode: Mode; owner?: string | null } | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const body = (step: "preview" | "do") => claim ? { locationId, conversationId: conversationIds[0], step } : { locationId, conversationIds, ownerId: owner, step };
  const path = claim ? "inbox/act/claim" : "inbox/act/assign";
  const look = async () => {
    setBusy(true); setBlockers([]); setDone(null);
    try { setPlan(await api.post(path, body("preview"))); } catch (e) { setBlockers(blockersOf(e) ?? [{ id: "x", text: msgOf(e) }]); } finally { setBusy(false); }
  };
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; dryRun?: boolean; done?: number | boolean; message?: string; summary?: string; batchId?: string; undoable?: boolean }>(path, body("do"));
      const live = r.dryRun !== true && !(typeof r.done === "number" && r.done === 0);
      if (live) onChanged();
      setDone({
        tone: r.dryRun || (typeof r.done === "number" && r.done === 0) ? "dry" : "done",
        text: r.message ?? r.summary ?? "Done.",
        ...(r.batchId && live && (r.undoable ?? true) ? { undo: async () => { try { const u = await api.post<{ message?: string }>("inbox/act/undo", { batchId: r.batchId, step: "do" }); onChanged(); setDone({ tone: "done", text: u.message ?? "Put back." }); } catch (e) { setDone({ tone: "error", text: msgOf(e) }); } } } : {}),
      });
      setPlan(null);
    } catch (e) { setBlockers(blockersOf(e) ?? [{ id: "x", text: msgOf(e) }]); } finally { setBusy(false); }
  };
  return (
    <div>
      {!claim && (
        <label className="block">
          <span className="text-muted-foreground">Choose someone from this account&apos;s team</span>
          <select value={owner} onChange={(e) => { setOwner(e.target.value); setPlan(null); setDone(null); }} className="mt-1 block min-h-11 w-full rounded-md border bg-background px-2 sm:min-h-9 sm:max-w-xs" data-testid="act-owner">
            <option value="">Choose...</option>
            {(team?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === caps.me ? " (you)" : ""}</option>)}
          </select>
        </label>
      )}
      {!claim && team?.needsPermission && <Notice tone="warn">Needs permission: reconnect SubSync so it can read this account&apos;s team.</Notice>}
      {!claim && error && <Notice tone="warn">The team could not be loaded. Try again.</Notice>}
      {!claim && team && team.members.length === 0 && !team.needsPermission && <Notice tone="info">SubSync has not read this account&apos;s team yet, so nobody can be chosen.</Notice>}
      {!plan && !done && <div className="mt-3"><button type="button" onClick={() => void look()} disabled={busy || (!claim && !owner)} className={PRIMARY} data-testid="act-preview">{claim ? "Make it mine" : "Preview"}</button></div>}
      {plan && (
        <div className="mt-3" data-testid="act-plan">
          {plan.plan.summary && <p>{plan.plan.summary}.</p>}
          {plan.plan.change && (
            <>
              <p>{plan.plan.change.length} will change{plan.owner ? ` to ${plan.owner}` : ""}{plan.plan.same ? `, ${plan.plan.same} already ${plan.plan.same === 1 ? "has" : "have"} that owner` : ""}{plan.plan.overCap ? `, ${plan.plan.overCap} left out (at most ${caps.caps.assign} at a time)` : ""}.</p>
              <ul className="mt-1 max-h-32 overflow-auto text-muted-foreground">{plan.plan.change.slice(0, 20).map((c, i) => <li key={i} className="truncate">{c.name} (now: {c.from})</li>)}</ul>
            </>
          )}
          <p className="mt-1 text-muted-foreground">You can undo this right after.</p>
          <Blockers list={plan.plan.blockers} />
          <ModeLine mode={plan.mode} />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void go()} disabled={busy || plan.plan.blockers.length > 0} className={PRIMARY} data-testid="act-confirm">Confirm</button>
            <button type="button" onClick={() => setPlan(null)} className={BTN}>Back</button>
          </div>
        </div>
      )}
      <Blockers list={blockers} />
      <DoneLine done={done} />
    </div>
  );
}

function NoteBody({ targets, onChanged }: BodyProps) {
  const api = useApiClient();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<{ plan: { summary: string; blockers: Blocker[] }; mode: Mode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const t = targets[0];
  const send = async (step: "preview" | "do") => {
    setBusy(true); setBlockers([]);
    try {
      if (step === "preview") setPlan(await api.post("inbox/act/note", { locationId: t.locationId, contactId: t.contactId, text, step }));
      else {
        const r = await api.post<{ dryRun?: boolean; message?: string; summary?: string }>("inbox/act/note", { locationId: t.locationId, contactId: t.contactId, text, step, confirm: true });
        setPlan(null);
        if (!r.dryRun) { onChanged(); setText(""); }
        setDone({ tone: r.dryRun ? "dry" : "done", text: r.dryRun ? `${r.message ?? "Nothing was sent."}` : `Saved in your CRM. ${r.summary ?? ""}`.trim() });
      }
    } catch (e) { setBlockers(blockersOf(e) ?? [{ id: "x", text: msgOf(e) }]); } finally { setBusy(false); }
  };
  if (!t.contactId) return <Notice tone="info">There is no contact on file for this person, so a note cannot be added.</Notice>;
  return (
    <div>
      <label className="block"><span className="text-muted-foreground">Only your team sees this. It is never sent to the customer.</span>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPlan(null); setDone(null); }} rows={3} maxLength={5000} className="mt-1 block w-full rounded-md border bg-background p-2" data-testid="act-note-text" />
      </label>
      {!plan && <div className="mt-2"><button type="button" onClick={() => void send("preview")} disabled={busy || !text.trim()} className={PRIMARY} data-testid="act-preview">Preview</button></div>}
      {plan && (
        <div className="mt-2" data-testid="act-plan">
          <p>{plan.plan.summary}.</p>
          <p className="mt-1 text-muted-foreground">SubSync marks this note as its own, so it never counts as a reply or as activity in the numbers.</p>
          <Blockers list={plan.plan.blockers} /><ModeLine mode={plan.mode} />
          <div className="mt-2 flex gap-2"><button type="button" onClick={() => void send("do")} disabled={busy || plan.plan.blockers.length > 0} className={PRIMARY} data-testid="act-confirm">Add note</button><button type="button" onClick={() => setPlan(null)} className={BTN}>Back</button></div>
        </div>
      )}
      <Blockers list={blockers} /><DoneLine done={done} />
    </div>
  );
}

const OUTCOME_WORDS: Record<UnansweredOutcome, { label: string; hint: string }> = {
  replied: { label: "Replied", hint: "Someone answered them." },
  appointment_booked: { label: "Booked", hint: "They booked an appointment." },
  needs_follow_up: { label: "Needs follow-up", hint: "Still open. Keep it on the list." },
  not_a_lead: { label: "Not a lead", hint: "Spam, wrong number or a supplier. This person leaves the list." },
};

function OutcomeBody({ targets, conversationIds, onChanged, onClose }: BodyProps & { onClose: () => void }) {
  const api = useApiClient();
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (outcome: UnansweredOutcome) => {
    setBusy(true);
    try {
      for (const t of targets) await api.post("inbox/act/outcome", { locationId: t.locationId, conversationId: t.conversationId, outcome });
      onChanged();
      setDone({ tone: "done", text: outcome === "not_a_lead" ? "Marked as not a lead. They are hidden from the list (you can bring them back under Hidden). Nothing changed in your CRM." : "Saved in SubSync. Nothing changed in your CRM." });
      if (outcome === "not_a_lead") setTimeout(onClose, 1800);
    } catch (e) { setDone({ tone: "error", text: msgOf(e) }); } finally { setBusy(false); }
  };
  void conversationIds;
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(OUTCOME_WORDS) as UnansweredOutcome[]).map((o) => (
          <button key={o} type="button" disabled={busy} onClick={() => void pick(o)} className={`${BTN} h-auto flex-col items-start py-2 text-left`} data-testid={`act-outcome-${o}`}>
            <span className="font-semibold">{OUTCOME_WORDS[o].label}</span><span className="text-xs font-normal text-muted-foreground">{OUTCOME_WORDS[o].hint}</span>
          </button>
        ))}
      </div>
      <DoneLine done={done} />
    </div>
  );
}

type ClearPlan = { allowed: Array<{ conversationId: string; name: string }>; blocked: Array<{ conversationId: string; name: string; reasons: string[] }>; overCap: number; phrase: string; summary: string };

function ClearBody({ targets, conversationIds, caps, onChanged }: BodyProps) {
  const api = useApiClient();
  const locationId = targets[0].locationId;
  const [view, setView] = useState<{ plan: ClearPlan; mode: Mode; needsPermission: boolean } | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const look = async () => { setBusy(true); setBlockers([]); try { setView(await api.post("inbox/act/clear", { locationId, conversationIds, step: "preview" })); } catch (e) { setBlockers(blockersOf(e) ?? [{ id: "x", text: msgOf(e) }]); } finally { setBusy(false); } };
  const go = async () => {
    setBusy(true); setBlockers([]);
    try {
      const r = await api.post<{ message?: string; dryRun?: number; done?: number }>("inbox/act/clear", { locationId, conversationIds, step: "do", typed });
      setView(null);
      if ((r.done ?? 0) > 0) onChanged();
      setDone({ tone: (r.done ?? 0) > 0 ? "done" : "dry", text: r.message ?? "Done." });
    } catch (e) { setBlockers(blockersOf(e) ?? [{ id: "x", text: msgOf(e) }]); } finally { setBusy(false); }
  };
  const phraseOk = !!view && typed.trim().toLowerCase().replace(/\s+/g, " ") === view.plan.phrase;
  return (
    <div>
      {!view && !done && (
        <div><p className="text-muted-foreground">Deletes the chosen conversations in your CRM. The people stay. Anyone who asked not to be contacted, has an open deal, is a customer or has an appointment coming up is always kept.</p>
          <div className="mt-2"><button type="button" onClick={() => void look()} disabled={busy} className={PRIMARY} data-testid="act-preview">Check what can be cleared</button></div></div>
      )}
      {view && (
        <div data-testid="act-plan">
          <p>{view.plan.allowed.length} can be cleared{view.plan.overCap ? `, ${view.plan.overCap} left out (at most ${caps.caps.clear} at a time)` : ""}.</p>
          {view.plan.allowed.length > 0 && <ul className="mt-1 max-h-28 overflow-auto text-muted-foreground">{view.plan.allowed.map((a) => <li key={a.conversationId} className="truncate">{a.name}</li>)}</ul>}
          {view.plan.blocked.length > 0 && (
            <div className="mt-2" data-testid="act-clear-blocked"><p className="font-medium">{view.plan.blocked.length} kept, and why</p>
              <ul className="mt-1 space-y-1">{view.plan.blocked.map((b) => <li key={b.conversationId} className="border-l-2 border-warning pl-3">{b.reasons.join(" ")}</li>)}</ul></div>
          )}
          <p className="mt-2 font-medium">This cannot be undone.</p>
          {view.needsPermission && <Notice tone="warn">Needs permission: reconnect SubSync so it may clear conversations.</Notice>}
          <ModeLine mode={view.mode} />
          {view.plan.allowed.length > 0 && (
            <label className="mt-2 block"><span className="text-muted-foreground">Type <strong className="text-foreground">{view.plan.phrase}</strong> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 block min-h-11 w-full rounded-md border bg-background px-2 sm:min-h-9 sm:max-w-xs" autoComplete="off" data-testid="act-typed" /></label>
          )}
          <div className="mt-3 flex gap-2"><button type="button" onClick={() => void go()} disabled={busy || !phraseOk} className={DANGER} data-testid="act-confirm">Clear {view.plan.allowed.length}</button><button type="button" onClick={() => { setView(null); setTyped(""); }} className={BTN}>Back</button></div>
        </div>
      )}
      <Blockers list={blockers} /><DoneLine done={done} />
    </div>
  );
}

// ---------------- the hook the screen wires in ----------------

/** A tick box for choosing people for a batch. A stable component, so ticking never resets a panel that is open. */
function PickBox({ row, on, toggle }: { row: WaitRow; on: boolean; toggle: (key: string) => void }) {
  return (
    <label data-no-open className="inline-flex size-11 cursor-pointer items-center justify-center sm:size-8">
      <input type="checkbox" checked={on} onChange={() => toggle(row.key)} className="size-5 sm:size-4" aria-label={`Choose ${row.name}`} data-testid="act-select" />
    </label>
  );
}

export function BatchPanel({ rows: chosen, caps, batch, setBatch, clearPicked, changed }: { rows: readonly WaitRow[]; caps: Caps; batch: Kind | null; setBatch: (k: Kind | null) => void; clearPicked: () => void; changed: () => void }) {
  if (chosen.length === 0) return null;
  const oneAccount = chosen.every((r) => r.locationId === chosen[0].locationId);
  const withContact = chosen.every((r) => r.contactId);
  const over = (n: number) => chosen.length > n;
  return (
    <div className="sticky bottom-2 z-10 my-2 rounded-xl border bg-popover/95 p-3 shadow-lg backdrop-blur" role="region" aria-label="Actions for the chosen people" data-testid="act-batch">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 font-semibold">{chosen.length} chosen</p>
        {caps.assign && <button type="button" className={BTN} disabled={!oneAccount || !withContact || over(caps.caps.assign * 3)} onClick={() => setBatch("assign")}>Assign owner</button>}
        {caps.snooze && <button type="button" className={BTN} disabled={!oneAccount || over(50)} onClick={() => setBatch("snooze")}>Set aside</button>}
        {caps.outcome && <button type="button" className={BTN} disabled={!oneAccount} onClick={() => setBatch("outcome")}>Not a lead / outcome</button>}
        {caps.clearJunk && <button type="button" className={BTN} disabled={!oneAccount || over(caps.caps.clear * 3)} onClick={() => setBatch("clear")}>Clear junk</button>}
        <button type="button" className="min-h-11 px-2 text-muted-foreground underline sm:min-h-8" onClick={() => { clearPicked(); setBatch(null); }}>Clear choice</button>
      </div>
      {!oneAccount && <p className="mt-2 text-muted-foreground">Choose people from one client account at a time, so an owner can only be someone from that account&apos;s team.</p>}
      {batch && oneAccount && <div className="mt-2 grid"><ActionPanel kind={batch} targets={chosen} caps={caps} onClose={() => setBatch(null)} onChanged={() => { changed(); setBatch(null); }} /></div>}
    </div>
  );
}



export type WaitingActionsOptions = { rows: readonly WaitRow[]; onChanged: () => void; openLead?: (r: WaitRow) => void };

export function useWaitingActions({ rows, onChanged, openLead }: WaitingActionsOptions) {
  const caps = useActionCaps();
  const [panel, setPanel] = useState<{ key: string; kind: Kind } | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState<Kind | null>(null);
  const changed = useCallback(() => { onChanged(); setPicked(new Set()); }, [onChanged]);

  // A row opens the lead panel (timeline, notes, deals, appointments) when the flag is on, and never just starts a reply. A click on a button, link or field inside the row does its own thing.
  const rowProps = (r: WaitRow) => {
    if (!caps.openLead || !openLead || !r.contactId) return {};
    const interactive = (t: EventTarget | null) => t instanceof Element && !!t.closest("a,button,input,select,textarea,label,[role=menu],[role=menuitem],[data-no-open]");
    return {
      onClick: (e: MouseEvent) => { if (!interactive(e.target)) openLead(r); },
      onKeyDown: (e: KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); openLead(r); } },
      tabIndex: 0, "aria-label": `Open ${r.name}`, "data-open-lead": "true", className: "cursor-pointer",
    };
  };

  const menuItems = (r: WaitRow): MenuItem[] => {
    const items: MenuItem[] = [];
    const mine = caps.me !== null && r.owner?.id === caps.me;
    if (caps.claim && r.unassigned && r.contactId) items.push({ key: "claim", label: "Claim this lead", onSelect: () => setPanel({ key: r.key, kind: "claim" }) });
    if (caps.assign && r.contactId) items.push({ key: "assign", label: mine ? "Change owner" : "Assign an owner", onSelect: () => setPanel({ key: r.key, kind: "assign" }) });
    if (caps.snooze) items.push({ key: "snooze", label: "Set aside for later", onSelect: () => setPanel({ key: r.key, kind: "snooze" }) });
    if (caps.note && r.contactId) items.push({ key: "note", label: "Add a note", onSelect: () => setPanel({ key: r.key, kind: "note" }) });
    if (caps.outcome) items.push({ key: "outcome", label: "What happened?", onSelect: () => setPanel({ key: r.key, kind: "outcome" }) });
    if (caps.clearJunk) items.push({ key: "clear", label: "Clear this conversation", onSelect: () => setPanel({ key: r.key, kind: "clear" }), danger: true });
    return items;
  };

  const strip = (r: WaitRow): ReactNode => (panel?.key === r.key ? <ActionPanel kind={panel.kind} targets={[r]} caps={caps} onClose={() => setPanel(null)} onChanged={onChanged} /> : null);

  const toggle = (key: string) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const select = (row: WaitRow): ReactNode => (caps.assign || caps.snooze || caps.outcome || caps.clearJunk ? <PickBox row={row} on={picked.has(row.key)} toggle={toggle} /> : null);
  const batchBar = (): ReactNode => <BatchPanel rows={rows.filter((r) => picked.has(r.key))} caps={caps} batch={batch} setBatch={setBatch} clearPicked={() => setPicked(new Set())} changed={changed} />;

  return { caps, rowProps, menuItems, strip, select, batchBar, picked, open: (r: WaitRow, kind: Kind) => setPanel({ key: r.key, kind }) };
}

// ---------------- "N set aside, N hidden, show" ----------------

type HiddenData = {
  settings: { notALead: boolean; internal: boolean; automatic: boolean };
  summary: { total: number; snoozed: number; not_a_lead: number; internal: number; automatic: number };
  words: Record<string, string>; canChange: boolean;
  page: { total: number; page: number; pages: number; rows: Array<{ key: string; locationId: string; locationName: string; contactId: string | null; conversationId: string; name: string; channel: string | null; hours: number; reason: string; until: string | null; snoozeReason: string | null; url: string; contactUrl: string }> } | null;
};

const untilWords = (iso: string | null) => { if (!iso) return ""; const ms = Date.parse(iso) - Date.now(); if (ms <= 0) return "back now"; const h = Math.round(ms / 3_600_000); return h < 1 ? "back within the hour" : h < 36 ? `back in ${h} hour${h === 1 ? "" : "s"}` : `back in ${Math.round(h / 24)} days`; };

/** The quiet line under the list: how many people are set aside or hidden, with a button that shows exactly those people (the count equals the rows). */
export function HiddenPeople({ onChanged, account }: { onChanged: () => void; account?: string | null }) {
  const api = useApiClient();
  const [open, setOpenRaw] = useState<string | "all" | null>(null);
  const [page, setPage] = useState(0);
  const setOpen = (k: string | "all" | null) => { setOpenRaw(k); setPage(0); };
  const path = `inbox/act/hidden?rows=${open ? 1 : 0}&page=${page}&size=25${open && open !== "all" ? `&reason=${open}` : ""}${account ? `&account=${encodeURIComponent(account)}` : ""}`;
  const { data, error, reload } = useData<HiddenData>(path);
  const [note, setNote] = useState<string | null>(null);
  if (error || !data || (data.summary.total === 0 && !data.canChange)) return null;
  const s = data.summary;
  const parts: Array<[string, string, number]> = [["snoozed", "set aside", s.snoozed], ["not_a_lead", "not a lead", s.not_a_lead], ["internal", "your own team or spam", s.internal], ["automatic", "automatic messages", s.automatic]];
  const bringBack = async (r: NonNullable<HiddenData["page"]>["rows"][number]) => {
    try {
      if (r.reason === "snoozed") await api.post("inbox/act/unsnooze", { locationId: r.locationId, conversationIds: [r.conversationId] });
      else if (r.reason === "not_a_lead") await api.post("inbox/act/outcome", { locationId: r.locationId, conversationId: r.conversationId, outcome: "needs_follow_up" });
      setNote("Back on the list.");
      reload(); onChanged();
    } catch (e) { setNote(msgOf(e)); }
  };
  const toggle = async (k: "notALead" | "internal" | "automatic") => {
    try { await api.put("inbox/act/settings", { ...data.settings, [k]: !data.settings[k] }); reload(); onChanged(); } catch (e) { setNote(msgOf(e)); }
  };
  return (
    <section className="mt-3 rounded-lg border bg-card/40 px-3 py-2 text-sm" aria-label="Hidden from the list" data-testid="hidden-people">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <EyeOff aria-hidden className="size-4 text-muted-foreground" />
        {s.total === 0 ? <span className="text-muted-foreground">Nobody is hidden.</span> : parts.filter(([, , n]) => n > 0).map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setOpen(open === k ? null : k)} className={`min-h-11 underline-offset-2 hover:underline sm:min-h-8 ${open === k ? "font-semibold" : "text-muted-foreground"}`} data-testid={`hidden-${k}`}>{n} {label}, {open === k ? "hide" : "show"}</button>
        ))}
        {data.canChange && <button type="button" onClick={() => setOpen(open === "all" ? null : "all")} className="ml-auto inline-flex min-h-11 items-center gap-1 text-muted-foreground sm:min-h-8" aria-expanded={open === "all"} data-testid="hidden-settings">What is hidden<ChevronDown aria-hidden className="size-3.5" /></button>}
      </div>
      {open === "all" && data.canChange && (
        <div className="mt-2 grid gap-1 border-t pt-2" data-testid="hidden-choices">
          <p className="text-muted-foreground">Left out of the list by default. Set-aside people always are, until their time is up.</p>
          {([["notALead", "People marked not a lead"], ["internal", "Your own team and spam (by tag, or the business's own number or email)"], ["automatic", "Messages sent by an automation or a form"]] as const).map(([k, label]) => (
            <label key={k} className="flex min-h-11 items-center gap-2 sm:min-h-8"><input type="checkbox" className="size-5 sm:size-4" checked={data.settings[k]} onChange={() => void toggle(k)} />{label}</label>
          ))}
        </div>
      )}
      {open && open !== "all" && data.page && (
        <div className="mt-2 border-t pt-2" data-testid="hidden-list">
          <ul className="divide-y">
            {data.page.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5" data-testid="hidden-row">
                <span className="min-w-0 flex-1 truncate font-medium" title={r.name}>{r.name}</span>
                <span className="text-muted-foreground">{r.locationName} · {data.words[r.reason] ?? r.reason}{r.until ? ` · ${untilWords(r.until)}` : ""}</span>
                {(r.reason === "snoozed" || r.reason === "not_a_lead") && <button type="button" onClick={() => void bringBack(r)} className={BTN} data-testid="hidden-bring-back">Bring back</button>}
              </li>
            ))}
          </ul>
          {data.page.pages > 1 && (
            <p className="mt-1 flex items-center gap-3"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={BTN}>Previous</button><span className="text-muted-foreground">Page {data.page.page + 1} of {data.page.pages}</span><button type="button" disabled={page + 1 >= data.page.pages} onClick={() => setPage(page + 1)} className={BTN}>Next</button></p>
          )}
        </div>
      )}
      {note && <p className="mt-1 text-muted-foreground" role="status">{note}</p>}
    </section>
  );
}
