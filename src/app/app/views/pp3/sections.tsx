"use client";

import { useState } from "react";
import type { PpAccountRef, PpHandoff, PpLoadRow, PpNextLead, PpPage, PpPerson, PpToday } from "@/lib/analytics/people3-types-interim";
import { AssignSlot, MoveLeadsSlot } from "./actions-slot";
import type { PpParams } from "./data";
import { usePp } from "./data";
import type { Drill } from "./panel";
import { ago, Find, Initials, Load, minutes, money, NO_ACTIVITY, NOT_ENOUGH, Note, Pager, share, Spark, Status, Trend, useCursor, useDebounced } from "./shared";

// The first four sections of Team: Today, Scorecards (with Handoffs), Workload (with the next-lead suggestion). Every count opens exactly its rows. Nothing here messages anyone or changes the CRM.
export type SecProps = { filters: PpParams; open: (d: Drill) => void; pick: (id: string, ids: string[]) => void; accounts: PpAccountRef[]; ownRow: boolean };
const ROLE = { owner: "Owner", admin: "Admin", staff: "" } as const;

export function Today({ filters, open }: Pick<SecProps, "filters" | "open">) {
  const r = usePp<PpToday>("today", filters);
  return (
    <Load r={r} empty={(t) => !t.headline && t.lines.length === 0}>
      {(t) => {
        const b = t.button;
        return (
          <div className="pp-stack" data-testid="pp-today">
            <section className="pp-card" aria-label="Who needs you today">
              <h2 className="pp-h">{t.ownQueue ? "Your queue today" : "Who needs you today"}</h2>
              <p className="pp-sentence" data-testid="pp-today-sentence">{t.headline}</p>
              {b && <button type="button" className="s6-btn" data-kind="primary" data-testid="pp-today-go" onClick={() => open({ title: t.headline, reason: b.reason, userId: b.userId, location: b.locationId, count: b.count })}>{b.label} ({b.count.toLocaleString("en-US")})</button>}
              {t.lines.length > 1 && (
                <ul className="pp-lines" aria-label="Also today">
                  {t.lines.slice(1).map((l) => <li key={`${l.userId}:${l.reason}:${l.locationId}`}><span>{l.text}</span><button type="button" className="ap-link" onClick={() => open({ title: l.text, reason: l.reason, userId: l.userId, location: l.locationId, count: l.count })}>See the leads ({l.count})</button></li>)}
                </ul>
              )}
              {t.lines.length === 0 && <p className="ap-fine">Nothing is waiting, and nobody has gone quiet while leads wait.</p>}
            </section>
            <p className="ap-fine">{NO_ACTIVITY} means nothing was recorded there. It does not mean someone is not working: calls on a personal phone are not visible to SubSync.</p>
          </div>
        );
      }}
    </Load>
  );
}

const SORTS: Array<[string, string]> = [["", "Name"], ["won", "Money won"], ["leads", "Leads handled"], ["reply", "Fastest first reply"]];
function Person({ p, onPick }: { p: PpPerson; onPick: () => void }) {
  return (
    <span className="pp-cell"><Initials name={p.name} />
      <span><button type="button" className="pp-name" onClick={(e) => { e.stopPropagation(); onPick(); }}>{p.name}</button>{ROLE[p.role] && <span className="ap-fine"> {ROLE[p.role]}, not ranked</span>}{p.deleted && <span className="ap-fine"> no longer in your CRM</span>}{p.awayUntil && <span className="ap-fine"> away until {p.awayUntil}</span>}
        <br /><span className="ap-fine">{p.accounts === 1 ? p.accountNames[0] : `${p.accounts} accounts`}{p.idle ? "" : <span className="pp-hide-sm">, last activity {ago(p.lastActivityAt)}</span>}</span>{p.idle && <><br /><Status on>{NO_ACTIVITY}, {ago(p.lastActivityAt).replace(" ago", "")}</Status></>}</span>
    </span>
  );
}

