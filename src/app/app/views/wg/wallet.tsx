"use client";

import { useEffect, useMemo, useState } from "react";
import type { WgAccount, WgBucket, WgList, WgRow, WgSettings, WgSummary, WgUsage } from "@/lib/analytics/wg-types";
import { usd } from "@/lib/analytics/wg-core";
import { ApiError, useApiClient } from "../../session";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { OpenLeadButton } from "../../ds/open-lead-button";
import "../speed6.css";
import "../cl3/cl3.css";
import "./wg.css";
import { sampleAccount, sampleList, sampleSettings, sampleSummary, sampleUsage, useWg, wgfxOn } from "./data";

// Clients, Wallet: every client account's credit balance, lowest days left first. REAL values only: the balance the platform returned (optional permission wallet.readonly) and SubSync's own
// readings of it, kept from the day we first saw each balance. Days left and spikes are ESTIMATES with the formula one tap away, and say "not enough data" until our record has a few days.
// Every count opens exactly its rows. Nothing here tops up a balance, charges anyone or messages anyone. Sample data appears ONLY with ?wgfx and says so.

const num = (n: number) => n.toLocaleString("en-US");
const failText = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Please try again.");
const BUCKETS: Array<[WgBucket, string, string]> = [
  ["all", "All accounts", "Every client account."], ["empty", "Empty", "The balance is zero: texts, calls and emails can stop."], ["low", "Running low", "Under your limit, or about to run out at the usual spend (estimate)."],
  ["spike", "Spending jump", "Spending far more than the account's own normal (estimate)."], ["unknown", "Not readable", "No balance from the platform yet: needs permission, or not available."], ["paused", "Alerts paused", "You paused alerts for these accounts."],
];

function daysText(r: WgRow): string {
  if (r.balance === null) return "";
  if (r.balance <= 0) return "Empty";
  if (r.daysLeft === null) return r.readings > 0 && !r.enough ? "Not enough data" : "No spending seen";
  return r.daysLeft < 1 ? "Under a day" : `About ${Math.round(r.daysLeft)} ${Math.round(r.daysLeft) === 1 ? "day" : "days"}`;
}

function Bar({ r }: { r: WgRow }) {
  // Fills with the days left out of 14 (shape as well as colour: the text beside it always says the number).
  const pct = r.balance === null ? 0 : r.balance <= 0 ? 2 : r.daysLeft === null ? 100 : Math.max(4, Math.min(100, (r.daysLeft / 14) * 100));
  return <span className="wg-bar" role="img" aria-label={daysText(r) || "No balance"}><i style={{ width: `${pct}%` }} data-level={r.level} /></span>;
}

function LevelChip({ r }: { r: WgRow }) {
  const t = r.level === "empty" ? ["Empty", "amber"] : r.level === "low" ? ["Running low", "amber"] : r.level === "spike" ? ["Spending jump", "cyan"] : r.level === "unknown" ? ["Not readable", ""] : ["Fine", ""];
  return <span className="ap-chip" data-tone={t[1] || undefined}>{t[0]}</span>;
}

