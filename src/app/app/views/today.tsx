"use client";

import type { GoFn } from "../nav";
import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Loading, PageHeader, Stat, type Tone } from "../ui";

type Change = { today: number; yesterday: number | null; avg7: number | null; vsYesterday: number | null; vsAvg: number | null; unusual: "up" | "down" | null; samples: number };
type Data = {
  connection: { ok: boolean; message: string | null };
  freshness: { hours: number | null; ok: boolean; label: string; pending: number };
  headlines: Array<{ key: string; label: string; money: boolean; change: Change }>;
  attention: Array<{ locationId: string; name: string; severity: "critical" | "warning" | "info"; url: string; items: Array<{ kind: string; title: string; detail: string }> }>;
  fine: Array<{ locationId: string; name: string; checked: string[]; learning: boolean }>;
  accounts: number;
  notWatched: Array<{ what: string; why: string }>;
  schedule: { hour: number; timezone: string | null; slack: boolean };
  limited: boolean;
};

type AuditData = { audit: { headline: string; estimatedDollars: number | null; staleDollars: number; findings: Array<{ key: string; severity: string; title: string; detail: string; dollars: number | null; kind: string; view: string; fix: string }> } };

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
  if (loading && !data) return <Loading label="Working out what needs you today..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.schedule;
  const when = `${String(s.hour).padStart(2, "0")}:00${s.timezone ? ` (${s.timezone})` : " in your first client's time zone"}`;
  const noun = data.limited ? "your account" : "your client accounts";

  return (
    <div>
      <PageHeader
        title="Today"
        subtitle={`What changed, and what to do first. Every account is compared with its own last week, so a quiet account is not flagged just for being quiet.`}
        actions={<><Badge tone={data.freshness.ok ? "good" : "warn"}>{data.freshness.label}</Badge><Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn></>}
      />

      {!data.connection.ok && <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{data.connection.message}</p>}
      {data.freshness.pending > 0 && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">A sync is still running, so some numbers may change in a few minutes.</p>}

      <DoFirst go={go} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      <div className="grid gap-4 lg:grid-cols-2">
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
