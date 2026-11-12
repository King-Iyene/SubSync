"use client";

import { useEffect, useState } from "react";
import { CHURN_FORMULA, money } from "@/lib/analytics/finance-core";
import { EmptyState, useNow } from "../../ds";
import { useApiClient } from "../../session";
import type { GoFn } from "../../nav";
import { fnfxOn, msg, useKeyset } from "./data";
import { How, Money, Picker, SampleNote, num, useAct } from "./shared";
import type { FnChurn } from "./types";

// Finance, Churn watch: client accounts that look likely to leave, ranked by the points of evidence and then by the money (the monthly plan price). A score is shown with its parts and the formula one tap away,
// labelled an estimate. Each row has Open, an owner (searchable), a status, a "save this account" playbook, and snooze or mute (with a preview before anything is saved). SubSync never contacts the client.
type Row = FnChurn["rows"][number];
const LEVEL: Record<string, [string, string | undefined]> = { high: ["High", "amber"], watch: ["Watch", "cyan"], steady: ["Steady", undefined], not_enough_data: ["Not enough data", undefined], left: ["Already left", undefined] };
const STATUS = [["open", "Not started"], ["working", "Working on it"], ["saved", "Saved"], ["lost", "Lost"]] as const;
const GO_VIEW: Record<string, "payments" | "speed" | "appointments" | "clients" | "pipeline" | "team"> = { payments: "payments", speed: "speed", appointments: "appointments", clients: "clients", pipeline: "pipeline", team: "team" };