function How({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (<><button type="button" className="ap-link" aria-expanded={open} onClick={() => setOpen(!open)}>How is this worked out?</button>{open && <p className="ap-fine" data-testid="wg-formula">{text}</p>}</>);
}

/** A tiny line of the balance over time (our own readings). */
function Line({ points, label }: { points: number[]; label: string }) {
  if (points.length < 3) return <p className="ap-fine">Not enough data: our record needs a few readings.</p>;
  const lo = Math.min(...points), span = Math.max(...points) - lo || 1;
  const d = points.map((v, i) => `${(i / (points.length - 1)) * 300},${58 - ((v - lo) / span) * 54}`).join(" ");
  return <svg className="wg-line" viewBox="0 0 300 62" role="img" aria-label={label} preserveAspectRatio="none"><polyline points={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
}

function Detail({ id, name, onClose, canEdit, reload, sample }: { id: string; name: string; onClose: () => void; canEdit: boolean; reload: () => void; sample: boolean }) {
  const api = useApiClient();
  const r = useWg<WgAccount>(`part=account&account=${encodeURIComponent(id)}`, () => sampleAccount(id));
  const [usageOn, setUsageOn] = useState(false), [limit, setLimit] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const u = useWg<WgUsage>(usageOn ? `part=usage&account=${encodeURIComponent(id)}&days=7` : null, sampleUsage);
  const save = async (body: object, done: string) => {
    if (sample) { setMsg("This is sample data, so nothing is saved."); return; }
    setBusy(true); setMsg(null);
    try { await api.post("wg/act/rule", { location: id, ...body }); setMsg(done); reload(); r.reload(); } catch (e) { setMsg(failText(e)); } finally { setBusy(false); }
  };
  const d = r.data;
  return (
    <section className="cl-drill" aria-label={`${name}: credit history`} data-testid="wg-detail">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">{name}</h3><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      {r.loading && !d ? <SkeletonRows rows={3} label="Loading..." /> : r.error ? <ErrorState error={r.error as Error} onRetry={r.reload} /> : d && (
        <div className="cl-stack">
          <div className="wg-two">
            <div><h4 className="cl-h">Balance, last 30 days</h4><Line points={d.balances.map((b) => b.balance)} label="Credit balance over the last 30 days" /></div>
            <div><h4 className="cl-h">Spent each day</h4>
              {d.series.length < 3 ? <p className="ap-fine">Not enough data yet.</p> : (
                <div className="wg-bars" role="img" aria-label="Spend per day">{(() => { const mx = Math.max(...d.series.map((x) => x.spent), 1); return d.series.map((x) => <i key={x.day} title={`${x.day}: ${usd(x.spent)}${x.topups ? ", topped up" : ""}`} style={{ height: `${Math.max(3, (x.spent / mx) * 100)}%` }} data-top={x.topups ? "1" : undefined} />); })()}</div>)}
            </div>
          </div>
          <p className="ap-fine">{d.row.balance === null ? d.row.why : `${usd(d.row.balance)} now. ${d.row.why}`}{d.row.burnPerDay !== null ? ` Average spend about ${usd(d.row.burnPerDay)} a day (estimate).` : ""}{d.row.credits ? ` Free credits: ${usd(d.row.credits)}.` : ""}</p>
          {d.events.length > 0 && <ul className="cl-steps" aria-label="Recent events">{d.events.map((e) => <li key={e.id}><b>{e.at.slice(0, 10)}</b><span>{e.text}</span></li>)}</ul>}
          <div>
            <button type="button" className="s6-btn" onClick={() => setUsageOn(true)} disabled={usageOn}>What did the credit go on?</button>
            {usageOn && (u.loading && !u.data ? <p className="ap-fine">Asking the platform...</p> : u.data && (
              <div className="wg-usage" data-testid="wg-usage">
                {u.data.state !== "ok" ? <p className="ap-fine" role="status">{u.data.note}</p> : (
                  <>
                    <p className="ap-fine">Last {u.data.days} days: {u.data.total !== null ? usd(u.data.total) : ""} in charges. {u.data.note}</p>
                    <ul className="cl-steps">{u.data.byType.map((t) => <li key={t.type}><b>{t.type}</b><span>{usd(t.amount)} across {num(t.count)}</span></li>)}</ul>
                  </>)}
              </div>))}
          </div>
          {canEdit && (
            <form className="wg-form" onSubmit={(e) => { e.preventDefault(); void save({ lowAmount: limit === "" ? null : Number(limit) }, limit === "" ? "Back to your usual limit." : "Limit saved for this account."); }}>
              <label className="ap-fine" htmlFor={`wg-lim-${id}`}>Alert me under (dollars), for this account only</label>
              <input id={`wg-lim-${id}`} className="ap-field" inputMode="decimal" placeholder={`${d.row.ruleAmount ?? d.row.lowAmount} (usual: ${usd(d.row.lowAmount)})`} value={limit} onChange={(e) => setLimit(e.target.value)} />
              <button type="submit" className="s6-btn" disabled={busy}>Save limit</button>
              {d.row.pausedUntil
                ? <button type="button" className="s6-btn" disabled={busy} onClick={() => void save({ pauseDays: 0 }, "Alerts are back on for this account.")}>Turn alerts back on</button>
                : <button type="button" className="s6-btn" disabled={busy} onClick={() => void save({ pauseDays: 7 }, "Alerts paused for 7 days.")}>Pause alerts for 7 days</button>}
              {msg && <span className="ap-fine" role="status">{msg}</span>}
            </form>)}
        </div>
      )}
    </section>
  );
}

