"use client";

import type { GoFn } from "../nav";
import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Loading, PageHeader, Stat, type Tone } from "../ui";

type Change = { today: number; yesterday: number | null; avg7: number | null; vsYesterday: number | null; vsAvg: number | null; unusual: "up" | "down" | null; samples: number };
type Data = {
  connection: { ok: boolean; message: string | null };
  headlines: Array<{ key: string; label: string; money: boolean; change: Change }>;
  attention: Array<{ locationId: string; name: string; severity: "critical" | "warning" | "info"; url: string; items: Array<{ kind: string; title: string; detail: string }> }>;
  fine: Array<{ locationId: string; name: string; checked: string[]; learning: boolean }>;
  accounts: number;
  notWatched: Array<{ what: string; why: string }>;
  schedule: { hour: number; timezone: string | null; slack: boolean };
  limited: boolean;
};

type AuditData = { audit: { headline: string; estimatedDollars: number | null; staleDollars: number; findings: Array<{ key: string; severity: string; title: string; detail: string; dollars: number | null; kind: string; view: string; fix: string }> } };

// The front door: three plain sentences that answer "what needs me right now", leads first because a lead goes cold in minutes.
// Each number is the same one its own page shows (Speed to lead, Appointments, and the attention list below).
function FrontDoor({ go, attention, limited }: { go: GoFn; attention: number | null; limited: boolean }) {
  const speed = useData<{ overall: { stillWaiting: number }; neverAnswered?: number; access: { ok: number; total: number } }>("speed");
  const appts = useData<{ unmarkedTotal?: number }>("appointments");
  const waiting = speed.data ? Math.max(0, speed.data.overall.stillWaiting - (speed.data.neverAnswered ?? 0)) : null;
  const never = speed.data?.neverAnswered ?? 0;
  const unmarked = appts.data?.unmarkedTotal ?? null;
  const leadLine = speed.loading && !speed.data ? "Checking for leads waiting for a reply..."
    : waiting === null ? "Leads waiting for a reply could not be loaded."
    : waiting === 0 && never === 0 ? "No leads are waiting for a reply right now."
    : `${waiting} ${waiting === 1 ? "lead is" : "leads are"} waiting for a reply${never > 0 ? `, and ${never} ${never === 1 ? "was" : "were"} never answered` : ""}.`;
  const urgent = (waiting ?? 0) > 0;
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]" aria-label="What needs you right now" data-testid="front-door">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What needs you right now</p>
      <h2 className={`mt-1 text-xl font-semibold ${urgent ? "text-red-700 dark:text-red-400" : ""}`} data-testid="leads-headline">{leadLine}</h2>
      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>{unmarked === null ? "Checking appointments..." : unmarked === 0 ? "Every past appointment has an outcome recorded." : `${unmarked} past ${unmarked === 1 ? "appointment has" : "appointments have"} no outcome recorded, so the show rate is a guess.`}</span>
          <Btn variant="ghost" onClick={() => go("appointments")}>Fix appointments</Btn>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>{attention === null ? "Checking your accounts..." : attention === 0 ? (limited ? "Your account is within its normal range." : "No client account needs you today.") : `${attention} ${limited ? (attention === 1 ? "thing needs" : "things need") : attention === 1 ? "client account needs" : "client accounts need"} attention today.`}</span>
          {(attention ?? 0) > 0 && <a href="#needs-attention" className="text-sm font-medium text-primary underline-offset-2 hover:underline">See which</a>}
        </li>
      </ul>
      {urgent && <div className="mt-3"><Btn variant="primary" onClick={() => go("speed")}>Open Speed to lead</Btn></div>}
    </section>
  );
}

// One deal worth at least half of the open pipeline is called out, so the dollar figures are not read as a normal spread.
function OutlierNote() {
  const { data } = useData<{ kpis: { outlier: { value: number; share: number; of: number } | null } }>("overview");
  const o = data?.kpis.outlier;
  if (!o) return null;
  return <p className="mb-6 text-xs text-amber-700 dark:text-amber-400">One deal ({fmtMoney(o.value)}) is {Math.round(o.share * 100)}% of the open pipeline of {fmtInt(o.of)} deals, so the dollar figures move with it. Amounts are as entered in each account.</p>;
}

