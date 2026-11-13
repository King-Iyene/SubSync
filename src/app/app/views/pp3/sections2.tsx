"use client";

import { useState } from "react";
import type { Pp3Access, Pp3AccessRow, Pp3Board, Pp3Coaching, Pp3Leaderboard, Pp3Money, Pp3Proof } from "@/lib/analytics/people3-types";
import { RoleChip } from "../../roles";
import { PersonActionsSlot, ProofActionsSlot } from "./actions-slot";
import { CoachNoteCard } from "../ai-team/team-notes";
import { fixturesOn, usePp } from "./data";
import type { SecProps } from "./sections";
import { ago, Find, Initials, Load, minutes, money, NOT_ENOUGH, NO_ACTIVITY, Note, Pager, RECONNECT, ROLE_LABEL, share, Status, subline, useCursor, useDebounced } from "./shared";

// The other four sections of Team: Leaderboard, Money, Coaching, Access, Proof.

function BoardTable({ b, pick }: { b: Pp3Board; pick: (id: string) => void }) {
  const closers = b.kind === "closers";
  return (
    <section className="pp-group" aria-label={b.location.name} data-testid="pp-group">
      <h3>{b.location.name}</h3>
      {b.note ? <p className="ap-fine">{b.note}</p> : (
        <div className="ap-scroll"><table className="ap-t" style={{ minWidth: 0 }}><thead><tr><th>Rank</th><th>Person</th><th data-num data-sm="hide">Leads</th><th data-num>{closers ? "Deals won" : "In time"}</th><th data-num data-sm="hide">Against the same sources</th><th data-sm="hide">Why</th></tr></thead>
          <tbody>{b.shown.map((p) => (
            <tr key={p.person.userId} style={{ cursor: "default" }}><td><span className="pp-rank">{p.rank ?? "Not ranked"}</span></td>
              <td className="pp-wrap"><span className="pp-cell"><Initials p={p.person} /><button type="button" className="pp-name" onClick={() => pick(p.person.userId)}>{p.person.name}</button><RoleChip userId={p.person.userId} /></span></td>
              <td data-num data-sm="hide">{p.n}</td><td data-num>{p.enough ? share(p.value) : NOT_ENOUGH}</td>
              <td data-num data-sm="hide">{p.enough && p.vsMix !== null ? `${p.vsMix > 0 ? "+" : ""}${Math.round(p.vsMix)} pts` : ""}</td>
              <td className="pp-wrap" data-sm="hide" style={{ maxWidth: "26rem" }}><span className="ap-fine">{p.why}</span></td></tr>
          ))}</tbody></table></div>
      )}
      {b.you && <p className="ap-fine mt-1">Your place: {b.you.rank ?? "not ranked"} of {b.you.of}. {b.you.why}</p>}
      {b.hidden > 0 && <p className="ap-fine mt-1">The top half is shown. {b.hidden} more {b.hidden === 1 ? "person is" : "people are"} ranked below, and each person sees their own place.</p>}
    </section>
  );
}

