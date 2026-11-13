"use client";

import { useMemo } from "react";
import type { Coming } from "@/lib/analytics/today-smart";
import { specComing, specKind, type SpecEnv } from "@/lib/analytics/today-specs";
import type { Kind } from "@/lib/analytics/today-queue";
import type { TodayData } from "@/lib/analytics/today-types";
import { WhatIs } from "../ds/what-is";
import { fmtInt } from "../ui";
import { ReportFilterBar, useReportFilter } from "./report-filter";
import { TabIntro } from "./today-flow";
import type { TodayModel } from "./today-model";

// The Forecast tab in plain words: one sentence about what will go wrong later today if nobody acts, the few items behind it with the reason in a sentence and an Open link, and
// a calm empty state that still says what is already late. Read from the data Today already holds (no new request); the client choice narrows it on the page.

const clock = (at: number, now: number) => {
  const d = new Date(at);
  const same = d.toDateString() === new Date(now).toDateString();
  return `${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}${same ? "" : `, ${d.toLocaleDateString("en-GB", { weekday: "short" })}`}`;
};
const many = (n: number, one: string, more: string) => `${fmtInt(n)} ${n === 1 ? one : more}`;
type Row = Coming & { group: "leads" | "deals" | "appointments"; why: string };
const SHOWN = 8;

export function ForecastTab({ m, t, clients, agency }: { m: TodayModel; t: TodayData; clients?: Array<{ id: string; name: string }>; agency: boolean }) {
  const f = useReportFilter("w", "7d");
  const only = f.client && f.client !== "all" ? f.client : null;
  const pick = (l: Coming[]) => (only ? l.filter((c) => c.locationId === only) : l);
  const leads = pick(t.forecast.leads), deals = pick(t.forecast.deals), appts = pick(t.forecast.appointments);
  const rows = useMemo<Row[]>(() => [
    ...leads.map((c): Row => ({ ...c, group: "leads", why: `Nobody has replied yet. A reply is due by ${clock(c.at, m.now)}.` })),
    ...deals.map((c): Row => ({ ...c, group: "deals", why: `It has not moved in a while. It will count as a quiet deal at ${clock(c.at, m.now)}.` })),
    ...appts.map((c): Row => ({ ...c, group: "appointments", why: `Starts at ${clock(c.at, m.now)}. Someone will need to mark how it went.` })),
  ].sort((a, b) => a.at - b.at), [leads, deals, appts, m.now]);
  const late = useMemo(() => {
    const c: Record<string, number> = { replies: 0, stale: 0, appointments: 0 };
    for (const i of m.view.items) if (i.kind in c && (!only || i.locationId === only)) c[i.kind]++;
    return c;
  }, [m.view.items, only]);
  const lateAll = late.replies + late.stale + late.appointments;
  const dealMoney = deals.reduce((s, d) => s + (d.value ?? 0), 0);
  const bits = [
    leads.length > 0 ? `${many(leads.length, "lead is", "leads are")} about to go unanswered` : null,
    deals.length > 0 ? `${many(deals.length, "deal", "deals")} will go quiet` : null,
    appts.length > 0 ? `${many(appts.length, "appointment", "appointments")} will need an outcome` : null,
  ].filter((x): x is string => !!x);
  const headline = bits.length === 0 ? "Nothing is about to slip. Good." : `Later today, if nobody acts: ${bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}` : bits[0]}.`;
  const env = m.env as SpecEnv;
  const bar = <ReportFilterBar f={f} label="Forecast" noDates clients={agency ? clients : undefined} />;
  return (
    <div data-testid="tab-numbers" className="max-w-3xl">
      <TabIntro name="Forecast" />
      {bar}
      <p className="text-[0.9375rem] font-medium" data-testid={rows.length === 0 ? "coming-none" : "coming-headline"}>
        {headline}{" "}
        <WhatIs text={`SubSync looks ahead at what will be late by the end of today if nobody acts: leads whose first reply is due (your reply goal is ${t.targetMinutes} minutes), deals that are about to sit untouched too long, and appointments about to end with no outcome. It sends nothing by itself.`} />
      </p>
      {dealMoney > 0 && <p className="t-small t-quiet mt-1" data-testid="coming-money">Those deals are worth ${Math.round(dealMoney).toLocaleString("en-US")} between them.</p>}
      {rows.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-[var(--t-rule)] border-y border-[var(--t-rule)]" data-testid="coming-list">
            {rows.slice(0, SHOWN).map((r) => (
              <li key={`${r.group}-${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5" data-testid={`coming-${r.group}`} data-count={1}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={r.name}>{r.name}{agency && <span className="t-quiet font-normal"> &middot; {r.accountName}</span>}</p>
                  <p className="t-small t-quiet mt-0.5">{r.why}</p>
                </div>
                {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="ds-press cursor-pointer text-sm text-primary underline underline-offset-4" aria-label={`Open ${r.name} in your CRM`}>Open</a> : <span />}
              </li>
            ))}
          </ul>
          <p className="t-small mt-2 flex flex-wrap gap-x-4" data-testid="coming-see">
            {([["leads", leads], ["deals", deals], ["appointments", appts]] as const).filter(([, l]) => l.length > 0).map(([k, l]) => (
              <button key={k} type="button" onClick={() => m.open(specComing(k, l, t.targetMinutes))} data-testid={`coming-open-${k}`} className="ds-press cursor-pointer text-primary underline underline-offset-4">See all {fmtInt(l.length)} {k === "leads" ? (l.length === 1 ? "lead" : "leads") : k === "deals" ? (l.length === 1 ? "deal" : "deals") : (l.length === 1 ? "appointment" : "appointments")}</button>
            ))}
          </p>
        </>
      )}
      {rows.length === 0 && (
        <p className="t-small mt-3" data-testid="coming-late">
          {lateAll > 0
            ? <>Already late: {[late.replies > 0 ? many(late.replies, "person waiting for a reply", "people waiting for a reply") : null, late.stale > 0 ? many(late.stale, "quiet deal", "quiet deals") : null, late.appointments > 0 ? many(late.appointments, "appointment with no outcome", "appointments with no outcome") : null].filter(Boolean).join(", ")}.{" "}
                <button type="button" className="ds-press cursor-pointer text-primary underline underline-offset-4" onClick={() => m.open(specKind((late.replies > 0 ? "replies" : late.stale > 0 ? "stale" : "appointments") as Kind, env))} data-testid="coming-late-open">See them</button></>
            : <span className="t-quiet">Nothing is late either.</span>}
        </p>
      )}
    </div>
  );
}