function Handoffs({ filters }: { filters: PpParams }) {
  const key = JSON.stringify(filters), c = useCursor(key), r = usePp<PpPage<PpHandoff>>("handoffs", { ...filters, cursor: c.cursor });
  return (
    <Load r={r} empty={(x) => x.rows.length === 0 && "No deal in this period has both a person who booked it and a person who closed it."}>
      {(x) => (
        <>
          <div className="ap-scroll"><table className="ap-t" data-testid="pp-handoffs"><thead><tr><th>Lead</th><th data-sm="hide">Account</th><th data-sm="hide">Booked by</th><th data-sm="hide">Closed by</th><th data-num>Days between</th><th data-num data-sm="hide">Value</th><th data-sm="hide" /></tr></thead>
            <tbody>{x.rows.map((h, i) => <tr key={`${h.locationId}:${h.contactName}:${i}`} style={{ cursor: "default" }}><td className="pp-wrap">{h.contactName}<span className="pp-only-sm ap-fine"><br />Booked by {h.bookedBy}{h.estimated ? " (likely)" : ""}<br />Closed by {h.closedBy}<br />{h.url ? <a className="ap-link" href={h.url} target="_blank" rel="noopener noreferrer">Open in your CRM</a> : "Link not available"}</span></td><td data-sm="hide">{h.accountName}</td><td data-sm="hide">{h.bookedBy}{h.estimated && <span className="ap-fine"> (likely)</span>}</td><td data-sm="hide">{h.closedBy}</td><td data-num>{h.days}</td><td data-num data-sm="hide">{h.value ? money(h.value) : ""}</td><td data-sm="hide">{h.url ? <a className="ap-link" href={h.url} target="_blank" rel="noopener noreferrer">Open in your CRM</a> : <span className="ap-fine">Link not available</span>}</td></tr>)}</tbody></table></div>
          <Pager c={c} next={x.next} total={x.total} />
          <Note>Booked by is the person recorded on the appointment. Where your CRM does not record who booked it, we use the last person who messaged or called that lead before the booking, marked (likely), an estimate.</Note>
        </>
      )}
    </Load>
  );
}

export function Scorecards({ filters, pick, ownRow }: SecProps) {
  const [view, setView] = useState<"people" | "handoffs">("people"), [q, setQ] = useState(""), [sort, setSort] = useState(""), [admins, setAdmins] = useState(false), dq = useDebounced(q);
  const f = { ...filters, q: dq, sort, admins: admins ? "1" : undefined }, c = useCursor(JSON.stringify(f)), r = usePp<PpPage<PpPerson>>("scorecards", { ...f, cursor: c.cursor }, view !== "people");
  return (
    <div data-testid="pp-scorecards">
      {!ownRow && <div className="pp-sub" role="group" aria-label="Scorecard views"><button type="button" className="s6-btn" aria-pressed={view === "people"} onClick={() => setView("people")}>People</button><button type="button" className="s6-btn" aria-pressed={view === "handoffs"} onClick={() => setView("handoffs")}>Booked by one, closed by another</button></div>}
      {view === "handoffs" ? <Handoffs filters={filters} /> : (
        <>
          {!ownRow && <Find q={q} setQ={setQ}>
            <select className="ap-field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="ap-fine inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} />Include owners and admins</label>
          </Find>}
          <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
            {(x) => (
              <>
                <div className="ap-scroll"><table className="ap-t" data-testid="pp-table"><thead><tr><th>Person</th><th data-num data-sm="hide">Leads</th><th data-num>First reply</th><th data-num data-sm="hide">In time</th><th data-num data-sm="hide">Appts set</th><th data-num data-sm="hide">Showed</th><th data-num>Won</th><th data-sm="hide">8 weeks</th></tr></thead>
                  <tbody>{x.rows.map((p) => {
                                        return (
                      <tr key={p.userId} tabIndex={0} onClick={() => pick(p.userId, x.rows.map((m) => m.userId))} onKeyDown={(e) => { if (e.key === "Enter") pick(p.userId, x.rows.map((m) => m.userId)); }} data-testid="pp-row">
                        <td className="pp-wrap"><Person p={p} onPick={() => pick(p.userId, x.rows.map((m) => m.userId))} /></td>
                        <td data-num data-sm="hide">{p.leadsHandled.toLocaleString("en-US")}</td>
                        <td data-num>{p.enough ? minutes(p.firstReplyMinutes) : NOT_ENOUGH}</td>
                        <td data-num data-sm="hide">{share(p.inTime)}</td>
                        <td data-num data-sm="hide">{p.appointmentsSet.enough ? p.appointmentsSet.current : NOT_ENOUGH}{p.appointmentsSet.estimated && p.appointmentsSet.enough && <span className="ap-sub"> est.</span>}<Trend d={p.appointmentsSet} /></td>
                        <td data-num data-sm="hide">{share(p.showed)}</td>
                        <td data-num>{p.wonValue.enough ? <>{money(p.wonValue.current)}<span className="ap-sub"> ({p.wonCount})</span></> : NOT_ENOUGH}<Trend d={p.wonValue} /></td>
                        <td data-sm="hide"><Spark values={p.enough ? p.spark : []} label={`${p.name}, share of first replies in time, 8 weeks`} /></td>
                      </tr>
                    );
                  })}</tbody></table></div>
                <Pager c={c} next={x.next} total={x.total} noun="people" />
                <Note>{ownRow ? "This is your own row. " : ""}Figures cover the period you chose. Appointments marked est. use the last person who messaged or called the lead before the booking, because your CRM records only the owner.</Note>
              </>
            )}
          </Load>
        </>
      )}
    </div>
  );
}

