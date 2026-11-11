"use client";

import { useState } from "react";
import type { PpAccess, PpAccessAccount, PpAccessPerson, PpAccountRef, PpBoard, PpCoach, PpMoney, PpPage, PpProof } from "@/lib/analytics/people3-types-interim";
import { CoachActionsSlot, ProofActionsSlot } from "./actions-slot";
import { usePp } from "./data";
import type { SecProps } from "./sections";
import { ago, Find, Initials, Load, minutes, money, NOT_ENOUGH, Note, Pager, share, Status, useCursor, useDebounced } from "./shared";

// The other four sections of Team: Leaderboard, Money, Coaching, Access, Proof.

export function Leaderboard({ filters, pick }: SecProps) {
  const [b, setB] = useState<"setters" | "closers">("setters"), f = { ...filters, board: b }, c = useCursor(JSON.stringify(f)), r = usePp<PpBoard>("leaderboard", { ...f, cursor: c.cursor });
  return (
    <div data-testid="pp-leaderboard">
      <div className="pp-sub" role="group" aria-label="Board"><button type="button" className="s6-btn" aria-pressed={b === "setters"} onClick={() => setB("setters")}>Setters</button><button type="button" className="s6-btn" aria-pressed={b === "closers"} onClick={() => setB("closers")}>Closers</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && "Nobody can be ranked fairly yet. People are ranked only against others in the same account with enough leads."}>
        {(x) => (
          <>
            <p className="ap-fine mb-3">Ranked only among people in the same account who get the same kinds of leads. Under {x.minLeads} leads or {x.minDays} days of history, a person is not ranked. Measure: {x.metric.toLowerCase()}.</p>
            {x.rows.map((g) => (
              <section key={g.locationId} className="pp-group" aria-label={g.accountName} data-testid="pp-group">
                <h3>{g.accountName}</h3><p className="ap-fine">{g.mix}. {g.people} {g.people === 1 ? "person" : "people"}.</p>
                {g.note ? <p className="ap-fine">{g.note}</p> : (
                  <div className="ap-scroll"><table className="ap-t" style={{ minWidth: 0 }}><thead><tr><th>Rank</th><th>Person</th><th data-num data-sm="hide">Leads</th><th data-num>{x.board === "closers" ? "Won" : "In time"}</th><th data-sm="hide">Why</th></tr></thead>
                    <tbody>{g.rows.map((p) => (
                      <tr key={p.userId} style={{ cursor: "default" }}><td><span className="pp-rank">{p.rank ?? "n/a"}</span></td>
                        <td className="pp-wrap"><span className="pp-cell"><Initials name={p.name} /><button type="button" className="pp-name" onClick={() => pick(p.userId, g.rows.map((m) => m.userId))}>{p.name}</button>{p.you && <span className="ap-fine"> you</span>}</span></td>
                        <td data-num data-sm="hide">{p.leads}</td><td data-num>{p.enough && p.value !== null ? (x.board === "closers" ? money(p.value) : `${Math.round(p.value * 100)}%`) : NOT_ENOUGH}</td>
                        <td data-sm="hide" className="pp-wrap"><span className="ap-fine">{p.why}</span></td></tr>
                    ))}</tbody></table></div>
                )}
                {g.hidden > 0 && <p className="ap-fine mt-1">The top half is shown. {g.hidden} more {g.hidden === 1 ? "person is" : "people are"} ranked below, and each person sees their own rank.</p>}
              </section>
            ))}
            <Pager c={c} next={x.next} total={x.total} noun="accounts" />
          </>
        )}
      </Load>
    </div>
  );
}

