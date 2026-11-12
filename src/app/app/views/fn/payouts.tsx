"use client";

import { useEffect, useState } from "react";
import { BASES, BASIS_HELP, BASIS_LABEL, PAYOUT_FORMULA, money, type PayBasis, type Role } from "@/lib/analytics/finance-core";
import { EmptyState } from "../../ds";
import { useApiClient } from "../../session";
import { fnfxOn, msg, useFn, useKeyset, useWindow, type Params } from "./data";
import { How, Load, Picker, SampleNote, Typed, day, num, useAct } from "./shared";
import type { FnOptions, FnPayouts, FnPeriods, FnStatement } from "./types";

// Finance, Payouts: what each setter and closer earned in the period the date bar shows. Setter = whoever booked the appointment (else the lead's owner); closer = whoever the appointment is assigned to.
// The agency chooses what a payout is paid on: booked, showed or won. Every count opens exactly its rows (count equals rows), each line can be flagged as disputed, a period can be frozen, and the CSV and the
// print view are formula-safe. A person without manager rights sees only their OWN statement (the server forces it). Rates and disputes are SubSync-only records.
type Person = FnPayouts["rows"][number];
type Line = FnStatement["rows"][number];
type Open = { personId: string; kind: PayBasis | null; role: Role | null; disputed?: boolean; period?: string | null; title: string };
const KIND_WORD: Record<PayBasis, string> = { booked: "Booked", showed: "Showed", won: "Won" };

