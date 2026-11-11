"use client";

import { useEffect, useState } from "react";
import { Formula, money, num } from "./audit-parts";
import { EmptyState, InlineAlert, Section } from "../ds";
import { Btn, Card } from "../ui";
import { useApiClient } from "../session";
import { shortDay, type CountKey, type History, type ThenNowLine } from "@/lib/analytics/au-history";

// The history part of the Account audit (docs/features/AUDIT_BRIEF.md): what changed since the last audit, then and now against the baseline taken when a client
// account was first read, the clients added lately, and the monthly message settings. Counts only. The "now" number on every line opens exactly the rows it counted.
// The estimate is shown as a range, only with enough closed deals on both sides, and never added to counted money.

const WORD: Record<ThenNowLine["tone"], string> = { better: "Better", worse: "Worse", same: "Same", unknown: "Not checked" };

function Trend({ series }: { series: History["series"] }) {
  if (series.length < 3) return null;
  const w = 220, h = 36;
  const max = Math.max(...series.map((s) => s.things)), min = Math.min(...series.map((s) => s.things)), span = Math.max(1, max - min);
  const pts = series.map((s, i) => `${((i / (series.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 4 - ((s.things - min) / span) * (h - 8)).toFixed(1)}`).join(" ");
  const first = series[0], last = series[series.length - 1];
  return (
    <figure className="mt-4" data-testid="audit-trend">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Things to fix by day: ${num(first.things)} on ${shortDay(first.day)}, ${num(last.things)} on ${shortDay(last.day)}`} className="h-9 w-56 text-primary">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="mt-1 text-xs text-muted-foreground">Things to fix, by day audited ({num(first.things)} on {shortDay(first.day)}, {num(last.things)} on {shortDay(last.day)}). History starts {shortDay(first.day)}.</figcaption>
    </figure>
  );
}

/** The sentence at the top of the audit: what changed since the audit before this one. */
export function SinceLine({ history }: { history: History | null }) {
  if (!history || !history.since) return null;
  return <p className="mt-3 max-w-3xl text-sm leading-6" data-testid="audit-since">{history.since}</p>;
}

export function ThenNow({ history, onOpen, openable, sample }: { history: History; onOpen: (key: CountKey) => void; openable: ReadonlySet<CountKey>; sample: boolean }) {
  const c = history.thenNow;
  return (
    <Section title="Then and now" hint={history.startsOn ? `Compared with the baseline taken when each client account was first audited. History starts ${shortDay(history.startsOn)}.` : "Compared with the baseline taken when each client account was first audited."} id="audit-history">
      <div data-testid="audit-then-now" data-state={history.state}>
        {sample && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" role="status">Sample data</p>}
        {!c ? (
          <EmptyState compact title={history.state === "recording" ? "The baseline is recorded" : history.state === "rules_changed" ? "Not compared" : "Baseline taken"} body={history.why ?? "Nothing to compare yet."} />
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              {num(c.accounts)} client {c.accounts === 1 ? "account" : "accounts"}, baseline {c.thenDay ? shortDay(c.thenDay) : ""} against {c.nowDay ? shortDay(c.nowDay) : "today"}.
              {history.waiting > 0 && ` ${num(history.waiting)} ${history.waiting === 1 ? "account is" : "accounts are"} left out until its first audit is recorded.`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm">
                <caption className="sr-only">Things to fix at the baseline and now</caption>
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">What</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Then</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Now</th>
                    <th scope="col" className="py-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((l) => (
                    <tr key={l.key} className="border-b last:border-0" data-testid={`audit-then-${l.key}`}>
                      <th scope="row" className="py-2 pr-3 text-left font-normal">{l.label}</th>
                      <td className="tnum py-2 pr-3 text-right">{l.then === null ? "Not checked" : num(l.then)}</td>
                      <td className="tnum py-2 pr-3 text-right">
                        {l.now === null ? "Not checked" : !openable.has(l.key) || sample ? num(l.now) : (
                          <button type="button" className="min-h-8 font-medium text-primary underline underline-offset-4 max-sm:min-h-11" onClick={() => onOpen(l.key)} aria-label={`Show the ${num(l.now)} ${l.noun}`}>{num(l.now)}</button>
                        )}
                      </td>
                      <td className="tnum py-2 text-right">{l.change === null ? "" : `${l.change > 0 ? "+" : ""}${num(l.change)} `}<span className="text-xs text-muted-foreground">{WORD[l.tone]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {c.staleDollars && (
              <p className="mt-3 text-sm" data-testid="audit-then-stale">
                Counted from your CRM: deals that have gone quiet were <span className="tnum font-medium">{money(c.staleDollars.then)}</span> then and are <span className="tnum font-medium">{money(c.staleDollars.now)}</span> now.
              </p>
            )}
            <p className="mt-2 text-sm" data-testid="audit-then-estimate">
              {c.estimate
                ? <>Estimate, not a fact: the monthly leak was about {money(c.estimate.thenLow)} to {money(c.estimate.thenHigh)} then and about {money(c.estimate.nowLow)} to {money(c.estimate.nowHigh)} now ({num(c.estimate.accounts)} {c.estimate.accounts === 1 ? "account has" : "accounts have"} enough closed deals to price).</>
                : <>Estimate: not enough data. It needs at least 20 closed deals in a client account, on both days.</>}
            </p>
            <Formula label="How this is counted" sr="then and now">Each client account is compared with its own first audit, only when both were counted under the same rules and neither was cut short by the reading limit, and only when at least 7 days apart. Each person or deal is counted once. Anything that could not be checked is left out, never counted as zero. The estimate is the same formula as the one at the top (people waiting plus no-shows, times the average deal times the win rate) and is never added to counted money.</Formula>
          </>
        )}
        <Trend series={history.series} />
      </div>
    </Section>
  );
}

export function NewAccounts({ history, onAudit, sample }: { history: History; onAudit: (id: string) => void; sample: boolean }) {
  if (history.newAccounts.length === 0) return null;
  return (
    <Section title="Added lately" hint="Each new client account is audited when it is first read. The first audit is its baseline." id="audit-new">
      <ul className="@container divide-y border-y" data-testid="audit-new-accounts">
        {history.newAccounts.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span><span className="font-medium">{n.name}</span> <span className="text-muted-foreground">· baseline {shortDay(n.baselineDay)}{n.things === null ? ", not fully counted" : `, ${num(n.things)} ${n.things === 1 ? "thing" : "things"} to fix`}</span></span>
            <Btn variant="ghost" onClick={() => onAudit(n.id)} disabled={sample}>Audit this account</Btn>
          </li>
        ))}
      </ul>
    </Section>
  );
}

type Prefs = { monthly: boolean; accounts: Array<{ id: string; name: string; muted: boolean }> };

export function MonthlyCard({ sample }: { sample: boolean }) {
  const api = useApiClient();
  const [p, setP] = useState<Prefs | null>(sample ? { monthly: true, accounts: [{ id: "s1", name: "Sample Dental", muted: false }, { id: "s2", name: "Sample Roofing", muted: true }] } : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { if (sample) return; api.get<Prefs>("audit/prefs").then(setP).catch(() => setError("Could not load the monthly message settings.")); }, [api, sample]);
  const send = async (body: Record<string, unknown>) => {
    if (sample) return;
    setBusy(true); setError(null);
    try { setP(await api.post<Prefs>("audit/prefs", body)); } catch { setError("Could not save that. Try again."); } finally { setBusy(false); }
  };
  if (error && !p) return <InlineAlert tone="danger" className="mb-4">{error}</InlineAlert>;
  if (!p) return null;
  const shown = p.accounts.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  return (
    <Card title="Monthly audit message" className="mt-4 print:hidden">
      <div data-testid="audit-monthly">
        {sample && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" role="status">Sample data</p>}
        <p className="text-sm text-muted-foreground">Once a month, in the first week, SubSync sends your company&apos;s summary address one message: what got better, what got worse, and one link. It reads nothing new and sends nothing to anyone else.</p>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input type="checkbox" checked={p.monthly} disabled={busy} onChange={(e) => { void send({ monthly: e.target.checked }); }} data-testid="audit-monthly-toggle" />
          Send the monthly message
        </label>
        {p.accounts.length > 1 && p.monthly && (
          <details className="mt-2 text-sm">
            <summary className="min-h-8 cursor-pointer text-primary underline-offset-4 hover:underline max-sm:min-h-11">Leave out a client account ({num(p.accounts.filter((a) => a.muted).length)} left out)</summary>
            <input type="search" aria-label="Search client accounts" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm sm:h-9 sm:w-64" />
            <ul className="mt-2 divide-y border-y">
              {shown.length === 0 && <li className="py-2 text-muted-foreground">No client matches.</li>}
              {shown.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{a.name}</span>
                  <Btn variant="ghost" onClick={() => { void send({ location: a.id, muted: !a.muted }); }} disabled={busy}>{a.muted ? "Include again" : "Leave out"}</Btn>
                </li>
              ))}
            </ul>
          </details>
        )}
        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      </div>
    </Card>
  );
}