export function Money({ filters, open, pick }: SecProps) {
  const [by, setBy] = useState<"person" | "account">("person"), [q, setQ] = useState(""), [tip, setTip] = useState<string | null>(null), dq = useDebounced(q);
  const f = { ...filters, by, q: dq }, c = useCursor(JSON.stringify(f)), r = usePp<PpMoney>("money", { ...f, cursor: c.cursor });
  return (
    <div data-testid="pp-money">
      <div className="pp-sub" role="group" aria-label="Group by"><button type="button" className="s6-btn" aria-pressed={by === "person"} onClick={() => setBy("person")}>By person</button><button type="button" className="s6-btn" aria-pressed={by === "account"} onClick={() => setBy("account")}>By client account</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
        {(x) => {
          const tile = (k: string, label: string, n: number, est?: boolean) => <button key={k} type="button" className="pp-tile" aria-expanded={tip === k} onClick={() => setTip(tip === k ? null : k)}><b>{money(n)}</b><span>{label}{est ? " (estimate)" : ""}</span></button>;
          return (
            <>
              <div className="pp-tiles">{tile("won", "Won", x.totals.wonValue)}{tile("open", "Open now", x.totals.openValue)}{tile("stale", "May slip", x.totals.staleValue, true)}{tile("waiting", "Waiting for a reply", x.totals.waitingValue, true)}</div>
              {tip && x.formulas[tip] && <p className="pp-formula" role="note" data-testid="pp-formula">{x.formulas[tip]}</p>}
              <Find q={q} setQ={setQ} label={by === "person" ? "Search people" : "Search accounts"} />
              <div className="ap-scroll"><table className="ap-t" data-testid="pp-money-table"><thead><tr><th>{by === "person" ? "Person" : "Client account"}</th><th data-num>Won</th><th data-num data-sm="hide">Open now</th><th data-num data-sm="hide">May slip (estimate)</th><th data-num>Waiting</th></tr></thead>
                <tbody>{x.rows.map((m) => (
                  <tr key={`${m.locationId}:${m.userId}`} style={{ cursor: "default" }}>
                    <td className="pp-wrap">{by === "person" ? <span className="pp-cell"><Initials name={m.name} /><button type="button" className="pp-name" onClick={() => pick(m.userId, x.rows.map((n) => n.userId))}>{m.name}</button></span> : <span className="ap-name">{m.name}</span>}</td>
                    <td data-num>{money(m.wonValue)}<span className="ap-sub pp-hide-sm"> ({m.wonCount})</span></td><td data-num data-sm="hide">{money(m.openValue)}</td><td data-num data-sm="hide">{money(m.staleValue)}</td>
                    <td data-num>{m.waitingCount > 0 ? <button type="button" className="ap-link" onClick={() => open({ title: `${m.name}: waiting for a reply`, reason: "waiting", userId: m.userId || null, location: m.locationId, count: m.waitingCount })}>{m.waitingCount}</button> : 0}<span className="ap-sub pp-hide-sm"> {m.waitingValue ? `~${money(m.waitingValue)}` : ""}</span></td>
                  </tr>
                ))}</tbody></table></div>
              <Pager c={c} next={x.next} total={x.total} noun={by === "person" ? "people" : "accounts"} />
              <Note>Won is credited to the person who owned the deal at the time. Tap a total to see how it is worked out. Estimates are labelled and are never promised money.</Note>
            </>
          );
        }}
      </Load>
    </div>
  );
}

export function Coaching({ filters, pick }: SecProps) {
  const [q, setQ] = useState(""), dq = useDebounced(q), f = { ...filters, q: dq }, c = useCursor(JSON.stringify(f)), r = usePp<PpPage<PpCoach>>("coaching", { ...f, cursor: c.cursor });
  return (
    <div data-testid="pp-coaching">
      <Find q={q} setQ={setQ} />
      <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
        {(x) => (
          <>
            <div className="ap-scroll"><table className="ap-t" data-testid="pp-coach-table"><thead><tr><th>Person</th><th>One thing to work on</th><th data-sm="hide">Compared with their month before</th><th data-sm="hide">Targets</th><th data-num data-sm="hide">Notes</th><th /></tr></thead>
              <tbody>{x.rows.map((p) => (
                <tr key={p.userId} style={{ cursor: "default" }}>
                  <td className="pp-wrap"><span className="pp-cell"><Initials name={p.name} /><button type="button" className="pp-name" onClick={() => pick(p.userId, x.rows.map((m) => m.userId))}>{p.name}</button></span></td>
                  <td className="pp-wrap">{p.focus ?? <span className="ap-fine">{NOT_ENOUGH}</span>}</td>
                  <td data-sm="hide">{p.lowest ? `${p.lowest.label}: ${p.lowest.before} to ${p.lowest.now}` : ""}</td>
                  <td data-sm="hide">{p.targets.map((t) => `${t.label} ${t.value}${t.unit === "%" ? "%" : ` ${t.unit}`}`).join(", ") || <span className="ap-fine">None set</span>}</td>
                  <td data-num data-sm="hide">{p.notes}</td><td><CoachActionsSlot userId={p.userId} name={p.name} onChanged={r.reload} /></td>
                </tr>
              ))}</tbody></table></div>
            <Pager c={c} next={x.next} total={x.total} noun="people" />
            <Note>The suggestion is built only from a person&apos;s own lowest number compared with their own month before, never against someone else. Notes are private to the author and admins unless marked shared.</Note>
          </>
        )}
      </Load>
    </div>
  );
}