const LEVEL = { over: "Heavy load", under: "Light load", normal: "Normal", unknown: "Not enough data" } as const;
function NextLead({ loc, accounts }: { loc: string; accounts: PpAccountRef[] }) {
  const r = usePp<PpNextLead>("nextlead", { location: loc }, !loc);
  if (!loc) return <p className="ap-fine mb-3">Choose one account above to see who could take its next lead.</p>;
  return (
    <Load r={r} empty={() => false}>
      {(s) => (
        <section className="pp-note-card mb-4" aria-label="Who could take the next lead" data-testid="pp-nextlead">
          <h2 className="pp-h">Who could take the next lead in {s.accountName || accounts.find((a) => a.locationId === loc)?.name}</h2>
          {s.enough && s.name ? <p className="text-sm"><b>Suggested: {s.name}.</b> {s.because}</p> : <p className="text-sm">{NOT_ENOUGH} to suggest someone yet.</p>}
          <p className="ap-fine">An estimate from {s.sample.toLocaleString("en-US")} recent leads. It never assigns anything by itself.{s.waitingNow > 0 ? ` ${s.waitingNow} leads are waiting in this account now.` : ""}</p>
          {s.enough && <AssignSlot suggestion={s} onChanged={r.reload} />}
        </section>
      )}
    </Load>
  );
}

export function Workload({ filters, open, pick, accounts }: SecProps) {
  const [only, setOnly] = useState(false), [q, setQ] = useState(""), dq = useDebounced(q), loc = String(filters.location ?? "");
  const f = { ...filters, q: dq, only: only ? "flagged" : undefined }, c = useCursor(JSON.stringify(f)), r = usePp<PpPage<PpLoadRow>>("workload", { ...f, cursor: c.cursor });
  return (
    <div data-testid="pp-workload">
      <NextLead loc={loc} accounts={accounts} />
      <Find q={q} setQ={setQ}><label className="ap-fine inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Only people to look at</label></Find>
      <Load r={r} empty={(x) => x.rows.length === 0 && (only || dq ? "Nobody matches. That is good news if you filtered for people to look at." : true)}>
        {(x) => (
          <>
            <div className="ap-scroll"><table className="ap-t" data-testid="pp-load"><thead><tr><th>Person</th><th data-sm="hide">Account</th><th data-num>Waiting</th><th>Open leads</th><th data-num data-sm="hide">Open deals</th><th data-num data-sm="hide">Appointments coming</th><th data-sm="hide">How it looks</th><th /></tr></thead>
              <tbody>{x.rows.map((l) => (
                <tr key={`${l.locationId}:${l.userId}`} style={{ cursor: "default" }} data-testid="pp-load-row">
                  <td className="pp-wrap"><span className="pp-cell"><Initials name={l.name} /><button type="button" className="pp-name" onClick={() => pick(l.userId, x.rows.map((m) => m.userId))}>{l.name}</button></span><span className="pp-only-sm ap-fine"><br />{l.accountName}<br />{l.enough ? <Status on={l.level === "over"}>{LEVEL[l.level]}</Status> : NOT_ENOUGH}{l.why ? `. ${l.why}` : ""}</span></td>
                  <td data-sm="hide">{l.accountName}</td>
                  <td data-num>{l.waiting > 0 ? <button type="button" className="ap-link" onClick={() => open({ title: `${l.name} in ${l.accountName}: waiting for a reply`, reason: "waiting", userId: l.userId, location: l.locationId, count: l.waiting })}>{l.waiting}</button> : 0}</td>
                  <td><span className="pp-bar" data-on={l.level === "over" ? "1" : undefined} aria-hidden><b style={{ width: `${Math.min(100, (l.openLeads / (l.median * 2.2)) * 100)}%` }} /><u style={{ left: `${(1 / 2.2) * 100}%` }} /></span><button type="button" className="ap-link" onClick={() => open({ title: `${l.name} in ${l.accountName}: open leads`, reason: "open", userId: l.userId, location: l.locationId, count: l.openLeads })}>{l.openLeads}</button></td>
                  <td data-num data-sm="hide">{l.openDeals}</td><td data-num data-sm="hide">{l.upcoming}</td>
                  <td className="pp-wrap" data-sm="hide">{l.enough ? <Status on={l.level === "over"}>{LEVEL[l.level]}</Status> : <span className="ap-fine">{NOT_ENOUGH}</span>}{l.why && <><br /><span className="ap-fine">{l.why}</span></>}</td>
                  <td><MoveLeadsSlot userId={l.userId} locationId={l.locationId} waiting={l.waiting} onChanged={r.reload} /></td>
                </tr>
              ))}</tbody></table></div>
            <Pager c={c} next={x.next} total={x.total} noun="rows" />
            <Note>The line in each bar is the team&apos;s own normal in that account. Heavy and light are measured against it, never against a fixed number.</Note>
          </>
        )}
      </Load>
    </div>
  );
}
