"use client";

import { hotkeyIgnored } from "@/lib/design/ui-logic";
import { CalendarClock, Check, ChevronRight, Copy, Flame, MessageSquareText, PhoneCall, SkipForward, Sparkles, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtWhen } from "@/lib/analytics/speed6";
import { dialPlan } from "@/lib/people/dial";
import { DEFAULT_SCRIPT, fillScript, keyOf, outcomeOf, quietWarning, sessionSummary, skipReason, taskFor, type Logged, type QueueItem } from "@/lib/dial/dial";
import { bookingText, BOOKING_TEXT, callScreen, callWindow, classifyQueue, planSession, startState, dispositionWrites, cleanTag, DEFAULT_WINDOW, noteDraft, powerHour, reorderByHeat, scriptFor, todaysCallbacks, type AttemptState, type BoardRow, type CadenceStep, type Disposition, type Waiting } from "@/lib/dial/dial6";
import { detectionKey, firstTime, inferDetected, POLL_EVERY_MS, pollDue, rulesFrom, skipOwnNote, toastText, type Inferred, type Signals } from "@/lib/dial/autosync";
import type { Action } from "@/lib/ghl/workbench";
import { useApiClient, useData } from "../session";
import { EmptyState, ErrorState, InlineAlert, SkeletonRows, useDialer } from "../ds";
import { announceCall } from "../ds/dial-button";
import { InfoTip } from "../ds/info-tip";
import { fmtMoney } from "../ui";
import { PeoplePopup, type PersonRow } from "./dial-people";
import { CallQueueCard } from "./dial-queue-panel";
import { cadenceSummary, touchRow } from "@/lib/dial/touch";
import { PrefsCtx, useScripts, ActivityCard, AttemptCard, BestHourCard, Board6, CadenceCard, DispositionEditor, PowerBar, useCadence, useCallbacks, useDispositions, useGoals, useLocal, useTick, type SavedCallback } from "./dial6-ui";
import { CountUp, Fold, TzNote } from "./speed6-base";
import { useSpeedFilter } from "./speed-filter";
import "./speed6.css";
import "./call-cards.css";

// Call mode (stages DIAL and SPEED6, docs/features/DIAL.md and SPEED6.md): a power dialer without telephony. The call is placed in the customer's own CRM phone; SubSync orders the list, feeds it one
// lead at a time, tracks the redial plan and the lead's own clock, and logs how the call went (its own record, plus a short note, tags and tasks through the one write gateway: a dry run until writes are on).

type Item = QueueItem & { source?: string | null };
type Queue = { list: string; lists: Array<{ id: string; label: string; help: string }>; total: number; page?: number; size?: number; dollars?: number | null; ownOnly: boolean; me: string | null; items: Item[] };
type Stats = { people: Array<{ userId: string; name: string; calls: number; perHour: number | null; outcomes: Record<string, number> }>; own: boolean };
type Insights = {
  now: number; states: Array<[string, AttemptState]>; best: { hour: number; rate: number; tries: number } | null; byAttempt: Array<{ attempt: number; leads: number; booked: number; rate: number | null }>;
  board: BoardRow[]; ownRank: { rank: number; of: number } | null; teamVisible: boolean; activity: Array<{ locationId: string; name: string; calls: number; reached: number; booked: number; last: number }>;
};
type Ctx = { mode: { live: boolean; demo: boolean }; tags: string[]; deals: Array<{ id: string; name: string | null; stageName: string | null; value: number; status: string }>; me: string | null };
type Story = { events: Array<{ at: number; kind: string; text: string }> };
/** A lead in a running session: the queue row plus where it stands in the redial plan and in its own clock. */
type Card = Item & { key: string; step: CadenceStep; attempts: number; callbackDue: boolean; windowOk: boolean; waitingForRedial: boolean };
type Later = { key: string; name: string; why: string };
function useNowEvery(ms: number) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

const BIG = "ds-press inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--s6-edgec)_25%,transparent)] bg-[color-mix(in_srgb,var(--s6-cyan)_6%,transparent)] px-4 text-[15px] font-medium hover:bg-[color-mix(in_srgb,var(--s6-cyan)_16%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "s6-btn !min-h-12 !px-6 !text-base";
const initials = (name: string) => { const p = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase(); };
const when = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Provides the server-kept choices (redial plan, goals, scripts, outcome sets) to everything in Call mode; falls back to this browser until the database has them. */
export function DialMode() {
  const api = useApiClient();
  const prefs = useData<{ ready: boolean; prefs: Record<string, unknown> }>("speed/prefs");
  const put = (key: string, scope: string, value: unknown) => { void api.put("speed/prefs", { key, scope, value }).then(() => prefs.reload()).catch(() => undefined); };
  return <PrefsCtx.Provider value={{ ready: prefs.data?.ready === true, map: prefs.data?.prefs ?? {}, put }}><DialInner /></PrefsCtx.Provider>;
}