const FLAG_TEXT = { nobody_active: "Nobody active recently", single_point: "One person does most of it" } as const;
export function Access({ filters, pick }: SecProps) {
  const [by, setBy] = useState<"person" | "account">("person"), [q, setQ] = useState(""), dq = useDebounced(q), f = { ...filters, by, q: dq }, c = useCursor(JSON.stringify(f)), r = usePp<PpAccess>("access", { ...f, cursor: c.cursor });
  return (
    <div data-testid="pp-access">
      <div className="pp-sub" role="group" aria-label="Group by"><button type="button" className="s6-btn" aria-pressed={by === "person"} onClick={() => setBy("person")}>By person</button><button type="button" className="s6-btn" aria-pressed={by === "account"} onClick={() => setBy("account")}>By client account</button></div>
      <Find q={q} setQ={setQ} label={by === "person" ? "Search people" : "Search accounts"} />
      <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
        {(x) => (
          <>
            <div className="ap-scroll">
              {by === "person" ? (
                <table className="ap-t" data-testid="pp-access-people"><thead><tr><th>Person</th><th>Works in</th><th data-sm="hide">Connection</th><th data-sm="hide">Last activity</th></tr></thead>
                  <tbody>{(x.rows as PpAccessPerson[]).map((p) => (
                    <tr key={p.userId} style={{ cursor: "default" }}>
                      <td><span className="pp-cell"><Initials name={p.name} /><span><button type="button" className="pp-name" onClick={() => pick(p.userId, (x.rows as PpAccessPerson[]).map((m) => m.userId))}>{p.name}</button><br /><span className="ap-fine">{p.role === "staff" ? "Staff" : p.role === "admin" ? "Admin" : "Owner"}{p.newPerson ? ", new" : ""}</span></span></span></td>
                      <td className="pp-wrap">{p.scope === "all" ? "All client accounts" : p.scope === "none" ? <Status on>In no account</Status> : <>{p.accounts.slice(0, 3).map((a: PpAccountRef) => a.name).join(", ")}{p.accountCount > 3 ? ` and ${p.accountCount - 3} more` : ""}</>}</td>
                      <td data-sm="hide">{p.connected ? <Status>Connected</Status> : <Status on>Not connected</Status>}</td><td data-sm="hide"><span className="ap-fine">{ago(p.lastSeenAt)}</span></td>
                    </tr>
                  ))}</tbody></table>
              ) : (
                <table className="ap-t" data-testid="pp-access-accounts"><thead><tr><th>Client account</th><th data-num>People</th><th data-num>Active recently</th><th>Who handles it</th></tr></thead>
                  <tbody>{(x.rows as PpAccessAccount[]).map((a) => (
                    <tr key={a.locationId} style={{ cursor: "default" }}><td><span className="ap-name">{a.name}</span></td><td data-num>{a.people}</td><td data-num>{a.active}</td>
                      <td className="pp-wrap">{a.topName && <span>{a.topName} {a.topShare.enough ? `sends ${share(a.topShare)} of replies` : ""}</span>} {a.flags.map((fl) => <Status key={fl} on>{FLAG_TEXT[fl]}</Status>)}</td></tr>
                  ))}</tbody></table>
              )}
            </div>
            <Pager c={c} next={x.next} total={x.total} noun={by === "person" ? "people" : "accounts"} />
            <Note>Who can reach which account comes from your CRM users list. New people appear here by themselves after the next sync; a person who sends messages but is not named shows as Unnamed user.</Note>
          </>
        )}
      </Load>
    </div>
  );
}

export function Proof({ filters, accounts }: SecProps) {
  const [loc, setLoc] = useState(String(filters.location ?? accounts[0]?.locationId ?? "")), pickLoc = String(filters.location ?? loc), r = usePp<PpProof>("proof", { from: filters.from, location: pickLoc }, !pickLoc);
  return (
    <div data-testid="pp-proof">
      <div className="ap-head"><select className="ap-field" aria-label="Client account" value={pickLoc} onChange={(e) => setLoc(e.target.value)} disabled={Boolean(filters.location)}>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select><span className="ap-fine">A summary for one client, for one period of up to 90 days.</span></div>
      <Load r={r} empty={(p) => !p.locationId && "Choose a client account to see how the team handled its leads."}>
        {(p) => (
          <section className="pp-card pp-receipt" aria-label={`Team receipt for ${p.accountName}`} data-testid="pp-receipt">
            <h2 className="pp-h">{p.accountName}, {p.from} to {p.to}</h2>
            <p className="pp-sentence">{p.sentence}</p>
            <dl>
              <dt>New leads answered</dt><dd>{p.answered.enough ? `${p.answered.n} of ${p.answered.of} (${share(p.answered)})` : NOT_ENOUGH}</dd>
              <dt>Typical first reply</dt><dd>{minutes(p.medianMinutes)}</dd>
              <dt>Replied in time</dt><dd>{share(p.inTime)}</dd>
              <dt>Appointments booked</dt><dd>{p.appointments.booked}</dd>
              <dt>Showed up</dt><dd>{p.appointments.held} of {p.appointments.booked} ({share(p.showed)})</dd>
            </dl>
            {p.staff && p.naming && (
              <div className="ap-scroll w-full"><table className="ap-t" style={{ minWidth: 0 }}><thead><tr><th>Team member</th><th data-num>Answered</th><th data-num>First reply</th></tr></thead><tbody>{p.staff.map((s) => <tr key={s.name} style={{ cursor: "default" }}><td>{s.name}</td><td data-num>{s.answered}</td><td data-num>{minutes(s.medianMinutes)}</td></tr>)}</tbody></table></div>
            )}
            <p className="ap-fine">{p.naming ? "Team members are named because you chose that for this client." : "Shows the team as a whole. Individual names are left out unless you choose to show them for this client."}{p.historyStarts ? ` Based on SubSync's own record, which starts ${p.historyStarts}.` : ""}</p>
            <ProofActionsSlot proof={p} />
          </section>
        )}
      </Load>
    </div>
  );
}
