"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Pp3PersonPanel, Pp3Reason } from "@/lib/analytics/people3-types";
import { ErrorState, SkeletonRows } from "../../ds";
import { portalRoot } from "../../ds/portal-root";
import { PersonActionsSlot } from "./actions-slot";
import { usePp } from "./data";
import { ago, Initials, money, NO_ACTIVITY, NOT_ENOUGH, ROLE_LABEL, secs, share, Spark, Status, subline } from "./shared";

/** A count that opens its rows: what the list is for, who, which account. `count` is null when only the list itself knows (it then shows its own total). */
export type Drill = { title: string; reason: Pp3Reason; userId: string | null; location: string | null; count: number | null };

function Trend({ label, values, weeks, fmt, lower }: { label: string; values: Array<number | null>; weeks: string[]; fmt: (n: number) => string; lower?: boolean }) {
  const have = values.filter((v): v is number => v !== null);
  if (have.length < 3) return <figure><figcaption>{label}</figcaption><span className="ap-fine">{NOT_ENOUGH}</span></figure>;
  // a week with nothing recorded repeats the week before it, so the line has no gap
  const v = values.reduce<number[]>((acc, x) => [...acc, x === null ? (acc.length ? acc[acc.length - 1] : have[0]) : x], []), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, pts = v.map((n, i) => `${(i / (v.length - 1)) * 100},${40 - ((n - lo) / span) * 36}`).join(" ");
  const now = v[v.length - 1], before = v[v.length - 2], better = lower ? now < before : now > before;
  return (
    <figure>
      <figcaption>{label}: <b>{fmt(now)}</b>{now === before ? ", same as the week before" : better ? ", better than the week before" : ", worse than the week before"}</figcaption>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={`${label}, last ${v.length} weeks, from ${fmt(v[0])} to ${fmt(now)}`}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>
      <span><i>{weeks[0]}</i><i>{weeks[weeks.length - 1]}</i></span>
    </figure>
  );
}