export function Leaderboard({ filters, pick, viewer }: SecProps) {
  const [role, setRole] = useState<"setter" | "closer">("setter"), [all, setAll] = useState(false), f = { ...filters, role, all: all ? 1 : undefined }, c = useCursor(JSON.stringify(f)), r = usePp<Pp3Leaderboard>("leaderboard", { ...f, after: c.cursor });
  return (
    <div data-testid="pp-leaderboard">
      <div className="pp-sub" role="group" aria-label="Board"><button type="button" className="s6-btn" aria-pressed={role === "setter"} onClick={() => setRole("setter")}>Setters</button><button type="button" className="s6-btn" aria-pressed={role === "closer"} onClick={() => setRole("closer")}>Closers</button>
        {viewer.canRankAll && <label className="ap-fine inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show the whole ranking</label>}</div>
      <Load r={r} empty={(x) => x.boards.length === 0 && "Nobody can be ranked fairly yet. People are ranked only against others in the same account with enough leads."}>
        {(x) => (
          <>
            <p className="ap-fine mb-3">Ranked only among people in the same account, and compared on the same sources of leads. Under {x.minLeads} leads or {x.minDays} days of history, a person is shown but not ranked. Owners and admins are left out.</p>
            {x.boards.map((b) => <BoardTable key={`${b.location.locationId}:${b.kind}`} b={b} pick={pick} />)}
            <Pager c={c} next={x.page.next} total={x.page.total} noun="accounts" />
          </>
        )}
      </Load>
    </div>
  );
}

export function Money({ filters, open, pick }: SecProps) {
  const [q, setQ] = useState(""), [tip, setTip] = useState(false), dq = useDebounced(q), f = { ...filters, q: dq }, c = useCursor(JSON.stringify(f)), r = usePp<Pp3Money>("money", { ...f, after: c.cursor });
  return (
    <div data-testid="pp-money">
      <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
        {(x) => {
          const tile = (label: string, n: number, on?: () => void, est?: boolean) => (on
            ? <button type="button" className="pp-tile" aria-expanded={tip} onClick={on}><b>{money(n)}</b><span>{label}{est ? " (estimate)" : ""}</span></button>
            : <div className="pp-tile" data-static="1"><b>{money(n)}</b><span>{label}{est ? " (estimate)" : ""}</span></div>);
          const link = (n: number, userId: string, loc: string | null, title: string, reason: "open_deals" | "stale_deals" | "waiting") => (n > 0 ? <button type="button" className="ap-link" onClick={() => open({ title, reason, userId, location: loc ?? (filters.location ? String(filters.location) : null), count: null })}>{money(n)}</button> : money(0));
          return (
            <>
              <div className="pp-tiles">{tile("Won", x.totals.wonValue)}{tile("Open now", x.totals.openValue)}{tile("At risk", x.totals.atRiskValue, () => setTip(!tip), true)}</div>
              {tip && <p className="pp-formula" role="note" data-testid="pp-formula">{x.formula}</p>}
              <Find q={q} setQ={setQ} />
              <div className="ap-scroll"><table className="ap-t" data-testid="pp-money-table"><thead><tr><th>Person</th><th data-num>Won</th><th data-num data-sm="hide">Open now</th><th data-num data-sm="hide">Quiet deals</th><th data-num>Waiting</th><th data-num data-sm="hide">At risk (estimate)</th></tr></thead>
                <tbody>{x.rows.map((m) => {
                  const loc = m.location?.locationId ?? null, p = m.person;
                  return (
                    <tr key={`${loc}:${p.userId}`} style={{ cursor: "default" }}>
                      <td className="pp-wrap"><span className="pp-cell"><Initials p={p} /><button type="button" className="pp-name" onClick={() => pick(p.userId)}>{p.name}</button><RoleChip userId={p.userId} /></span></td>
                      <td data-num>{m.enough ? <>{money(m.wonValue)}<span className="ap-sub pp-hide-sm"> ({m.wonCount})</span></> : NOT_ENOUGH}</td>
                      <td data-num data-sm="hide">{link(m.openValue, p.userId, loc, `${p.name}: open deals`, "open_deals")}</td>
                      <td data-num data-sm="hide">{link(m.staleValue, p.userId, loc, `${p.name}: quiet deals`, "stale_deals")}</td>
                      <td data-num>{link(m.waitingValue, p.userId, loc, `${p.name}: waiting for a reply`, "waiting")}</td>
                      <td data-num data-sm="hide">{m.enough ? money(m.atRiskValue) : NOT_ENOUGH}</td>
                    </tr>
                  );
                })}</tbody></table></div>
              <Pager c={c} next={x.next} total={x.total} noun="people" />
              <Note>Won is credited to the person who owned the deal at the time. Only deals with a value above zero and an owner are counted. Tap At risk to see how it is worked out. Estimates are never promised money.</Note>
            </>
          );
        }}
      </Load>
    </div>
  );
}

export function Coaching({ filters, accounts, coachUser, viewer }: SecProps & { coachUser?: string }) {
  void accounts;
  const [sel, setSel] = useState(coachUser ?? ""), [q, setQ] = useState(""), dq = useDebounced(q), r = usePp<Pp3Coaching>("coaching", { ...filters, user: sel || undefined, q: dq || undefined });
  const self = viewer.level === "self";
  return (
    <div data-testid="pp-coaching">
      <Load r={r} empty={() => false}>
        {(x) => x.person ? (
          <section className="pp-stack" aria-label={`Coaching for ${x.person.name}`} data-testid="pp-coach-detail">
            <div className="pp-cell"><Initials p={x.person} /><h2 className="text-lg font-semibold">{x.person.name}</h2>{!self && <button type="button" className="ap-link ml-3" onClick={() => setSel("")}>Back to the list</button>}</div>
            <div className="pp-note-card"><h3 className="pp-h">One thing to work on</h3>{x.oneThing ? <><p className="text-sm"><b>{x.oneThing.line}</b></p><p className="ap-fine">{x.oneThing.evidence}</p></> : <p className="text-sm">{NOT_ENOUGH} history yet to suggest one thing.</p>}</div>
            <CoachNoteCard userId={x.person.userId} locationId={(filters as { location?: string }).location} />
            {x.moves.length > 0 && <section><h3 className="pp-h mb-1">How their numbers moved</h3><ul className="grid gap-1 text-sm">{x.moves.map((m) => <li key={m.metric}><Status on={m.better === false}>{m.line}</Status></li>)}</ul></section>}
            <section><h3 className="pp-h mb-1">Targets</h3>{x.targets.length ? <ul className="grid gap-1 text-sm">{x.targets.map((t) => <li key={`${t.metric}:${t.locationId}`}>{t.label}</li>)}</ul> : <p className="ap-fine">None set.</p>}</section>
            <section><h3 className="pp-h mb-1">Notes</h3>{x.notes.length ? <ul className="grid gap-2">{x.notes.map((n) => <li key={n.id} className="ap-note"><span className="text-sm">{n.body}</span><br /><span className="ap-fine">{n.authorName}, {n.createdAt.slice(0, 10)}{n.shared ? ", shared with them" : ", private"}</span></li>)}</ul> : <p className="ap-fine">No notes yet.</p>}</section>
            <PersonActionsSlot person={x.person} locationId={null} onChanged={r.reload} />
            <Note>Notes are private to the author and admins unless marked shared. The suggestion compares a person only with their own earlier weeks, never with someone else.</Note>
          </section>
        ) : (
          <>
            <Find q={q} setQ={setQ} />
            {x.people.length === 0 ? <p className="ap-fine">{dq ? "No one matches that search." : "Nobody to show yet. People appear here once their first messages and calls have synced."}</p> : (
              <div className="ap-scroll"><table className="ap-t" data-testid="pp-coach-table"><thead><tr><th>Person</th><th>Last note</th><th /></tr></thead>
                <tbody>{x.people.map((p) => <tr key={p.person.userId} style={{ cursor: "default" }}><td className="pp-wrap"><span className="pp-cell"><Initials p={p.person} /><span>{p.person.name}<br /><span className="ap-fine">{subline(p.person)}</span></span></span></td><td>{p.lastNoteAt ? ago(p.lastNoteAt) : <span className="ap-fine">No note in 30 days</span>}</td><td><button type="button" className="ap-link" onClick={() => setSel(p.person.userId)}>Open</button></td></tr>)}</tbody></table></div>
            )}
            <Note>One thing to work on is built only from a person&apos;s own lowest number compared with their own earlier weeks.</Note>
          </>
        )}
      </Load>
    </div>
  );
}

const FLAG_WORD = { no_account: "In no account", deleted: "No longer in your CRM", unnamed: "Not named yet", new: "New" } as const;
export function Access({ filters, pick }: SecProps) {
  const [by, setBy] = useState<"person" | "account">("person"), [q, setQ] = useState(""), dq = useDebounced(q), f = { ...filters, q: dq }, c = useCursor(JSON.stringify(f)), r = usePp<Pp3Access>("access", { ...f, after: c.cursor });
  return (
    <div data-testid="pp-access">
      <div className="pp-sub" role="group" aria-label="Group by"><button type="button" className="s6-btn" aria-pressed={by === "person"} onClick={() => setBy("person")}>By person</button><button type="button" className="s6-btn" aria-pressed={by === "account"} onClick={() => setBy("account")}>By client account</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && (dq ? "No one matches that search." : true)}>
        {(x) => (
          <>
            {x.needsPermission.length > 0 && <p className="ap-note mb-3" role="status"><b>{RECONNECT}</b> for {x.needsPermission.map((a) => a.name).join(", ")}. We could not read the list of people there.</p>}
            {x.risks.length > 0 && <section className="mb-3" aria-label="Where one person does it all"><h3 className="pp-h mb-1">Worth a look</h3><ul className="grid gap-1 text-sm">{x.risks.map((k) => <li key={`${k.location.locationId}:${k.kind}`}><Status on>{k.line}</Status></li>)}</ul></section>}
            <p className="ap-fine mb-2">{x.total.toLocaleString("en-US")} people{x.newPeople > 0 ? `, ${x.newPeople} new` : ""}{x.deletedPeople > 0 ? `, ${x.deletedPeople} no longer in your CRM` : ""}.</p>
            {by === "person" ? (
              <>
                <Find q={q} setQ={setQ} />
                <div className="ap-scroll"><table className="ap-t" data-testid="pp-access-people"><thead><tr><th>Person</th><th>Works in</th><th data-sm="hide">Verified sign-in</th><th data-sm="hide">Last activity</th></tr></thead>
                  <tbody>{x.rows.map((a: Pp3AccessRow) => (
                    <tr key={a.person.userId} style={{ cursor: "default" }}>
                      <td className="pp-wrap"><span className="pp-cell"><Initials p={a.person} /><span><button type="button" className="pp-name" onClick={() => pick(a.person.userId)}>{a.person.name}</button><RoleChip userId={a.person.userId} /><br /><span className="ap-fine">{ROLE_LABEL[a.person.role]}{a.flags.length ? `, ${a.flags.map((fl) => FLAG_WORD[fl]).join(", ").toLowerCase()}` : ""}</span></span></span></td>
                      <td className="pp-wrap" style={{ maxWidth: "26rem" }}>{a.person.allAccounts ? "All client accounts" : a.flags.includes("no_account") ? <Status on>In no account</Status> : <>{a.person.accounts.slice(0, 3).map((k) => k.name).join(", ")}{a.person.accountCount > 3 ? ` and ${a.person.accountCount - 3} more` : ""}</>}</td>
                      <td data-sm="hide">{a.verified === null ? <span className="ap-fine">Not tracked</span> : a.verified ? <Status>Verified</Status> : <Status on>Not verified</Status>}</td>
                      <td data-sm="hide"><span className="ap-fine">{a.person.lastActivityAt ? ago(a.person.lastActivityAt) : NO_ACTIVITY}</span></td>
                    </tr>
                  ))}</tbody></table></div>
                <Pager c={c} next={x.next} total={x.total} noun="people" />
              </>
            ) : (
              <div className="ap-scroll"><table className="ap-t" data-testid="pp-access-accounts"><thead><tr><th>Client account</th><th data-num>People</th><th>What to know</th></tr></thead>
                <tbody>{x.accounts.map((a) => { const risks = x.risks.filter((k) => k.location.locationId === a.locationId); return <tr key={a.locationId} style={{ cursor: "default" }}><td className="pp-wrap"><span className="ap-name">{a.name}</span></td><td data-num>{a.people}</td><td className="pp-wrap" style={{ maxWidth: "30rem" }}>{risks.length ? risks.map((k) => <Status key={k.kind} on>{k.line}</Status>) : <span className="ap-fine">Nothing to flag</span>}</td></tr>; })}</tbody></table></div>
            )}
            <Note>Who can reach which account comes from the list of users in your CRM. New people appear here by themselves after the next sync; a person who sends messages but has no name shows as not named yet.</Note>
          </>
        )}
      </Load>
    </div>
  );
}

