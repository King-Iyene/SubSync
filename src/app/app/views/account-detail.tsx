"use client";

import { useState } from "react";
import type { GoFn } from "../nav";
import { useApiClient, useData } from "../session";
import type { AccountDetail } from "../types";
import {
  Badge, BandBadge, Btn, Card, ChurnBadge, daysLabel, ErrorBox, ExtLink, fmtInt, fmtMoney, fmtPct, inputClass, Loading, PageHeader,
  severityTone, Sparkline, Stat, Table, Td, Th,
} from "../ui";

export function AccountDetailView({ locationId, go, agency }: { locationId: string; go: GoFn; agency: string }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<AccountDetail>(`accounts/${locationId}`);
  const [owner, setOwner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { account: a, breakdown, trend, staleDeals, checklist, domains, alerts } = data;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (done) setMsg(done);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div>
      <div className="mb-4 print:hidden">
        <Btn variant="ghost" onClick={() => go("accounts")}>← All accounts</Btn>
      </div>

      {/* Printed reports start with a clear header. */}
      <div className="mb-6 hidden print:block">
        <p className="text-sm text-muted-foreground">{agency} · Client performance report · {today}</p>
      </div>

      <PageHeader
        title={a.name ?? "Unnamed account"}
        subtitle={a.churn.reasons.length ? a.churn.reasons.join(". ") + "." : "No risk signals right now."}
        actions={
          <>
            <ExtLink href={a.url}>Open in platform</ExtLink>
            <Btn onClick={() => window.print()}>Print / save as PDF</Btn>
          </>
        }
      />
      {msg && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm print:hidden" role="status">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BandBadge band={a.band} />
        <ChurnBadge level={a.churn.level} />
        {a.dormant && <Badge tone="bad">Dormant · {daysLabel(a.daysInactive)}</Badge>}
        {a.ignored && <Badge>Ignored</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Engagement score" value={a.score} sub="of 100" />
        <Stat label="Contacts" value={fmtInt(a.contacts)} sub={`+${a.new30d} in 30 days`} />
        <Stat label="Data completeness" value={`${a.completenessPct}%`} sub={`email ${a.emailPct}% · phone ${a.phonePct}% · tags ${a.tagPct}%`} />
        <Stat label="Open pipeline" value={fmtMoney(a.openValue)} sub={`${a.openOpps} deals · win rate ${fmtPct(a.winRate)}`} />
        <Stat label="Stale deals" value={a.staleOpps} tone={a.staleOpps > 0 ? "warn" : undefined} sub={fmtMoney(a.revenueAtRisk) + " at risk"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="How the score is built">
          <ul className="space-y-3">
            {breakdown.components.map((c) => (
              <li key={c.key}>
                <div className="flex justify-between text-sm"><span className="font-medium">{c.label}</span><span className="tabular-nums text-muted-foreground">{c.points} / {c.max}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${(c.points / c.max) * 100}%` }} /></div>
                <p className="mt-1 text-xs text-muted-foreground">{c.why}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">The total is simply the five rows added up. There are no hidden caps or adjustments.</p>
        </Card>

        <Card title="Trend (last 60 days)">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="mb-1 text-xs text-muted-foreground">Engagement score</p><Sparkline label="Engagement score" values={trend.map((t) => t.engagementScore)} /></div>
            <div><p className="mb-1 text-xs text-muted-foreground">Open pipeline value</p><Sparkline label="Open pipeline value" values={trend.map((t) => t.openValue)} /></div>
            <div><p className="mb-1 text-xs text-muted-foreground">Contacts</p><Sparkline label="Contacts" values={trend.map((t) => t.contacts)} /></div>
            <div><p className="mb-1 text-xs text-muted-foreground">Data completeness</p><Sparkline label="Data completeness" values={trend.map((t) => t.completenessPct)} /></div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={`Onboarding checklist · ${checklist.completionPct}% done`}>
          <ul className="space-y-2">
            {checklist.items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-sm">
                {i.auto ? (
                  <span aria-hidden className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${i.status === "done" ? "bg-emerald-500 text-white" : i.status === "unknown" ? "bg-muted text-muted-foreground" : "border"}`}>{i.status === "done" ? "✓" : i.status === "unknown" ? "?" : ""}</span>
                ) : (
                  <input type="checkbox" className="mt-0.5 size-4 print:hidden" checked={i.status === "done"} disabled={busy} aria-label={i.label}
                    onChange={(e) => act(() => api.put(`accounts/${locationId}/tasks`, { task: i.key, done: e.target.checked }))} />
                )}
                <span className={i.status === "done" ? "text-muted-foreground line-through" : ""}>
                  {i.label}
                  {i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Items marked ? cannot be checked automatically. Tick the manual ones as you complete them.</p>
        </Card>

        <div className="space-y-4">
          <Card title="Email authentication">
            {domains.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sending domain checked yet. Use Email health to check this account&apos;s domain.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {domains.map((d) => (
                  <li key={d.domain} className="flex items-center justify-between gap-2">
                    <span>{d.domain}</span>
                    <Badge tone={d.status === "ok" ? "good" : d.status === "warning" ? "warn" : "bad"}>{d.status === "ok" ? "Passing" : d.status === "warning" ? "Needs attention" : "Broken"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Open alerts">
            {alerts.length === 0 ? <p className="text-sm text-muted-foreground">No open alerts.</p> : (
              <ul className="space-y-2 text-sm">{alerts.map((x) => <li key={x.id} className="flex items-start gap-2"><Badge tone={severityTone(x.severity)}>{x.severity}</Badge><span>{x.title}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title={`Stale deals (no movement in ${data.settings.staleDays}+ days)`}>
          {staleDeals.length === 0 ? <p className="text-sm text-muted-foreground">No stale deals.</p> : (
            <Table head={<tr><Th>Deal</Th><Th>Stage</Th><Th className="text-right">Value</Th><Th className="text-right">Days stale</Th></tr>}>
              {staleDeals.map((d) => (
                <tr key={d.opportunityId}>
                  <Td>{d.name ?? "Untitled deal"}<div className="text-xs text-muted-foreground">{d.contactName}</div></Td>
                  <Td>{d.stageName ?? "n/a"}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(d.value)}</Td>
                  <Td className="text-right tabular-nums">{d.daysStale}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4 print:hidden">
        <Card title="Account controls">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="owner" className="mb-1 block text-sm font-medium">Account owner</label>
              <div className="flex gap-2">
                <input id="owner" className={inputClass} placeholder="Who looks after this client?" value={owner ?? a.owner ?? ""} maxLength={60} onChange={(e) => setOwner(e.target.value)} />
                <Btn disabled={busy || owner === null} onClick={() => act(() => api.put(`accounts/${locationId}/flags`, { owner: (owner ?? "").trim() || null }), "Owner saved.")}>Save</Btn>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Ignore this account</p>
              <p className="mb-2 text-xs text-muted-foreground">Use for snapshot templates and test accounts. Ignored accounts are left out of totals, alerts and reports.</p>
              <Btn disabled={busy} onClick={() => act(() => api.put(`accounts/${locationId}/flags`, { ignored: !a.ignored }), a.ignored ? "Account is counted again." : "Account ignored.")}>{a.ignored ? "Stop ignoring" : "Ignore account"}</Btn>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
