"use client";

import { Section, type Column } from "../ds";
import { DataList } from "../ds/data-list";
import { PulseTile } from "../ds/pulse";
import { EmptyState } from "../ds/states";
import { useData } from "../session";
import { ErrorBox, Loading } from "../ui";

// Calls held, not logged (docs/features/MEETINGS_BRIEF.md slice 3) and what followed a call (slice 4). Counts only: nobody reads another person's call here.
// A person's own numbers equal the rows of their Meeting inbox; "Open my inbox" goes there. An administrator also sees the people their scope covers, by person and by account.

type Counts = { held: number; logged: number; notLogged: number; overdue: number; needsContact: number; needsOk: number; needsPermission: number; failed: number; share: number | null };
type Rep = Counts & { name: string; accountName: string | null; isMe: boolean };
type Account = Counts & { name: string | null };
type Outcomes = {
  enough: boolean; total: number; needed: number; historyStarts: string | null;
  logged24hShare: number | null; nextStepShare: number | null; movedOrBookedShare: number | null; logged24h: number; nextStepSet: number; movedOrBooked7d: number;
};
type Data = {
  windowHours: number; windowDays: number; minOutcomeMeetings: number; flags: { logged: boolean; outcomes: boolean }; demo?: boolean; notReady?: boolean;
  mine: Counts | null; team: { scope: string; total: Counts; reps: Rep[]; accounts: Account[] } | null; outcomes: Outcomes | null;
};

const pct = (n: number | null) => (n === null ? "No calls" : `${n}%`);
const dayWords = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");

function MineBlock({ c, days, openInbox }: { c: Counts; days: number; openInbox: () => void }) {
  if (c.held === 0) return <EmptyState compact title={`No recorded calls in the last ${days} days`} body="When a call is recorded in your meeting tool, it shows here as logged or waiting." />;
  const waits = [c.needsContact && `${c.needsContact} need you to pick the contact`, c.needsOk && `${c.needsOk} wait for your OK`, c.needsPermission && `${c.needsPermission} need a permission`, c.failed && `${c.failed} were refused by your CRM`].filter(Boolean).join(", ");
  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3" data-testid="mn-mine">
      <PulseTile usual={null} label="Calls logged" value={pct(c.share)} sub={`${c.logged} of ${c.held} calls in the last ${days} days are on a contact in your CRM.`} testId="mn-mine-logged" />
      <PulseTile usual={null} label="Not logged yet" value={String(c.notLogged)} sub={c.notLogged === 0 ? "Everything is logged." : waits} testId="mn-mine-not" onOpen={c.notLogged > 0 ? openInbox : undefined} openLabel="Open my Meeting inbox" />
      <PulseTile usual={null} label="Over a day old" value={String(c.overdue)} sub={c.overdue === 0 ? "Nothing has waited more than 24 hours." : "Waiting more than 24 hours. The sooner the note is on the contact, the more use it is."} testId="mn-mine-overdue" onOpen={c.overdue > 0 ? openInbox : undefined} openLabel="Open my Meeting inbox" />
    </div>
  );
}

const countCols = <T extends Counts>(first: Column<T>): Array<Column<T>> => [
  first,
  { key: "held", header: "Calls", width: "5rem", align: "right", cell: (r) => r.held },
  { key: "logged", header: "Logged", width: "6rem", align: "right", cell: (r) => (r.share === null ? "None" : `${r.logged} (${r.share}%)`) },
  { key: "not", header: "Not logged", width: "6rem", align: "right", cell: (r) => r.notLogged },
  { key: "over", header: "Over 24 h", width: "6rem", align: "right", cell: (r) => (r.overdue > 0 ? <strong className="text-destructive">{r.overdue}</strong> : 0) },
];