function Settings({ summary, reload, sample }: { summary: WgSummary; reload: () => void; sample: boolean }) {
  const api = useApiClient();
  const r = useWg<WgSettings>("part=settings", sampleSettings);
  type Form = { la: string; ld: string; alerts: boolean; spike: boolean };
  const [open, setOpen] = useState(false), [edit, setEdit] = useState<Partial<Form>>({}), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const f: Form | null = r.data ? { la: String(r.data.lowAmount), ld: String(r.data.lowDays), alerts: r.data.alertsOn, spike: r.data.spikeOn, ...edit } : null;
  const setF = (n: Form) => setEdit(n);
  const post = async (name: string, body: object, done: string) => {
    if (sample) { setMsg("This is sample data, so nothing is saved."); return; }
    setBusy(true); setMsg(null);
    try { await api.post(`wg/act/${name}`, body); setMsg(done); reload(); r.reload(); } catch (e) { setMsg(failText(e)); } finally { setBusy(false); }
  };
  const d = r.data;
  return (
    <section aria-label="Alert settings" className="wg-settings" data-testid="wg-settings">
      <button type="button" className="ap-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide alert settings" : "Alert settings"}</button>
      {open && d && f && (
        <div className="cl-stack">
          <p className="ap-fine">{d.watching ? "You get an alert when a balance is low, empty or jumps." : "You do not get alerts yet."} {d.sendingNote} Quiet hours follow Notifications.</p>
          <div className="wg-form">
            <button type="button" className="s6-btn" data-kind={d.watching ? undefined : "primary"} disabled={busy} onClick={() => void post("watch", { on: !d.watching }, d.watching ? "You will not get wallet alerts." : "You will get wallet alerts.")}>{d.watching ? "Stop alerting me" : "Alert me"}</button>
          </div>
          {d.canEdit && (
            <form className="wg-form" onSubmit={(e) => { e.preventDefault(); void post("settings", { lowAmount: Number(f.la), lowDays: Number(f.ld), alertsOn: f.alerts, spikeOn: f.spike }, "Saved."); }}>
              <label className="ap-fine" htmlFor="wg-la">Low when the balance is under (dollars)</label>
              <input id="wg-la" className="ap-field" inputMode="decimal" value={f.la} onChange={(e) => setF({ ...f, la: e.target.value })} />
              <label className="ap-fine" htmlFor="wg-ld">Or when it will last fewer than (days, estimate)</label>
              <input id="wg-ld" className="ap-field" inputMode="numeric" value={f.ld} onChange={(e) => setF({ ...f, ld: e.target.value })} />
              <label className="ap-fine"><input type="checkbox" checked={f.alerts} onChange={(e) => setF({ ...f, alerts: e.target.checked })} /> Send alerts</label>
              <label className="ap-fine"><input type="checkbox" checked={f.spike} onChange={(e) => setF({ ...f, spike: e.target.checked })} /> Alert on a sudden jump in spend</label>
              <button type="submit" className="s6-btn" data-kind="primary" disabled={busy}>Save</button>
            </form>)}
          {d.rules.length > 0 && <ul className="cl-steps" aria-label="Accounts with their own limit or pause">{d.rules.map((x) => <li key={x.locationId}><b>{x.name}</b><span>{x.lowAmount !== null ? `limit ${usd(x.lowAmount)}` : ""}{x.pausedUntil ? ` paused until ${x.pausedUntil.slice(0, 10)}` : ""}</span></li>)}</ul>}
          <p className="ap-fine">Usual limit now: {usd(summary.prefs.lowAmount)} or fewer than {summary.prefs.lowDays} days left.</p>
          {msg && <p className="ap-fine" role="status">{msg}</p>}
        </div>)}
    </section>
  );
}

