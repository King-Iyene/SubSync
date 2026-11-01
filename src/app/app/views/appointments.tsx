"use client";

import type { GoFn } from "../nav";
import { useData } from "../session";
import { DataList, EmptyState, HowTo, InlineAlert, Page, SkeletonCards, type Column } from "../ds";
import { Badge, Btn, Card, ErrorBox, ExtLink, fmtInt, Stat } from "../ui";

type Rates = { held: number; noShow: number; cancelled: number; booked: number; unmarked: number; showRate: number | null; noShowRate: number | null; cancelRate: number | null };
type Person = { contactId: string; name: string; phone: string | null; locationName: string | null; at: number; calendar: string | null; url: string };
type Row = { key: string; label: string; booked: number; held: number; noShow: number; cancelled: number; showRate: number | null };
type Data = {
  access: { ok: number; needsPermission: Array<{ locationId: string; name: string | null }>; notYet: number; total: number };
  headline: string[]; last30: Rates; prior30: Rates; upcoming7: number;
  unconfirmed: Person[]; unconfirmedTotal: number; recover: Person[]; recoverTotal: number; unmarked: Person[]; unmarkedTotal: number;
  byCalendar: Row[]; byPerson: Row[];
  perAccount: Array<{ locationId: string; name: string | null; booked: number; held: number; noShow: number; showRate: number | null; upcoming7: number; unmarked: number; access: string }>;
  canSeeAccounts: boolean;
};

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Contacts({ rows, empty, action }: { rows: Person[]; empty: string; action: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((p) => (
        <li key={p.contactId + p.at} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">· {p.calendar ?? "appointment"} · {when(p.at)}{p.locationName ? ` · ${p.locationName}` : ""}</span></span>
          <span className="flex items-center gap-3 text-xs">
            {p.phone && <span className="tabular-nums text-muted-foreground">{p.phone}</span>}
            <ExtLink href={p.url}>{p.phone ? `${action} in your CRM` : "Open"}</ExtLink>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AppointmentsView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Data>("appointments");
  if (loading && !data) return <Page title="Appointments"><SkeletonCards cards={5} label="Loading appointments..." /></Page>;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const d = data;
  const hasData = d.last30.booked + d.prior30.booked + d.upcoming7 > 0;
  const waiting = d.access.needsPermission.length;

  return (
    <Page title="Appointments" subtitle="Who is booked, who showed up, and who to chase today. A past appointment with no outcome is flagged, not guessed." actions={<Btn onClick={() => go("calls")}>Open call lists</Btn>}>
      {waiting > 0 && (
        <InlineAlert tone="warning" className="mb-6" title={waiting === d.access.total ? "SubSync needs your approval to read appointments." : `${waiting} account${waiting === 1 ? " still needs" : "s still need"} approval to show appointments.`}>
          <p>
            SubSync now asks for permission to read calendar events and your team&apos;s names (read only). Accounts that installed before this was added keep their old permissions until the app is approved again:
            open the app in the marketplace and choose Reinstall (or ask the account owner to), then approve. Nothing else changes.
          </p>
          {d.canSeeAccounts && <p className="mt-1 text-xs">Waiting: {d.access.needsPermission.slice(0, 6).map((a) => a.name ?? "Unnamed").join(", ")}{waiting > 6 ? ` and ${waiting - 6} more` : ""}.</p>}
        </InlineAlert>
      )}

      {!hasData ? (
        <EmptyState title="No appointments yet" body={waiting > 0 ? "They will appear after the app is approved again and the next sync finishes." : "Once calendars have bookings, show rate, no-shows and who to chase appear here."} action={<Btn onClick={() => go("help")}>Open Getting started</Btn>} />
      ) : (
        <>
          <HowTo id="appointments" title="How to use this page" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
            Work the three lists from the left: remind people booked for the next two days, call the no-shows, then record what happened so the show rate is true.
          </HowTo>
          {d.headline.length > 0 && (
            <Card className="mb-6">
              <ul className="space-y-1 text-sm">{d.headline.map((h) => <li key={h} className="font-medium">{h}</li>)}</ul>
            </Card>
          )}
          {/* These numbers are for the last 30 days and the 30 days before: a fixed window, stated here (KF-4). A range choice for this card arrives when the server can answer other windows (stage F3). */}
          <p className="mb-2 text-xs text-muted-foreground" data-testid="appointments-window">Last 30 days, compared with the 30 days before. Show rate needs at least 5 recorded outcomes before it is shown.</p>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Booked, last 30 days" value={fmtInt(d.last30.booked)} sub={`${fmtInt(d.prior30.booked)} the 30 days before`} />
            <Stat label="Show rate" value={pct(d.last30.showRate)} sub={`was ${pct(d.prior30.showRate)}`} tone={d.last30.showRate !== null && d.last30.showRate < 0.6 ? "bad" : undefined} />
            <Stat label="No-shows" value={fmtInt(d.last30.noShow)} sub={d.last30.noShowRate !== null ? `${pct(d.last30.noShowRate)} of held and missed` : "not enough outcomes yet"} tone={d.last30.noShow > 0 ? "warn" : undefined} />
            <Stat label="Coming up (7 days)" value={fmtInt(d.upcoming7)} sub={`${d.unconfirmedTotal} unconfirmed in 2 days`} />
            <Stat label="No outcome recorded" value={fmtInt(d.unmarkedTotal)} sub="past, still new or confirmed" tone={d.unmarkedTotal > 0 ? "warn" : undefined} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title={`Remind today (${d.unconfirmedTotal})`}>
              <Contacts rows={d.unconfirmed} empty="Everything in the next two days is confirmed." action="Call" />
              <p className="mt-2 text-xs text-muted-foreground">Booked but never confirmed, starting within two days. A reminder cuts no-shows.</p>
            </Card>
            <Card title={`No-shows to rebook (${d.recoverTotal})`} action={d.recoverTotal > 0 ? <Btn variant="ghost" onClick={() => go("calls")}>Call list</Btn> : undefined}>
              <Contacts rows={d.recover} empty="No recent no-shows are waiting to be rebooked." action="Call" />
              <p className="mt-2 text-xs text-muted-foreground">Missed in the last 14 days and not booked again.</p>
            </Card>
            <Card title={`Record the outcome (${d.unmarkedTotal})`}>
              <Contacts rows={d.unmarked} empty="Every past appointment has an outcome." action="Call" />
              <p className="mt-2 text-xs text-muted-foreground">Mark these as showed or no-show in the platform so the show rate is real.</p>
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BreakdownCard title="By calendar (30 days)" rows={d.byCalendar} />
            <BreakdownCard title="By person (30 days)" rows={d.byPerson} />
          </div>

          {d.canSeeAccounts && (
            <Card title="By client account (30 days)">
              <DataList rows={d.perAccount} rowKey={(a) => a.locationId} caption="Appointments by client account" columns={accountColumns(go)} />
              <p className="mt-2 text-xs text-muted-foreground">Show rate needs at least 5 recorded outcomes. Held and missed are the outcomes people recorded.</p>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

const accountColumns = (go: GoFn): Array<Column<Data["perAccount"][number]>> => [
  { key: "name", header: "Account", primary: true, width: "minmax(0,2fr)", cell: (a) => a.name ?? "Unnamed account" },
  { key: "booked", header: "Booked", width: "5rem", align: "right", cell: (a) => <span className="tabular-nums">{a.booked}</span> },
  { key: "held", header: "Showed", width: "5rem", align: "right", cell: (a) => <span className="tabular-nums">{a.held}</span> },
  { key: "noshow", header: "No-shows", width: "5.5rem", align: "right", cell: (a) => <span className="tabular-nums">{a.noShow}</span> },
  { key: "rate", header: "Show rate", width: "5.5rem", align: "right", cell: (a) => <span className="tabular-nums">{pct(a.showRate)}</span> },
  { key: "next", header: "Next 7 days", width: "6rem", align: "right", cell: (a) => <span className="tabular-nums">{a.upcoming7}</span> },
  { key: "none", header: "No outcome", width: "6rem", align: "right", cell: (a) => <span className="tabular-nums">{a.unmarked}</span> },
  { key: "open", header: "", width: "7rem", align: "right", cell: (a) => (a.access === "needs_permission" ? <Badge tone="warn">Needs approval</Badge> : <button type="button" className="min-h-9 text-xs underline" onClick={() => go("account", a.locationId)}>Open</button>) },
];

const breakdownColumns: Array<Column<Row>> = [
  { key: "label", header: "Name", primary: true, width: "minmax(0,2fr)", cell: (r) => r.label },
  { key: "booked", header: "Booked", width: "4.5rem", align: "right", cell: (r) => <span className="tabular-nums">{r.booked}</span> },
  { key: "held", header: "Held", width: "4rem", align: "right", cell: (r) => <span className="tabular-nums">{r.held}</span> },
  { key: "missed", header: "Missed", width: "4.5rem", align: "right", cell: (r) => <span className="tabular-nums">{r.noShow}</span> },
  { key: "rate", header: "Rate", width: "4rem", align: "right", cell: (r) => <span className="tabular-nums">{pct(r.showRate)}</span> },
];

function BreakdownCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in the last 30 days.</p> : <DataList rows={rows} rowKey={(r) => r.key} columns={breakdownColumns} caption={title} />}
    </Card>
  );
}
