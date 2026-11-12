"use client";

import { useState } from "react";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { moneyWords, REASON_HINT, REASON_LABEL, trendWords, type AccountCount, type Reason } from "@/lib/analytics/ignored-leads-core";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { WhatIs } from "../ds/what-is";
import { useData } from "../session";
import { useSpeedFilter } from "./speed-filter";
import { SidePopup } from "./speed-popup";
import { LeadRows, useLeadActions, type LeadRow } from "./speed-rows";
import "./speed4.css";

// "Waiting on the client": for an agency, which client accounts are not answering the leads the agency sends them. Per account: people nobody called back, new leads never answered, customers who
// wrote and got no reply, and customers who got only an automatic reply. Every number opens exactly the people it counts (the same query, docs/METRICS.md "Clients ignoring leads").
// SubSync only measures this. It never messages a lead or a client.

type Report = {
  enabled: boolean; now: number; days: number; eventsStored: number; accounts: Array<AccountCount & { previous: number | null }>;
  totals: { people: number; missed: number; never: number; replyNobody: number; replyAuto: number; dollars: number; unpriced: number; previous: number | null; accountsAffected: number } | null;
  measuring?: { countAutomated: boolean };
};
type Spec = { title: string; reason: Reason | "all"; account: string | null };
const cls = "s6-link underline decoration-dotted underline-offset-4";

