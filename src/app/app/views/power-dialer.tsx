"use client";

import { ExternalLink, PhoneCall } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CLICK_MAX } from "@/lib/dial/callqueue";
import { capNote, confirmText, finishTab, gate, requeueNote, reserveTab, shouldOpenQueue, stepsText, handSteps, summaryLine, UNDO_NOTE, type Opener, type SentLead, type SetupState } from "@/lib/dial/powerdialer";
import { useApiClient } from "../session";

// "Send to power dialer" (docs/features/DIALQUEUE.md). Tags the chosen leads with the call tag through the safe gateway; the customer's own CRM workflow turns each tag into a call task;
// then the CRM's Manual Actions page opens in a new tab, where its own "Let's Start" power dialer runs. SubSync never places a call and never messages anyone.

type Ready = { state: SetupState; tag: string; canMark: boolean; canEdit: boolean };
type Prev = { ok: boolean; message: string; live: boolean; names: Array<{ key: string; name: string; phone: string | null; list: string }>; plan: { skipped: { dnd: number; noPhone: number; outsideHours: number; recent: number; cap: number } } | null };
type Sent = { ok: boolean; message: string; live: boolean; added: number; failed: number; needsPermission: boolean; sent: SentLead[]; wouldSend: SentLead[]; queueUrl: string; tag: string };
type Batch = { loc: string; name: string; res: Sent };
type Review = { loc: string; name: string; p: Prev; keys: string[]; held: number }[];