export function ChurnTab({ go }: { go: GoFn }) {
  const [level, setLevel] = useState<"high" | "watch" | "all" | "">(""), [snoozed, setSnoozed] = useState(false), [status, setStatus] = useState(""), [q, setQ] = useState(""), [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const k = useKeyset<Row, FnChurn>("churn", { level, snoozed, status, q: dq });
  const c = k.first?.counts;
  if (k.error && /not switched on/i.test(String((k.error as Error).message))) return <EmptyState title="Not switched on yet" body="This part of Finance is not switched on for your account yet." />;
  const chip = (key: typeof level, label: string, n: number | undefined, test: string) => (
    <button type="button" className="cl-reason" aria-pressed={level === key && !snoozed} data-on={level === key && !snoozed ? "1" : undefined} onClick={() => { setLevel(key); setSnoozed(false); }} data-testid={test}>{label}{n !== undefined ? ` (${num(n)})` : ""}</button>
  );
  return (
    <div className="fn-stack" data-testid="fn-churn">
      {fnfxOn() && <SampleNote />}
      <section className="fn-card" aria-label="Accounts likely to leave">
        <h2 className="fn-h">Accounts that may leave</h2>
        <p className="fn-sentence" data-testid="fn-churn-sentence">
          {c ? (c.high + c.watch === 0 ? "No client account looks likely to leave right now." : `${num(c.high)} high and ${num(c.watch)} to watch`) : "Checking every client account..."}
          {k.first && k.first.mrrAtRisk.length > 0 && c && c.high + c.watch > 0 && <>, with <Money items={k.first.mrrAtRisk} /> a month in plans behind them (estimate).</>}
        </p>
        <p className="ap-fine">Each account is compared with its own normal, not with other clients. Logins are not available from the platform yet, so they are not part of this.</p>
        <How title="How is the score worked out?">{CHURN_FORMULA}</How>
        {k.first?.historyNote && <p className="ap-fine" data-testid="fn-churn-history">{k.first.historyNote}</p>}
      </section>
      <div role="group" aria-label="Filter the watch list" className="cl3-chips">
        {chip("", "High and watch", c ? c.high + c.watch : undefined, "fn-churn-chip-main")}
        {chip("high", "High", c?.high, "fn-churn-chip-high")}
        {chip("watch", "Watch", c?.watch, "fn-churn-chip-watch")}
        {chip("all", "Every account", c?.all, "fn-churn-chip-all")}
        <button type="button" className="cl-reason" aria-pressed={snoozed} data-on={snoozed ? "1" : undefined} onClick={() => setSnoozed(!snoozed)} data-testid="fn-churn-chip-snoozed">Snoozed or muted{c ? ` (${num(c.snoozed)})` : ""}</button>
      </div>
      <div className="ap-head print:hidden" role="search">
        <label className="ap-search"><span className="sr-only">Search accounts</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="fn-churn-search" /></label>
        <select className="ap-field" aria-label="Where the save attempt stands" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="fn-churn-status"><option value="">Any status</option>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {k.loading && !k.first ? <p className="ap-fine">Checking every client account...</p> : k.error ? <EmptyState title="Could not load" body={msg(k.error)} /> : k.rows.length === 0 ? (
        <EmptyState title={snoozed ? "Nothing is snoozed" : "No account matches"} body={snoozed ? "Accounts you snooze or mute wait here." : "Good news, or not enough record yet. Try Every account to see each one's score."} />
      ) : (
        <>
          <p className="ap-fine" data-testid="fn-churn-count">{num(k.total)} {k.total === 1 ? "account" : "accounts"}.</p>
          <ul className="fn-list" data-testid="fn-churn-list">{k.rows.map((r, i) => <ChurnRow key={r.locationId} r={r} rank={i + 1} go={go} reload={k.reload} />)}</ul>
          {k.next && <div className="fn-more"><span className="ap-fine">Showing {num(k.rows.length)} of {num(k.total)}</span><button type="button" className="s6-btn" onClick={k.showMore} disabled={k.more}>{k.more ? "Loading..." : "Show more"}</button></div>}
        </>
      )}
    </div>
  );
}

function ChurnRow({ r, rank, go, reload }: { r: Row; rank: number; go: GoFn; reload: () => void }) {
  const api = useApiClient();
  const { busy, note, run } = useAct(reload);
  const [open, setOpen] = useState(false), [plan, setPlan] = useState<{ text: string; body: object } | null>(null), [noteText, setNoteText] = useState(r.note ?? ""), [editNote, setEditNote] = useState(false);
  const lv = LEVEL[r.level] ?? LEVEL.steady;
  const put = (body: object, ok: string) => run(() => api.put("finance/churn", { locationId: r.locationId, ...body }), ok).then(() => setPlan(null));
  const now = useNow(60_000, Date.parse(r.snoozedUntil ?? "1970-01-01") - 1);
  const days = (iso: string | null) => (iso ? Math.max(1, Math.round((Date.parse(iso) - now) / 86_400_000)) : 0);
  const snoozedNow = r.muted || (r.snoozedUntil !== null && Date.parse(r.snoozedUntil) > now);
  return (
    <li className="fn-row" data-pri={r.level === "high" ? "high" : undefined} data-testid="fn-churn-row">
      <div>
        <span className="fn-who"><span className="ap-fine" aria-hidden>{rank}. </span>{r.name}</span>
        <div className="fn-sub"><span className="ap-chip" data-tone={lv[1]}>{lv[0]}</span> {r.points > 0 ? `${r.points} ${r.points === 1 ? "point" : "points"} (estimate)` : ""} · {r.payLabel}{r.mrr ? ` · ${money(r.mrr.amount, r.mrr.currency)} a month` : ""}</div>
        {snoozedNow && <div className="fn-sub">{r.muted ? "Muted" : `Snoozed for ${days(r.snoozedUntil)} more ${days(r.snoozedUntil) === 1 ? "day" : "days"}`}</div>}
      </div>
      <div>
        <div className="fn-sub">Owner</div>
        <Picker what="person" label="Owner" value={r.owner.userId ? { id: r.owner.userId, name: r.owner.name ?? "Team member" } : null} clearable placeholder={r.owner.manager ? `Manager: ${r.owner.manager}` : "Nobody yet"} onPick={(v) => void put({ owner: v ? v.id : null }, "Owner saved.")} testId="fn-churn-owner" />
        <select className="ap-field" style={{ marginTop: 6 }} aria-label={`Status for ${r.name}`} value={r.status} onChange={(e) => void put({ status: e.target.value }, "Status saved.")} disabled={busy} data-testid="fn-churn-set-status">{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div>
        {r.evidence.length === 0 ? <p className="fn-sub">{r.level === "not_enough_data" ? "Needs 28 days of record before the activity checks run." : "Nothing unusual."}</p> : (
          <ul className="fn-ev" data-testid="fn-churn-evidence">{r.evidence.map((e) => <li key={e.key}><b>{e.label}</b> ({e.points}): {e.detail}</li>)}</ul>
        )}
        {open && (
          <div data-testid="fn-playbook"><p className="fn-h" style={{ marginTop: 10 }}>Save this account: suggested steps</p>
            <ol className="fn-steps">{r.playbook.map((s, i) => <li key={i}>{s.text}{s.go && GO_VIEW[s.go] && <> <button type="button" className="ap-link" onClick={() => go(GO_VIEW[s.go as string], r.locationId)}>Open</button></>}{s.go === "proof" && <> <button type="button" className="ap-link" onClick={() => go("clients", r.locationId)}>Open Clients</button></>}</li>)}</ol>
            <p className="ap-fine">SubSync never contacts your client. You send the message or make the call yourself.</p>
          </div>
        )}
        {editNote ? (
          <div style={{ marginTop: 6 }}><textarea className="ap-field" style={{ width: "100%", minHeight: 64 }} value={noteText} maxLength={1000} onChange={(e) => setNoteText(e.target.value)} aria-label="Your note" />
            <button type="button" className="s6-btn" onClick={() => void put({ note: noteText }, "Note saved.").then(() => setEditNote(false))} disabled={busy}>Save note</button> <button type="button" className="ap-link" onClick={() => setEditNote(false)}>Cancel</button></div>
        ) : r.note ? <p className="fn-sub" style={{ marginTop: 6 }}>Note: {r.note}</p> : null}
        {plan && (
          <div className="fn-typed" style={{ marginTop: 8 }} role="group" aria-label="Preview of the change" data-testid="fn-churn-preview"><span>{plan.text}</span>
            <span className="fn-end" style={{ justifyContent: "flex-start" }}><button type="button" className="s6-btn" data-kind="primary" disabled={busy} onClick={() => void put(plan.body, "Saved.")} data-testid="fn-churn-confirm">Confirm</button><button type="button" className="s6-btn" onClick={() => setPlan(null)}>Cancel</button></span></div>
        )}
        {note && <p className="ap-fine" role="status">{note}</p>}
      </div>
      <div className="fn-end print:hidden">
        <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("account", r.locationId)} data-testid="fn-churn-open">Open</button>
        <button type="button" className="s6-btn" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="fn-churn-playbook-btn">{open ? "Hide steps" : "Save this account"}</button>
        {snoozedNow ? <button type="button" className="ap-link" onClick={() => setPlan({ text: `Bring ${r.name} back onto the watch list?`, body: { snoozeDays: 0, muted: false } })}>Bring back</button> : <>
          <button type="button" className="ap-link" onClick={() => setPlan({ text: `Snooze ${r.name} for 14 days? It leaves the list and comes back after that.`, body: { snoozeDays: 14 } })} data-testid="fn-churn-snooze">Snooze 14 days</button>
          <button type="button" className="ap-link" onClick={() => setPlan({ text: `Mute ${r.name}? It stays off the watch list until you bring it back.`, body: { muted: true } })}>Mute</button></>}
        <button type="button" className="ap-link" onClick={() => setEditNote(!editNote)}>{r.note ? "Edit note" : "Add note"}</button>
      </div>
    </li>
  );
}