export function Proof({ filters, accounts, viewer }: SecProps) {
  const [loc, setLoc] = useState(String(accounts[0]?.locationId ?? "")), [named, setNamed] = useState(false), pickLoc = String(filters.location ?? loc), r = usePp<Pp3Proof>("proof", { from: filters.from, to: filters.to, location: pickLoc || undefined, named: named ? 1 : undefined }, !pickLoc && accounts.length > 1);
  return (
    <div data-testid="pp-proof">
      <div className="ap-head">{accounts.length > 1 && <select className="ap-field" aria-label="Client account" value={pickLoc} onChange={(e) => setLoc(e.target.value)} disabled={Boolean(filters.location)}>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
        {fixturesOn() && viewer.level === "all" && <label className="ap-fine inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={named} onChange={(e) => setNamed(e.target.checked)} />Show team members by name</label>}
        <span className="ap-fine">A summary for one client, for one period of up to 90 days{filters.from && filters.to && (Date.parse(String(filters.to)) - Date.parse(String(filters.from))) / 86_400_000 + 1 > 90 ? `. The dates above are longer, so this shows the 90 days up to ${filters.to}` : ""}.</span></div>
      <Load r={r} empty={(p) => !p.location && "Choose a client account to see how the team handled its leads."}>
        {(p) => (
          <section className="pp-card pp-receipt" aria-label={`Team summary for ${p.location?.name ?? ""}`} data-testid="pp-receipt">
            <h2 className="pp-h">{p.location?.name}, {p.period.from} to {p.period.to}</h2>
            <p className="pp-sentence">{p.lines[0] ?? ""}</p>
            <dl>
              <dt>New leads answered</dt><dd>{p.answeredPct.enough ? `${p.answered} of ${p.leads} (${share(p.answeredPct)})` : NOT_ENOUGH}</dd>
              <dt>Typical first reply</dt><dd>{minutes(p.typicalReplyMinutes)}{p.targetMinutes !== null ? ` (target ${p.targetMinutes} min)` : ""}</dd>
              <dt>Replied in time</dt><dd>{share(p.inTime)}</dd>
              <dt>Appointments booked</dt><dd>{p.appointments}</dd>
              <dt>Showed up</dt><dd>{p.showed} of {p.appointments} ({share(p.showedPct)})</dd>
            </dl>
            {p.lines.length > 1 && <ul className="text-sm" style={{ margin: 0, paddingLeft: "1.1rem" }}>{p.lines.slice(1).map((l) => <li key={l}>{l}</li>)}</ul>}
            {p.staff && p.naming === "named" && (
              <div className="ap-scroll w-full"><table className="ap-t" style={{ minWidth: 0 }}><thead><tr><th>Team member</th><th data-num>Answered</th><th data-num>First reply</th></tr></thead><tbody>{p.staff.map((s) => <tr key={s.name} style={{ cursor: "default" }}><td>{s.name}</td><td data-num>{s.answered}</td><td data-num>{minutes(s.typicalReplyMinutes)}</td></tr>)}</tbody></table></div>
            )}
            <p className="ap-fine">{p.naming === "named" ? "Team members are named because you chose that for this client." : "Shows the team as a whole. Individual names are left out unless you choose Show staff names below for this client."}{p.historyStarts ? ` Based on SubSync's own record, which starts ${p.historyStarts}.` : ""}</p>
            <ProofActionsSlot proof={p} />
          </section>
        )}
      </Load>
    </div>
  );
}