export function usePowerDialer(o: { list: string; locs: string[]; nameOf: (loc: string) => string; keysFor?: (loc: string) => string[] | undefined; onSent?: () => void; showStatus?: boolean }) {
  const api = useApiClient();
  const { list, locs, nameOf, keysFor, onSent } = o;
  const [ready, setReady] = useState<Record<string, Ready>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [gateLoc, setGateLoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [opened, setOpened] = useState<boolean | null>(null);
  const [undoMsg, setUndoMsg] = useState<string | null>(null);
  const locKey = locs.join(",");

  const fetchReady = useCallback(async (loc: string): Promise<Ready> => {
    try { return await api.get<Ready>(`dial/cq-ready?locationId=${encodeURIComponent(loc)}`, { fresh: true }); } catch { return { state: "not_sure", tag: "call-now", canMark: false, canEdit: false }; }
  }, [api]);

  // The status line under the button: read for a few accounts only (each read may ask the CRM for its workflow list).
  useEffect(() => {
    if (o.showStatus === false || locs.length === 0 || locs.length > 3) return;
    let live = true;
    void Promise.all(locs.map(async (l) => [l, await fetchReady(l)] as const)).then((rows) => { if (live) setReady(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [locKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setBusy(true); setMsg(null); setBatches(null); setOpened(null); setUndoMsg(null); setGateLoc(null);
    try {
      const rows = await Promise.all(locs.slice(0, 20).map(async (l) => [l, await fetchReady(l)] as const));
      const map = Object.fromEntries(rows);
      setReady((r) => ({ ...r, ...map }));
      const usable = rows.filter(([, r]) => gate(r.state) !== "setup_card").map(([l]) => l);
      if (usable.length === 0) { setGateLoc(rows[0]?.[0] ?? null); setReview(null); return; }
      let budget = CLICK_MAX;
      const out: Review = [];
      for (const loc of usable) {
        if (budget <= 0) break;
        const ks = keysFor?.(loc);
        if (ks && ks.length === 0) continue;
        const p = await api.post<Prev>("dial/cq-preview", { locationId: loc, list, keys: ks });
        const names = p.names.slice(0, budget);
        const held = (p.plan?.skipped.cap ?? 0) + (p.names.length - names.length);
        budget -= names.length;
        out.push({ loc, name: nameOf(loc), p: { ...p, names }, keys: names.map((n) => n.key), held });
      }
      const blocked = rows.filter(([, r]) => gate(r.state) === "setup_card").map(([l]) => l);
      setGateLoc(blocked[0] ?? null);
      setReview(out);
    } catch { setMsg("Could not check the call queue right now. Nothing was sent."); } finally { setBusy(false); }
  }

  // The confirm click: the new tab is reserved here, inside the click (a browser refuses a tab opened after waiting for the server), and sent to the CRM once the leads are tagged.
  async function confirm() {
    const tab = reserveTab(((u, t) => window.open(u, t)) as Opener);
    setBusy(true); setMsg(null);
    const done: Batch[] = [];
    try {
      for (const x of review ?? []) {
        if (!x.p.ok || x.keys.length === 0) continue;
        const res = await api.post<Sent>("dial/cq-send", { locationId: x.loc, list, keys: x.keys, confirm: true });
        done.push({ loc: x.loc, name: x.name, res });
      }
      const first = done.find((b) => shouldOpenQueue({ live: b.res.live, added: b.res.added }));
      const isOpen = finishTab(tab, first ? first.res.queueUrl : null);
      setOpened(isOpen); setBatches(done); setReview(null); onSent?.();
    } catch {
      finishTab(tab, null);
      setBatches(done); setReview(null); setMsg("Could not add to the call queue. Nothing more was sent.");
    } finally { setBusy(false); }
  }

  async function undo() {
    setBusy(true); setUndoMsg(null);
    try {
      const lines: string[] = [];
      for (const b of batches ?? []) {
        const ids = (b.res.live ? b.res.sent : b.res.wouldSend).map((l) => l.contactId);
        if (ids.length === 0) continue;
        const r = await api.post<{ message: string }>("dial/cq-undo", { locationId: b.loc, contactIds: ids });
        lines.push(`${b.name}: ${r.message}`);
      }
      setUndoMsg(lines.join(" ") || "Nothing to undo.");
    } catch { setUndoMsg("Could not undo right now. Nothing was changed."); } finally { setBusy(false); }
  }

  async function mark(loc: string) {
    setBusy(true);
    try { await api.post("dial/cq-mark", { locationId: loc, done: true }); setReady((r) => ({ ...r, [loc]: { ...(r[loc] ?? { tag: "call-now", canMark: true, canEdit: true }), state: "set_up" } })); setGateLoc(null); setMsg("Marked as set up. Press the button again to send."); }
    catch { setMsg("Could not save that. It needs the latest database update."); } finally { setBusy(false); }
  }

  const states = locs.slice(0, 3).map((l) => ready[l]?.state).filter((s): s is SetupState => !!s);
  const status = o.showStatus !== false && locs.length <= 3 && states.length === Math.min(locs.length, 3) && states.length > 0 ? summaryLine(states) : null;
  const total = review?.reduce((n, x) => n + x.p.names.length, 0) ?? 0;
  const tag = (review?.[0] && ready[review[0].loc]?.tag) || ready[locs[0] ?? ""]?.tag || "call-now";
  const held = review?.reduce((n, x) => n + x.held, 0) ?? 0;
  const anyNotSure = (review ?? []).some((x) => ready[x.loc]?.state === "not_sure");
  const queueUrl = batches?.find((b) => b.res.added > 0)?.res.queueUrl ?? null;
  const sentAll = (batches ?? []).flatMap((b) => (b.res.live ? b.res.sent : b.res.wouldSend).map((l) => ({ ...l, account: b.name, would: !b.res.live })));

  const panel: ReactNode = (
    <div data-testid="pd-panel" className="basis-full">
      {status && <p className="s6-label mt-2" data-testid="pd-status">{status}</p>}
      {msg && <p className="mt-2 text-sm" role="status" data-testid="pd-msg">{msg}</p>}
      {gateLoc && (
        <div className="cm-panel mt-2" role="dialog" aria-label="Set up your call queue" data-testid="pd-setup">
          <p className="font-medium">{locs.length > 1 ? `${nameOf(gateLoc)}: ` : ""}Set up your call queue first (once, in your CRM, about 2 minutes).</p>
          <p className="s6-label mt-1">Your CRM turns the tag {ready[gateLoc]?.tag ?? "call-now"} into a call task for each lead. Build this workflow by hand:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm" data-testid="pd-steps">{handSteps(ready[gateLoc]?.tag ?? "call-now").map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={stepsText(ready[gateLoc]?.tag ?? "call-now")} />
            <button type="button" className="s6-btn" data-kind="primary" disabled={busy || ready[gateLoc]?.canEdit === false} onClick={() => void mark(gateLoc)} data-testid="pd-mark">Mark as set up</button>
            <button type="button" className="s6-btn" onClick={() => setGateLoc(null)}>Close</button>
          </div>
          <p className="s6-label mt-2">SubSync cannot see inside your workflow unless the optional workflows permission is granted, so it takes your word. It also notices when a tagged lead loses its tag again.</p>
        </div>
      )}
      {review && review.length > 0 && (
        <div className="cm-panel mt-2" role="dialog" aria-label="Send to your power dialer" data-testid="pd-preview">
          <p className="font-medium" data-testid="pd-confirm-text">{total > 0 ? confirmText(total, tag, review.filter((x) => x.p.names.length).length) : "Nobody can be sent right now."}</p>
          {(review.some((x) => x.p.names.length > 0) ? review.filter((x) => x.p.names.length > 0) : review.slice(0, 1)).map((x) => (
            <div key={x.loc} className="mt-2">
              <p className="s6-label">{x.name}: {x.p.names.length === 0 ? x.p.message : `${x.p.names.slice(0, 8).map((n) => n.name).join(", ")}${x.p.names.length > 8 ? `, and ${x.p.names.length - 8} more` : ""}`}</p>
              {x.p.plan && <p className="s6-label">Left out: {x.p.plan.skipped.dnd} asked not to be contacted, {x.p.plan.skipped.noPhone} with no phone, {x.p.plan.skipped.outsideHours} outside calling hours in their time zone, {x.p.plan.skipped.recent} sent in the last 24 hours.</p>}
              {!x.p.live && x.p.ok && <p className="s6-label">Writing to your CRM is off for this account, so nothing will be changed. This is a preview.</p>}
            </div>
          ))}
          {held > 0 && <p className="s6-label mt-2" data-testid="pd-cap">{capNote(total, held)}</p>}
          {anyNotSure && <p className="s6-label mt-2" data-testid="pd-notsure">SubSync cannot confirm your call queue workflow. If it is missing, the tag is added but no call task appears.</p>}
          <p className="s6-label mt-2">{requeueNote(tag)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="s6-btn" data-kind="primary" disabled={busy || total === 0} onClick={() => void confirm()} data-testid="pd-confirm">Confirm and open my power dialer</button>
            <button type="button" className="s6-btn" onClick={() => setReview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {review && review.length === 0 && !gateLoc && <p className="mt-2 text-sm" role="status" data-testid="pd-none">Nobody to send right now.</p>}
      {batches && (
        <div className="cm-panel mt-2" data-testid="pd-result">
          {batches.map((b) => <p key={b.loc} className="font-medium">{b.name}: {b.res.message}</p>)}
          {queueUrl && <p className="mt-1 text-sm" data-testid="pd-open-line">{opened ? "Your CRM call queue opened in a new tab. Press Let's Start there." : <>Your browser did not open a new tab. <a className="s6-link" href={queueUrl} target="_blank" rel="noopener noreferrer" data-testid="pd-open-link">Open your CRM call queue</a>, then press Let&apos;s Start.</>}</p>}
          {sentAll.length > 0 && (
            <>
              <p className="s6-label mt-2">{sentAll[0].would ? "Would have been sent" : "Sent to your call queue"} ({sentAll.length}):</p>
              <ul className="mt-1 divide-y text-sm" data-testid="pd-sent">
                {sentAll.map((l) => <li key={`${l.account}${l.contactId}`} className="flex flex-wrap items-center gap-2 py-1"><span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>{batches.length > 1 && <span className="s6-label">{l.account}</span>}{l.url && <a className="s6-link inline-flex items-center gap-1" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${l.name}`}><ExternalLink aria-hidden className="size-3" />Open</a>}</li>)}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" className="s6-btn" disabled={busy || undoMsg !== null} onClick={() => void undo()} data-testid="pd-undo">Undo this batch</button><span className="s6-label">{UNDO_NOTE}</span></div>
            </>
          )}
          {undoMsg && <p className="mt-2 text-sm" role="status" data-testid="pd-undo-msg">{undoMsg}</p>}
        </div>
      )}
    </div>
  );
  return { start, busy, panel };
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return <button type="button" className="s6-btn" data-testid="pd-copy" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); t.current = setTimeout(() => setDone(false), 2500); }).catch(() => setDone(false)); }}>{done ? "Copied" : "Copy steps"}</button>;
}

/** The "Start calling" button of Speed to lead: leads waiting for a first reply go to the CRM call queue and the CRM's power dialer opens. */
export function StartCallingButton({ list = "new_unanswered", className, testId = "start-calling", onCallMode }: { list?: string; className?: string; testId?: string; onCallMode?: () => void }) {
  const api = useApiClient();
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { let live = true; void api.get<{ accounts: Array<{ id: string; name: string }> }>("dial/cq-status").then((r) => { if (live) setAccounts(r.accounts ?? []); }).catch(() => undefined); return () => { live = false; }; }, [api]);
  const pd = usePowerDialer({ list, locs: accounts.map((a) => a.id), nameOf: (id) => accounts.find((a) => a.id === id)?.name ?? "Account" });
  return (
    <>
      <button type="button" onClick={() => void pd.start()} disabled={pd.busy || accounts.length === 0} data-testid={testId} className={className}><PhoneCall aria-hidden className="size-4" />Start calling</button>
      {onCallMode && <button type="button" className="s6-link text-sm" onClick={onCallMode} data-testid="start-calling-mode">Or pick a list in Call mode</button>}
      {pd.panel}
    </>
  );
}