function DialInner() {
  const [list, setListRaw] = useState("missed");
  const { range } = useSpeedFilter();
  // The page and its size are server-side (20, 50 or 100 people at a time); a new list, size or date range starts at the first page.
  const rangeKey = range ? `${range.from}:${range.to}` : "";
  const [pg, setPg] = useState({ k: `missed|50|${rangeKey}`, n: 0, size: 50 });
  const pageKey = `${list}|${pg.size}|${rangeKey}`;
  const page = pg.k === pageKey ? pg.n : 0;
  const setPage = (n: number) => setPg({ k: pageKey, n, size: pg.size });
  const setSize = (size: number) => setPg({ k: `${list}|${size}|${rangeKey}`, n: 0, size });
  const setList = (l: string) => { setNotice(null); setListRaw(l); setPg({ k: `${l}|${pg.size}|${rangeKey}`, n: 0, size: pg.size }); };
  const [view, setView] = useState<"lists" | "callbacks">("lists");
  const queue = useData<Queue>(`dial/queue?list=${encodeURIComponent(list)}&page=${page}&size=${pg.size}${range ? `&from=${range.from}&to=${range.to}` : ""}`);
  const stats = useData<Stats>("dial/stats");
  const ins = useData<Insights>("dial/insights");
  const [cadence, setCadence] = useCadence();
  const [goals, setGoals] = useGoals();
  const [cbs, setCbs] = useCallbacks();
  const [autoOn, setAutoOn] = useLocal<boolean>("subsync.dial.auto", true);
  const [session, setSession] = useState<S | null>(null);
  const [pop, setPop] = useState<{ title: string; note?: string; rows: PersonRow[]; selectable?: boolean } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const nowMs = useNowEvery(30_000); // calling hours open and close while the page stays open, so the counts are re-read twice a minute
  const [notice, setNotice] = useState<string | null>(null);
  const states = useMemo(() => new Map(ins.data?.states ?? []), [ins.data]);

  /** The one rule for who can be called now (classifyQueue): the count, the Start button and the session all come from it. */
  const place = (items: Item[], now: number, o: { ignoreSnooze?: boolean; skipReached?: boolean } = {}) => classifyQueue(items, { now, cadence, states, callbacks: cbs, ...o });
  const laterRow = (w: Waiting<Item>): Later => ({ key: w.key, name: w.name, why: w.kind === "hours" ? w.why : w.kind === "redial" ? `try again at ${fmtWhen(w.at ?? 0, w.timeZone)}` : `call at ${fmtWhen(w.at ?? 0, w.timeZone)}` });
  const start = (items: Item[], power: boolean, o: { ignoreSnooze?: boolean } = {}) => {
    const now = Number(new Date());
    const plan = planSession(items, { now, cadence, states, callbacks: cbs, ...o, skipReached: list !== "missed" && !o.ignoreSnooze });
    // Never open a session that would end at once: with nobody callable now, say why and what happens next.
    if (!plan.started) { setNotice(`${plan.reason} Pick another list in the meantime.`); return; }
    setNotice(null);
    setSession({ items: plan.items, idx: 0, done: new Set(), logged: [], skips: 0, finished: false, later: plan.waiting.map(laterRow), texts: plan.texts.map((t) => ({ key: t.key, name: t.name, why: `${t.attempts} tries, send a text` })), timed: power ? { startedAt: now, minutes: 60 } : null, streak: 0, skippedAtStart: plan.skipped });
  };

  if (session) return <Session s={session} setS={setSession} cadence={cadence} goals={goals} setCbs={setCbs} cbs={cbs} onExit={() => { setSession(null); void queue.reload(); void stats.reload(); void ins.reload(); }} me={queue.data?.me ?? null} />;

  const d = queue.data;
  // Who can be called NOW, who waits (and why) and who cannot be called from here: one rule (classifyQueue), so the count, the Start button and the session agree.
  const cls = place(d?.items ?? [], nowMs, { skipReached: list !== "missed" });
  const ready = cls.ready.length;
  const go = startState(cls);
  const readyKeys = new Set(cls.ready.map((x) => x.key));
  const blocked = cls.skipped.length;
  const waiting = cls.waiting;
  const screen = callScreen({ ready, waiting });
  const otherList = (d?.lists ?? []).find((l) => l.id !== list)?.id ?? null;
  const todays = todaysCallbacks(cbs, nowMs, null);
  const touches = (d?.items ?? []).map((i) => ({ it: i, t: touchRow(keyOf(i), states.get(keyOf(i)), cadence, nowMs, i.timeZone) }));
  const toPerson = ({ it, t }: (typeof touches)[number]): PersonRow => ({
    key: t.key, name: it.name, account: it.locationName, chip: `touch ${t.touch} of ${t.of}`, chipTone: t.state === "waiting" ? "cyan" : t.state === "text_fallback" ? "red" : "amber",
    detail: t.state === "waiting" && t.nextAt ? `Next try ${fmtWhen(t.nextAt, it.timeZone)}${it.timeZone ? " their time" : ""}` : t.state === "text_fallback" ? "Every try used: a text task" : t.state === "due" ? "Ready for its next try now" : "Not called yet",
    tip: `${it.name}: ${(it.reasons ?? []).join(", ")}`,
    seed: { contactId: it.contactId, locationId: it.locationId, name: it.name, locationName: it.locationName, phone: it.phone, url: it.url, dnd: it.dnd, timeZone: it.timeZone, note: (it.reasons ?? [])[0] },
    phone: it.phone, dnd: it.dnd, timeZone: it.timeZone, url: it.url,
  });
  /** A person who is not callable now: no Call button (calling hours and the other rules hold), but their number and a link to open them in the CRM stay. */
  const heldRow = (it: Item, chip: string, tone: "cyan" | "amber" | "red", detail: string): PersonRow => ({ key: keyOf(it), name: it.name, account: it.locationName, chip, chipTone: tone, detail, tip: `${it.name}: ${detail}`, phone: it.phone, dnd: it.dnd, timeZone: it.timeZone, url: it.url, openCrm: true });
  const waitRow = (w: Waiting<Item>) => heldRow(w, w.kind === "hours" ? "calling hours" : w.kind === "redial" ? "next try" : "call later", w.kind === "hours" ? "amber" : "cyan", w.kind === "hours" ? `Opens ${DEFAULT_WINDOW.start}:00 their time${w.at ? ` (${fmtWhen(w.at, w.timeZone)})` : ""}` : w.kind === "redial" ? `Next try ${fmtWhen(w.at ?? 0, w.timeZone)}` : `Asked for a call ${fmtWhen(w.at ?? 0, w.timeZone)}`);
  const sum = cadenceSummary(touches.map((x) => x.t));
  const keysOf = (ks: string[]) => touches.filter((x) => ks.includes(x.t.key)).map(toPerson);
  const ex = sum.example ? touches.find((x) => x.t.key === sum.example?.key) : undefined;
  const changes = d ? (
    <div className="mt-3 border-t pt-3 text-sm" data-testid="cad-changes">
      <p className="font-medium">What this changes</p>
      {ex && sum.example ? <p className="s6-label mt-1" data-testid="cad-example">{ex.it.name}: touch {sum.example.touch} of {sum.example.of}{sum.example.nextAt ? `, next try ${fmtWhen(sum.example.nextAt, ex.it.timeZone)}${ex.it.timeZone ? " their time" : ""}` : ", due now"}.</p> : <p className="s6-label mt-1">No lead on this list has been tried yet, so there is no example.</p>}
      <p className="s6-label mt-1">
        <button type="button" className="s6-link" data-testid="cad-waiting" onClick={() => setPop({ title: "Waiting for their next try", rows: keysOf(sum.waiting) })}>{sum.waiting.length} {sum.waiting.length === 1 ? "lead" : "leads"} waiting for their next try</button>
        {", "}<button type="button" className="s6-link" data-testid="cad-text" onClick={() => setPop({ title: "Used every try, now a text task", rows: keysOf(sum.textNow) })}>{sum.textNow.length} reach the text task</button>{" (this list)."}
      </p>
      <p className="s6-label mt-1">No-answer leads come back in the Redial list and the queue after this wait; after the last try SubSync makes a text task.</p>
    </div>
  ) : null;
  const callbackItem = (c: SavedCallback): Item => ({ contactId: c.contactId, locationId: c.locationId, locationName: c.locationName, name: c.name, phone: c.phone, dnd: false, timeZone: c.timeZone, openValue: 0, ageHours: 0, priority: 90, reasons: ["Promised callback"], url: c.url });
  return (
    <section aria-label="Call mode" data-testid="dial-pick" className="cm ds-enter">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Who do I call next?</h2>
        <InfoTip label="How calling works here" testId="dial-how" text="Calls go through your CRM's own phone, with your own number and provider. SubSync costs nothing extra for calling: it puts the people in order, feeds them to you one at a time, and writes down how each call went." />
      </div>
      <p className="s6-sub">Pick a list and press Start. SubSync never places a call.</p>
      <TzNote />
      <div className="cm-seg" role="group" aria-label="Choose a list">
        {(d?.lists ?? [{ id: "missed", label: "Missed calls, no callback", help: "" }]).map((l) => {
          const on = view === "lists" && list === l.id;
          return (
            <button key={l.id} type="button" onClick={() => { setList(l.id); setView("lists"); }} aria-pressed={on} title={l.help || undefined} data-testid={`dial-list-${l.id}`} className="cm-seg-i">
              {l.label}{on && d && d.list === l.id && <span className="cm-n" data-testid={`dial-list-count-${l.id}`}>{d.total.toLocaleString("en-US")}</span>}
            </button>
          );
        })}
        <button type="button" onClick={() => setView("callbacks")} aria-pressed={view === "callbacks"} data-testid="dial-view-callbacks" className="cm-seg-i"><CalendarClock aria-hidden />Today&apos;s callbacks<span className="cm-n">{todays.length}</span></button>
      </div>

      {view === "callbacks" ? (
        <div className="s6-card mb-8" data-testid="dial-callbacks">
          <h3 className="s6-q">Who asked for a callback today?</h3>
          {todays.length === 0 ? <p className="s6-label mt-2" data-testid="callbacks-empty">Nobody has a callback today. When someone says &quot;call me later&quot;, pick Call back later and a time: they show up here.</p> : (
            <ul className="s6-ready mt-3">{todays.map((c) => { const full = cbs.find((x) => x.key === c.key && x.at === c.at) as SavedCallback; const can = place([callbackItem(full)], nowMs, { ignoreSnooze: true }); const closed = can.waiting.find((w) => w.kind === "hours"); const noNumber = can.skipped[0]; return (
              <li key={c.key + c.at} data-testid="callback-row"><span className="s6-chip" data-tone={c.at <= nowMs ? "red" : "cyan"}>{fmtWhen(c.at, full.timeZone)}</span><span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>{c.locationName && <span className="s6-label">{c.locationName}</span>}
                {closed && <span className="s6-chip" data-tone="amber" data-testid="callback-closed">{closed.why}</span>}{noNumber && <span className="s6-chip" data-tone="red" data-testid="callback-skipped" title={noNumber.block.text}>cannot be called from here</span>}
                <button type="button" className="s6-btn" data-kind="primary" disabled={can.ready.length === 0} title={can.ready.length === 0 ? (closed ? `Calling hours are closed where they are: ${closed.why}.` : noNumber?.block.text) : undefined} onClick={() => start([callbackItem(full)], false, { ignoreSnooze: true })} data-testid="callback-call">Call now</button>
                <button type="button" className="s6-btn" onClick={() => setCbs(cbs.filter((x) => !(x.key === c.key && x.at === c.at)))} aria-label={`Done with ${c.name}`}>Done</button></li>); })}</ul>
          )}
        </div>
      ) : queue.error ? <ErrorState error={queue.error} onRetry={queue.reload} /> : !d ? <SkeletonRows rows={3} label="Building your call list..." /> : d.items.length === 0 ? (
        <EmptyState title={list === "missed" ? "No missed calls to call back" : list === "redial" ? "Nobody to try again" : "Nobody to call on this list"} body={d.ownOnly ? "Nobody assigned to you is waiting on this list. Pick another list." : list === "redial" ? "People who did not pick up show up here for another try. Call someone first." : "Nothing is waiting here right now. Pick another list, or check back after the next sync."} />
      ) : (
        <div className="cm-card mb-8" data-testid="dial-ready">
          <div className="cm-sec">
          <p className="cm-eyebrow">{(d.lists.find((l) => l.id === list)?.label) ?? "Your list"}</p>
          <p className="cm-count" data-testid="dial-count"><button type="button" className="s6-link text-left" data-testid="dial-count-open" onClick={() => setPop({ title: "Ready to call", note: d.total > d.items.length ? `${(page * pg.size + 1).toLocaleString("en-US")} to ${(page * pg.size + d.items.length).toLocaleString("en-US")} of ${d.total.toLocaleString("en-US")}, hottest first.` : undefined, rows: touches.filter((x) => readyKeys.has(x.t.key)).map(toPerson), selectable: true })}>{ready > 0 ? <><CountUp value={ready} /> {ready === 1 ? "person" : "people"} ready to call now</> : screen.headline}{d.total > d.items.length ? `, showing ${(page * pg.size + 1).toLocaleString("en-US")} to ${(page * pg.size + d.items.length).toLocaleString("en-US")} of ${d.total.toLocaleString("en-US")}` : ""}.</button></p>
          <p className="cm-note"><span data-testid="dial-next-step">{screen.line}</span>{blocked > 0 && <> <button type="button" className="s6-link" data-testid="dial-blocked-open" onClick={() => setPop({ title: "Will be skipped", note: "Asked not to be contacted, no number saved here, or already reached. Open them in your CRM if you need to.", rows: cls.skipped.map((x) => heldRow(x, x.block.kind === "dnd" ? "do not contact" : x.block.kind === "done" ? "already reached" : x.noRecord ? "no record yet" : "no number", "red", x.block.text)) })}>{blocked} will be skipped</button> (asked not to be contacted, no number saved, or already reached).</>}{d.ownOnly ? " Only people assigned to you." : ""}</p>
          {waiting.length > 0 && (
            <p className="mt-2 text-sm" data-testid="dial-waiting" role="status"><span className="s6-chip mr-2" data-tone="amber">waiting</span><button type="button" className="s6-link text-left" data-testid="dial-waiting-open" onClick={() => setPop({ title: "Not callable yet", note: "They will be callable once their calling hours open, their next try is due, or the call they asked for is due. Calling hours are 9:00 to 20:00 their time.", rows: waiting.map(waitRow) })}>See who is waiting ({waiting.length})</button></p>
          )}
          {cls.texts.length > 0 && <p className="s6-label mt-1" data-testid="dial-texts"><button type="button" className="s6-link text-left" onClick={() => setPop({ title: "Used every try, now a text task", rows: cls.texts.map((x) => heldRow(x, "text instead", "red", "Every try used: a text task")) })}>{cls.texts.length} {cls.texts.length === 1 ? "person has" : "people have"} used every try: text instead</button>.</p>}
          {notice && <p className="cm-notice" role="status" data-testid="dial-notice">{notice}</p>}
          </div>
          {/* The main button is always live: with people ready it starts calling; with nobody ready it does the useful thing (queue the waiting people in your CRM) or points to another list. */}
          {screen.mode === "ready" && !pop && <EnterKey onEnter={() => start(d.items, false)} />}
          <CallQueueCard list={list} items={d.items.filter((i) => !skipReason(i))} picked={picked} onPickedDone={() => setPicked([])} showSend={screen.mode === "ready"}
            tools={<button type="button" className="cm-tool" data-tip="A timed hour of calling with goals for calls, people reached and bookings." onClick={() => (go.enabled ? start(d.items, true) : setNotice(screen.powerNote))} data-testid="dial-start-power"><Zap aria-hidden />Power hour</button>}
            primary={(review, busy) => (
              <>
                {screen.mode === "ready" && <button type="button" className="cm-primary" data-kind="primary" onClick={() => start(d.items, false)} data-testid="dial-start" aria-keyshortcuts="Enter"><PhoneCall aria-hidden className="size-[18px]" />{screen.primary}<span className="cm-kbd" aria-hidden>↵</span></button>}
                {screen.mode === "waiting" && <button type="button" className="cm-primary" data-kind="primary" onClick={review} disabled={busy} data-testid="cq-send">{screen.primary}</button>}
                {screen.mode === "empty" && <button type="button" className="cm-primary" data-kind="primary" onClick={() => { if (otherList) { setList(otherList); setView("lists"); } else void queue.reload(); }} data-testid="dial-start">{screen.primary}</button>}
              </>
            )} />
          {(d.total > 20 || page > 0) && (
            <div className="cm-sec flex flex-wrap items-center gap-2 text-sm" data-testid="dial-pager">
              <button type="button" className="s6-btn" disabled={page === 0} onClick={() => setPage(page - 1)} data-testid="dial-prev">Previous</button>
              <span className="s6-label" data-testid="dial-page-text">Page {page + 1} of {Math.max(1, Math.ceil(d.total / pg.size)).toLocaleString("en-US")}</span>
              <button type="button" className="s6-btn" disabled={(page + 1) * pg.size >= d.total} onClick={() => setPage(page + 1)} data-testid="dial-next">Next</button>
              <label className="s6-label ml-auto flex items-center gap-2">People per page<select className="s6-num !w-20" value={pg.size} onChange={(e) => setSize(Number(e.target.value))} data-testid="dial-size">{[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
          )}
          <div className="cm-sec cm-prefs"><div className="flex items-center gap-3" data-testid="auto-row"><button type="button" role="switch" aria-checked={autoOn} aria-label="Auto-detect calls" className="s6-toggle" onClick={() => setAutoOn(!autoOn)} data-testid="auto-toggle" /><span className="text-sm font-medium">Auto-detect calls (recommended)</span><InfoTip label="What auto-detect does" text="When you call from your CRM, SubSync reads the call it records (answered, no answer, voicemail and how long) and the tag, appointment or do-not-disturb you set there, then logs the outcome and moves to the next lead. It only asks when it cannot tell." /></div>
          <div className="flex flex-wrap items-center gap-4" data-testid="goal-row">
            <span className="s6-label">Hour goals</span>
            {(["calls", "reached", "booked"] as const).map((k) => <label key={k} className="flex items-center gap-2"><span className="s6-label">{k}</span><input type="number" min={1} max={500} className="s6-num !w-16" value={goals[k]} onChange={(e) => setGoals({ ...goals, [k]: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} aria-label={`Goal for ${k}`} data-testid={`goal-${k}`} /></label>)}
          </div>
          </div>
        </div>
      )}

      <Fold keep={3} testId="dial-fold">
        <div className="s6-grid s6-three">
          <CadenceCard cadence={cadence} set={setCadence} extra={changes} />
          <BestHourCard best={ins.data?.best ?? null} />
          <AttemptCard rows={ins.data?.byAttempt ?? []} />
          {ins.data && ins.data.teamVisible && <ActivityCard rows={ins.data.activity} />}
        </div>
      </Fold>
      {ins.data && <div className="mb-8" data-testid="board-wrap"><Board6 rows={ins.data.board} own={ins.data.ownRank} /></div>}
      {stats.data && stats.data.people.length > 0 && (
        <div className="mt-2" data-testid="dial-stats">
          <h3 className="mb-1 text-sm font-semibold">{stats.data.own ? "Your calls in the last 12 hours" : "Calls logged in the last 12 hours"}</h3>
          <ul className="divide-y divide-[color-mix(in_srgb,var(--s6-line)_90%,transparent)] rounded-lg border border-[color-mix(in_srgb,var(--s6-line)_90%,transparent)] text-sm">
            {stats.data.people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"><span className="font-medium">{p.name}</span><span>{p.calls} {p.calls === 1 ? "call" : "calls"}</span>{p.perHour !== null && <span>{p.perHour} an hour</span>}
                <span className="text-muted-foreground">{Object.entries(p.outcomes).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(", ")}</span></li>
            ))}
          </ul>
        </div>
      )}
      {pop && <PeoplePopup title={pop.title} note={pop.note} rows={pop.rows} onClose={() => setPop(null)} onSendSelected={pop.selectable ? (keys) => { setPicked(keys); setPop(null); } : undefined} />}
    </section>
  );
}

/** Enter starts calling when nothing else has the keyboard (the hint on the main button). Mounted only while the main button is "Start calling". */
function EnterKey({ onEnter }: { onEnter: () => void }) {
  const latest = useRef(onEnter);
  useEffect(() => { latest.current = onEnter; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || (t && t !== document.body && /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(t.tagName)) || document.querySelector('[role="dialog"]:not([hidden])')) return;
      e.preventDefault(); latest.current();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return null;
}

type S = { skippedAtStart?: number; items: Card[]; idx: number; done: Set<string>; logged: Logged[]; skips: number; finished: boolean; later: Later[]; texts: Later[]; timed: { startedAt: number; minutes: number } | null; streak: number };

function Session({ s, setS, onExit, me, cadence, goals, cbs, setCbs }: {
  s: S; setS: (f: (p: S | null) => S | null) => void; onExit: () => void; me: string | null;
  cadence: ReturnType<typeof useCadence>[0]; goals: ReturnType<typeof useGoals>[0]; cbs: SavedCallback[]; setCbs: (v: SavedCallback[]) => void;
}) {
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
  const [hover, setHover] = useState<Disposition | null>(null);
  const [link, setLink] = useLocal<string>("subsync.dial.bookingLink", "");
  const [textMsg, setTextMsg] = useState<string | null>(null);
  const [scripts, setScripts] = useScripts();
  const [dispo, setDispo] = useDispositions(item?.locationId ?? null);
  const now = useTick(s.timed !== null);

  const ctx = useData<Ctx>(item ? `workbench/context?locationId=${item.locationId}&contactId=${item.contactId}` : null);
  const story = useData<Story>(item ? `speed?part=story&loc=${item.locationId}&contact=${item.contactId}` : null);
  const scriptQ = useData<{ script: string | null; default: string; canEdit: boolean }>(item ? `dial/script?locationId=${item.locationId}` : null);
  const [draft, setDraft] = useState<{ loc: string; text: string } | null>(null);
  const localKey = item ? `subsync.dial.script.${item.locationId}` : "";
  const stored = (() => { try { return localKey ? window.localStorage.getItem(localKey) : null; } catch { return null; } })();
  const accountScript = scriptQ.data?.script ?? stored ?? DEFAULT_SCRIPT;
  const script = draft && item && draft.loc === item.locationId ? draft.text : scriptFor(scripts, item?.source, accountScript);

  const warn = item ? quietWarning(item.timeZone, new Date()) : null;
  const plan = item ? dialPlan(choice, { phone: item.phone, contactUrl: item.url }) : null;
  const key = item ? keyOf(item) : "";
  const shown = useMemo(() => (item ? fillScript(script, { name: item.name, me: ctx.data?.me ?? me, business: item.locationName }) : ""), [item, script, ctx.data?.me, me]);
  const hour = s.timed ? powerHour({ startedAt: s.timed.startedAt, now, minutes: s.timed.minutes, goals, logged: s.logged }) : null;

  /** After each outcome the rest of the queue is re-ranked by heat with the lead's own clock; a lead whose calling window has just closed moves to "later". */
  const advance = useCallback((from: number, logged: Logged[], done: Set<string>, skipsAdd: number, redialKey: string | null, reachedNow: boolean | null) => {
    setS((p) => {
      if (!p) return p;
      const t = Date.now();
      const head = p.items.slice(0, from + 1);
      const rest = p.items.slice(from + 1).filter((c) => !done.has(c.key));
      const later = [...p.later];
      const live: Card[] = [];
      for (const c of rest) {
        const w = callWindow(t, c.timeZone, DEFAULT_WINDOW);
        if (!w.ok && !skipReason(c)) later.push({ key: c.key, name: c.name, why: w.label ?? "later" }); else live.push({ ...c, windowOk: w.ok, attempts: c.key === redialKey ? c.attempts + 1 : c.attempts });
      }
      const items = [...head, ...reorderByHeat(live)];
      let n = -1;
      for (let i = from + 1; i < items.length; i++) if (!skipReason(items[i], done, items[i].key)) { n = i; break; }
      return { ...p, items, idx: n, logged, done, skips: p.skips + skipsAdd, finished: n === -1, later, streak: reachedNow === null ? p.streak : reachedNow ? p.streak + 1 : 0 };
    });
    setCallback(null); setOkQuiet(false); setDraft(null); setTextMsg(null);
  }, [setS]);

  const gateway = async (it: Card, acts: Action[]): Promise<string> => {
    const base = { locationId: it.locationId, contactId: it.contactId };
    let dry = false;
    try {
      for (const action of acts) {
        const pv = await api.post<{ plan: { blockers: Array<{ text: string }> } }>("workbench/preview", { ...base, action });
        if (pv.plan.blockers.length) return `Not written to your CRM: ${pv.plan.blockers[0].text}`;
        const r = await api.post<{ dryRun?: boolean }>("workbench/do", { ...base, action, confirm: true, ack: [] });
        if (r.dryRun) dry = true;
      }
    } catch (e) { return `Not written to your CRM: ${(e as Error).message}`; }
    return dry ? "Dry run: your CRM was not changed (writing is switched off)." : "Saved in your CRM.";
  };

  // ---- auto outcome sync: the rep calls in the CRM; SubSync reads what the CRM recorded and logs the outcome itself.
  const [auto] = useLocal<boolean>("subsync.dial.auto", true);
  const [called, setCalled] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; card: Card; via: "call" | "crm" } | null>(null);
  const [chips, setChips] = useState<{ pre: Disposition["base"] | null; card: Card | null; correction: boolean } | null>(null);
  const seen = useRef(new Set<string>());
  /** Logs an outcome. `o.inf` marks one that came from the CRM (auto-synced). `o.correction` re-logs the PREVIOUS lead without moving on. */
  const record = useCallback(async (d: Disposition, at: string | null, o: { target?: Card; inf?: Inferred; crmHasCall?: boolean; correction?: boolean } = {}) => {
    const it = o.target ?? item;
    if (!it || busy) return;
    setBusy(true); setErr(null);
    const oc = outcomeOf(d.base);
    const k = keyOf(it);
    try { await api.post("dial/outcome", { locationId: it.locationId, contactId: it.contactId, outcome: d.base, ...(at ? { callbackAt: at } : {}) }); }
    catch (e) { setErr((e as Error).message); setBusy(false); return; }
    let crm = "Saved in SubSync only.";
    if (writeCrm) {
      const acts: Action[] = [];
      // The CRM already holds this call (it is where the rep placed it): SubSync adds no second note.
      if (!skipOwnNote(o.inf !== undefined, o.crmHasCall === true)) acts.push({ kind: "note", text: noteDraft({ disposition: d.label, name: it.name, attempt: it.attempts + 1, max: cadence.maxAttempts, source: it.source ?? null, callbackAt: at }) });
      const t = taskFor(d.base, it.name, at, new Date());
      if (t) acts.push({ kind: "task", title: t.title, dueDate: t.dueDate });
      // A tag the rep already set in the CRM is not written again.
      if (o.inf?.via !== "crm") for (const w of dispositionWrites(d)) acts.push(w);
      if (d.doNotCall && o.inf?.via !== "crm" && !(d.tag && cleanTag(d.tag) === "do-not-call")) acts.push({ kind: "tag_add", tag: "do-not-call" });
      if (d.next === "redial" && it.attempts + 1 >= cadence.maxAttempts) acts.push({ kind: "task", title: `Text ${it.name}: ${cadence.maxAttempts} tries, no answer`, dueDate: new Date(Date.now() + 3_600_000).toISOString() });
      crm = acts.length ? await gateway(it, acts) : "The CRM already has the call.";
    }
    if (d.base === "call_back" && at) setCbs([...cbs.filter((c) => c.key !== k), { key: k, name: it.name, at: new Date(at).getTime(), phone: it.phone, locationId: it.locationId, contactId: it.contactId, locationName: it.locationName, timeZone: it.timeZone, url: it.url }]);
    setStatus(`${it.name}: ${d.label}. ${crm}`);
    if (o.correction) { setToast(null); setChips(null); setBusy(false); return; }
    const logged = [...s.logged, { outcome: d.base, at: Date.now() }];
    const done = new Set(s.done); done.add(k);
    if (o.inf) setToast({ text: toastText(it.name, o.inf), card: it, via: o.inf.via });
    advance(s.idx, logged, done, 0, d.next === "redial" ? k : null, oc.reached);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, busy, api, writeCrm, s, advance, cadence, cbs]);

  const check = async (): Promise<"done" | "asked" | "none"> => {
    if (!item || called === null || !auto) return "none";
    let sig: Signals;
    try { sig = await api.get<Signals>(`dial/detect?locationId=${item.locationId}&contactId=${item.contactId}&since=${called - 5000}`); } catch { return "none"; }
    const inf = inferDetected(sig, rulesFrom(dispo));
    if (!inf) return "none";
    if (!firstTime(seen.current, detectionKey(key, sig, inf))) return "done";
    if (inf.confidence === "ambiguous") { setChips({ pre: inf.base, card: item, correction: false }); return "asked"; }
    const d = dispo.find((x) => x.base === inf.base) ?? dispo[0];
    await record(d, null, { inf, crmHasCall: sig.call !== null });
    setCalled(null);
    return "done";
  };
  const checkRef = useRef(check);
  useEffect(() => { checkRef.current = check; });
  useEffect(() => {
    if (called === null || !auto) return;
    const t = setInterval(() => { if (pollDue(called, Date.now())) void checkRef.current(); else setCalled(null); }, POLL_EVERY_MS);
    return () => clearInterval(t);
  }, [called, auto]);
  useEffect(() => {
    const back = async () => { if (document.visibilityState !== "visible" || called === null || !auto) return; if ((await checkRef.current()) === "none") setChips((c) => c ?? { pre: null, card: null, correction: false }); };
    document.addEventListener("visibilitychange", back); window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [called, auto]);

  const pick = (d: Disposition) => { if (d.next === "callback" || d.base === "call_back") { setCallback((c) => c ?? new Date(Date.now() + 86_400_000 - (new Date().getTimezoneOffset() * 60_000)).toISOString().slice(0, 16)); } else void record(d, null); };
  const skip = useCallback(() => { if (item && !busy) { const done = new Set(s.done); done.add(key); advance(s.idx, s.logged, done, 1, null, null); setStatus(`Skipped ${item.name}.`); } }, [item, busy, s, key, advance]);

  const textBooking = async () => {
    if (!item) return;
    if (!link.trim()) { setTextMsg("Paste your booking link below first."); return; }
    setTextMsg("Working...");
    const text = bookingText(BOOKING_TEXT, { name: item.name, me: ctx.data?.me ?? me, business: item.locationName, link: link.trim() });
    setTextMsg(await gateway(item, [{ kind: "message", channel: "SMS", text }]));
  };

  // Keyboard: N skips to the next person, 1 to 9 are the outcomes. Ignored while typing.
  const latest = useRef({ pick, skip, callback, dispo });
  useEffect(() => { latest.current = { pick, skip, callback, dispo }; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (hotkeyIgnored(e) || latest.current.callback !== null) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); latest.current.skip(); return; }
      const d = latest.current.dispo[Number(e.key) - 1];
      if (d && /^[1-9]$/.test(e.key)) { e.preventDefault(); latest.current.pick(d); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (s.finished || !item) return <Finish s={s} onExit={onExit} />;

  const total = s.items.length;
  const position = Math.min(total, s.done.size + 1);
  const copy = async () => { try { await navigator.clipboard.writeText(item.phone ?? ""); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("Copy this number", item.phone ?? ""); } };
  const callNow = () => { if (plan?.href) { window.open(plan.href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); announceCall(); setCalled(Date.now()); setChips(null); } };
  const events = (story.data?.events ?? []).slice(-5).reverse();
  const open = (ctx.data?.deals ?? []).filter((x) => x.status === "open");
  const mode = ctx.data?.mode;
  const previewNote = noteDraft({ disposition: (hover ?? dispo[0]).label, name: item.name, attempt: item.attempts + 1, max: cadence.maxAttempts, source: item.source ?? null });
  const sourceKey = (item.source ?? "").toLowerCase().trim();

  return (
    <section aria-label="Calling" data-testid="dial-session" className="cm ds-enter mx-auto max-w-2xl">
      {hour && <PowerBar msLeft={hour.msLeft} over={hour.over} streak={s.streak} rings={hour.rings} goals={goals} calls={hour.calls} reached={hour.reached} booked={hour.booked} />}
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between text-sm"><span className="font-medium" data-testid="dial-progress-text">{position} of {total}</span><button type="button" onClick={onExit} className="min-h-9 text-muted-foreground underline" data-testid="dial-end">End session</button></div>
          <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--s6-line)_80%,transparent)]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position} aria-label="Progress through the list"><div className="h-full rounded-full bg-[var(--s6-cyan)] shadow-[0_0_10px_color-mix(in_srgb,var(--s6-cyan)_70%,transparent)] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round((position / Math.max(1, total)) * 100)}%` }} /></div>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {status && <p className="mb-2 text-sm text-muted-foreground" data-testid="dial-status">{status}</p>}
      {toast && (
        <div className="s6-card s6-enter mb-3 flex flex-wrap items-center gap-3 !p-3" role="status" data-testid="dial-toast" data-glow="active">
          <Sparkles aria-hidden className="size-4 text-[var(--s6-cyan)]" /><span className="text-sm font-medium" data-testid="dial-toast-text">{toast.text}</span><span className="s6-chip" data-tone="cyan" data-testid="auto-synced">auto-synced</span>
          <button type="button" className="s6-btn !min-h-9" data-testid="dial-toast-change" onClick={() => { setChips({ pre: null, card: toast.card, correction: true }); setToast(null); }}>Undo / change</button>
        </div>
      )}
      {err && <InlineAlert tone="danger" className="mb-2">{err}</InlineAlert>}

      <div className="cm-card" data-testid="dial-card" key={key}>
        <div className="cm-sec">
          <div className="cm-head">
            <span className="cm-avatar" aria-hidden>{initials(item.name)}</span>
            <div className="cm-who">
              <h3 className="cm-name" data-testid="dial-name">{item.name}</h3>
              <div className="cm-phone">
                <span className="cm-phone-n" data-testid="dial-phone">{item.phone}</span>
                <button type="button" onClick={() => void copy()} className="cm-tool cm-icon" aria-label={copied ? "Number copied" : "Copy number"} data-tip={copied ? "Copied" : "Copy number"} data-testid="dial-copy">{copied ? <Check aria-hidden /> : <Copy aria-hidden />}</button>
              </div>
            </div>
            <span className="s6-chip cm-touch" data-tone={item.step.state === "due" ? "amber" : "cyan"} data-testid="dial-touch">{item.step.label}</span>
          </div>
          <div className="cm-meta">
            {item.reasons[0] && <span className="s6-chip" data-tone="amber" data-testid="dial-status-pill">{item.reasons[0]}</span>}
            {item.callbackDue && <span className="s6-chip" data-tone="red"><CalendarClock aria-hidden className="size-3" />Callback due</span>}
            {item.source && <span className="s6-chip" data-tone="neutral">{item.source}</span>}
            <span className="cm-acct">{item.locationName ?? "Your account"}</span>
          </div>
          <p className="cm-note" data-testid="dial-why" hidden={!(item.reasons.length > 1 || item.openValue > 0)}>{item.reasons.slice(1, 2).join(". ")}{item.openValue > 0 ? `${item.reasons.length > 1 ? ". " : ""}${fmtMoney(item.openValue)} in open deals.` : ""}</p>
        </div>

        {warn && (
          <div className="cm-sec">
            <div className="cm-notice !mt-0" role="alert" data-testid="dial-quiet">
              <p>{warn}</p>
              {!okQuiet && <button type="button" onClick={() => setOkQuiet(true)} className="mt-1 min-h-9 font-medium underline" data-testid="dial-quiet-ok">I understand, show the call button</button>}
            </div>
          </div>
        )}
        <div className="cm-sec">
          <div className="cm-call-row">
            {plan?.href ? (
              <button type="button" onClick={callNow} disabled={!!warn && !okQuiet} className="cm-primary" data-kind="primary" data-testid="dial-call"><PhoneCall aria-hidden className="size-[18px]" />{plan.label}</button>
            ) : <p className="text-sm text-muted-foreground">{plan?.note}</p>}
          </div>
          <p className="cm-sub" data-testid="dial-call-note">{plan?.note} <InfoTip label="How calling works here" text="Calls go through your CRM's own phone, with your own number and provider. SubSync costs nothing extra for calling." /></p>
        </div>
        <div className="cm-toolbar" role="group" aria-label="More ways to reach them">
          <button type="button" className="cm-tool" data-tip="Texts them your booking link from your CRM." onClick={() => void textBooking()} data-testid="dial-text-link" data-kind={item.attempts > 0 ? "primary" : undefined}><MessageSquareText aria-hidden />Text the booking link</button>
          {textMsg && <span role="status" className="s6-label px-2" data-testid="dial-text-msg">{textMsg}</span>}
        </div>
        {!link.trim() && <div className="cm-sec !py-3"><label className="cm-linkfield !mt-0"><span>Your booking link (kept in this browser)</span><input placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} data-testid="dial-link-input" /></label></div>}

        <details className="cm-fold cm-sec" open data-testid="dial-script">
          <summary><ChevronRight aria-hidden />Call script{item.source ? ` for ${item.source}` : ""}</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm" data-testid="dial-script-text">{shown}</p>
          <ScriptEditor loc={item.locationId} value={script} canEdit={scriptQ.data?.canEdit !== false} onChange={(t) => setDraft({ loc: item.locationId, text: t })}
            onSaved={(t) => { try { window.localStorage.setItem(localKey, t); } catch { /* the script stays on screen */ } void scriptQ.reload(); }}
            source={sourceKey || null} onSaveSource={(t) => { setScripts({ ...scripts, [sourceKey]: t }); setDraft(null); }} />
        </details>

        <div className="cm-sec text-sm" data-testid="dial-story">
          <p className="mb-1 font-medium">Their story</p>
          {ctx.loading && !ctx.data ? <p className="text-muted-foreground">Loading...</p> : (
            <>
              {(ctx.data?.tags.length ?? 0) > 0 && <p className="mb-1 flex flex-wrap gap-1.5">{ctx.data!.tags.slice(0, 8).map((t) => <span key={t} className="rounded-full border border-[color-mix(in_srgb,var(--s6-edgec)_25%,transparent)] px-2 py-0.5 text-xs">{t}</span>)}</p>}
              {open.length > 0 && <p className="mb-1">{open.slice(0, 3).map((x) => `${x.name ?? "Deal"}${x.stageName ? ` (${x.stageName})` : ""}, ${fmtMoney(x.value)}`).join("; ")}</p>}
              {events.length > 0 ? <ul className="space-y-0.5 text-muted-foreground">{events.map((e, i) => <li key={i}>{when(e.at)}: {e.text}</li>)}</ul> : <p className="text-muted-foreground">No earlier touches recorded.</p>}
            </>
          )}
        </div>

        <div className="cm-sec">
          {chips && (
            <div className="mb-3 rounded-xl border border-[color-mix(in_srgb,var(--s6-cyan)_50%,transparent)] p-3" data-testid="dial-chips" role="group" aria-label="How did it go?">
              <p className="mb-2 text-sm font-medium">{chips.correction ? `Change the outcome for ${chips.card?.name ?? "this lead"}` : "How did it go?"}</p>
              <div className="flex flex-wrap gap-2">{dispo.map((d) => <button key={d.key} type="button" disabled={busy} data-testid={`chip-${d.key}`} aria-pressed={chips.pre === d.base} onClick={() => { const c = chips; if (c.correction && c.card) void record(d, null, { target: c.card, correction: true }); else if (d.next === "callback" || d.base === "call_back") pick(d); else void record(d, null); setChips(null); }} className={`s6-btn ${chips.pre === d.base ? "!border-[var(--s6-cyan)] !bg-[color-mix(in_srgb,var(--s6-cyan)_30%,transparent)]" : ""}`}>{d.label}</button>)}</div>
            </div>
          )}
          {auto && !chips ? <p className="s6-label mb-2" data-testid="dial-auto-note"><Sparkles aria-hidden className="mr-1 inline size-3.5 text-[var(--s6-cyan)]" />Call from your CRM. SubSync notices how it went and moves on by itself.</p> : null}
          <details open={!auto || chips !== null}><summary className="mb-2 min-h-9 cursor-pointer text-sm font-medium">{auto ? "Set the outcome here yourself" : "How did the call go?"}</summary>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="dial-outcomes">
            {dispo.map((d, i) => (
              <button key={d.key} type="button" disabled={busy} onClick={() => pick(d)} onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} className={`${BIG} justify-between ${d.doNotCall ? "col-span-2 sm:col-span-1" : ""}`} data-testid={`dial-outcome-${d.key}`} aria-keyshortcuts={String(i + 1)}>
                <span>{d.label}</span><kbd className="hidden rounded border border-[color-mix(in_srgb,var(--s6-edgec)_30%,transparent)] px-1.5 text-xs text-muted-foreground sm:inline">{i + 1}</kbd>
              </button>
            ))}
          </div>
          </details>
          {callback !== null && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-[color-mix(in_srgb,var(--s6-violet)_40%,transparent)] p-3" data-testid="dial-callback">
              <label className="text-sm">Call back at<input type="datetime-local" value={callback} onChange={(e) => setCallback(e.target.value)} className="mt-1 block min-h-11 rounded-md border bg-background px-2" data-testid="dial-callback-time" /></label>
              <button type="button" disabled={busy || !callback} onClick={() => void record(dispo.find((x) => x.base === "call_back") ?? dispo[0], new Date(callback).toISOString())} className={PRIMARY} data-kind="primary" data-testid="dial-callback-save">Save and next</button>
              <button type="button" onClick={() => setCallback(null)} className="min-h-11 px-2 underline">Cancel</button>
            </div>
          )}
          <label className="mt-3 flex min-h-9 items-start gap-2 text-sm"><input type="checkbox" checked={writeCrm} onChange={(e) => setWriteCrm(e.target.checked)} className="mt-1 size-4" data-testid="dial-write-crm" />
            <span>Also write a short note to your CRM{mode ? (mode.live ? "." : ". Writing is switched off, so this is a dry run and nothing in your CRM changes.") : "."}</span></label>
          {writeCrm && <p className="s6-label mt-1" data-testid="dial-note-preview">Note: {previewNote}</p>}
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={skip} disabled={busy} className={BIG} data-testid="dial-skip"><SkipForward aria-hidden className="size-4" />Skip<kbd className="hidden rounded border border-[color-mix(in_srgb,var(--s6-edgec)_30%,transparent)] px-1.5 text-xs text-muted-foreground sm:inline">N</kbd></button>
            <p className="hidden text-xs text-muted-foreground sm:block">Keys: N skip, 1 to {Math.min(9, dispo.length)} outcomes</p>
          </div>
          <DispositionEditor value={dispo} onChange={setDispo} accountName={item.locationName} />
        </div>
      </div>
    </section>
  );
}