/** One person: headline sentence, 8-week lines, accounts and roles, open items (each opens its rows), the link to the CRM. The previous and next arrows (and the left and right arrow keys) come from the server, in the order of the list behind it. */
export function PersonPanel({ userId, onSelect, onClose, onDrill, onCoach, filters }: { userId: string; onSelect: (id: string) => void; onClose: () => void; onDrill: (d: Drill) => void; onCoach: (id: string) => void; filters: Record<string, string | number | undefined> }) {
  const r = usePp<Pp3PersonPanel>("person", { ...filters, user: userId });
  const ref = useRef<HTMLElement>(null), d = r.data && r.data.person ? r.data : null, p = d?.person ?? null, prev = d?.prev ?? null, next = d?.next ?? null;
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
  const sc = d?.scorecard ?? null, weeks = d?.weeks.map((w) => w.start.slice(5)) ?? [];
  // Drawn in the app wrapper (fixed, covering the window) so the page's entrance animation cannot trap it, and it keeps the same theme.
  return createPortal(
    <div className="s6 ap pp">
      <div className="ap-scrim" onClick={onClose} aria-hidden />
      <aside className="ap-panel" role="dialog" aria-modal="true" aria-label="Person details" ref={ref} tabIndex={-1} data-testid="pp-panel">
        <div className="ap-panel-h">
          {p && <Initials p={p} />}
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-tight" data-testid="pp-panel-name">{p?.name ?? "Person"}</h2><p className="ap-fine">{p ? `${ROLE_LABEL[p.role]}${p.deleted ? ", no longer in your CRM" : ""}${p.away ? `, away until ${p.away.until.slice(0, 10)}` : ""}` : ""}</p></div>
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
                  <Trend label="First reply" values={d.weeks.map((w) => (w.typicalReplySeconds === null ? null : w.typicalReplySeconds / 60))} weeks={weeks} fmt={(n) => `${Math.round(n)} min`} lower />
                  <Trend label="Appointments set" values={d.weeks.map((w) => w.apptsSet)} weeks={weeks} fmt={(n) => String(Math.round(n))} />
                  <Trend label="Showed up" values={d.weeks.map((w) => w.showedPct)} weeks={weeks} fmt={(n) => `${Math.round(n)}%`} />
                  <Trend label="Money won" values={d.weeks.map((w) => w.wonValue)} weeks={weeks} fmt={money} />
                  {d.workloadTrend.length >= 3 && <Trend label="Open items" values={d.workloadTrend.map((w) => w.open)} weeks={d.workloadTrend.map((w) => w.day.slice(5))} fmt={(n) => String(Math.round(n))} lower />}
                </div>
                <p className="ap-fine mt-2">{d.historyStarts ? `History starts ${d.historyStarts}.` : "History starts when SubSync first synced this account."}</p>
              </section>
              <section aria-label="Where they work"><h3 className="pp-h mb-2">Where they work, and what is open</h3>
                <div className="ap-scroll"><table className="ap-t" data-testid="pp-panel-accounts" style={{ minWidth: 0 }}><thead><tr><th>Client account</th><th data-num>Waiting</th><th data-num>Open deals</th><th data-num>Quiet</th></tr></thead>
                  <tbody>{d.accounts.map((a) => {
                    const open = (n: number, reason: Pp3Reason, what: string) => (n > 0 ? <button type="button" className="ap-link" onClick={() => onDrill({ title: `${p.name} in ${a.location.name}: ${what}`, reason, userId: p.userId, location: a.location.locationId, count: n })}>{n}</button> : 0);
                    return (
                      <tr key={a.location.locationId} style={{ cursor: "default" }}><td><span className="ap-name">{a.location.name}</span><br /><span className="ap-fine">{ROLE_LABEL[a.role]}</span></td>
                        <td data-num>{open(a.waiting, "waiting", "waiting for a reply")}</td><td data-num>{open(a.openDeals, "open_deals", "open deals")}</td><td data-num>{open(a.staleDeals, "stale_deals", "quiet deals")}</td></tr>
                    );
                  })}</tbody></table></div>
                {p.accountCount > d.accounts.length && <p className="ap-fine mt-1">and {p.accountCount - d.accounts.length} more client accounts.</p>}
              </section>
              {sc && (
                <dl className="ap-dl">
                  <dt>First reply</dt><dd>{sc.enough ? secs(sc.typicalReplySeconds) : NOT_ENOUGH} <span className="ap-sub"><Spark values={sc.enough ? sc.spark : []} label="First replies, last 8 weeks" /></span></dd>
                  <dt>Replied in time</dt><dd>{share(sc.inTime)}</dd>
                  <dt>Appointments set</dt><dd>{sc.apptsSet.enough ? sc.apptsSet.current : NOT_ENOUGH}{sc.apptsSetEstimated > 0 ? ` (+${sc.apptsSetEstimated} est.)` : ""}</dd>
                  <dt>Showed up</dt><dd>{share(sc.showed)}</dd>
                  <dt>Money won</dt><dd>{sc.wonValue.enough ? `${money(sc.wonValue.current)} (${sc.wonCount} deals)` : NOT_ENOUGH}</dd>
                </dl>
              )}
              <dl className="ap-dl">
                <dt>Last activity</dt><dd>{p.lastActivityAt ? ago(p.lastActivityAt) : <Status on>{NO_ACTIVITY}</Status>}</dd>
                <dt>Works in</dt><dd>{subline(p)}</dd>
                {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
              </dl>
              {d.nextLeadEligible && <p className="ap-fine">Can be suggested for the next lead (an estimate; see Workload).</p>}
              <button type="button" className="s6-btn" onClick={() => onCoach(p.userId)} data-testid="pp-open-coaching">Open coaching</button>
              <PersonActionsSlot person={p} locationId={d.accounts[0]?.location.locationId ?? null} onChanged={r.reload} />
              {d.openInCrmUrl ? <a className="s6-btn" data-kind="primary" href={d.openInCrmUrl} target="_blank" rel="noopener noreferrer" data-testid="pp-open-crm">Open in your CRM <ExternalLink aria-hidden className="size-3.5" /></a> : <span className="ap-fine">Link to your CRM not available.</span>}
              <p className="ap-fine">SubSync reads message and call metadata, never the words. Arrow keys move to the next person.</p>
            </>
          ) : <p className="ap-fine">Nothing to show for this person.</p>}
        </div>
      </aside>
    </div>,
    portalRoot(),
  );
}
