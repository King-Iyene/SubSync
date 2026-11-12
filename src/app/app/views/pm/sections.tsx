"use client";

import { useState } from "react";
import { fmtMoney } from "@/lib/analytics/payments-format";
import type { PmDispute, PmDisputes, PmHistory, PmOptions, PmSetup, PmToday, PmUpcoming } from "@/lib/analytics/payments-types";
import { EmptyState } from "../../ds";
import { useApiClient } from "../../session";
import { fixturesOn, usePm } from "./data";
import { Load, Money, NotFromPlatform, PermissionNotice, RECONNECT, ago, day } from "./shared";
import type { QFilters } from "./queue";

// The other Payments screens: Today, Disputes (a log you keep), Upcoming (estimates only), History (our own record) and Setup. Every number opens its rows or says where it comes from.

export function TodayTab({ go, openQueue, openDisputes }: { go: (tab: string) => void; openQueue: (f: Partial<QFilters>) => void; openDisputes: () => void }) {
  const r = usePm<PmToday>("today");
  return (
    <Load r={r}>
      {(t) => (
        <div className="pm-stack" data-testid="pm-today">
          <PermissionNotice sources={t.sources} />
          <section className="pm-card" aria-label="What to do today">
            <h2 className="pm-h mb-1">What to do today</h2>
            <p className="pm-sentence" data-testid="pm-sentence">{t.headline}</p>
            {t.button && <button type="button" className="s6-btn mt-3" data-kind="primary" data-testid="pm-go" onClick={() => openQueue({ problem: "" })}>{t.button.label} ({t.button.count})</button>}
          </section>
          {t.setupNote && <div className="pm-notice" role="status" data-testid="pm-setup-card"><b>Check your payment setup.</b> {t.setupNote} <button type="button" className="ap-link" onClick={() => go("setup")}>See the checks</button></div>}
          <div className="pm-tiles">
            {t.tiles.map((x) => (
              <button key={x.key} type="button" className="pm-tile" data-hot={x.count > 0 && x.key !== "refunds" ? "1" : undefined} data-testid={`pm-tile-${x.key}`} onClick={() => (x.filter.disputes ? openDisputes() : openQueue({ problem: x.filter.problem ?? "" }))}>
                <b>{x.count.toLocaleString("en-US")}</b><span>{x.label}</span>
                {x.money.length > 0 && <Money items={x.money} />}
                {x.note && <span>{x.note}</span>}
              </button>
            ))}
          </div>
          {t.atRisk.length > 0 && (
            <section className="pm-card" aria-label="Money at risk">
              <h2 className="pm-h mb-2">Money at risk (estimate)</h2>
              <ul className="pm-list">{t.atRisk.map((a) => (
                <li key={a.currency}><b className="pm-amt">{fmtMoney(a.amount, a.currency)}</b> <span className="pm-sub">across {a.count} {a.count === 1 ? "item" : "items"}</span>
                  <details className="mt-1"><summary className="ap-fine cursor-pointer">How is this worked out?</summary><p className="ap-fine mt-1">{a.formula}</p></details></li>))}</ul>
            </section>
          )}
          <section className="pm-card" aria-label="Recovery so far">
            <h2 className="pm-h mb-2">Fixed after we flagged it</h2>
            {t.historyStarts === null ? <p className="ap-fine">History starts today. Once payments are flagged and paid, how many and how fast shows here.</p> : (
              <>
                <p className="text-sm">{t.recoveredLast30.length ? <>Recovered {t.windowFrom && t.windowTo ? `from ${t.windowFrom} to ${t.windowTo}` : "in the last 30 days"}: <Money items={t.recoveredLast30} /></> : `Nothing recovered ${t.windowFrom && t.windowTo ? `from ${t.windowFrom} to ${t.windowTo}` : "in the last 30 days"} yet.`}</p>
                <p className="ap-fine mt-1">{t.avgDaysToRecover !== null ? `Usually fixed in ${t.avgDaysToRecover} days. ` : ""}{t.recoveryRate !== null ? `${t.recoveryRate}% of the payments we flagged in these dates were fixed. ` : ""}History starts {t.historyStarts}. <button type="button" className="ap-link" onClick={() => go("history")}>See the history</button></p>
              </>
            )}
          </section>
          {t.expectedMonthly.length > 0 && (
            <section className="pm-card" aria-label="Expected from your clients">
              <h2 className="pm-h mb-1">Expected from your clients each month (estimate)</h2>
              {t.expectedMonthly.map((e) => <p key={e.currency} className="text-sm"><b>{fmtMoney(e.amount, e.currency)}</b> <span className="ap-fine">{e.formula}</span></p>)}
            </section>
          )}
          {t.testRowsHidden > 0 && <p className="ap-fine">{t.testRowsHidden} test {t.testRowsHidden === 1 ? "payment is" : "payments are"} hidden. Turn on &quot;Show test payments&quot; in the list to see {t.testRowsHidden === 1 ? "it" : "them"}.</p>}
          <p className="ap-fine">Read only: SubSync cannot charge, retry or change a payment, and sends nothing to anyone. {t.sources.length > 0 && <>Last read: {ago(t.sources.map((s) => s.lastOkAt).filter(Boolean).sort().pop() ?? null)}.</>}</p>
        </div>
      )}
    </Load>
  );
}

