"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ClAgencyInfo, ClNote, ClAccount, ClDrillRow, ClOverview, ClPage, ClPerson, ClReasonKey, ClReportRow, ClSetupRow, ClTrendRow } from "@/lib/analytics/clients3-types-interim";
import { useApiClient } from "../../session";
import { EmptyState, ErrorState, ModuleTabs, Page, SkeletonRows } from "../../ds";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "./cl3.css";
import { fixturesOn, useCl, type ClParams } from "./data";

// Clients as a module (the Appointments and Pipeline pattern): Overview | Needs attention | Trends | Compare accounts | Reports | People | Setup health.
// Reads only. Every number is a count that opens its rows. Nothing here messages anyone or changes the CRM.
type Drill = { title: string; reason: ClReasonKey | "all"; account: string; accountName: string; count: number } | null;
const TABS = [
  { key: "overview", label: "Overview", tip: "What to do today, in one sentence." }, { key: "needs", label: "Needs attention", tip: "Accounts ranked by what is wrong, with the count behind each reason." },
  { key: "trends", label: "Trends", tip: "Week on week, from our own record." }, { key: "compare", label: "Compare accounts", tip: "Two accounts side by side." },
  { key: "reports", label: "Reports", tip: "A weekly receipt per client to show them." }, { key: "people", label: "People", tip: "Who works in which account, and who has gone quiet." },
  { key: "setup", label: "Setup health", tip: "Connection, permissions and how fresh the data is." },
] as const;
type Tab = (typeof TABS)[number]["key"];
const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const ago = (iso: string | null) => { if (!iso) return "Never"; const h = Math.max(0, Math.round((Date.parse("2026-11-11T08:00:00Z") > 0 && fixturesOn() ? Date.parse("2026-11-11T08:00:00Z") - Date.parse(iso) : Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
const change = (now: number, prev: number) => (prev < 10 ? null : Math.round(((now - prev) / prev) * 100));

const RECONNECT = "Needs permission: reconnect";
const PLAN_STATUS: Record<string, string> = { active: "Paying", trial: "On trial", failed: "Payment failed", cancelled: "Cancelled" };
function BillingChip({ info }: { info?: ClAgencyInfo }) {
  const b = info?.billing;
  if (!info) return <span className="ap-fine">Loading...</span>;
  if (!b) return <span className="ap-fine" data-testid="cl-billing-missing">{RECONNECT}</span>;
  const bad = b.status === "failed" || b.status === "cancelled";
  return <span className="cl-bill" data-bad={bad ? "1" : undefined} data-testid="cl-billing"><b>{b.plan}</b> {PLAN_STATUS[b.status]}{b.failedCount > 0 ? " (" + b.failedCount + " failed)" : ""}{b.nextPayment ? ", next " + b.nextPayment : ""}</span>;
}
/** Billing and apps for up to 200 accounts at once, keyed by account. */
function useAgency() { const r = useCl<ClPage<ClAgencyInfo>>("agency", { pageSize: 200 }); return useMemo(() => new Map((r.data?.rows ?? []).map((x) => [x.locationId, x])), [r.data]); }
function Notes({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const api = useApiClient(), fx = fixturesOn();
  const r = useCl<ClPage<ClNote>>("notes", { location: id });
  const [text, setText] = useState(""), [mine, setMine] = useState<ClNote[]>([]), [err, setErr] = useState("");
  const save = async () => {
    const t = text.trim(); if (!t) return; setErr("");
    try { if (!fx) await api.post("clients3?part=notes", { location: id, text: t }); setMine((m) => [{ id: String(Date.now()), text: t, at: new Date().toISOString().slice(0, 10), by: "You" }, ...m]); setText(""); } catch { setErr("Could not save this note. Try again."); }
  };
  const all = [...mine, ...(r.data?.rows ?? [])];
  return (
    <section className="cl-drill" data-testid="cl-notes" aria-label={"Notes for " + name}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">Notes: {name}</h3><span className="ap-fine">Only your team sees these. They stay in SubSync and are never sent to the client or the CRM.</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <textarea className="ap-field cl-note-box" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened, what was agreed, what to do next" aria-label="New note" />
      <div className="mt-2 flex items-center gap-3"><button type="button" className="s6-btn" data-kind="primary" disabled={!text.trim()} onClick={() => void save()}>Save note</button>{err && <span className="ap-fine" role="alert">{err}</span>}</div>
      {r.loading && !r.data ? <SkeletonRows rows={2} label="Loading notes..." /> : all.length === 0 ? <p className="ap-fine mt-3">No notes yet.</p> : <ul className="cl-notes">{all.map((n) => <li key={n.id}><span className="ap-fine">{n.at} by {n.by}</span><p>{n.text}</p></li>)}</ul>}
    </section>
  );
}

function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 3) return <span className="ap-fine">Not enough data</span>;
  const lo = Math.min(...values), span = Math.max(...values) - lo || 1, pts = values.map((v, i) => `${(i / (values.length - 1)) * 80},${22 - ((v - lo) / span) * 20}`).join(" ");
  return <svg className="cl-spark" viewBox="0 0 80 24" role="img" aria-label={label}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
function Load<T>({ r, children, empty }: { r: { data: T | null; error: unknown; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty: (d: T) => boolean | string }) {
  if (r.loading && !r.data) return <SkeletonRows rows={6} label="Loading clients..." />;
  if (r.error) return <ErrorState error={r.error as Error} onRetry={r.reload} />;
  if (!r.data) return null;
  const e = empty(r.data);
  return e ? <EmptyState title="Nothing to show yet" body={typeof e === "string" ? e : "Client accounts appear here after the first sync finishes."} /> : <>{children(r.data)}</>;
}
function Pager({ p, set }: { p: ClPage<unknown>; set: (n: number) => void }) {
  const last = Math.max(1, Math.ceil(p.total / p.pageSize));
  return (
    <div className="cl-pager" role="navigation" aria-label="Pages">
      <span className="ap-fine">{p.total.toLocaleString("en-US")} in total</span>
      <button type="button" className="s6-btn" disabled={p.page <= 1} onClick={() => set(p.page - 1)}>Previous</button>
      <span className="ap-fine">Page {p.page} of {last}</span>
      <button type="button" className="s6-btn" disabled={p.page >= last} onClick={() => set(p.page + 1)}>Next</button>
    </div>
  );
}
function Find({ q, setQ, children }: { q: string; setQ: (s: string) => void; children?: ReactNode }) {
  return (
    <div className="ap-head" role="search">
      <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search accounts</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="cl-search" /></label>
      {children}
    </div>
  );
}
/** A small paged list hook: search is debounced and any change returns to page 1. */
function useList<T>(part: Parameters<typeof useCl>[0], extra: ClParams = {}) {
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const key = JSON.stringify(extra);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [key]);
  const r = useCl<ClPage<T>>(part, { q: dq, page, pageSize: 25, ...extra });
  return { r, q, setQ, page, setPage };
}

function DrillList({ d, onClose }: { d: NonNullable<Drill>; onClose: () => void }) {
  const r = useCl<ClPage<ClDrillRow>>("rows", { reason: d.reason, location: d.account, account: d.accountName, expect: d.count, pageSize: 20 });
  return (
    <section id="cl-drill" className="cl-drill" data-testid="cl-drill" aria-label={d.title}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold" data-testid="cl-drill-title">{d.title}</h3><span className="ap-chip" data-tone="cyan">{d.count}</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && "Nothing behind this one in these dates."}>
        {(x) => (
          <div className="ap-scroll"><table className="ap-t" data-testid="cl-drill-list"><thead><tr><th>Item</th><th>When</th><th /></tr></thead>
            <tbody>{x.rows.map((row) => <tr key={row.id}><td>{row.title}</td><td>{row.sub}</td><td>{row.url ? <a className="ap-link" href={row.url} target="_blank" rel="noopener noreferrer">Open in your CRM</a> : <span className="ap-fine">Link not available</span>}</td></tr>)}</tbody></table></div>
        )}
      </Load>
    </section>
  );
}

function Overview({ open, go }: { open: (d: NonNullable<Drill>) => void; go: (t: Tab) => void }) {
  const r = useCl<ClOverview>("overview");
  return (
    <Load r={r} empty={(o) => o.accounts === 0}>
      {(o) => {
        const first = o.today.steps[0];
        return (
          <div className="cl-stack" data-testid="cl-overview">
            <section className="cl-today" aria-label="What to do today">
              <h2 className="cl-h">What to do today</h2>
              <p className="cl-sentence" data-testid="cl-today-sentence">{o.today.sentence || "All your client accounts look fine today."}</p>
              {first && <button type="button" className="s6-btn" data-kind="primary" data-testid="cl-today-go" onClick={() => open({ title: `${first.accountName}: ${first.title}`, reason: first.reason, account: first.locationId, accountName: first.accountName, count: first.count })}>See {first.count} {first.title.replace(/^\d+ /, "")}</button>}
              {o.today.steps.length > 1 && <ol className="cl-steps">{o.today.steps.slice(1).map((s) => <li key={s.locationId}><span>{s.accountName}</span><button type="button" className="ap-link" onClick={() => open({ title: `${s.accountName}: ${s.title}`, reason: s.reason, account: s.locationId, accountName: s.accountName, count: s.count })}>{s.title}</button></li>)}</ol>}
            </section>
            <PaymentsAtRisk open={open} />
            <div className="cl-tiles">
              {([["Client accounts", o.accounts, () => go("needs")], ["Need a look", o.needAttention, () => go("needs")], ["Leads waiting for a reply", o.totals.waiting, () => open({ title: "Leads waiting for a reply", reason: "waiting", account: "", accountName: "All accounts", count: o.totals.waiting })], ["Appointments with no outcome", o.totals.unmarked, () => open({ title: "Appointments with no outcome", reason: "unmarked", account: "", accountName: "All accounts", count: o.totals.unmarked })]] as Array<[string, number, () => void]>).map(([label, n, fn]) => (
                <button key={label} type="button" className="cl-tile" onClick={fn}><b>{n.toLocaleString("en-US")}</b><span>{label}</span></button>
              ))}
            </div>
            <p className="ap-fine">{o.historySince ? `Trends use our own record, which starts ${o.historySince}.` : "Trends start once we have a few weeks of record."}</p>
          </div>
        );
      }}
    </Load>
  );
}

function PaymentsAtRisk({ open }: { open: (d: NonNullable<Drill>) => void }) {
  const r = useCl<ClPage<ClAgencyInfo>>("payments", { pageSize: 5 });
  if (!r.data || r.data.rows.length === 0) return null;
  return (
    <section className="cl-today" aria-label="Payments at risk" data-testid="cl-payments">
      <h2 className="cl-h">Payments at risk</h2>
      <p className="cl-sentence">{r.data.total} client{r.data.total === 1 ? "" : "s"} with a failed payment or no billing data.</p>
      <ul className="cl-steps">{r.data.rows.map((x) => <li key={x.locationId}><span>{x.name}</span>{x.billing ? <button type="button" className="ap-link" onClick={() => open({ title: x.name + ": failed payments", reason: "all", account: x.locationId, accountName: x.name, count: x.billing!.failedCount })}>{x.billing.failedCount} failed, {money(x.billing.amountCents)} owed</button> : <span>{RECONNECT}</span>}</li>)}</ul>
    </section>
  );
}

const SORTS: Array<[string, string]> = [["attention", "Most to fix"], ["name", "Name"], ["leads", "New leads"], ["waiting", "Waiting for a reply"], ["stale", "Stuck deals"], ["won", "Money won"]];
function Needs({ open, onlyNeeds }: { open: (d: NonNullable<Drill>) => void; onlyNeeds: boolean }) {
  const agency = useAgency(), [notes, setNotes] = useState<{ id: string; name: string } | null>(null);
  const [only, setOnly] = useState(onlyNeeds), [sort, setSort] = useState("attention");
  const { r, q, setQ, setPage } = useList<ClAccount>("accounts", { only: only ? "needs" : "", sort, dir: sort === "name" ? "asc" : "desc" });
  return (
    <div data-testid="cl-needs">
      <Find q={q} setQ={setQ}>
        <select className="ap-field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="ap-fine inline-flex items-center gap-2"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Only accounts that need a look</label>
      </Find>
      <Load r={r} empty={(p) => p.rows.length === 0 && (only ? "No account needs a look right now." : false)}>
        {(p) => (
          <>
            <div className="ap-scroll"><table className="ap-t" data-testid="cl-table"><thead><tr><th>Account</th><th>What needs a look</th><th data-num>New leads</th><th data-num>Waiting</th><th data-num>Stuck deals</th><th>Billing</th><th /></tr></thead>
              <tbody>{p.rows.map((a) => {
                const d = change(a.leads, a.leadsPrev);
                return (
                  <tr key={a.locationId} data-tone={a.reasons.length > 1 ? "amber" : undefined}>
                    <td><span className="ap-name">{a.name}</span></td>
                    <td className="cl-reasons">{a.reasons.length ? a.reasons.map((x) => <button key={x.key} type="button" className="cl-reason" onClick={() => open({ title: `${a.name}: ${x.label}`, reason: x.key, account: a.locationId, accountName: a.name, count: x.count })}>{x.count} {x.label}</button>) : <span className="ap-fine">All good</span>}</td>
                    <td data-num>{a.leads}{d !== null && <span className="ap-sub"> {d > 0 ? "+" : ""}{d}%</span>}</td>
                    <td data-num>{a.waiting > 0 ? <button type="button" className="ap-link" onClick={() => open({ title: `${a.name}: waiting for a reply`, reason: "waiting", account: a.locationId, accountName: a.name, count: a.waiting })}>{a.waiting}</button> : 0}</td>
                    <td data-num>{a.staleShare === null ? "Not enough data" : `${Math.round(a.staleShare * 100)}%`}</td>
                    <td><BillingChip info={agency.get(a.locationId)} /></td>
                    <td><button type="button" className="ap-link" onClick={() => setNotes({ id: a.locationId, name: a.name })}>Notes</button></td>
                  </tr>
                );
              })}</tbody></table></div>
            <Pager p={p} set={setPage} />
          </>
        )}
      </Load>
      {notes && <Notes key={notes.id} id={notes.id} name={notes.name} onClose={() => setNotes(null)} />}
    </div>
  );
}

function Trends({ since }: { since: string | null }) {
  const { r, q, setQ, setPage } = useList<ClTrendRow>("trends");
  const wow = (v: number[]) => { const a = v[v.length - 1], b = v[v.length - 2]; return b === undefined || b < 5 ? "" : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`; };
  return (
    <div data-testid="cl-trends">
      <Find q={q} setQ={setQ} />
      <p className="ap-fine mb-2">Last 5 weeks, from our own record{since ? ` (starts ${since})` : ""}. Week on week change is shown only when last week had enough to compare.</p>
      <Load r={r} empty={(p) => p.rows.length === 0}>
        {(p) => (
          <>
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Account</th><th>New leads</th><th>Replied to</th><th>Booked</th><th>Money won</th></tr></thead>
              <tbody>{p.rows.map((t) => <tr key={t.locationId}><td><span className="ap-name">{t.name}</span></td>
                <td><span className="cl-cell"><Spark values={t.leads} label={`${t.name} new leads by week`} /><span>{t.leads[t.leads.length - 1]} <span className="ap-sub">{wow(t.leads)}</span></span></span></td>
                <td><span className="cl-cell"><Spark values={t.answeredPct.filter((x): x is number => x !== null)} label={`${t.name} share of leads replied to`} /><span>{t.answeredPct[t.answeredPct.length - 1] ?? "n/a"}%</span></span></td>
                <td><span className="cl-cell"><Spark values={t.booked} label={`${t.name} booked by week`} /><span>{t.booked[t.booked.length - 1]} <span className="ap-sub">{wow(t.booked)}</span></span></span></td>
                <td><span className="cl-cell"><Spark values={t.wonCents} label={`${t.name} money won by week`} /><span>{money(t.wonCents[t.wonCents.length - 1])}</span></span></td></tr>)}</tbody></table></div>
            <Pager p={p} set={setPage} />
          </>
        )}
      </Load>
    </div>
  );
}

function Compare() {
  const r = useCl<ClPage<ClAccount>>("accounts", { pageSize: 200, sort: "name", dir: "asc" });
  const [a, setA] = useState(""), [b, setB] = useState("");
  const rows = r.data?.rows ?? [];
  const A = rows.find((x) => x.locationId === a) ?? rows[0], B = rows.find((x) => x.locationId === b) ?? rows[1];
  const lines: Array<[string, (x: ClAccount) => number | null, (n: number) => string, boolean]> = [
    ["New leads", (x) => x.leads, String, true], ["Waiting for a reply", (x) => x.waiting, String, false], ["Median first reply", (x) => x.medianReplyMin, (n) => `${n} min`, false],
    ["Appointments booked", (x) => x.booked, String, true], ["Showed up", (x) => x.showed, String, true], ["No-shows", (x) => x.noShow, String, false], ["Appointments with no outcome", (x) => x.unmarked, String, false],
    ["Open deals", (x) => x.dealsOpen, String, true], ["Stuck deals", (x) => (x.staleShare === null ? null : Math.round(x.staleShare * 100)), (n) => `${n}%`, false], ["Money won", (x) => x.wonCents, money, true], ["Staff active", (x) => x.staffActive, String, true],
  ];
  return (
    <Load r={r} empty={(p) => p.rows.length < 2 && "Compare needs at least two client accounts."}>
      {() => (
        <div data-testid="cl-compare">
          <div className="ap-head"><select className="ap-field" aria-label="First account" value={A?.locationId} onChange={(e) => setA(e.target.value)}>{rows.map((x) => <option key={x.locationId} value={x.locationId}>{x.name}</option>)}</select>
            <span className="ap-fine">against</span><select className="ap-field" aria-label="Second account" value={B?.locationId} onChange={(e) => setB(e.target.value)}>{rows.map((x) => <option key={x.locationId} value={x.locationId}>{x.name}</option>)}</select></div>
          {A && B && <div className="ap-scroll"><table className="ap-t" style={{ minWidth: 420 }}><thead><tr><th>Last 30 days</th><th data-num>{A.name}</th><th data-num>{B.name}</th></tr></thead>
            <tbody>{lines.map(([label, f, fmt, hi]) => { const x = f(A), y = f(B), win = x === null || y === null || x === y ? 0 : (x > y) === hi ? 1 : 2; return <tr key={label} style={{ cursor: "default" }}><td>{label}</td><td data-num data-win={win === 1 ? "1" : undefined}>{x === null ? "Not enough data" : fmt(x)}</td><td data-num data-win={win === 2 ? "1" : undefined}>{y === null ? "Not enough data" : fmt(y)}</td></tr>; })}</tbody></table></div>}
          <p className="ap-fine mt-2">The bold number is the stronger of the two. Neither is a score; they are plain counts from your CRM.</p>
        </div>
      )}
    </Load>
  );
}

function Reports() {
  const { r, q, setQ, setPage } = useList<ClReportRow>("reports");
  const [done, setDone] = useState("");
  const text = (x: ClReportRow) => `${x.name}, this week: ${x.came} new leads came in and ${x.answered} were answered. ${x.booked} appointments were booked and ${x.showed} showed up. ${x.won} deals were won for ${money(x.wonCents)}. We caught ${x.caught} things that needed attention.`;
  const copy = (x: ClReportRow) => { try { void navigator.clipboard.writeText(text(x)); setDone(x.locationId); setTimeout(() => setDone(""), 1500); } catch { setDone(""); } };
  return (
    <div data-testid="cl-reports">
      <Find q={q} setQ={setQ}><button type="button" className="s6-btn" onClick={() => window.print()}>Print</button></Find>
      <Load r={r} empty={(p) => p.rows.length === 0}>
        {(p) => (
          <>
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Client</th><th data-num>Came in</th><th data-num>Answered</th><th data-num>Booked</th><th data-num>Showed</th><th data-num>Won</th><th data-num>Caught</th><th /></tr></thead>
              <tbody>{p.rows.map((x) => <tr key={x.locationId} style={{ cursor: "default" }}><td><span className="ap-name">{x.name}</span></td><td data-num>{x.came}</td><td data-num>{x.answered}</td><td data-num>{x.booked}</td><td data-num>{x.showed}</td><td data-num>{money(x.wonCents)}</td><td data-num>{x.caught}</td>
                <td><button type="button" className="ap-link" onClick={() => copy(x)}>{done === x.locationId ? "Copied" : "Copy for client"}</button></td></tr>)}</tbody></table></div>
            <Pager p={p} set={setPage} />
          </>
        )}
      </Load>
    </div>
  );
}

function People() {
  const [idle, setIdle] = useState(false);
  const { r, q, setQ, setPage } = useList<ClPerson>("people", { only: idle ? "idle" : "" });
  return (
    <div data-testid="cl-people">
      <Find q={q} setQ={setQ}><label className="ap-fine inline-flex items-center gap-2"><input type="checkbox" checked={idle} onChange={(e) => setIdle(e.target.checked)} />Only people who have gone quiet</label></Find>
      <Load r={r} empty={(p) => p.rows.length === 0 && (idle ? "Nobody has gone quiet." : false)}>
        {(p) => (
          <>
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Person</th><th>Account</th><th data-num>Messages sent</th><th>Last active</th></tr></thead>
              <tbody>{p.rows.map((x) => <tr key={x.id} style={{ cursor: "default" }}><td><span className="ap-name">{x.name}</span></td><td>{x.accountName}</td><td data-num>{x.sent}</td><td>{x.idle ? <span className="ap-chip" data-tone="amber">Gone quiet</span> : x.lastActive}</td></tr>)}</tbody></table></div>
            <Pager p={p} set={setPage} />
          </>
        )}
      </Load>
    </div>
  );
}

function Setup() {
  const agency = useAgency();
  const [bad, setBad] = useState(false);
  const { r, q, setQ, setPage } = useList<ClSetupRow>("setup", { only: bad ? "needs" : "" });
  return (
    <div data-testid="cl-setup">
      <Find q={q} setQ={setQ}><label className="ap-fine inline-flex items-center gap-2"><input type="checkbox" checked={bad} onChange={(e) => setBad(e.target.checked)} />Only accounts with a problem</label></Find>
      <Load r={r} empty={(p) => p.rows.length === 0 && (bad ? "Every account is connected and up to date." : false)}>
        {(p) => (
          <>
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Account</th><th>Connection</th><th>Data last updated</th><th>Marketplace apps</th><th>Setup health</th></tr></thead>
              <tbody>{p.rows.map((x) => <tr key={x.locationId} style={{ cursor: "default" }} data-tone={x.connection === "ok" ? undefined : "amber"}><td><span className="ap-name">{x.name}</span></td>
                <td>{x.connection === "ok" ? "Connected" : x.connection === "reconnect" ? "Needs permission: reconnect" : `Missing permission for ${x.missingScopes.join(" and ")}: reconnect`}</td><td>{ago(x.syncedAt)}</td>
                <td data-testid="cl-apps">{(() => { const ap = agency.get(x.locationId)?.apps; return ap === undefined ? "..." : ap === null ? RECONNECT : ap.installed + ": " + ap.names.join(", "); })()}</td>
                <td>{(() => { const ap = agency.get(x.locationId)?.apps; return ap === undefined ? "..." : ap === null ? RECONNECT : ap.setupDone + " of " + ap.setupTotal + " steps done"; })()}</td></tr>)}</tbody></table></div>
            <Pager p={p} set={setPage} />
          </>
        )}
      </Load>
    </div>
  );
}

export function ClientsModule() {
  const [tab, setTab] = useState<Tab>("overview"), [drill, setDrill] = useState<Drill>(null);
  const ov = useCl<ClOverview>("overview");
  const index = TABS.findIndex((t) => t.key === tab);
  const open = (d: NonNullable<Drill>) => { setDrill(d); setTimeout(() => document.getElementById("cl-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); };
  const go = (t: Tab) => { setTab(t); setDrill(null); };
  const body = useMemo(() => {
    switch (tab) {
      case "overview": return <Overview open={open} go={go} />;
      case "needs": return <Needs open={open} onlyNeeds />;
      case "trends": return <Trends since={ov.data?.historySince ?? null} />;
      case "compare": return <Compare />;
      case "reports": return <Reports />;
      case "people": return <People />;
      case "setup": return <Setup />;
    }
  }, [tab, ov.data?.historySince]);
  return (
    <div className="s6 ap cl ds-enter" data-testid="cl-module">
      <Page title="Clients" subtitle="Which client accounts are fine, which need you, and proof to show them." actions={null}>
        {fixturesOn() && <p className="ap-fine mb-2" role="status" data-testid="cl-sample">Sample data: these are not your real clients.</p>}
        <ModuleTabs pill label="Clients sections" tabs={TABS.map((t) => ({ label: t.label, tip: t.tip, node: null }))} value={index} onChange={(i) => go(TABS[i].key)} />
        <div data-testid={`cl-tab-${tab}`}>{body}</div>
        {drill && <DrillList d={drill} onClose={() => setDrill(null)} />}
      </Page>
    </div>
  );
}