export function PayoutsTab({ options, goTab }: { options: FnOptions; goTab: (t: string) => void }) {
  void goTab;
  const win = useWindow(), api = useApiClient();
  const manager = options.manager;
  const [basis, setBasis] = useState<PayBasis>(options.settings.payoutBasis), [q, setQ] = useState(""), [dq, setDq] = useState(""), [open, setOpen] = useState<Open | null>(null), [freeze, setFreeze] = useState(false), [rev, setRev] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const k = useKeyset<Person, FnPayouts>("payouts", { basis, q: dq, v: rev }, { ranged: true, off: !manager, size: 15 });
  const periods = useFn<FnPeriods>("periods", { v: rev });
  const { busy, note, run } = useAct(() => setRev((n) => n + 1));
  const d = k.first, cur = d?.currency ?? options.settings.currency, usd = (n: number) => money(n, cur);
  if (!manager) return <MyStatement options={options} basis={basis} periods={periods.data?.rows ?? []} />;
  const label = `${win.from} to ${win.to} (${basis})`;
  return (
    <div className="fn-stack" data-testid="fn-payouts">
      {fnfxOn() && <SampleNote />}
      <section className="fn-card" aria-label="Payout basis">
        <h2 className="fn-h">What is a payout paid on?</h2>
        <div role="radiogroup" aria-label="Payout basis" className="cl3-chips">
          {BASES.map((b) => <button key={b} type="button" role="radio" aria-checked={basis === b} className="cl-reason" data-on={basis === b ? "1" : undefined} onClick={() => setBasis(b)} data-testid={`fn-basis-${b}`}>{BASIS_LABEL[b]}</button>)}
        </div>
        <p className="ap-fine">{BASIS_HELP[basis]} Period: {win.label || "the date bar above"}.{basis !== options.settings.payoutBasis && <> <button type="button" className="ap-link" onClick={() => void run(() => api.put("finance/settings", { payoutBasis: basis }), "Saved as your default.")}>Make this my default</button></>}</p>
        <How title="How is a payout worked out?">{PAYOUT_FORMULA}</How>
      </section>

      <section className="fn-card" aria-label="Payout totals">
        <h2 className="fn-h">This period</h2>
        {d ? (
          <>
            <p className="fn-sentence" data-testid="fn-pay-sentence">{d.totals.counted === 0 ? `Nothing counted ${basis === "booked" ? "as booked" : basis === "showed" ? "as showed" : "as won"} in this period.` : `${usd(d.totals.payable)} to pay ${num(d.total)} ${d.total === 1 ? "person" : "people"} across ${num(d.totals.counted)} ${d.totals.counted === 1 ? "line" : "lines"}.`}</p>
            {d.totals.held > 0 && <p className="ap-fine" data-testid="fn-pay-held">{usd(d.totals.held)} is held back on {num(d.totals.disputed)} disputed {d.totals.disputed === 1 ? "line" : "lines"}.</p>}
            {d.unattributed.count > 0 && <p className="ap-fine" data-testid="fn-pay-unattributed">{num(d.unattributed.count)} won {d.unattributed.count === 1 ? "deal" : "deals"} ({usd(d.unattributed.value)}) had no appointment in the {d.windowDays} days before, so they are not counted for anyone.</p>}
            <div className="fn-end" style={{ justifyContent: "flex-start", marginTop: 8 }}>
              <button type="button" className="s6-btn" onClick={() => setFreeze((v) => !v)} aria-expanded={freeze} data-testid="fn-freeze-btn">Freeze this period</button>
            </div>
            {freeze && (
              <div style={{ marginTop: 8 }}>
                <p className="ap-fine">Freezing copies every line now, so a later change in the CRM never changes what you agreed. It covers the client accounts shown right now.</p>
                <Typed name={label} verb="freeze this period" busy={busy} onCancel={() => setFreeze(false)} onConfirm={(t) => void run(() => api.post("finance/freeze", { from: win.from, to: win.to, basis, confirm: t }), "Period frozen.").then(() => setFreeze(false))} />
              </div>
            )}
          </>
        ) : <p className="ap-fine">Counting...</p>}
        {note && <p className="ap-fine" role="status" data-testid="fn-pay-note">{note}</p>}
      </section>

      <div className="ap-head print:hidden" role="search">
        <label className="ap-search"><span className="sr-only">Search people</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" data-testid="fn-pay-search" /></label>
      </div>
      {k.error && /not switched on/i.test(String((k.error as Error).message)) ? <EmptyState title="Not switched on yet" body="This part of Finance is not switched on for your account yet." /> : k.loading && !d ? <p className="ap-fine">Counting...</p> : k.error ? <EmptyState title="Could not load" body={msg(k.error)} /> : k.rows.length === 0 ? (
        <EmptyState title="No one to pay in this period" body="People appear when an appointment they booked or took, or a deal they helped win, falls inside the dates. If your appointments have no booker recorded, give your team roles in Team first." />
      ) : (
        <>
          <ul className="fn-list" data-testid="fn-pay-list">
            {k.rows.map((p) => (
              <li key={p.personId} className="fn-row" data-testid="fn-pay-row" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,2.4fr) minmax(0,0.9fr) auto" }}>
                <div><span className="fn-who">{p.name}</span><div className="fn-sub">{p.roleLabel ? `Team role: ${p.roleLabel}` : "No team role set"}</div></div>
                <div className="fn-end" style={{ justifyContent: "flex-start" }}>
                  <Count n={p.booked} label="booked" onClick={() => setOpen({ personId: p.personId, kind: "booked", role: "setter", title: `${p.name}: appointments booked` })} />
                  <Count n={p.showed} label="showed" onClick={() => setOpen({ personId: p.personId, kind: "showed", role: "setter", title: `${p.name}: appointments showed` })} />
                  <Count n={p.closed} label="closed" onClick={() => setOpen({ personId: p.personId, kind: "won", role: "closer", title: `${p.name}: deals closed` })} />
                  <span className="fn-sub">Won {usd(p.wonValue)}{p.setWonValue > 0 ? ` · set ${usd(p.setWonValue)}` : ""}</span>
                </div>
                <div><span className="fn-amt" data-testid="fn-pay-amount">{usd(p.payable)}</span><div className="fn-sub">{num(p.counted)} {p.counted === 1 ? "line" : "lines"}{p.held > 0 ? ` · ${usd(p.held)} held` : ""}</div></div>
                <div className="fn-end"><button type="button" className="s6-btn" data-kind="primary" onClick={() => setOpen({ personId: p.personId, kind: null, role: null, title: `${p.name}: statement` })} data-testid="fn-pay-statement">Statement</button></div>
              </li>
            ))}
          </ul>
          {k.next && <div className="fn-more"><span className="ap-fine">Showing {num(k.rows.length)} of {num(k.total)}</span><button type="button" className="s6-btn" onClick={k.showMore} disabled={k.more}>{k.more ? "Loading..." : "Show more"}</button></div>}
        </>
      )}

      <Disputes d={d} onChange={() => setRev((n) => n + 1)} openLine={(p) => setOpen({ personId: p, kind: null, role: null, disputed: true, title: "Disputed lines" })} />
      <Rates d={d} onChange={() => setRev((n) => n + 1)} />
      <Frozen periods={periods} onOpen={(p) => setOpen(p)} onChange={() => setRev((n) => n + 1)} />
      {open && <StatementPanel open={open} basis={basis} manager onClose={() => { setOpen(null); setRev((n) => n + 1); }} />}
    </div>
  );
}