export function WalletTab({ onOpen }: { onOpen: (id: string) => void }) {
  const sample = wgfxOn();
  const [bucket, setBucket] = useState<WgBucket>("all"), [q, setQ] = useState(""), [dq, setDq] = useState(""), [page, setPage] = useState(0), [openId, setOpenId] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const sum = useWg<WgSummary>("part=summary", sampleSummary);
  const qs = useMemo(() => `part=list&bucket=${bucket}&page=${page}&size=20${dq ? `&q=${encodeURIComponent(dq)}` : ""}`, [bucket, page, dq]);
  const list = useWg<WgList>(qs, () => sampleList(bucket, dq));
  const reload = () => { sum.reload(); list.reload(); };
  const s = sum.data;
  if (sum.loading && !s) return <SkeletonRows rows={5} label="Reading every credit balance..." />;
  if (sum.error) return /not switched on/i.test(String((sum.error as Error).message)) ? <EmptyState title="Not switched on yet" body="The wallet watchlist is not switched on for your account yet." /> : <ErrorState error={sum.error as Error} onRetry={sum.reload} />;
  if (!s) return null;
  if (s.restricted) return <EmptyState title="Wallet is for owners and admins" body="It shows every client account's credit balance. Ask the owner of your account to open it." />;
  if (s.accounts === 0) return <EmptyState title="No client accounts yet" body="Client accounts appear here after the first sync finishes." />;
  const pick = (b: WgBucket) => { setBucket(b); setPage(0); setOpenId(null); };
  const tile = (label: string, n: number, b: WgBucket, tip: string) => <button key={b} type="button" className="cl-tile" onClick={() => pick(b)} title={tip}><b>{num(n)}</b><span>{label}</span></button>;
  return (
    <div className="cl-stack" data-testid="wg-module">
      {sample && <p className="ap-fine" role="status" data-testid="wg-sample">Sample data: these are not your real clients.</p>}
      <section className="cl-today" aria-label="What to do about credit balances">
        <h2 className="cl-h">What to do today</h2>
        <p className="cl-sentence" data-testid="wg-headline">{s.headline}</p>
        {s.counts.empty + s.counts.low > 0 && <button type="button" className="s6-btn" data-kind="primary" onClick={() => pick(s.counts.empty > 0 ? "empty" : "low")}>Show these {num(s.counts.empty > 0 ? s.counts.empty : s.counts.low)}</button>}
        {s.needsPermission > 0 && <p className="ap-fine" role="status" data-testid="wg-perm">Needs permission: reconnect and allow wallet access. {num(s.needsPermission)} {s.needsPermission === 1 ? "account is" : "accounts are"} not readable until then.</p>}
      </section>
      <div className="cl-tiles" aria-label="Credit balance headline">
        {tile("Empty", s.counts.empty, "empty", "Texts, calls and emails can stop at zero.")}
        {tile("Running low", s.counts.low, "low", "Under your limit or about to run out (estimate).")}
        {tile("Spending jump", s.counts.spike, "spike", "Far above the account's own normal (estimate).")}
        {tile("Not readable", s.counts.unknown, "unknown", "No balance from the platform.")}
      </div>
      <p className="ap-fine" data-testid="wg-history">{s.historyStarts ? `Our own record of these balances starts ${s.historyStarts}.` : "Our own record starts at the first balance we read."} Days left and jumps are estimates: they need about 4 readings over 3 days, and a week of record for a jump. Auto-recharge: {s.autoRecharge.note}</p>
      <How text={`${s.formulaBurn} ${s.formulaSpike}`} />
      <div role="group" aria-label="Filter accounts" className="cl3-chips">
        {BUCKETS.map(([k, label, tip]) => <button key={k} type="button" className="cl-reason" aria-pressed={bucket === k} data-on={bucket === k ? "1" : undefined} title={tip} onClick={() => pick(k)}>{label} ({num(s.counts[k])})</button>)}
      </div>
      <div className="ap-head print:hidden" role="search"><label className="ap-search"><span className="sr-only">Search accounts</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="wg-search" /></label></div>
      {list.loading && !list.data ? <SkeletonRows rows={4} label="Loading..." /> : list.error ? <ErrorState error={list.error as Error} onRetry={list.reload} /> : list.data && (list.data.rows.length === 0 ? <EmptyState title="No accounts here" body="No client account matches this filter." /> : (
        <>
          <p className="ap-fine" data-testid="wg-count">{num(list.data.total)} {list.data.total === 1 ? "account" : "accounts"}, lowest days left first.</p>
          <ul className="wg-list" data-testid="wg-list" aria-label="Wallet watchlist">
            {list.data.rows.map((r) => (
              <li key={r.locationId} className="wg-row" data-level={r.level} data-testid={`wg-row-${r.locationId}`}>
                <div className="wg-main">
                  <b className="wg-name">{r.name}</b> <LevelChip r={r} />{r.pausedUntil && <span className="ap-chip">Alerts paused</span>}
                  <p className="ap-fine">{r.why}</p>
                </div>
                <div className="wg-nums">
                  <div><span className="ap-fine">Balance</span><b>{r.balance === null ? "" : r.balance <= 0 ? "Empty" : usd(r.balance)}</b></div>
                  <div><span className="ap-fine">Days left (estimate)</span><b>{daysText(r)}</b><Bar r={r} /></div>
                  <div><span className="ap-fine">Spend per day</span><b>{r.burnPerDay !== null ? usd(r.burnPerDay) : r.balance === null ? "" : "Not enough data"}</b></div>
                </div>
                <div className="wg-act">
                  <button type="button" className="s6-btn" data-kind="primary" onClick={() => setOpenId({ id: r.locationId, name: r.name })} data-testid="wg-details">Details</button>
                  <button type="button" className="ap-link" onClick={() => onOpen(r.locationId)} data-testid="wg-open-account">Open account</button>
                  {r.url && <OpenLeadButton seed={null} crmUrl={r.url} reason="" name={r.name} testId="wg-open-crm" />}
                </div>
              </li>
            ))}
          </ul>
          <div className="cl-pager print:hidden" role="navigation" aria-label="Pages">
            <span className="ap-fine">{num(list.data.total)} in total</span>
            <button type="button" className="s6-btn" disabled={list.data.page <= 0} onClick={() => setPage(list.data!.page - 1)}>Previous</button>
            <span className="ap-fine">Page {list.data.page + 1} of {list.data.pages}</span>
            <button type="button" className="s6-btn" disabled={list.data.page + 1 >= list.data.pages} onClick={() => setPage(list.data!.page + 1)}>Next</button>
          </div>
        </>))}
      {openId && <Detail key={openId.id} id={openId.id} name={openId.name} onClose={() => setOpenId(null)} canEdit reload={reload} sample={sample} />}
      <Settings summary={s} reload={reload} sample={sample} />
    </div>
  );
}
