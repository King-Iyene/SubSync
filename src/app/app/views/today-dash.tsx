"use client";

import { Banknote, BarChart3, CalendarCheck, Clock, Compass, Kanban, LayoutDashboard, Timer, TrendingUp, Users, Workflow, ArrowLeftRight } from "lucide-react";
import { type ReactNode } from "react";
import type { AccessKind } from "@/lib/access";
import { cardLink, goWith } from "@/lib/design/deep-link";
import { zoneWord } from "@/lib/design/zone";
import { usePageRange } from "../ds/page-range";
import type { TodayData } from "@/lib/analytics/today-types";
import type { GoFn } from "../nav";
import { OverviewView } from "./overview";
import { PipelineView } from "./pipeline";
import { InfoTip } from "../ds/info-tip";
import type { TodayModel } from "./today-model";
import "./td3/td3.css";

// The Numbers dashboard: the older Today charts (growth, how fast we answer, where leads go, appointments, forecast, sources, coverage, where the work sits, people, clients coming and going,
// pipeline) and the old Overview (accounts at a glance), laid out as cards in the order a business owner reads them over coffee: are leads coming in, are we answering them, where do they go,
// do they show up, what is the money doing, where do they come from, who is carrying the work. Nothing is removed: each card holds the same working component the older page used (so every
// mark still opens exactly its rows). ONE bar above sets the dates for all of them; the client choice is the bar at the top of the app (the same choice for every card).

/** The dates of every chart below, in words. There is NO second date control here: the date bar at the top of the app is the only one (docs/DATE_RULES.md). */
export function DatesBar() {
  const bar = usePageRange();
  return (
    <div className="td-dates print:hidden" role="group" aria-label="Dates for every chart below" data-testid="td-dates">
      <span className="ap-fine" data-testid="td-dates-window">{bar.ready ? `Every chart below shows ${bar.spec.preset === "custom" ? "from " : ""}${bar.label}, ${zoneWord()} time. ` : "Working out the dates... "}Change the dates in the bar at the top of the page; choose the client accounts there too.</span>
    </div>
  );
}

/** Two honest definitions of a "new lead" on one page. The growth card counts people with a usable email, one per person; the funnel counts every new contact. Both say so. */
export const EMAIL_LEADS_RULE = "This card counts new email leads only: one per person, with a usable email. Test and junk records, extra copies of the same person and your own team are left out. The funnel below counts every new contact, so it is usually the bigger number.";
export const ALL_LEADS_RULE = "This counts every new contact in the dates you picked, with or without an email, so it can be bigger than the email leads card above.";

function Card({ id, title, sub, tip, icon, wide, action, children }: { id: string; title: string; sub: string; tip?: string; icon: ReactNode; wide?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`td-card${wide ? " wide" : ""}`} data-testid={`td-card-${id}`} aria-labelledby={`td-card-h-${id}`}>
      <header>
        <span className="td-ico" aria-hidden>{icon}</span>
        <div><h3 id={`td-card-h-${id}`}>{title}</h3><p>{sub}{tip && <> <InfoTip text={tip} label={`Why this number can differ: ${title}`} testId={`td-tip-${id}`} /></>}</p></div>
        {action && <div className="td-card-action">{action}</div>}
      </header>
      <div className="td-card-body">{children}</div>
    </section>
  );
}

export function TodayDashboard({ t, kind, agency, go, evidence, growthTab, forecast, where, sources, coverage, people, coming, flow }: {
  m: TodayModel; t: TodayData; kind: AccessKind; agency: boolean; multi?: boolean; go: GoFn; options: Array<{ id: string; name: string }>;
  evidence: ReactNode; growthTab: ReactNode; forecast: ReactNode; where: ReactNode; sources: ReactNode; coverage: ReactNode; people: ReactNode; proof: ReactNode; coming: ReactNode; flow: ReactNode;
}) {
  const link = (label: string, view: Parameters<GoFn>[0]) => <button type="button" className="ap-link" onClick={() => go(view)}>{label}</button>;
  const showPipeline = kind !== "client";
  return (
    <div className="td-dash-wrap" data-testid="td-dashboard">
      <div className="td-dash">
        {/* 1. Are leads coming in? */}
        <Card id="growth" wide title="New leads and growth" sub="Email leads only, against your goal, and where they came from."
          tip={EMAIL_LEADS_RULE} icon={<TrendingUp className="size-4" />}>{growthTab}</Card>
        {/* 2. Are we answering them? */}
        <Card id="reply" title="How fast we answer" sub="Typical first reply, who is waiting and appointments with no outcome." icon={<Timer className="size-4" />} action={link("Open Speed to lead", "speed")}>{evidence}</Card>
        {coverage && <Card id="coverage" title="Which hours miss leads" sub="The hours of the day when leads arrive and nobody answers." icon={<Clock className="size-4" />}>{coverage}</Card>}
        {/* 3. Where do they go? */}
        <Card id="flow" wide title="Where do my leads go?" sub="Every new contact followed to where they are now: replied, booked, showed, won."
          tip={ALL_LEADS_RULE} icon={<Workflow className="size-4" />}>{flow}</Card>
        {/* 4. Do they show up, and what is the money doing? */}
        <Card id="appointments" title="Appointments" sub="Show rate, outcomes still to mark and no-shows." icon={<CalendarCheck className="size-4" />} action={<button type="button" className="ap-link" onClick={() => goWith(go, { ...cardLink(t.totals.appointments.count > 0 || t.totals.noshows.count === 0 ? "unmarked" : "noshows", { count: 0 }), expect: null })}>Open Appointments</button>}>
          <p className="ap-fine">{t.totals.appointments.count > 0 ? `${t.totals.appointments.count.toLocaleString("en-US")} appointments are over with no outcome marked.` : "Every past appointment has an outcome."} {t.totals.noshows.count > 0 ? `${t.totals.noshows.count.toLocaleString("en-US")} no-shows are not rebooked.` : ""}</p>
        </Card>
        <Card id="forecast" title="What goes wrong if nothing changes" sub="The forecast: leads that will wait too long, and deals that go quiet." icon={<Banknote className="size-4" />}>{forecast}</Card>
        {showPipeline && <Card id="pipeline" wide title="Pipeline" sub="Forecast and stages across your deals." icon={<Kanban className="size-4" />} action={link("Open Pipeline", "pipeline")}><div className="[&_h1]:sr-only"><PipelineView /></div></Card>}
        {/* 5. Where do they come from, and who carries the work? */}
        {sources && <Card id="sources" title="Where leads come from" sub="Reply speed by source." icon={<Compass className="size-4" />}>{sources}</Card>}
        {where && <Card id="where" wide title="Where the work sits" sub="One bar per client: what is waiting in each." icon={<BarChart3 className="size-4" />}>{where}</Card>}
        {people && <Card id="people" title="People" sub="Workload by person." icon={<Users className="size-4" />} action={link("Open Team", "team")}>{people}</Card>}
        {coming && <Card id="coming" wide title="Clients coming and going" sub="Clients added and removed each week." icon={<ArrowLeftRight className="size-4" />}>{coming}</Card>}
        {/* 6. The old Overview */}
        {agency && (
          <Card id="overview" wide title="Accounts at a glance" sub="Who needs attention, where money is stuck, account health." icon={<LayoutDashboard className="size-4" />}>
            <div className="td-embed"><OverviewView go={go} /></div>
          </Card>
        )}
      </div>
    </div>
  );
}
