"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PpPanel } from "@/lib/analytics/people3-types-interim";
import { ErrorState, SkeletonRows } from "../../ds";
import { portalRoot } from "../../ds/portal-root";
import { PersonActionsSlot } from "./actions-slot";
import { usePp } from "./data";
import { ago, Initials, minutes, NO_ACTIVITY, NOT_ENOUGH, Spark, Status } from "./shared";

export type Drill = { title: string; reason: string; userId: string | null; location: string | null; count: number };

function Trend({ label, values, weeks, unit, lower }: { label: string; values: number[]; weeks: string[]; unit: string; lower?: boolean }) {
  if (values.length < 3) return <figure><figcaption>{label}</figcaption><span className="ap-fine">{NOT_ENOUGH}</span></figure>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${40 - ((v - lo) / span) * 36}`).join(" ");
  const last = values[values.length - 1], prev = values[values.length - 2], better = lower ? last < prev : last > prev;
  return (
    <figure>
      <figcaption>{label}: <b>{last}{unit}</b>{last === prev ? ", same as the week before" : better ? ", better than the week before" : ", worse than the week before"}</figcaption>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={`${label}, last ${values.length} weeks, from ${values[0]}${unit} to ${last}${unit}`}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>
      <span><i>{weeks[0]}</i><i>{weeks[weeks.length - 1]}</i></span>
    </figure>
  );
}

/** One person: headline sentence, 8-week lines, accounts and roles, open items (each opens its rows), notes, the next-lead estimate, and the link to the CRM. Left and right arrow keys move between the people in the list behind it. */
export function PersonPanel({ userId, ids, onSelect, onClose, onDrill, filters }: { userId: string; ids: string[]; onSelect: (id: string) => void; onClose: () => void; onDrill: (d: Drill) => void; filters: Record<string, string | number | undefined> }) {
  const r = usePp<PpPanel>("person", { ...filters, user: userId });
  const ref = useRef<HTMLElement>(null), at = ids.indexOf(userId), prev = at > 0 ? ids[at - 1] : null, next = at >= 0 && at < ids.length - 1 ? ids[at + 1] : null;
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") onClose(); else if (e.key === "ArrowLeft" && prev) onSelect(prev); else if (e.key === "ArrowRight" && next) onSelect(next);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, onSelect, prev, next]);
  const d = r.data && (r.data as { person?: unknown }).person ? r.data : null, p = d?.person;
  // Drawn in the app wrapper (fixed, covering the window) so the page's entrance animation cannot trap it, and it keeps the same theme.
  return createPortal(
    <div className="s6 ap pp">
      <div className="ap-scrim" onClick={onClose} aria-hidden />
      <aside className="ap-panel" role="dialog" aria-modal="true" aria-label="Person details" ref={ref} tabIndex={-1} data-testid="pp-panel">
        <div className="ap-panel-h">
          {p && <Initials name={p.name} />}
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-tight" data-testid="pp-panel-name">{p?.name ?? "Person"}</h2><p className="ap-fine">{p ? `${p.role === "owner" ? "Owner" : p.role === "admin" ? "Admin" : "Staff"}${p.deleted ? ", no longer in your CRM" : ""}${p.awayUntil ? `, away until ${p.awayUntil}` : ""}` : ""}</p></div>
          <div className="pp-panel-nav">
            <button type="button" className="ap-iconbtn" disabled={!prev} onClick={() => prev && onSelect(prev)} aria-label="Previous person"><ChevronLeft aria-hidden className="size-4" /></button>
            <button type="button" className="ap-iconbtn" disabled={!next} onClick={() => next && onSelect(next)} aria-label="Next person"><ChevronRight aria-hidden className="size-4" /></button>
            <button type="button" className="ap-iconbtn" onClick={onClose} aria-label="Close panel" data-testid="pp-panel-close"><X aria-hidden className="size-4" /></button>
          </div>
        </div>
        <div className="ap-panel-b">
          {r.loading && !d ? <SkeletonRows rows={5} label="Loading this person" /> : r.error ? <ErrorState error={r.error as Error} onRetry={r.reload} /> : d && p ? (
            <>
              <p className="ap-note" data-testid="pp-headline">{d.headline}</p>
              <section aria-label="The last 8 weeks"><h3 className="pp-h mb-2">The last 8 weeks</h3>
                <div className="pp-lens">
                  <Trend label="First reply (minutes)" values={d.trends.response} weeks={d.weeks} unit=" min" lower />
                  <Trend label="Appointments set" values={d.trends.booked} weeks={d.weeks} unit="" />
                  <Trend label="Showed up" values={d.trends.showed} weeks={d.weeks} unit="%" />
                  <Trend label="Deals won" values={d.trends.won} weeks={d.weeks} unit="" />
                </div>
                <p className="ap-fine mt-2">{d.historyStarts ? `History starts ${d.historyStarts}.` : "History starts when SubSync first synced this account."}</p>
              </section>
              <section aria-label="Where they work"><h3 className="pp-h mb-2">Where they work, and what is open</h3>
                <div className="ap-scroll"><table className="ap-t" data-testid="pp-panel-accounts" style={{ minWidth: 0 }}><thead><tr><th>Account</th><th data-num>Waiting</th><th data-num>Leads</th><th data-num>Deals</th></tr></thead>
                  <tbody>{d.accounts.map((a) => (
                    <tr key={a.locationId} style={{ cursor: "default" }}><td><span className="ap-name">{a.name}</span><br /><span className="ap-fine">{a.role}</span></td>
                      <td data-num>{a.waiting > 0 ? <button type="button" className="ap-link" onClick={() => onDrill({ title: `${p.name} in ${a.name}: waiting for a reply`, reason: "waiting", userId: p.userId, location: a.locationId, count: a.waiting })}>{a.waiting}</button> : 0}</td>
                      <td data-num>{a.openLeads > 0 ? <button type="button" className="ap-link" onClick={() => onDrill({ title: `${p.name} in ${a.name}: open leads`, reason: "open", userId: p.userId, location: a.locationId, count: a.openLeads })}>{a.openLeads}</button> : 0}</td>
                      <td data-num>{a.openDeals}</td></tr>
                  ))}</tbody></table></div>
                {p.accounts > d.accounts.length && <p className="ap-fine mt-1">and {p.accounts - d.accounts.length} more accounts.</p>}
              </section>
              <dl className="ap-dl">
                <dt>First reply</dt><dd>{minutes(p.firstReplyMinutes)} <span className="ap-sub"><Spark values={p.spark} label="Share of first replies sent in time, 8 weeks" /></span></dd>
                <dt>Last activity</dt><dd>{p.lastActivityAt ? ago(p.lastActivityAt) : NO_ACTIVITY} {p.idle && <Status on>{NO_ACTIVITY}</Status>}</dd>
                {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
              </dl>
              {d.focus && <section aria-label="One thing to work on"><h3 className="pp-h mb-1">One thing to work on</h3><p className="text-sm">{d.focus}</p><p className="ap-fine">Built from their own lowest number compared with their own month before.</p></section>}
              {d.notes.length > 0 && <section aria-label="Coaching notes"><h3 className="pp-h mb-1">Coaching notes</h3><ul className="grid gap-2">{d.notes.map((n) => <li key={n.id} className="ap-note"><b>{n.title}</b><br /><span className="text-sm">{n.text}</span><br /><span className="ap-fine">{n.author}, {n.at.slice(0, 10)}{n.shared ? ", shared with them" : ", private"}</span></li>)}</ul></section>}
              {d.nextLead && <p className="ap-fine">Could take the next lead in {d.nextLead.accountName}: {d.nextLead.because}. This is an estimate.</p>}
              <PersonActionsSlot person={p} locationId={d.accounts[0]?.locationId ?? null} onChanged={r.reload} />
              {p.url ? <a className="s6-btn" data-kind="primary" href={p.url} target="_blank" rel="noopener noreferrer" data-testid="pp-open-crm">Open in your CRM <ExternalLink aria-hidden className="size-3.5" /></a> : <span className="ap-fine">Link to your CRM not available.</span>}
              <p className="ap-fine">SubSync reads message and call metadata, never the words. Arrow keys move to the next person.</p>
            </>
          ) : <p className="ap-fine">Nothing to show for this person.</p>}
        </div>
      </aside>
    </div>,
    portalRoot(),
  );
}
