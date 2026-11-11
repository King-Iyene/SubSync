"use client";

import { useState, type ReactNode } from "react";
import { useApiClient, useData } from "../../session";
import { EmptyState, SkeletonRows } from "../../ds";
import { Btn } from "../../ui";

// Clients > Health and risk (slice CB): the agency health score, the churn-risk estimate, which standard workflows each client has (with a previewed, opt-in copy into a client) and the new
// clients' checklist progress. Every estimate carries its formula one tap away; under the minimum data it says "not enough data". Nothing here messages anyone.
type Risk = { locationId: string; name: string; level: "high" | "watch" | "steady" | "not_enough_data"; points: number; drivers: string[]; historyDays: number; since: string | null; quieted: boolean };
type RiskData = {
  risks: Risk[]; formula: string; minHistoryDays: number; enough: number; total: number;
  health?: { score: number | null; message: string; formula: string; parts: Array<{ id: string; label: string; value: number | null; detail: string; enough: boolean }> }; healthFormula?: string;
};
type Missing = { id: string; label: string; source: { locationId: string; workflowId: string; name: string; from: string } | null };
type Wf = {
  permission: { canRead: boolean; canInstall: boolean; dryRun: boolean; readText: string | null; installText: string | null }; reason?: string; estimate?: string;
  clients: Array<{ locationId: string; name: string; known: boolean; have: string[]; missing: Missing[]; issues: number; status: "healthy" | "attention" | "not_read" }>;
};
type NewClients = { clients: Array<{ locationId: string; name: string; daysIn: number; completionPct: number; stuck: boolean; next: string[] }> };
const WORDS = { high: "High", watch: "Watch", steady: "Steady", not_enough_data: "Not enough data" } as const;

const hidden = (e: unknown) => /not switched on/i.test(String(e));
const Formula = ({ text }: { text: string }) => <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">How is this worked out?</summary><p className="mt-1 max-w-3xl leading-5">{text}</p></details>;
const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => <section className="space-y-2"><div><h2 className="text-base font-semibold">{title}</h2>{hint && <p className="text-sm text-muted-foreground">{hint}</p>}</div>{children}</section>;

export function HealthTab() {
  const risk = useData<RiskData>("clients/act/health");
  const wf = useData<Wf>("clients/act/workflows");
  const nc = useData<NewClients>("clients/act/new-clients");
  if ([risk, wf, nc].every((x) => hidden(x.error))) return <EmptyState title="Not switched on yet" body="Health, risk and new-client progress appear here once they are switched on for your account." />;
  return (
    <div className="space-y-8" data-testid="clients-health">
      {!hidden(risk.error) && <HealthAndRisk q={risk} />}
      {!hidden(wf.error) && <WorkflowCoverage q={wf} />}
      {!hidden(nc.error) && <NewClientsStrip q={nc} />}
    </div>
  );
}

function HealthAndRisk({ q }: { q: ReturnType<typeof useData<RiskData>> }) {
  if (q.loading && !q.data) return <SkeletonRows rows={3} label="Loading health..." />;
  if (!q.data) return null;
  const { health, risks } = q.data;
  const shown = risks.filter((r) => r.level !== "steady");
  return (
    <>
      <Section title="Overall health" hint="One number for how your whole book is doing, shown only when there is enough data behind it.">
        {health?.score != null
          ? <p className="text-3xl font-semibold" data-testid="overall-score">{health.score}<span className="text-base font-normal text-muted-foreground"> out of 100 (estimate)</span></p>
          : <p className="text-sm">Not enough data yet.</p>}
        {health && <p className="text-sm text-muted-foreground">{health.message}</p>}
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{health?.parts.map((p) => <li key={p.id}><span className="font-medium">{p.label}:</span> {p.enough && p.value !== null ? `${Math.round(p.value)}%` : "not enough data"} <span className="text-xs text-muted-foreground">{p.detail}</span></li>)}</ul>
        {health && <Formula text={health.formula} />}
      </Section>
      <Section title="Clients who may be slipping" hint={`Estimated from SubSync's own daily record. ${q.data.enough} of ${q.data.total} clients have the ${q.data.minHistoryDays} days of record it needs.`}>
        {shown.length === 0 ? <p className="text-sm text-muted-foreground">{q.data.enough === 0 ? "Not enough data yet. SubSync needs about a month of its own record for each client." : "No client looks like they are slipping."}</p> : (
          <ul className="divide-y rounded-md border">{shown.map((r) => (
            <li key={r.locationId} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{r.name}</span><span>{WORDS[r.level]}{r.quieted ? " (quieted)" : ""}</span></div>
              {r.level === "not_enough_data" ? <p className="text-xs text-muted-foreground">Record so far: {r.historyDays} days{r.since ? `, since ${r.since}` : ""}.</p> : <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{r.drivers.map((d) => <li key={d}>{d}</li>)}</ul>}
            </li>))}</ul>
        )}
        <Formula text={q.data.formula} />
      </Section>
    </>
  );
}