function ScriptEditor({ loc, value, canEdit, onChange, onSaved, source, onSaveSource }: { loc: string; value: string; canEdit: boolean; onChange: (t: string) => void; onSaved: (t: string) => void; source: string | null; onSaveSource: (t: string) => void }) {
  const api = useApiClient();
  const [msg, setMsg] = useState<string | null>(null);
  if (!canEdit) return null;
  const save = async () => {
    try { await api.put("dial/script", { locationId: loc, script: value }); setMsg("Saved for this account."); onSaved(value); }
    catch (e) { setMsg((e as Error).message); onSaved(value); }
  };
  return (
    <div className="mt-2">
      <label className="text-xs text-muted-foreground" htmlFor="dial-script-edit">Edit the script. {"{name}"}, {"{me}"} and {"{business}"} are filled in.</label>
      <textarea id="dial-script-edit" value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" data-testid="dial-script-edit" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} className="min-h-9 text-sm font-medium underline" data-testid="dial-script-save">Save for this account</button>
        {source && <button type="button" onClick={() => { onSaveSource(value); setMsg(`Saved for ${source} leads (this browser).`); }} className="min-h-9 text-sm font-medium underline" data-testid="dial-script-save-source">Save for {source} leads</button>}
        {msg && <span className="text-xs text-muted-foreground" role="status">{msg}</span>}
      </div>
    </div>
  );
}

