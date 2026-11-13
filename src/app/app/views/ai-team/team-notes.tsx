"use client";

import { useState } from "react";
import { useApiClient, useData } from "../../session";

// Small cards for the team and client AI jobs. Each one only suggests: nothing is sent to a lead or a client and nothing is written to the CRM. Each hides itself when its feature is off, and each
// says in words why it cannot write (not connected, switched off for this account, too little recorded). Opening a card never calls the AI; only its button does, and the same figures give the
// same answer without a second charge.

type Flags = { flags: { report: boolean; leads: boolean; coach: boolean; anomaly: boolean; meeting: boolean; oneThing: boolean } };
const useFlag = (k: keyof Flags["flags"]) => { const s = useData<Flags>("ai-team?part=status"); return !s.error && s.data?.flags[k] === true; };
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed.");
const SAFE = "It only suggests. Nothing is sent to anyone and nothing is changed in your CRM.";

// ---------------------------------------------------------------- coaching note (Team)

type Coach = { ok: boolean; strengths?: string[]; fix?: string; error?: string; code?: string; runId?: string; figures?: { firstReplies: number; ready: boolean; team: { people: number } | null } };

export function CoachNoteCard({ userId, locationId }: { userId: string; locationId?: string | null }) {
  const api = useApiClient(), on = useFlag("coach");
  const q = new URLSearchParams({ part: "coach", user: userId, ...(locationId ? { account: locationId } : {}) });
  const peek = useData<Coach>(on ? `ai-team?${q}` : null);
  const [made, setMade] = useState<Coach | null>(null), [busy, setBusy] = useState(false);
  if (!on || peek.error) return null;
  const r = made ?? peek.data;
  const write = async () => {
    setBusy(true);
    try { setMade(await api.post<Coach>("ai-team/act/coach", { user: userId, account: locationId ?? undefined })); } catch (e) { setMade({ ok: false, error: msg(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="pp-note-card" data-testid="ai-coach-card">
      <h3 className="pp-h">Coaching note (AI draft)</h3>
      {r?.ok && r.fix ? (
        <div data-testid="ai-coach-note">
          {r.strengths && r.strengths.length > 0 && <ul className="list-disc pl-5 text-sm">{r.strengths.map((s) => <li key={s}>{s}</li>)}</ul>}
          <p className="mt-1 text-sm"><b>One thing to work on:</b> {r.fix}</p>
        </div>
      ) : <p className="text-sm" data-testid="ai-coach-empty">{r?.error ?? "Not written yet."}</p>}
      <p className="ap-fine mt-1">Private to this person and their manager. Written from their own last 30 days compared with the middle figure of their own team. It never ranks anyone. {SAFE}</p>
      {r?.figures && !r.figures.ready && <p className="ap-fine">Needs at least 10 first replies in 30 days for a fair note (so far {r.figures.firstReplies}).</p>}
      <button type="button" className="s6-btn mt-2" disabled={busy || r?.figures?.ready === false || r?.code === "job_off" || r?.code === "no_connection"} onClick={() => void write()} data-testid="ai-coach-write">{r?.ok ? "Write a new note" : "Write a coaching note"}</button>
    </div>
  );
}

// ---------------------------------------------------------------- why did this move (Clients)

type Moved = { rows: Array<{ locationId: string; name: string; key: string; label: string; direction: string; now: string; usual: string; relativePct: number }>; checked: string };
type Why = { ok: boolean; summary?: string; reasons?: Array<{ reason: string; check: string }>; error?: string };

/** The numbers that moved outside their own normal range (found by code), each with a "Why?" button. `locationId` narrows to one account; none lists the most unusual across the accounts you may read. */
export function MovedNumbers({ locationId }: { locationId?: string }) {
  const api = useApiClient(), on = useFlag("anomaly");
  const list = useData<Moved>(on ? `ai-team?${new URLSearchParams({ part: "anomalies", ...(locationId ? { account: locationId } : {}) })}` : null);
  const [why, setWhy] = useState<Record<string, Why>>({}), [busy, setBusy] = useState<string | null>(null);
  if (!on || list.error || !list.data) return null;
  const ask = async (row: Moved["rows"][number]) => {
    const k = `${row.locationId}:${row.key}`;
    setBusy(k);
    try { const r = await api.post<Why>("ai-team/act/anomaly", { account: row.locationId, key: row.key }); setWhy((w) => ({ ...w, [k]: r })); }
    catch (e) { setWhy((w) => ({ ...w, [k]: { ok: false, error: msg(e) } })); } finally { setBusy(null); }
  };
  return (
    <section className="cl-drill" aria-label="Numbers that moved" data-testid="ai-moved">
      <h3 className="text-sm font-semibold">Numbers that moved outside their normal range</h3>
      <p className="ap-fine">Found by SubSync from each account&apos;s own history ({list.data.checked}). The AI only offers possible reasons and what to check; they are candidates, not conclusions. {SAFE}</p>
      {list.data.rows.length === 0 ? <p className="mt-2 text-sm" data-testid="ai-moved-empty">Nothing has moved outside its normal range.</p> : (
        <ul className="mt-2 grid gap-3">
          {list.data.rows.slice(0, 12).map((row) => {
            const k = `${row.locationId}:${row.key}`, w = why[k];
            return (
              <li key={k} data-testid="ai-moved-row">
                <p className="text-sm"><b>{row.name}</b>: {row.label} is {row.direction === "above" ? "higher" : "lower"} than usual ({row.now} now, {row.usual} usual).
                  <button type="button" className="ap-link ml-2" disabled={busy === k} onClick={() => void ask(row)} data-testid="ai-why">Why?</button></p>
                {w?.ok && <div className="ap-note mt-1" data-testid="ai-why-answer"><p className="text-sm">{w.summary}</p><ul className="mt-1 list-disc pl-5 text-sm">{w.reasons?.map((x) => <li key={x.reason}>{x.reason} <span className="ap-fine">Check: {x.check}</span></li>)}</ul></div>}
                {w && !w.ok && w.error && <p className="ap-fine mt-1" role="status">{w.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- one thing to fix (Clients, account page)

type One = { ok: boolean; text?: string; top?: { count: number; dollars: number | null }; error?: string; code?: string };

export function OneThingCard({ locationId }: { locationId: string }) {
  const api = useApiClient(), on = useFlag("oneThing");
  const peek = useData<One>(on ? `ai-team?${new URLSearchParams({ part: "one-thing", account: locationId })}` : null);
  const [made, setMade] = useState<One | null>(null), [busy, setBusy] = useState(false);
  if (!on || peek.error) return null;
  const r = made ?? peek.data;
  if (r && !r.ok && (r.code === "not_enough")) return <p className="ap-fine" data-testid="ai-one-clear">{r.error}</p>;
  const write = async () => { setBusy(true); try { setMade(await api.post<One>("ai-team/act/one-thing", { account: locationId })); } catch (e) { setMade({ ok: false, error: msg(e) }); } finally { setBusy(false); } };
  return (
    <section className="cl-drill" aria-label="One thing to fix" data-testid="ai-one-thing">
      <h3 className="text-sm font-semibold">One thing to fix this week</h3>
      {r?.ok && r.text ? <p className="mt-1 text-sm" data-testid="ai-one-text">{r.text}</p> : <p className="ap-fine mt-1">{r?.error ?? "Not written yet."}</p>}
      <p className="ap-fine mt-1">SubSync picks the item and works out its count and dollar value; the AI only words it. The same sentence goes in your weekly summary email. {SAFE}</p>
      <button type="button" className="s6-btn mt-2" disabled={busy || r?.code === "job_off" || r?.code === "no_connection"} onClick={() => void write()} data-testid="ai-one-write">{r?.ok ? "Write it again" : "Write it"}</button>
    </section>
  );
}

// ---------------------------------------------------------------- meeting summary and follow-up draft (Meetings)

type Meet = { ok: boolean; summary?: string; followUp?: string; error?: string; code?: string };

export function MeetingAiCard({ meetingId }: { meetingId: string }) {
  const api = useApiClient(), on = useFlag("meeting");
  const peek = useData<Meet>(on ? `ai-team?${new URLSearchParams({ part: "meeting", id: meetingId })}` : null);
  const [made, setMade] = useState<Meet | null>(null), [busy, setBusy] = useState(false), [text, setText] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  if (!on || peek.error) return null;
  const r = made ?? peek.data;
  const write = async () => { setBusy(true); setNote(null); try { const x = await api.post<Meet>("ai-team/act/meeting", { id: meetingId }); setMade(x); setText(null); } catch (e) { setMade({ ok: false, error: msg(e) }); } finally { setBusy(false); } };
  const draft = text ?? r?.followUp ?? "";
  return (
    <section aria-label="AI follow-up draft" className="rounded-xl border p-3" data-testid="ai-meeting">
      <h3 className="text-sm font-semibold">One-line summary and follow-up draft (AI)</h3>
      {r?.ok ? (
        <>
          <p className="mt-1 text-sm" data-testid="ai-meeting-summary">{r.summary}</p>
          <label className="mt-2 grid gap-1 text-sm font-medium">Follow-up draft (edit it, then send it yourself)
            <textarea className="ap-field" style={{ padding: 10, minHeight: 120 }} value={draft} onChange={(e) => setText(e.target.value)} data-testid="ai-meeting-draft" /></label>
          <button type="button" className="s6-btn mt-2" onClick={() => void navigator.clipboard.writeText(draft).then(() => setNote("Copied. Paste it where you write to them."), () => setNote("Could not copy. Select the text yourself."))} data-testid="ai-meeting-copy">Copy the draft</button>
        </>
      ) : <p className="ap-fine mt-1" data-testid="ai-meeting-empty">{r?.error ?? "Not written yet."}</p>}
      <p className="ap-fine mt-1">Written only from the summary your meeting tool made, and only because this account allows it (Settings, AI). It is never sent: you read it and send it yourself. Only you can see this call.</p>
      <button type="button" className="s6-btn mt-2" disabled={busy || r?.code === "job_off" || r?.code === "no_connection"} onClick={() => void write()} data-testid="ai-meeting-write">{r?.ok ? "Write again" : "Write a summary and follow-up"}</button>
      <div aria-live="polite" className="mt-1 min-h-5 text-sm">{note}</div>
    </section>
  );
}