// The one thing to do first, taken from the account audit, with the money it is costing when that can be stated honestly.
function DoFirst({ go }: { go: GoFn }) {
  const { data } = useData<AuditData>("audit");
  const f = data?.audit.findings.find((x) => x.severity !== "info" && x.key !== "permission") ?? null;
  if (!f) return null;
  return (
    <section className="mb-6 rounded-2xl border border-primary/40 bg-primary/5 p-5" aria-label="Do this first">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Do this first</p>
      <h2 className="mt-1 text-lg font-semibold">{f.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>
      {f.dollars !== null && <p className="mt-2 text-sm"><strong>{fmtMoney(f.dollars)}</strong> <span className="text-muted-foreground">{f.kind === "estimate" ? "estimated at risk" : "counted at risk"}</span></p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Btn onClick={() => go(f.view as never)}>{f.fix}</Btn>
        <Btn variant="ghost" onClick={() => go("audit" as never)}>See the full audit</Btn>
      </div>
    </section>
  );
}

const tone = (s: string): Tone => (s === "critical" ? "bad" : s === "warning" ? "warn" : "info");
const signed = (n: number | null) => (n === null ? "no earlier day" : `${n > 0 ? "+" : ""}${n}%`);
// For these, up is bad (more stale deals, more unread); for the others, up is good.
const UP_IS_BAD = new Set(["stale", "unread"]);

export function TodayView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("daily");
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try { await api.post("sync"); await reload(); } finally { setSyncing(false); }
  };
  // The leads line does not wait for the slower daily read: it appears as soon as its own number arrives.
  if (loading && !data) return (
    <div>
      <PageHeader title="Today" subtitle="What needs you right now, then what changed." />
      <FrontDoor go={go} attention={null} limited={false} />
      <Loading label="Working out what needs you today..." />
    </div>
  );
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.schedule;
  const when = `${String(s.hour).padStart(2, "0")}:00${s.timezone ? ` (${s.timezone})` : " in your first client's time zone"}`;
  const noun = data.limited ? "your account" : "your client accounts";

  return (
    <div>
      <PageHeader
        title="Today"
        subtitle="What needs you right now, then what changed."
        actions={<Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn>}
      />

      {!data.connection.ok && <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{data.connection.message}</p>}

      <FrontDoor go={go} attention={data.attention.length} limited={data.limited} />
      <DoFirst go={go} />

      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.headlines.map((h) => {
          const c = h.change;
          const bad = c.unusual !== null && (c.unusual === "up") === UP_IS_BAD.has(h.key);
          return (
            <Stat key={h.key} label={h.label} value={h.money ? fmtMoney(c.today) : fmtInt(c.today)}
              tone={c.unusual ? (bad ? "bad" : "good") : undefined}
              sub={<>
                {signed(c.vsYesterday)} vs yesterday
                {c.avg7 !== null && <><br />{signed(c.vsAvg)} vs the last 7 days</>}
                {c.unusual && <><br /><strong>Unusual: {c.unusual === "up" ? "higher" : "lower"} than normal</strong></>}
              </>} />
          );
        })}
      </div>

      <OutlierNote />

      <div id="needs-attention" />
      <Card title={data.attention.length ? `Needs attention today (${data.attention.length})` : "Needs attention today"} className="mb-6">
        {data.attention.length === 0 ? (
          <Empty title="Nothing needs you today" body={`${noun[0].toUpperCase() + noun.slice(1)} ${data.limited ? "is" : "are"} all within ${data.limited ? "its" : "their"} own normal range. Replies, deals, new leads and setup were all checked.`} />
        ) : (
          <ul className="divide-y">
            {data.attention.map((a, i) => (
              <li key={a.locationId} className="py-4 first:pt-0 last:pb-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="font-medium">{a.name}</span>
                  <Badge tone={tone(a.severity)}>{a.severity === "critical" ? "Do first" : a.severity === "warning" ? "Soon" : "When you can"}</Badge>
                </div>
                <ul className="space-y-2 pl-6">
                  {a.items.map((it) => (
                    <li key={it.kind} className="text-sm"><span className="font-medium">{it.title}.</span> <span className="text-muted-foreground">{it.detail}</span></li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-3 pl-6">
                  <Btn onClick={() => go(data.limited ? "overview" : "account", a.locationId)}>Open the account in SubSync</Btn>
                  <ExtLink href={a.url}>Open in the platform</ExtLink>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mb-6"><Btn variant="ghost" onClick={() => go("alerts")}>See every open alert and dismiss resolved ones</Btn></div>

      {data.fine.length > 0 && (
        <Card title={`Fine today (${data.fine.length})`} className="mb-6">
          <ul className="divide-y text-sm">
            {data.fine.map((f) => (
              <li key={f.locationId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{f.name}</span>
                <span className="text-muted-foreground">
                  {f.learning ? "Nothing wrong, but still learning what is normal here (less than a week of history)" : "Nothing unusual compared with its last week"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Checked for each: {data.fine[0].checked.join(", ")}.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="When this is sent">
          {data.limited ? (
            <p className="text-sm text-muted-foreground">Your daily brief is shown here each time you open SubSync.</p>
          ) : s.slack ? (
            <p className="text-sm">Sent to Slack every day at <strong>{when}</strong>. Change the time in Settings.</p>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Not scheduled yet. Add a Slack webhook in Settings and switch on the daily brief, and this arrives every morning at the time you choose, in your time zone.</p>
              <Btn onClick={() => go("settings")}>Set it up</Btn>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Email delivery needs an email service connected to the app. It is not switched on yet.</p>
        </Card>
        <Card title="Not watched yet">
          <ul className="space-y-1 text-sm">
            {data.notWatched.map((n) => <li key={n.what}><span className="font-medium">{n.what}</span> <span className="text-muted-foreground">: {n.why}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">We list these so you never assume something is being watched when it is not.</p>
        </Card>
      </div>
    </div>
  );
}