function WorkflowCoverage({ q }: { q: ReturnType<typeof useData<Wf>> }) {
  const api = useApiClient();
  const [plan, setPlan] = useState<{ target: string; targetName: string; m: Missing; count: number; problem: string | null; token: string | null; dryRun: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (q.loading && !q.data) return <SkeletonRows rows={3} label="Loading workflows..." />;
  if (!q.data) return null;
  const d = q.data;
  const body = (c: { target: string }, m: Missing) => ({ kind: "clone", items: [{ locationId: m.source?.locationId, workflowId: m.source?.workflowId }], targetLocationId: c.target });
  const preview = async (c: Wf["clients"][number], m: Missing) => {
    setMsg(null);
    try { const r = await api.post<{ count: number; problem: string | null; token: string | null; dryRun: boolean }>("workflows/preview", body({ target: c.locationId }, m)); setPlan({ target: c.locationId, targetName: c.name, m, ...r }); }
    catch (e) { setMsg(e instanceof Error ? e.message : "That did not work."); }
  };
  const confirm = async () => {
    if (!plan) return;
    try {
      const r = await api.post<{ results?: Array<{ outcome: string; message: string }> }>("workflows/confirm", { ...body(plan, plan.m), token: plan.token });
      setMsg(r.results?.map((x) => x.message).join(" ") ?? "Done."); setPlan(null); q.reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : "That did not work."); }
  };
  return (
    <Section title="Standard workflows per client" hint="Whether each client has the four basics published: missed-call text back, new lead follow up, appointment reminders and no-show follow up.">
      {d.permission.readText ? <p className="rounded-md border px-3 py-2 text-sm" data-testid="wf-permission">{d.permission.readText}</p> : (
        <>
          {d.permission.installText && <p className="text-xs text-muted-foreground">{d.permission.installText}</p>}
          <ul className="divide-y rounded-md border">{d.clients.map((c) => (
            <li key={c.locationId} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{c.name}</span><span>{c.status === "healthy" ? "All four in place" : c.status === "not_read" ? "Not read yet" : `${c.missing.length} missing${c.issues ? `, ${c.issues} to check` : ""}`}</span></div>
              {c.missing.map((m) => (
                <div key={m.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>No published {m.label.toLowerCase()}.{m.source ? ` Found "${m.source.name}" in ${m.source.from}.` : " No client has one to copy."}</span>
                  {m.source && d.permission.canInstall && <Btn onClick={() => preview(c, m)}>Preview a copy</Btn>}
                </div>))}
            </li>))}</ul>
        </>
      )}
      {plan && (
        <div className="rounded-md border p-3 text-sm" role="dialog" aria-label="Copy a workflow">
          <p>{plan.problem ?? `Copy "${plan.m.source?.name}" into ${plan.targetName}. ${plan.dryRun ? "Practice run: nothing is sent to your CRM yet because live changes are switched off." : "This creates a copy in your CRM."} It is not published automatically.`}</p>
          <div className="mt-2 flex gap-2">{plan.token && plan.count > 0 && <Btn variant="primary" onClick={confirm}>{plan.dryRun ? "Run the practice copy" : "Copy it"}</Btn>}<Btn onClick={() => setPlan(null)}>Cancel</Btn></div>
        </div>
      )}
      <div aria-live="polite" className="text-sm">{msg}</div>
      {d.estimate && <Formula text={d.estimate} />}
    </Section>
  );
}

function NewClientsStrip({ q }: { q: ReturnType<typeof useData<NewClients>> }) {
  if (q.loading && !q.data) return <SkeletonRows rows={2} label="Loading new clients..." />;
  if (!q.data) return null;
  return (
    <Section title="New clients" hint="Added in the last 45 days, with how far their setup checklist is. The full checklist is on the Onboarding tab.">
      {q.data.clients.length === 0 ? <p className="text-sm text-muted-foreground">No new clients in the last 45 days.</p> : (
        <ul className="divide-y rounded-md border">{q.data.clients.map((c) => (
          <li key={c.locationId} className="px-4 py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{c.name}</span><span>{c.completionPct}% done, day {c.daysIn}{c.stuck ? ", stuck" : ""}</span></div>
            <div className="mt-1 h-1.5 rounded bg-muted" role="progressbar" aria-valuenow={c.completionPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} setup progress`}><div className="h-1.5 rounded bg-primary" style={{ width: `${c.completionPct}%` }} /></div>
            {c.next.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Next: {c.next.join("; ")}</p>}
          </li>))}</ul>
      )}
    </Section>
  );
}
