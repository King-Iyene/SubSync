"use client";

import { useState } from "react";
import type { Pp3AccountRef, Pp3Handoff, Pp3NextLead, Pp3Options, Pp3Scorecard, Pp3Scorecards, Pp3Today, Pp3Workload } from "@/lib/analytics/people3-types";
import { AssignSlot, MoveLeadsSlot } from "./actions-slot";
import type { PpParams } from "./data";
import { usePp } from "./data";
import type { Drill } from "./panel";
import { ago, Find, Initials, Load, money, NO_ACTIVITY, NOT_ENOUGH, Note, Pager, secs, share, Spark, Status, subline, Trend, useCursor, useDebounced } from "./shared";

// The first four sections of Team: Today, Scorecards (with Handoffs), Workload (with the next-lead suggestion). Every count opens exactly its rows. Nothing here messages anyone or changes the CRM.
export type SecProps = { filters: PpParams; open: (d: Drill) => void; pick: (id: string) => void; coach: (id: string) => void; accounts: Pp3AccountRef[]; viewer: Pp3Options["viewer"] };

export function Today({ filters, open, pick }: Pick<SecProps, "filters" | "open" | "pick">) {
  const r = usePp<Pp3Today>("today", filters);
  return (
    <Load r={r} empty={(t) => !t.headline && t.lines.length === 0}>
      {(t) => {
        const b = t.button;
        return (
          <div className="pp-stack" data-testid="pp-today">
            <section className="pp-card" aria-label="Who needs you today">
              <h2 className="pp-h">Who needs you today</h2>
              <p className="pp-sentence" data-testid="pp-today-sentence">{t.headline}</p>
              {b && (b.reason ? <button type="button" className="s6-btn" data-kind="primary" data-testid="pp-today-go" onClick={() => open({ title: t.headline, reason: b.reason!, userId: b.userId, location: b.locationId, count: b.count })}>{b.label} ({b.count.toLocaleString("en-US")})</button>
                : b.userId ? <button type="button" className="s6-btn" data-kind="primary" data-testid="pp-today-go" onClick={() => pick(b.userId!)}>{b.label}</button> : null)}
              {t.lines.length > 1 && (
                <ul className="pp-lines" aria-label="Also today">
                  {t.lines.slice(1).map((l) => (
                    <li key={`${l.kind}:${l.userId}:${l.locationId}`}><span>{l.text}</span>
                      {l.reason ? <button type="button" className="ap-link" onClick={() => open({ title: l.text, reason: l.reason!, userId: l.userId, location: l.locationId, count: l.count })}>See the leads ({l.count})</button>
                        : l.userId ? <button type="button" className="ap-link" onClick={() => pick(l.userId!)}>Open their page</button> : null}</li>
                  ))}
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

const SORTS: Array<[string, string]> = [["", "Default order"], ["name", "Name"], ["won", "Money won"], ["answered", "Leads answered first"], ["reply", "Fastest first reply"], ["in_time", "Replied in time"], ["appts", "Appointments set"], ["showed", "Showed up"], ["waiting", "Most waiting"]];
function Person({ s, onPick }: { s: Pp3Scorecard; onPick: () => void }) {
  const p = s.person;
  return (
    <span className="pp-cell"><Initials p={p} />
      <span><button type="button" className="pp-name" onClick={(e) => { e.stopPropagation(); onPick(); }}>{p.name}</button>{p.isAdmin && <span className="ap-fine"> Admin, not ranked</span>}
        <br /><span className="ap-fine">{subline(p)}<span className="pp-hide-sm">{p.lastActivityAt ? `, last activity ${ago(p.lastActivityAt)}` : ""}</span></span></span>
    </span>
  );
}

function Handoffs({ filters, pick }: { filters: PpParams; pick: (id: string) => void }) {
  const c = useCursor(JSON.stringify(filters)), r = usePp<Pp3Handoff>("handoff", { ...filters, after: c.cursor });
  return (
    <Load r={r} empty={(x) => x.rows.length === 0 && "No deal in this period has both a person who booked it and a person who closed it."}>
      {(x) => (
        <>
          <div className="ap-scroll"><table className="ap-t" data-testid="pp-handoffs"><thead><tr><th>Booked by</th><th>Closed by</th><th data-num>Deals</th><th data-num data-sm="hide">Won</th><th data-num>Typical days</th><th data-sm="hide">Client account</th></tr></thead>
            <tbody>{x.rows.map((h, i) => (
              <tr key={`${h.setter.userId}:${h.closer.userId}:${h.location?.locationId}:${i}`} style={{ cursor: "default" }}>
                <td className="pp-wrap">{h.setter.userId ? <button type="button" className="pp-name" onClick={() => pick(h.setter.userId!)}>{h.setter.name}</button> : h.setter.name}</td>
                <td className="pp-wrap">{h.closer.userId ? <button type="button" className="pp-name" onClick={() => pick(h.closer.userId!)}>{h.closer.name}</button> : h.closer.name}</td>
                <td data-num>{h.deals}</td><td data-num data-sm="hide">{money(h.wonValue)}</td><td data-num>{h.medianDays ?? NOT_ENOUGH}</td><td data-sm="hide">{h.location?.name ?? "All"}</td>
              </tr>
            ))}</tbody></table></div>
          <Pager c={c} next={x.next} total={x.total} noun="pairs" />
          <Note>{x.note} Looks back {x.windowDays} days from each booking.</Note>
        </>
      )}
    </Load>
  );
}

export function Scorecards({ filters, pick, viewer, open }: SecProps) {
  const own = viewer.level === "self", [view, setView] = useState<"people" | "handoffs">("people"), [q, setQ] = useState(""), [sort, setSort] = useState(""), [admins, setAdmins] = useState(false), dq = useDebounced(q);
  const f = { ...filters, q: dq, sort: sort || undefined, dir: sort === "name" || sort === "reply" ? "asc" : sort ? "desc" : undefined, admins: admins ? 1 : undefined }, c = useCursor(JSON.stringify(f)), r = usePp<Pp3Scorecards>("scorecards", { ...f, after: c.cursor }, view !== "people");
  return (
    <div data-testid="pp-scorecards">
      {!own && <div className="pp-sub" role="group" aria-label="Scorecard views"><button type="button" className="s6-btn" aria-pressed={view === "people"} onClick={() => setView("people")}>People</button><button type="button" className="s6-btn" aria-pressed={view === "handoffs"} onClick={() => setView("handoffs")}>Booked by one, closed by another</button></div>}
      {view === "handoffs" ? <Handoffs filters={filters} pick={pick} /> : (
        <>
          {!own && <Find q={q} setQ={setQ}>
            <select className="ap-field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="ap-fine inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} />Include owners and admins</label>
          </Find>}
          <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
            {(x) => (
              <>
                <div className="ap-scroll"><table className="ap-t" data-testid="pp-table"><thead><tr><th>Person</th><th data-num data-sm="hide">Leads answered first</th><th data-num>First reply</th><th data-num data-sm="hide">In time</th><th data-num data-sm="hide">Appts set</th><th data-num data-sm="hide">Showed</th><th data-num>Won</th><th data-num data-sm="hide">Waiting</th><th data-sm="hide">8 weeks</th></tr></thead>
                  <tbody>{x.rows.map((s) => (
                    <tr key={s.person.userId} tabIndex={0} onClick={() => pick(s.person.userId)} onKeyDown={(e) => { if (e.key === "Enter") pick(s.person.userId); }} data-testid="pp-row" data-former={s.person.deleted ? "1" : undefined}>
                      <td className="pp-wrap"><Person s={s} onPick={() => pick(s.person.userId)} /></td>
                      <td data-num data-sm="hide">{s.answeredFirst.current.toLocaleString("en-US")}<Trend d={s.answeredFirst} /></td>
                      <td data-num>{s.enough ? secs(s.typicalReplySeconds) : NOT_ENOUGH}</td>
                      <td data-num data-sm="hide">{share(s.inTime)}</td>
                      <td data-num data-sm="hide">{s.apptsSet.enough ? s.apptsSet.current : NOT_ENOUGH}{s.apptsSetEstimated > 0 && s.apptsSet.enough && <span className="ap-sub"> +{s.apptsSetEstimated} est.</span>}<Trend d={s.apptsSet} /></td>
                      <td data-num data-sm="hide">{share(s.showed)}</td>
                      <td data-num>{s.wonValue.enough ? <>{money(s.wonValue.current)}<span className="ap-sub"> ({s.wonCount})</span></> : NOT_ENOUGH}<Trend d={s.wonValue} /></td>
                      <td data-num data-sm="hide" onClick={(e) => e.stopPropagation()}>{s.waiting > 0 ? <button type="button" className="ap-link" onClick={() => open({ title: `${s.person.name}: waiting for a reply`, reason: "waiting", userId: s.person.userId, location: filters.location ? String(filters.location) : null, count: s.waiting })}>{s.waiting}</button> : 0}</td>
                      <td data-sm="hide"><Spark values={s.enough ? s.spark : []} label={`${s.person.name}, first replies, last 8 weeks`} /></td>
                    </tr>
                  ))}</tbody></table></div>
                <Pager c={c} next={x.next} total={x.total} noun="people" />
                <Note>{own ? "This is your own row. " : ""}Not credited to anyone: {x.unattributed.automated.toLocaleString("en-US")} automatic messages and {x.unattributed.unknown.toLocaleString("en-US")} with no person recorded. Appointments marked est. use the last person who messaged or called the lead before the booking, because your CRM records only the owner.</Note>
              </>
            )}
          </Load>
        </>
      )}
    </div>
  );
}

const LOAD_WORD = { over: "Heavy load", under: "Light load", normal: "Normal", unknown: NOT_ENOUGH } as const;
function NextLead({ loc }: { loc: string }) {
  const r = usePp<Pp3NextLead>("nextlead", { location: loc }, !loc);
  if (!loc) return <p className="ap-fine mb-3">Choose one client account above to see who could take its next lead.</p>;
  return (
    <Load r={r} empty={() => false}>
      {(s) => (
        <section className="pp-note-card mb-4" aria-label="Who could take the next lead" data-testid="pp-nextlead">
          <h2 className="pp-h">Who could take the next lead{s.location ? ` in ${s.location.name}` : ""}</h2>
          {s.suggestion ? (
            <>
              <p className="text-sm"><b>Suggested: {s.suggestion.name}.</b></p>
              <ul className="ap-fine" style={{ margin: 0, paddingLeft: "1.1rem" }}>{s.suggestion.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="ap-fine">An estimate from {s.suggestion.sample.toLocaleString("en-US")} recent leads. It never assigns anything by itself.</p>
              <AssignSlot suggestion={s} onChanged={r.reload} />
            </>
          ) : <p className="text-sm">{s.hidden === "nobody_available" ? "Nobody is free right now: everyone is away or heavily loaded." : s.hidden === "no_account" ? "Choose one client account." : `${NOT_ENOUGH} to suggest someone yet.`}</p>}
          {s.considered.length > 0 && <details className="ap-fine"><summary className="cursor-pointer">Who was considered</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: "1.1rem" }}>{s.considered.map((c) => <li key={c.userId}>{c.name}: {c.waiting} waiting{c.answersSourceMinutes !== null ? `, answers this source in about ${Math.round(c.answersSourceMinutes)} min` : ""}{c.away ? ", away" : ""} ({c.sample} leads)</li>)}</ul></details>}
        </section>
      )}
    </Load>
  );
}

const WSORTS: Array<[string, string]> = [["waiting", "Most waiting"], ["name", "Name"]];
export function Workload({ filters, open, pick }: SecProps) {
  const [q, setQ] = useState(""), [sort, setSort] = useState("waiting"), dq = useDebounced(q), loc = String(filters.location ?? "");
  const f = { ...filters, q: dq, sort, dir: sort === "name" ? "asc" : "desc" }, c = useCursor(JSON.stringify(f)), r = usePp<Pp3Workload>("workload", { ...f, after: c.cursor });
  const link = (n: number, d: Omit<Drill, "count">) => (n > 0 ? <button type="button" className="ap-link" onClick={() => open({ ...d, count: n })}>{n}</button> : 0);
  return (
    <div data-testid="pp-workload">
      <NextLead loc={loc} />
      <Find q={q} setQ={setQ}><select className="ap-field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>{WSORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Find>
      <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
        {(x) => (
          <>
            <p className="ap-fine mb-2">{x.over} heavy, {x.under} light{x.idleCount > 0 ? `, ${x.idleCount} with ${NO_ACTIVITY.toLowerCase()} for ${x.idleHours} hours or more while leads wait` : ""}.</p>
            <div className="ap-scroll"><table className="ap-t" data-testid="pp-load"><thead><tr><th>Person</th><th data-sm="hide">Account</th><th data-num>Waiting</th><th data-num data-sm="hide">Open deals</th><th data-num data-sm="hide">Quiet deals</th><th data-num data-sm="hide">Coming up</th><th data-sm="hide">How it looks</th><th /></tr></thead>
              <tbody>{x.rows.map((l) => {
                const d = { userId: l.person.userId, location: l.location.locationId }, who = `${l.person.name} in ${l.location.name}`, items = l.waiting + l.openDeals + l.upcoming;
                const look = <>{l.idle ? <Status on>{NO_ACTIVITY} for {l.idle.hours} h while {l.idle.waitingLeads} leads wait</Status> : <Status on={l.load === "over"}>{LOAD_WORD[l.load]}</Status>}{l.loadWhy && <><br /><span className="ap-fine">{l.loadWhy}</span></>}{l.needsOutcome > 0 && <><br /><span className="ap-fine">{link(l.needsOutcome, { ...d, title: `${who}: appointments with no outcome`, reason: "needs_outcome" })} appointments with no outcome</span></>}</>;
                return (
                  <tr key={`${l.location.locationId}:${l.person.userId}`} style={{ cursor: "default" }} data-testid="pp-load-row">
                    <td className="pp-wrap"><span className="pp-cell"><Initials p={l.person} /><button type="button" className="pp-name" onClick={() => pick(l.person.userId)}>{l.person.name}</button></span><span className="pp-only-sm ap-fine"><br />{l.location.name}<br />{look}</span></td>
                    <td data-sm="hide">{l.location.name}</td>
                    <td data-num>{x.medianOpen !== null && <span className="pp-bar" data-on={l.load === "over" ? "1" : undefined} aria-hidden><b style={{ width: `${Math.min(100, (items / (x.medianOpen * 2.4)) * 100)}%` }} /><u style={{ left: `${(1 / 2.4) * 100}%` }} /></span>}{link(l.waiting, { ...d, title: `${who}: waiting for a reply`, reason: "waiting" })}</td>
                    <td data-num data-sm="hide">{link(l.openDeals, { ...d, title: `${who}: open deals`, reason: "open_deals" })}</td>
                    <td data-num data-sm="hide">{link(l.staleDeals, { ...d, title: `${who}: quiet deals`, reason: "stale_deals" })}</td>
                    <td data-num data-sm="hide">{link(l.upcoming, { ...d, title: `${who}: appointments coming`, reason: "upcoming" })}</td>
                    <td className="pp-wrap" data-sm="hide">{look}</td>
                    <td><MoveLeadsSlot userId={l.person.userId} locationId={l.location.locationId} waiting={l.waiting} onChanged={r.reload} /></td>
                  </tr>
                );
              })}</tbody></table></div>
            <Pager c={c} next={x.next} total={x.total} noun="rows" />
            <Note>The line in each bar is the team&apos;s own middle ({x.medianOpen ?? "not known yet"} open items). Heavy and light are measured against it, never against a fixed number. Open items are waiting leads, open deals and appointments coming.</Note>
          </>
        )}
      </Load>
    </div>
  );
}