function TeamBlock({ team, days }: { team: NonNullable<Data["team"]>; days: number }) {
  if (team.total.held === 0) return <EmptyState compact title={`No recorded calls from your team in the last ${days} days`} body="Calls show here once people connect their meeting tool in Settings, Integrations." />;
  const person: Column<Rep> = { key: "who", header: "Person", primary: true, width: "minmax(0,2fr)", cell: (r) => <span>{r.name}{r.isMe ? " (you)" : ""}{r.accountName ? <span className="text-muted-foreground"> · {r.accountName}</span> : null}</span> };
  const account: Column<Account> = { key: "acct", header: "Client account", primary: true, width: "minmax(0,2fr)", cell: (r) => r.name ?? "Company staff, across accounts" };
  return (
    <>
      <div className="mb-5 grid gap-x-8 gap-y-5 sm:grid-cols-3" data-testid="mn-team-total">
        <PulseTile usual={null} label="Team calls logged" value={pct(team.total.share)} sub={`${team.total.logged} of ${team.total.held} calls in the last ${days} days.`} />
        <PulseTile usual={null} label="Not logged" value={String(team.total.notLogged)} sub="Waiting in someone's private Meeting inbox, or refused by the CRM." />
        <PulseTile usual={null} label="Over a day old" value={String(team.total.overdue)} sub="Not logged and more than 24 hours old." />
      </div>
      <DataList title="By person" rows={team.reps} columns={countCols(person)} rowKey={(r) => r.name + (r.accountName ?? "") + String(r.held)} empty="No calls." caption="Counts only. You never see what was said on a call." />
      {team.accounts.length > 1 && <div className="mt-6"><DataList title="By client account" rows={team.accounts} columns={countCols(account)} rowKey={(r) => r.name ?? "staff"} empty="No calls." caption="A call counts for the account its person works in." /></div>}
    </>
  );
}

function OutcomeBlock({ o, min }: { o: Outcomes; min: number }) {
  const since = o.historyStarts ? `History starts ${dayWords(o.historyStarts)}.` : "";
  if (!o.enough) {
    return <EmptyState compact title={o.total === 0 ? "No history yet" : `Not enough calls yet: ${o.total} of ${min}`} body={`Shares appear once ${min} calls are on record, so a few calls are never shown as a trend. SubSync keeps this record from now on. ${since}`.trim()} />;
  }
  return (
    <div data-testid="mn-outcomes">
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <PulseTile usual={null} label="Logged within a day" value={pct(o.logged24hShare)} sub={`${o.logged24h} of ${o.total} calls had their note on the contact within 24 hours.`} />
        <PulseTile usual={null} label="Next step set" value={pct(o.nextStepShare)} sub={`${o.nextStepSet} of ${o.total} calls had action items written to the contact.`} />
        <PulseTile usual={null} label="Booked or moved within 7 days" value={pct(o.movedOrBookedShare)} sub={`${o.movedOrBooked7d} of ${o.total} calls were followed by a new booking or a deal move for the same contact.`} />
      </div>
      <p className="t-small t-quiet mt-3">{since} This shows what followed calls. It does not prove the calls caused it.</p>
    </div>
  );
}

export function CallsToLog({ openInbox }: { openInbox: () => void }) {
  const { data, error, loading, reload } = useData<Data>("meeting-logged");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.demo) return <EmptyState title="Sample data has no recorded calls" body="Connect a meeting tool to see which calls are logged and which are waiting." />;
  return (
    <div data-testid="mn-logged">
      {data.notReady && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">The history of what followed calls is not switched on for your account yet. The counts below still work.</p>}
      {data.flags.logged && data.mine && <Section title="Your calls" hint={`Calls recorded in the last ${data.windowDays} days. Every number here equals what is in your Meeting inbox.`}><MineBlock c={data.mine} days={data.windowDays} openInbox={openInbox} /></Section>}
      {data.flags.logged && data.team && <Section title="Your team" hint="Who has calls that are held but not logged. Counts only."><TeamBlock team={data.team} days={data.windowDays} /></Section>}
      {data.flags.outcomes && data.outcomes && <Section title="What followed a call" hint="From calls that were saved to a contact, kept as our own record."><OutcomeBlock o={data.outcomes} min={data.minOutcomeMeetings} /></Section>}
    </div>
  );
}