const STATUS_WORDS: Record<PmDispute["status"], string> = { open: "Open", evidence_sent: "Evidence sent", won: "Won", lost: "Lost" };
const ALERT_WORDS: Record<NonNullable<PmDispute["alert"]>, string> = { overdue: "Evidence is overdue", today: "Evidence due today", tomorrow: "Evidence due tomorrow", soon: "Evidence due soon" };
type Draft = { id?: string; location: string; customer: string; amount: string; currency: string; reason: string; openedOn: string; evidenceDueOn: string; status: PmDispute["status"]; processorUrl: string; notes: string };
const BLANK: Draft = { location: "", customer: "", amount: "", currency: "USD", reason: "", openedOn: new Date().toISOString().slice(0, 10), evidenceDueOn: "", status: "open", processorUrl: "", notes: "" };

export function DisputesTab({ options, initialStatus, rev, bump }: { options: PmOptions | null; initialStatus: string; rev: number; bump: () => void }) {
  const api = useApiClient(), sample = fixturesOn();
  const [status, setStatus] = useState(initialStatus);
  const r = usePm<PmDisputes>("disputes", { status, v: rev || undefined });
  const [draft, setDraft] = useState<Draft | null>(null), [pv, setPv] = useState<null | { lines: Array<{ field: string; before?: string; after: string }>; note: string; confirmWith?: string; kind: "save" | "remove" }>(null), [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  const accounts = options?.accounts ?? [];
  const body = (d: Draft) => ({ location: d.location, id: d.id, customer: d.customer, amount: d.amount, currency: d.currency, reason: d.reason, openedOn: d.openedOn, evidenceDueOn: d.evidenceDueOn, status: d.status, processorUrl: d.processorUrl, notes: d.notes });
  const part = (d: Draft) => (d.id ? "payments/act/dispute-edit" : "payments/act/dispute");
  const preview = async () => {
    if (!draft) return; setErr(null); setMsg(null);
    if (sample) return setErr("Sample data cannot be changed.");
    try { const o = await api.post<{ lines: Array<{ field: string; before?: string; after: string }>; note: string }>(part(draft), { ...body(draft), step: "preview" }); setPv({ ...o, kind: "save" }); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const save = async () => {
    if (!draft) return;
    try { await api.post(part(draft), { ...body(draft), step: "do" }); setDraft(null); setPv(null); setMsg("Saved."); bump(); r.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const askRemove = async (d: PmDispute) => {
    setErr(null); setTyped("");
    if (sample) return setErr("Sample data cannot be changed.");
    try { const o = await api.post<{ lines: Array<{ field: string; after: string }>; note: string; confirmWith: string }>("payments/act/dispute-remove", { id: d.id, step: "preview" }); setDraft({ ...BLANK, id: d.id, customer: d.customer, location: d.locationId }); setPv({ ...o, kind: "remove" }); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const remove = async () => {
    if (!draft?.id) return;
    try { await api.post("payments/act/dispute-remove", { id: draft.id, step: "do", confirm: typed }); setDraft(null); setPv(null); setMsg("Removed."); bump(); r.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const edit = (d: PmDispute) => { setPv(null); setErr(null); setDraft({ id: d.id, location: d.locationId, customer: d.customer, amount: d.amount === null ? "" : String(d.amount), currency: d.currency ?? "", reason: d.reason ?? "", openedOn: d.openedOn, evidenceDueOn: d.evidenceDueOn ?? "", status: d.status, processorUrl: d.processorUrl ?? "", notes: d.notes ?? "" }); };
  const set = (p: Partial<Draft>) => { setDraft((x) => (x ? { ...x, ...p } : x)); setPv(null); };
  return (
    <div className="pm-stack" data-testid="pm-disputes">
      <div className="pm-notice" role="note"><b>Entered by you; not read from your payment processor.</b> The platform does not give us payment disputes, so this is a log you keep. We remind you 3 days, 1 day and on the day evidence is due.</div>
      <div className="pm-filters">
        <select className="ap-field" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="open">Open</option><option value="evidence_sent">Evidence sent</option><option value="won">Won</option><option value="lost">Lost</option></select>
        <button type="button" className="s6-btn" data-kind="primary" onClick={() => { setPv(null); setErr(null); setDraft({ ...BLANK, location: accounts[0]?.id ?? "" }); }} data-testid="pm-dispute-add">Add a dispute</button>
      </div>
      {msg && <p className="text-sm" role="status">{msg}</p>}
      <Load r={r} empty={(d) => d.rows.length === 0 && "No disputes written down yet. When your processor tells you about one, add it here so the due date is not missed."}>
        {(d) => (
          <>
            <p className="pm-totals"><b>{d.total}</b> in the log <span>{d.open} open</span>{d.due > 0 && <span data-alert="overdue">{d.due} with evidence due soon or overdue</span>}</p>
            <ul className="pm-list">{d.rows.map((x) => (
              <li key={x.id} className="pm-row" data-pri={x.alert === "overdue" || x.alert === "today" ? "high" : undefined} data-testid="pm-dispute-row">
                <div><span className="pm-who">{x.customer}</span><div className="pm-sub">{x.accountName}</div></div>
                <div><div className="pm-amt">{x.amount !== null ? fmtMoney(x.amount, x.currency) : "Amount not written"}</div><div className="pm-sub">Opened {x.openedOn}</div></div>
                <div><span className="ap-chip">{STATUS_WORDS[x.status]}</span> {x.alert && <span data-alert={x.alert === "soon" || x.alert === "tomorrow" ? undefined : x.alert}>{ALERT_WORDS[x.alert]}{x.daysLeft !== null && x.daysLeft > 0 ? ` (${x.daysLeft} ${x.daysLeft === 1 ? "day" : "days"})` : ""}</span>}
                  <div className="pm-sub">{x.evidenceDueOn ? `Evidence due ${x.evidenceDueOn}` : "No evidence date"}{x.reason ? ` - ${x.reason}` : ""}</div>{x.notes && <div className="pm-sub">{x.notes}</div>}</div>
                <div className="pm-end">{x.processorUrl && <a className="s6-btn" href={x.processorUrl} target="_blank" rel="noopener noreferrer">Open at your processor</a>}<button type="button" className="s6-btn" onClick={() => edit(x)}>Edit</button><button type="button" className="s6-btn" onClick={() => void askRemove(x)}>Remove</button></div>
              </li>))}</ul>
          </>
        )}
      </Load>
      {draft && (
        <section className="pm-card" aria-label={draft.id ? "Edit a dispute" : "Add a dispute"} data-testid="pm-dispute-form">
          {pv?.kind === "remove" ? (
            <>
              <h3 className="pm-h mb-2">Remove this dispute</h3>
              <p className="text-sm">{pv.note}</p>
              <p className="ap-fine my-2">Type <b>{pv.confirmWith}</b> to confirm.</p>
              <input className="ap-field" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the customer name to confirm" data-testid="pm-dispute-confirm" />{" "}
              <button type="button" className="s6-btn" disabled={typed.trim() !== pv.confirmWith} onClick={() => void remove()}>Remove it</button>{" "}<button type="button" className="s6-btn" onClick={() => { setDraft(null); setPv(null); }}>Keep it</button>
            </>
          ) : (
            <>
              <h3 className="pm-h mb-2">{draft.id ? "Edit a dispute" : "Add a dispute"}</h3>
              <div className="pm-form">
                {!draft.id && <label>Client account<select className="ap-field" value={draft.location} onChange={(e) => set({ location: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
                <label>Customer<input className="ap-field" value={draft.customer} maxLength={120} onChange={(e) => set({ customer: e.target.value })} /></label>
                <label>Amount<input className="ap-field" inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
                <label>Currency<input className="ap-field" value={draft.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></label>
                <label>Opened<input className="ap-field" type="date" value={draft.openedOn} onChange={(e) => set({ openedOn: e.target.value })} /></label>
                <label>Evidence due<input className="ap-field" type="date" value={draft.evidenceDueOn} onChange={(e) => set({ evidenceDueOn: e.target.value })} /></label>
                <label>Status<select className="ap-field" value={draft.status} onChange={(e) => set({ status: e.target.value as PmDispute["status"] })}>{(Object.keys(STATUS_WORDS) as Array<PmDispute["status"]>).map((k) => <option key={k} value={k}>{STATUS_WORDS[k]}</option>)}</select></label>
                <label>Reason<input className="ap-field" value={draft.reason} maxLength={300} onChange={(e) => set({ reason: e.target.value })} /></label>
                <label>Link to your processor (https)<input className="ap-field" value={draft.processorUrl} maxLength={500} onChange={(e) => set({ processorUrl: e.target.value })} /></label>
                <label>Notes<input className="ap-field" value={draft.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} /></label>
              </div>
              {pv && <div className="mt-3" data-testid="pm-dispute-preview"><p className="pm-h mb-1">Check before saving</p><ul className="pm-steps">{pv.lines.map((l) => <li key={l.field}><b>{l.field}:</b> {l.before !== undefined ? `${l.before} to ` : ""}{l.after}</li>)}</ul><p className="ap-fine mt-1">{pv.note}</p></div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!pv ? <button type="button" className="s6-btn" data-kind="primary" onClick={() => void preview()}>Check</button> : <button type="button" className="s6-btn" data-kind="primary" disabled={pv.lines.length === 0 && !!draft.id} onClick={() => void save()}>Save</button>}
                <button type="button" className="s6-btn" onClick={() => { setDraft(null); setPv(null); }}>Cancel</button>
              </div>
            </>
          )}
          {err && <p className="mt-2 text-sm" role="alert">{err}</p>}
        </section>
      )}
      {!draft && err && <p className="text-sm" role="alert">{err}</p>}
    </div>
  );
}

export function UpcomingTab() {
  const r = usePm<PmUpcoming>("upcoming");
  return (
    <Load r={r}>
      {(u) => (
        <div className="pm-stack" data-testid="pm-upcoming">
          <p className="ap-fine" data-testid="pm-upcoming-dates">The dates in the bar do not change this tab: the platform does not give the day each client is charged, so there are no due dates to place in a range.</p>
          <section className="pm-card" aria-label="Expected from your clients">
            <h2 className="pm-h mb-2">From your clients (estimate)</h2>
            {u.plans.state === "needs_permission" && <p className="text-sm"><b>{RECONNECT}</b></p>}
            {u.plans.items.map((i) => <p key={i.currency} className="text-sm"><b className="pm-amt">{fmtMoney(i.amount, i.currency)}</b> a month from {i.accounts} paying client {i.accounts === 1 ? "account" : "accounts"}. <span className="ap-fine">{i.formula}</span></p>)}
            {u.plans.items.length === 0 && u.plans.state !== "needs_permission" && <NotFromPlatform>the price of the plans you sell to your clients.</NotFromPlatform>}
            {u.plans.items.length > 0 && <p className="ap-fine mt-1">{u.plans.note}</p>}
          </section>
          <section className="pm-card" aria-label="Your clients' customers"><h2 className="pm-h mb-2">From your clients&apos; customers</h2><NotFromPlatform>{u.customers.note.replace(/^Not available from the platform yet: /, "")}</NotFromPlatform></section>
          <section className="pm-card" aria-label="What the platform does not give us">
            <h2 className="pm-h mb-2">Not available from the platform yet</h2>
            <ul className="pm-steps">{u.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className="ap-fine mt-2">We show these the moment the platform offers them. Until then, nothing here is guessed.</p>
          </section>
        </div>
      )}
    </Load>
  );
}

export function HistoryTab({ openAccount }: { openAccount: (id: string) => void }) {
  const r = usePm<PmHistory>("history");
  return (
    <Load r={r}>
      {(h) => {
        if (h.historyStarts === null && h.days.length === 0) return <EmptyState title="History starts today" body="Every status change of a payment is written down from now on, so soon you can see how long payments take to fix and who pays late again and again." />;
        const peak = Math.max(1, ...h.days.map((d) => Math.max(d.failed, d.recovered)));
        return (
          <div className="pm-stack" data-testid="pm-history">
            <p className="ap-fine">History starts {h.historyStarts}. This is our own record: the platform only shows today.{h.historyStarts && h.windowFrom && h.historyStarts > h.windowFrom ? ` Our record starts ${h.historyStarts}, so the dates before that (${h.windowFrom} onward) are empty, not zero.` : ""} Customers who pay late again and again are counted over the last 6 months, whatever the dates.</p>
            <div className="pm-tiles">
              <div className="pm-tile"><b>{h.avgDaysToRecover ?? "-"}</b><span>Days to fix, on average</span></div>
              <div className="pm-tile"><b>{h.recoveryRate !== null ? `${h.recoveryRate}%` : "-"}</b><span>Fixed after we flagged them ({h.fixed} of {h.flagged}, {h.windowFrom} to {h.windowTo})</span></div>
              <div className="pm-tile"><b>{h.recovered.reduce((a, x) => a + x.count, 0)}</b><span>Recovered, {h.windowFrom} to {h.windowTo}</span>{h.recovered.length > 0 && <Money items={h.recovered} />}</div>
            </div>
            {h.days.length > 0 && (
              <section className="pm-card" aria-label="Failed and recovered per day">
                <h2 className="pm-h mb-2">Failed (amber) and fixed (blue) per day</h2>
                <div className="pm-bars" role="img" aria-label={`Failed and fixed payments per day since ${h.days[0].day}`}>{h.days.map((d) => <span key={d.day} className="contents"><i data-k="f" title={`${d.day}: ${d.failed} failed`} style={{ height: `${(d.failed / peak) * 100}%`, minHeight: d.failed ? 3 : 0 }} /><i title={`${d.day}: ${d.recovered} fixed`} style={{ height: `${(d.recovered / peak) * 100}%`, minHeight: d.recovered ? 3 : 0 }} /></span>)}</div>
              </section>
            )}
            {h.repeat.length > 0 && (
              <section className="pm-card" aria-label="Customers who pay late again">
                <h2 className="pm-h mb-2">Customers who pay late again and again</h2>
                <ul className="pm-list">{h.repeat.map((x, i) => <li key={i} className="text-sm"><b>{x.who}</b> at {x.accountName}: {x.count} problems in 6 months <button type="button" className="ap-link" onClick={() => openAccount(x.locationId)}>See this client&apos;s items</button></li>)}</ul>
              </section>
            )}
          </div>
        );
      }}
    </Load>
  );
}

export function SetupTab() {
  const r = usePm<PmSetup>("setup");
  return (
    <Load r={r}>
      {(s) => (
        <div className="pm-stack" data-testid="pm-setup">
          <PermissionNotice sources={s.sources} />
          <section className="pm-card"><h2 className="pm-h mb-2">What we can read</h2>
            <ul className="pm-list">{s.sources.map((x) => <li key={x.key} className="text-sm"><b>{x.label}</b>: {x.state === "ok" ? `working, last read ${ago(x.lastOkAt)}` : x.message ?? "Not checked yet"} <span className="ap-fine">(<code>{x.scope}</code>)</span></li>)}</ul></section>
          <section className="pm-card"><h2 className="pm-h mb-2">Check your payment setup</h2>
            <ul className="pm-list">{s.checks.map((c) => <li key={c.key} className="text-sm"><b>{c.ok ? "OK" : "Look at this"}:</b> {c.title}. <span className="ap-fine">{c.detail}</span></li>)}</ul></section>
        </div>
      )}
    </Load>
  );
}

export { day };