function Finish({ s, onExit }: { s: S; onExit: () => void }) {
  const skipped = s.skips + (s.skippedAtStart ?? 0) + s.items.filter((i) => skipReason(i)).length;
  const sum = sessionSummary(s.logged, skipped);
  // Never a bare "Session ended": say what actually happened and what to do next.
  const why = s.items.length === 0
    ? `Nobody on this list can be called right now.${s.later.length > 0 ? " The people below are waiting for calling hours or their next try." : ""} Pick another list, or come back when they can be called.`
    : s.skips > 0 ? `You skipped ${s.skips === 1 ? "the person" : "everyone"} on the list, so no call was logged. Go back to the lists to start again.` : "You ended the session before logging a call. Go back to the lists to start again.";
  const tile = (n: string | number, label: string, id: string) => <div className="s6-card !p-3 text-center"><p className="s6-big !text-[1.75rem]" data-testid={id}>{n}</p><p className="s6-label">{label}</p></div>;
  const list = (title: string, rows: Later[], id: string) => <div className="s6-card mt-4 text-left" data-testid={id}><h3 className="s6-q">{title}</h3><ul className="mt-2 grid gap-1 text-sm">{rows.slice(0, 6).map((l) => <li key={l.key} className="flex justify-between gap-3"><span className="truncate">{l.name}</span><span className="s6-label shrink-0">{l.why}</span></li>)}</ul></div>;
  return (
    <section className="mx-auto max-w-xl text-center" aria-label="Session summary" data-testid="dial-summary">
      <div className="dial-pop mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--s6-cyan)_15%,transparent)] text-[var(--s6-cyan)] shadow-[0_0_24px_color-mix(in_srgb,var(--s6-cyan)_50%,transparent)]" aria-hidden><Check className="size-8" /></div>
      <h2 className="text-2xl font-semibold tracking-tight" data-testid="sum-title">{sum.calls === 0 ? (s.items.length === 0 ? "Nobody could be called" : "No calls logged") : "Nice work. The list is done."}</h2>
      <p className="mt-1 text-sm text-muted-foreground" data-testid="sum-reason">{sum.calls === 0 ? why : `${sum.calls} ${sum.calls === 1 ? "call" : "calls"} logged${sum.perHour !== null ? `, about ${sum.perHour} an hour` : ""}.`}</p>
      {s.streak >= 3 && <p className="s6-chip mt-2" data-tone="amber"><Flame aria-hidden className="size-3.5" />{s.streak} reached in a row</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tile(sum.calls, "calls", "sum-calls")}{tile(sum.reached, "reached", "sum-reached")}{tile(sum.booked, "booked", "sum-booked")}{tile(`${sum.minutesSaved} min`, "saved (estimate)", "sum-minutes")}
      </div>
      {sum.skipped > 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="sum-skipped">{sum.skipped} skipped.</p>}
      {s.later.length > 0 && list(`${s.later.length} ${s.later.length === 1 ? "lead waits" : "leads wait"} for a better time`, s.later, "sum-later")}
      {s.texts.length > 0 && list(`${s.texts.length} ${s.texts.length === 1 ? "lead is" : "leads are"} past the last try: text instead`, s.texts, "sum-texts")}
      <button type="button" onClick={onExit} className={`${PRIMARY} mt-5`} data-kind="primary" data-testid="dial-done">Back to the lists</button>
    </section>
  );
}