function Count({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return <button type="button" className="ap-chip" style={{ cursor: n ? "pointer" : "default" }} disabled={n === 0} onClick={onClick} aria-label={`${num(n)} ${label}. Show the ${n === 1 ? "line" : "lines"}.`} data-testid={`fn-count-${label}`}>{num(n)} {label}</button>;
}

function Disputes({ d, onChange, openLine }: { d: FnPayouts | null; onChange: () => void; openLine: (personId: string) => void }) {
  const api = useApiClient(), { busy, note, run } = useAct(onChange);
  if (!d || d.disputes.length === 0) return null;
  return (
    <section className="fn-card" aria-label="Disputed lines" data-testid="fn-disputes">
      <h2 className="fn-h">Flagged as wrong ({num(d.disputes.length)})</h2>
      <ul className="fn-list">
        {d.disputes.map((x) => (
          <li key={x.lineKey} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1.6fr) auto" }}>
            <div><span className="fn-who">{x.person}</span><div className="fn-sub">{x.account} · {day(x.raisedAt)}</div></div>
            <div className="fn-sub">{x.note ?? "No note"}</div>
            <div className="fn-end"><button type="button" className="ap-link" onClick={() => openLine(x.personId)}>See the line</button><button type="button" className="s6-btn" disabled={busy} onClick={() => void run(() => api.post("finance/dispute/resolve", { lineKey: x.lineKey }), "Marked as settled.")}>Mark settled</button></div>
          </li>
        ))}
      </ul>
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}

function Rates({ d, onChange }: { d: FnPayouts | null; onChange: () => void }) {
  const api = useApiClient(), { busy, note, run } = useAct(onChange);
  const [adding, setAdding] = useState(false), [role, setRole] = useState<Role>("setter"), [pct, setPct] = useState(""), [flat, setFlat] = useState(""), [person, setPerson] = useState<{ id: string; name: string } | null>(null), [acct, setAcct] = useState<{ id: string; name: string } | null>(null);
  const [rm, setRm] = useState<FnPayouts["rates"][number] | null>(null);
  const rates = d?.rates ?? [];
  const word = (r: FnPayouts["rates"][number]) => (r.person && r.account ? `${r.person} in ${r.account}` : r.person ?? (r.account ? `Everyone in ${r.account}` : "Everyone"));
  return (
    <section className="fn-card" aria-label="Commission rates" data-testid="fn-rates">
      <h2 className="fn-h">Commission rates</h2>
      <p className="ap-fine">SubSync-only. The most specific rate wins: one person in one account, then one person, then one account, then everyone. A percentage applies only when paid on won.</p>
      {rates.length === 0 ? <p className="ap-fine">No rates yet. Everyone is counted at zero until you add one.</p> : (
        <ul className="fn-list">
          {rates.map((r) => (
            <li key={`${r.personId}|${r.locationId}|${r.role}`} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto" }} data-testid="fn-rate-row">
              <span className="fn-who">{r.role === "setter" ? "Setter" : "Closer"}: {word(r)}</span>
              <span className="fn-sub">{r.flat > 0 ? `${money(r.flat, d?.currency ?? "USD")} a line` : ""}{r.flat > 0 && r.pct > 0 ? " + " : ""}{r.pct > 0 ? `${r.pct}% of the deal` : r.flat > 0 ? "" : "nothing"}</span>
              <span className="fn-end"><button type="button" className="ap-link" onClick={() => setRm(r)}>Remove</button></span>
            </li>
          ))}
        </ul>
      )}
      {rm && <Typed name={rm.person ?? rm.account ?? "everyone"} verb="remove this rate" busy={busy} onCancel={() => setRm(null)} onConfirm={(t) => void run(() => api.post("finance/rate/remove", { personId: rm.personId, locationId: rm.locationId, role: rm.role, confirm: t }), "Rate removed.").then(() => setRm(null))} />}
      <div className="fn-end" style={{ justifyContent: "flex-start", marginTop: 8 }}><button type="button" className="s6-btn" onClick={() => setAdding(!adding)} aria-expanded={adding} data-testid="fn-rate-add">{adding ? "Close" : "Add or change a rate"}</button></div>
      {adding && (
        <div className="fn-form" style={{ marginTop: 8 }}>
          <label>For<select className="ap-field" value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="fn-rate-role"><option value="setter">Setters (who book)</option><option value="closer">Closers (who take the appointment)</option></select></label>
          <Picker what="person" label="One person (optional)" value={person} clearable onPick={setPerson} placeholder="Everyone with this role" />
          <Picker what="account" label="One client account (optional)" value={acct} clearable onPick={setAcct} placeholder="Every client account" />
          <label>Flat amount per line<input className="ap-field" inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="0" data-testid="fn-rate-flat" /></label>
          <label>Percent of deal value<input className="ap-field" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0" data-testid="fn-rate-pct" /></label>
          <button type="button" className="s6-btn" data-kind="primary" disabled={busy} data-testid="fn-rate-save" onClick={() => void run(() => api.put("finance/rate", { role, personId: person?.id ?? "", locationId: acct?.id ?? "", pct: pct === "" ? 0 : Number(pct), flat: flat === "" ? 0 : Number(flat) }), "Rate saved.").then(() => { setFlat(""); setPct(""); })}>Save rate</button>
        </div>
      )}
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}

function Frozen({ periods, onOpen, onChange }: { periods: ReturnType<typeof useFn<FnPeriods>>; onOpen: (o: Open) => void; onChange: () => void }) {
  const api = useApiClient(), { busy, note, run } = useAct(onChange);
  const [rm, setRm] = useState<FnPeriods["rows"][number] | null>(null), [sel, setSel] = useState<FnPeriods["rows"][number] | null>(null);
  return (
    <section className="fn-card" aria-label="Frozen periods" data-testid="fn-frozen">
      <h2 className="fn-h">Frozen periods</h2>
      <Load r={periods} empty={(x) => (x.rows.length === 0 ? "Nothing frozen yet. When you have agreed a period, freeze it here so it can never change." : false)}>
        {(x) => (
          <ul className="fn-list">
            {x.rows.map((p) => (
              <li key={p.id} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr) auto" }} data-testid="fn-frozen-row">
                <div><span className="fn-who">{p.label}</span><div className="fn-sub">Frozen {day(p.frozenAt)} · {num(p.lines)} {p.lines === 1 ? "line" : "lines"} · {num(p.accounts)} client {p.accounts === 1 ? "account" : "accounts"}</div></div>
                <span className="fn-amt">{money(p.total, p.currency)}</span>
                <span className="fn-end"><button type="button" className="s6-btn" onClick={() => setSel(p)}>Open</button><button type="button" className="ap-link" onClick={() => setRm(p)}>Unfreeze</button></span>
              </li>
            ))}
          </ul>
        )}
      </Load>
      {rm && <Typed name={rm.label} verb="unfreeze this period" busy={busy} onCancel={() => setRm(null)} onConfirm={(t) => void run(() => api.post("finance/unfreeze", { id: rm.id, confirm: t }), "Period unfrozen.").then(() => setRm(null))} />}
      {sel && <FrozenPeople period={sel} onClose={() => setSel(null)} onOpen={onOpen} />}
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}

function FrozenPeople({ period, onClose, onOpen }: { period: FnPeriods["rows"][number]; onClose: () => void; onOpen: (o: Open) => void }) {
  const r = useKeyset<{ personId: string; name: string; lines: number; total: number; value: number }>("periods", { id: period.id }, { size: 10 });
  return (
    <div className="fn-card" style={{ marginTop: 10 }} role="region" aria-label={`People in ${period.label}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="fn-h" style={{ margin: 0 }}>{period.label}: {num(r.total)} {r.total === 1 ? "person" : "people"}</h3><button type="button" className="ap-link" onClick={onClose}>Close</button></div>
      <ul className="fn-list" style={{ marginTop: 8 }}>
        {r.rows.map((p) => (
          <li key={p.personId} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto" }}>
            <span className="fn-who">{p.name}</span><span className="fn-sub">{num(p.lines)} {p.lines === 1 ? "line" : "lines"}</span>
            <span className="fn-end"><span className="fn-amt">{money(p.total, period.currency)}</span><button type="button" className="s6-btn" onClick={() => onOpen({ personId: p.personId, kind: period.basis, role: null, period: period.id, title: `${p.name}: ${period.label}` })}>Lines</button></span>
          </li>
        ))}
      </ul>
      {r.next && <div className="fn-more"><button type="button" className="s6-btn" onClick={r.showMore} disabled={r.more}>Show more</button></div>}
    </div>
  );
}

/** The person's own statement, for anyone without manager rights. */
function MyStatement({ options, basis, periods }: { options: FnOptions; basis: PayBasis; periods: FnPeriods["rows"] }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="fn-stack" data-testid="fn-my-statement">
      {fnfxOn() && <SampleNote />}
      <section className="fn-card" aria-label="My payout statement"><h2 className="fn-h">My payout statement</h2>
        <p className="fn-lead">Only your own lines are here. Nobody else&apos;s pay is shown to you, and yours is shown only to you and the owner.</p>
        {periods.length > 0 && (
          <p className="ap-fine">Frozen periods with your lines: {periods.map((p) => <button key={p.id} type="button" className="ap-link" style={{ marginRight: 8 }} onClick={() => setSel(p.id)}>{p.label}</button>)}<button type="button" className="ap-link" onClick={() => setSel(null)}>Current period</button></p>
        )}
      </section>
      <StatementBody open={{ personId: options.selfId ?? "", kind: null, role: null, period: sel, title: "My statement" }} basis={basis} manager={false} />
    </div>
  );
}

function StatementPanel({ open, basis, manager, onClose }: { open: Open; basis: PayBasis; manager: boolean; onClose: () => void }) {
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  return (
    <>
      <button type="button" className="fn-scrim print:hidden" aria-label="Close the statement" onClick={onClose} />
      <aside className="fn-side fn-print" role="dialog" aria-modal="true" aria-label={open.title} data-testid="fn-statement-panel">
        <div className="flex items-start justify-between gap-2"><h2 className="fn-who" style={{ fontSize: "1.1rem", margin: 0 }}>{open.title}</h2><button type="button" className="s6-btn print:hidden" onClick={onClose} data-testid="fn-statement-close">Close</button></div>
        <StatementBody open={open} basis={basis} manager={manager} />
      </aside>
    </>
  );
}

function StatementBody({ open, basis, manager }: { open: Open; basis: PayBasis; manager: boolean }) {
  const api = useApiClient(), win = useWindow();
  const [kind, setKind] = useState<PayBasis | "">(open.kind ?? ""), [role, setRole] = useState<Role | "">(open.role ?? ""), [disputed, setDisputed] = useState(open.disputed === true), [rev, setRev] = useState(0), [flag, setFlag] = useState<Line | null>(null), [text, setText] = useState(""), [msgText, setMsgText] = useState<string | null>(null);
  const p: Params = { person: manager ? open.personId : undefined, kind, role, disputed, basis, period: open.period ?? undefined, v: rev };
  const k = useKeyset<Line, FnStatement>("statement", p, { ranged: !open.period, size: 20 });
  const d = k.first, cur = d?.currency ?? "USD", usd = (n: number) => money(n, cur);
  const range = d?.range ?? { from: win.from, to: win.to };
  const exportCsv = async () => {
    if (fnfxOn()) return setMsgText("Sample data: nothing is saved.");
    const q = new URLSearchParams({ part: "export", what: "statement", basis, from: range.from, to: range.to });
    if (manager) q.set("person", open.personId);
    if (kind) q.set("kind", kind);
    if (role) q.set("role", role);
    if (disputed) q.set("disputed", "1");
    if (open.period) q.set("period", open.period);
    try { await api.download(`finance?${q.toString()}`, "payout-statement.csv"); } catch (e) { setMsgText(msg(e)); }
  };
  const raise = async (l: Line) => {
    if (fnfxOn()) return setMsgText("Sample data: nothing is saved.");
    try { await api.post("finance/dispute", { lineKey: l.lineKey, note: text, from: range.from, to: range.to, basis, periodId: open.period ?? undefined }); setFlag(null); setText(""); setMsgText("Flagged. The owner can see it, and it is held out of the payable total until it is settled."); setRev((n) => n + 1); } catch (e) { setMsgText(msg(e)); }
  };
  const kinds: Array<[PayBasis | "", string]> = [["", `What pays (${KIND_WORD[d?.basis ?? basis]})`], ["booked", "Booked"], ["showed", "Showed"], ["won", "Won"]];
  return (
    <div className="fn-stack" data-testid="fn-statement">
      <p className="ap-fine" data-testid="fn-statement-range">{d?.person.name ? `${d.person.name} · ` : ""}{open.period ? "Frozen period" : `${range.from} to ${range.to}`} · {BASIS_LABEL[d?.basis ?? basis]}{d?.frozen ? " · frozen, it cannot change" : ""}</p>
      {!open.period && (
        <div role="group" aria-label="Which lines" className="cl3-chips print:hidden">
          {kinds.map(([v, l]) => <button key={v || "pay"} type="button" className="cl-reason" aria-pressed={kind === v} data-on={kind === v ? "1" : undefined} onClick={() => setKind(v)} data-testid={`fn-kind-${v || "pay"}`}>{l}</button>)}
          <button type="button" className="cl-reason" aria-pressed={disputed} data-on={disputed ? "1" : undefined} onClick={() => setDisputed(!disputed)}>Disputed only</button>
          <select className="ap-field" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role | "")}><option value="">Setter and closer</option><option value="setter">As setter</option><option value="closer">As closer</option></select>
        </div>
      )}
      {k.loading && !d ? <p className="ap-fine">Counting...</p> : k.error ? <EmptyState title="Could not load" body={msg(k.error)} /> : !d || k.rows.length === 0 ? <EmptyState title="No lines" body="Nothing counted for this person in this period." compact /> : (
        <>
          <p className="fn-sentence" style={{ fontSize: "1.05rem" }} data-testid="fn-statement-total">{num(d.totals.count)} {d.totals.count === 1 ? "line" : "lines"} · pays {usd(d.totals.payable)}{d.totals.held > 0 ? ` · ${usd(d.totals.held)} held (${num(d.totals.disputed)} disputed)` : ""}{d.totals.value > 0 ? ` · deal value ${usd(d.totals.value)}` : ""}</p>
          <div role="table" aria-label="Statement lines" data-testid="fn-statement-lines">
            <div role="row" className="fn-line" data-head="1"><span role="columnheader">Date</span><span role="columnheader">Client account</span><span role="columnheader">Role</span><span role="columnheader">Counted as</span><span role="columnheader">Deal value</span><span role="columnheader">Pays</span><span role="columnheader" className="fn-noprint"> </span></div>
            {k.rows.map((l) => (
              <div role="row" key={l.lineKey} className="fn-line" data-off={l.paid ? undefined : "1"} data-disputed={l.disputed ? "1" : undefined} data-testid="fn-statement-line">
                <span role="cell">{day(l.at)}</span><span role="cell">{l.account}</span><span role="cell">{l.role === "setter" ? "Setter" : "Closer"}</span><span role="cell">{KIND_WORD[l.kind]}</span>
                <span role="cell">{l.value !== null ? usd(l.value) : ""}</span><span role="cell" className="fn-amt">{l.paid ? usd(l.amount) : "Not paid on this basis"}</span>
                <span role="cell" className="fn-noprint">{l.disputed ? <span className="ap-chip" data-tone="amber" title={l.disputeNote ?? ""}>Disputed</span> : l.paid ? <button type="button" className="ap-link" onClick={() => setFlag(l)} aria-label={`Flag the ${KIND_WORD[l.kind]} line for ${l.account} as wrong`} data-testid="fn-flag">Flag</button> : null}</span>
              </div>
            ))}
          </div>
          {k.next && <div className="fn-more print:hidden"><span className="ap-fine">Showing {num(k.rows.length)} of {num(k.total)}</span><button type="button" className="s6-btn" onClick={k.showMore} disabled={k.more} data-testid="fn-statement-more">{k.more ? "Loading..." : "Show more"}</button></div>}
          <p className="ap-fine fn-pr-only">Printed {new Date().toISOString().slice(0, 10)}. {num(d.totals.count)} lines. Every line above is one appointment or deal counted once.</p>
        </>
      )}
      {flag && (
        <div className="fn-typed print:hidden" role="group" aria-label="Flag a line" data-testid="fn-flag-box"><span>Flag the {KIND_WORD[flag.kind]} line for {flag.account} ({day(flag.at)}) as wrong. Say why, in a few words.</span>
          <textarea className="ap-field" style={{ minHeight: 60 }} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label="Why it is wrong" data-testid="fn-flag-note" />
          <span className="fn-end" style={{ justifyContent: "flex-start" }}><button type="button" className="s6-btn" data-kind="primary" onClick={() => void raise(flag)} data-testid="fn-flag-go">Flag it</button><button type="button" className="s6-btn" onClick={() => setFlag(null)}>Cancel</button></span></div>
      )}
      {msgText && <p className="ap-fine" role="status" data-testid="fn-statement-note">{msgText}</p>}
      <div className="fn-end print:hidden" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="s6-btn" onClick={() => void exportCsv()} data-testid="fn-statement-csv">Download CSV</button>
        <button type="button" className="s6-btn" onClick={() => window.print()} data-testid="fn-statement-print">Print</button>
      </div>
    </div>
  );
}