export function IgnoredTab({ multi }: { multi: boolean }) {
  const { query } = useSpeedFilter();
  const { data: d, error, reload } = useData<Report>(`speed?part=ignored${query}`);
  const [open, setOpen] = useState<Spec | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={5} label="Checking who is answering..." />;
  const t = d.totals;
  if (!d.enabled || !t) return <EmptyState title="Not available yet" body="This view is not switched on for your account." />;
  const names = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
  const trend = trendWords(t.people, t.previous, d.days);
  const ranked = d.accounts.filter((a) => a.people > 0);
  const tiles: Array<{ reason: Reason; n: number }> = [{ reason: "missed", n: t.missed }, { reason: "never", n: t.never }, { reason: "reply_nobody", n: t.replyNobody }, { reason: "reply_auto", n: t.replyAuto }];
  return (
    <div data-testid="ignored-tab">
      {d.eventsStored === 0 && <p className="t-small t-quiet mb-4" data-testid="ignored-warming">Message and call history starts filling after the next sync. Numbers appear as it arrives.</p>}
      <section aria-labelledby="ignored-head" className="mb-8">
        <h3 id="ignored-head" className="t-title mb-2">Waiting on the client <WhatIs text="People a client account has not answered: new leads nobody called or messaged, customers whose last message got no reply (or only an automatic one), and callers nobody called back. A person does not count once someone on the client's team has answered. Automatic messages are not answers unless you chose to count them in Settings." /></h3>
        <p className="t-display" data-testid="ignored-headline">{t.people === 0 ? "Every client account has answered its people." : `${t.accountsAffected.toLocaleString("en-US")} ${t.accountsAffected === 1 ? "client account is" : "client accounts are"} not answering ${names(t.people)}.`}</p>
        {t.people > 0 && <p className="t-small t-quiet mt-1" data-testid="ignored-money">{moneyWords(t.dollars, t.people, t.unpriced)}{trend ? ` ${trend}` : ""}</p>}
        {t.people > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="ignored-reasons">
            {tiles.map((x) => x.n > 0 ? <button key={x.reason} type="button" className={cls} data-testid={`ignored-reason-${x.reason}`} data-tip={REASON_HINT[x.reason]} onClick={() => setOpen({ title: REASON_LABEL[x.reason], reason: x.reason, account: null })}>{x.n.toLocaleString("en-US")} {REASON_LABEL[x.reason].toLowerCase()}</button> : null)}
          </p>
        )}
        {t.people > 0 && <p className="t-small t-quiet mt-2">{d.measuring?.countAutomated ? "Automatic messages count as answers (your setting)." : "An automatic message is not an answer."} Last {d.days} days.</p>}
      </section>

      {ranked.length > 0 && (
        <section aria-label="Client accounts, worst first" className="mb-10 border-t border-[var(--t-rule)] pt-5" data-testid="ignored-accounts">
          <ol className="divide-y">
            {ranked.map((a, i) => (
              <li key={a.locationId} className="py-3" data-testid="ignored-account" data-account={a.locationId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 font-medium"><span className="t-quiet mr-2 tabular-nums">{i + 1}</span>{a.name}</p>
                  <button type="button" className={`${cls} font-semibold tabular-nums`} data-testid="ignored-account-total" aria-label={`${a.name}: ${a.people} people not answered. Open them.`} onClick={() => setOpen({ title: `${a.name}: not answered`, reason: "all", account: a.locationId })}>{names(a.people)}</button>
                </div>
                <p className="t-small mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {([["missed", a.missed], ["never", a.never], ["reply_nobody", a.replyNobody], ["reply_auto", a.replyAuto]] as Array<[Reason, number]>).map(([r, n]) => n > 0 ? <button key={r} type="button" className={cls} data-testid={`ignored-account-${r}`} onClick={() => setOpen({ title: `${a.name}: ${REASON_LABEL[r].toLowerCase()}`, reason: r, account: a.locationId })}>{n.toLocaleString("en-US")} {REASON_LABEL[r].toLowerCase()}</button> : null)}
                </p>
                <p className="t-small t-quiet mt-0.5">
                  {a.oldestAt !== null ? `Oldest has waited ${fmtDuration(Math.max(60, Math.round((d.now - a.oldestAt) / 1000)))}. ` : ""}{moneyWords(a.dollars, a.people, a.unpriced)}
                  {a.previous !== null ? ` ${trendWords(a.people, a.previous, d.days) ?? ""}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {d.accounts.length > ranked.length && ranked.length > 0 && <p className="t-small t-quiet mb-6" data-testid="ignored-fine">{(d.accounts.length - ranked.length).toLocaleString("en-US")} {d.accounts.length - ranked.length === 1 ? "client account has" : "client accounts have"} answered everyone.</p>}
      {open && <SidePopup label={open.title} onClose={() => setOpen(null)}><IgnoredList key={`${open.reason}|${open.account}`} spec={open} multi={multi || open.account === null} /></SidePopup>}
    </div>
  );
}

/** One quiet line on Today for an agency: how many client accounts are not answering their people, with a link to the list. Nothing is drawn when the view is off or nobody is waiting. */
export function IgnoredLine() {
  const { data } = useData<Report>("speed?part=ignored");
  const t = data?.enabled ? data.totals : null;
  if (!t || t.people === 0) return null;
  return (
    <p className="t-small mb-4" data-testid="today-ignored-line">
      {t.accountsAffected.toLocaleString("en-US")} {t.accountsAffected === 1 ? "client account is" : "client accounts are"} not answering {t.people.toLocaleString("en-US")} {t.people === 1 ? "person" : "people"}.{" "}
      <a href="#speed?tab=ignored" className="font-medium text-[var(--t-accent)] underline underline-offset-4">See who</a>
    </p>
  );
}

type Page = { total: number; page: number; size: number; rows: Array<LeadRow & { reasons: Reason[] }> };
function IgnoredList({ spec, multi }: { spec: Spec; multi: boolean }) {
  const { query } = useSpeedFilter();
  const [page, setPage] = useState(0);
  const { data, error, reload } = useData<Page>(`speed?part=ignored-list&reason=${spec.reason}&page=${page}${spec.account ? `&account=${encodeURIComponent(spec.account)}` : ""}${query}`);
  const actions = useLeadActions(data?.rows ?? []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={4} label="Opening the people..." />;
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  return (
    <div data-testid="ignored-list">
      <p className="t-small t-quiet mb-2" data-testid="ignored-list-count">{data.total.toLocaleString("en-US")} {data.total === 1 ? "person" : "people"}: {spec.title.toLowerCase()}{spec.reason !== "all" ? `. ${REASON_HINT[spec.reason]}` : ""}</p>
      {data.rows.length === 0 ? <EmptyState title="Nobody here" body="Nobody matches this right now." /> : <LeadRows rows={data.rows} showAccount={multi} actions={actions} testId="ignored-rows" />}
      {actions.drawer}
      {pages > 1 && (
        <nav className="mt-3 flex items-center gap-3 text-sm" aria-label="Pages">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="ds-press min-h-9 rounded-md border bg-card px-3 disabled:opacity-40">Previous</button>
          <span className="t-quiet tabular-nums">Page {page + 1} of {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="ds-press min-h-9 rounded-md border bg-card px-3 disabled:opacity-40">Next</button>
        </nav>
      )}
    </div>
  );
}
