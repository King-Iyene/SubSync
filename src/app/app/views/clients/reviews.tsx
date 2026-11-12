"use client";

import { useState } from "react";
import { changeBetween, MIN_BASE as MIN_SHOW } from "@/lib/design/range";
import { printAccent, printCss } from "@/lib/design/print";
import { daysBetween, reviewText, shiftDays } from "@/lib/analytics/client-success";
import type { Finding, QuarterFacts } from "@/lib/analytics/client-success";
import { useData } from "../../session";
import { EmptyState, HowTo, LineChart, Section, SkeletonCards } from "../../ds";
import { Btn, ErrorBox, inputClass, Stat, Table, Td, Th } from "../../ui";
import { BrandLogo } from "../../brand-logo";
import type { ClientRow, DayPoint } from "./types";

// A quarterly business review (N60): what a client sees at renewal. Pick a client and a quarter; the review sets it against the quarter before, shows the
// trends on labelled axes, says what went well and what did not, lists what SubSync caught, ends with next steps, and prints or saves as a PDF with the
// agency's own name and colour. Built only from numbers SubSync holds. Where its record does not reach back it says so instead of drawing an empty chart.
type Qbr = {
  brand: { name: string | null; color: string | null; logoUrl?: string | null }; client: ClientRow; openAlerts: number; generatedAt: string;
  quarter: { key: string; label: string; from: string; to: string; complete: boolean; days: number; total: number }; previous: { key: string; label: string; from: string; to: string };
  quarters: Array<{ key: string; label: string }>;
  facts: QuarterFacts; previousFacts: QuarterFacts; findings: { wins: Finding[]; issues: Finding[]; steps: Finding[] };
  proof: { total: number; resolved: number; groups: Array<{ kind: string; label: string; raised: number; resolved: number; example: string }> };
  historyStartsOn: string | null; series: { current: DayPoint[]; previous: DayPoint[] };
  health: { start: number | null; end: number | null; n: number };
  reply: { hitRate: number | null; leads: number; targetMinutes: number; windowDays: number } | null;
};
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const moneyShort = (n: number) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`);
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ReviewsTab({ accounts }: { accounts: Array<{ locationId: string; name: string }> }) {
  const [id, setId] = useState("");
  const [quarter, setQuarter] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const { data, error, loading, reload } = useData<Qbr>(id ? `qbr/${id}${quarter ? `?quarter=${quarter}` : ""}` : null);
  const c = data?.client;
  const accent = data ? printAccent(data.brand.color) : null;
  const prevData = data && data.previousFacts.contactsAdded + data.previousFacts.healthDays > 0;

  const trend = (pick: (d: DayPoint) => number | null) => {
    if (!data) return [];
    const shift = daysBetween(data.previous.from, data.quarter.from);
    return [
      { label: data.quarter.key.replace("-", " "), points: data.series.current.map((d) => ({ day: d.day, value: pick(d) })), tone: 1 as const },
      { label: `${data.previous.key.replace("-", " ")}, on the same dates`, points: shiftDays(data.series.previous, shift).map((d) => ({ day: d.day, value: pick(d) })), tone: "muted" as const, dashed: true },
    ];
  };
  const note = data?.historyStartsOn ? `SubSync has kept a daily record of ${c?.name ?? "this client"} since ${longDate(data.historyStartsOn)}; earlier days are empty.` : "SubSync has no daily record of this client yet.";
  const f = data?.facts;
  const p = data?.previousFacts;
  const rate = f && f.apptWithOutcome >= MIN_SHOW ? Math.round((f.apptShowed / f.apptWithOutcome) * 100) : null;
  const cmp = (cur: number, prevN: number | undefined, unit = "") => (prevData && prevN !== undefined ? `${changeBetween(cur, prevN, unit).text} (${data?.previous.key.replace("-", " ")})` : `No record of ${data?.previous.key.replace("-", " ")} to compare with`);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium" htmlFor="qbr-client">Client</label>
          <select id="qbr-client" className={inputClass} value={id} onChange={(e) => { setId(e.target.value); setQuarter(""); }}><option value="">Choose...</option>{accounts.map((x) => <option key={x.locationId} value={x.locationId}>{x.name}</option>)}</select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="qbr-quarter">Quarter</label>
          <select id="qbr-quarter" className={`${inputClass} w-60`} value={data?.quarter.key ?? ""} disabled={!data} onChange={(e) => setQuarter(e.target.value)}>
            {!data && <option value="">Current quarter</option>}
            {data?.quarters.map((q, i) => <option key={q.key} value={q.key}>{q.label}{i === 0 ? ", this one" : ""}</option>)}
          </select>
        </div>
        <Btn variant="primary" disabled={!c} onClick={() => window.print()}>Print or save as PDF</Btn>
        <Btn disabled={!data} onClick={() => { if (!data) return; navigator.clipboard.writeText(reviewText({ client: data.client.name ?? "Client", quarter: data.quarter.label, wins: data.findings.wins, issues: data.findings.issues, steps: data.findings.steps, proof: data.proof, brand: data.brand.name })).then(() => setCopied("Copied. Paste it into an email."), () => setCopied("Your browser did not allow copying. Use Print instead.")); }}>Copy as text</Btn>
        {copied && <span className="text-sm text-muted-foreground" role="status">{copied}</span>}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {id && loading && !data && <SkeletonCards cards={4} label="Preparing the review..." />}
      {!id && <>
        <HowTo id="clients-reviews" title="What a review is for">A quarterly review is the one-page report you show a client at renewal to prove what you delivered. Choose a client and a quarter: you get the numbers against the quarter before, what went well, what did not, what SubSync caught for them, and what to do next. Press Print to save it as a PDF with your name and colour on it.</HowTo>
        <EmptyState title="Choose a client" body="The review is built from what SubSync has recorded about that client. A quarter that began before SubSync started watching will be partly empty, and says so." />
      </>}
      {c && data && f && p && (
        <article className="qbr-print space-y-6 border-t pt-5 print:border-0 print:pt-0" data-testid="qbr">
          <style dangerouslySetInnerHTML={{ __html: printCss(data.brand.color, ".qbr-print") }} />
          <header className="border-b-4 pb-3" style={{ borderColor: accent ?? "var(--primary)" }} data-testid="qbr-header">
            {data.brand.logoUrl && <BrandLogo url={data.brand.logoUrl} name={data.brand.name} height={40} className="mb-2" fallback={null} />}
            {data.brand.name && <p className="mb-2 text-lg font-semibold" style={{ color: accent ?? undefined }}>{data.brand.name}</p>}
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Quarterly business review</p>
            <h2 className="text-2xl font-semibold tracking-tight">{c.name ?? "Client"}</h2>
            <p className="text-sm text-muted-foreground">{data.quarter.label} · prepared {new Date(data.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
            {!data.quarter.complete && <p className="mt-1 text-xs text-muted-foreground" data-testid="qbr-running">This quarter is still running: {data.quarter.days} of {data.quarter.total} days so far, so every figure is for the days that have passed.</p>}
          </header>

          <p className="text-base leading-7">{c.activity}</p>

          <Section title="The quarter at a glance" hint={`Each figure is set against ${data.previous.label}.`}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Health score" value={data.health.n >= 14 && data.health.end !== null ? data.health.end : <span className="text-base font-semibold">Not enough history</span>}
                sub={data.health.n >= 14 && data.health.start !== null ? `${data.health.start} at the start of the quarter, out of 100` : `${data.health.n} day${data.health.n === 1 ? "" : "s"} of record in this quarter; a trend needs 14`} />
              <Stat label="New contacts" value={f.contactsAdded} sub={cmp(f.contactsAdded, p.contactsAdded, "contacts")} />
              <Stat label="Deals won" value={f.wonCount} sub={`${money(f.wonValue)} in value`} />
              <Stat label="New deals started" value={money(f.pipelineCreated)} sub={c.profile.monthlyFee ? `${Math.round((f.pipelineCreated / (c.profile.monthlyFee * 3)) * 10) / 10}x what the client paid for the quarter` : "Add the monthly fee on the Details tab to see this against what they pay"} />
              <Stat label="Appointments attended" value={rate === null ? <span className="text-base font-semibold">Too few to rate</span> : `${rate}%`} sub={rate === null ? `${f.apptWithOutcome} with a recorded outcome; a rate needs ${MIN_SHOW}` : `${f.apptShowed} of ${f.apptWithOutcome} with a recorded outcome`} />
              <Stat label="First replies in time" value={data.reply && data.reply.hitRate !== null && data.reply.leads >= MIN_SHOW ? `${Math.round(data.reply.hitRate * 100)}%` : <span className="text-base font-semibold">Too few to rate</span>} sub={data.reply ? `New leads, last ${data.reply.windowDays} days, target ${data.reply.targetMinutes} minutes. SubSync keeps 8 weeks of this, so it covers the end of the quarter only.` : "Not available"} />
              <Stat label="Problems SubSync flagged" value={data.proof.total} sub={`${data.proof.resolved} cleared`} />
              <Stat label="Waiting past the reply target" value={c.unanswered} tone={c.unanswered > 0 ? "warn" : undefined} sub="customer messages, right now" />
            </div>
          </Section>

          <Section title="How the quarter moved" hint={`Solid line: ${data.quarter.key.replace("-", " ")}. Dashed grey line: ${data.previous.key.replace("-", " ")}, drawn on the same dates.`}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <LineChart hideFlat title="Health score" series={trend((d) => d.healthScore)} ceiling={100} axisLabel="0 to 100" min={3} />
              <LineChart hideFlat title="Open pipeline" series={trend((d) => d.openValue)} format={moneyShort} axisLabel="deals with a value and an owner" />
              <LineChart hideFlat title="New contacts" series={trend((d) => d.newContacts30d)} axisLabel="added in the 30 days before each day" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{note}</p>
          </Section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Section title="What went well" className="mb-0"><ul className="list-disc space-y-1.5 pl-5 text-sm" data-testid="qbr-wins">{data.findings.wins.map((w) => <li key={w.text}>{w.text}</li>)}</ul></Section>
            <Section title="What needs attention" className="mb-0">{data.findings.issues.length === 0 ? <p className="text-sm text-muted-foreground">Nothing stands out as a problem right now.</p> : <ul className="list-disc space-y-1.5 pl-5 text-sm" data-testid="qbr-issues">{data.findings.issues.map((w) => <li key={w.text}>{w.text}</li>)}</ul>}</Section>
          </div>

          <Section title="What SubSync caught" hint="Problems SubSync noticed in this client's account during the quarter, and how many have cleared since (fixed, dismissed or no longer showing; SubSync does not yet record which).">
            {data.proof.total === 0 ? <p className="text-sm text-muted-foreground" data-testid="qbr-proof-empty">SubSync did not flag any problem in this quarter. {data.historyStartsOn && data.historyStartsOn > data.quarter.from ? `It only started watching on ${longDate(data.historyStartsOn)}.` : ""}</p> : (
              <>
                <p className="mb-3 text-sm" data-testid="qbr-proof">{data.proof.total} problem{data.proof.total === 1 ? "" : "s"} flagged, {data.proof.resolved} cleared{data.proof.total - data.proof.resolved > 0 ? `, ${data.proof.total - data.proof.resolved} still open` : ""}.</p>
                <Table head={<tr><Th>What it was about</Th><Th className="text-right">Flagged</Th><Th className="text-right">Sorted out</Th><Th>Example</Th></tr>}>
                  {data.proof.groups.map((g) => <tr key={g.kind}><Td className="font-medium">{g.label}</Td><Td className="text-right tabular-nums">{g.raised}</Td><Td className="text-right tabular-nums">{g.resolved}</Td><Td className="text-muted-foreground">{g.example}</Td></tr>)}
                </Table>
              </>
            )}
          </Section>

          <Section title="Suggested next steps"><ol className="list-decimal space-y-1.5 pl-5 text-sm" data-testid="qbr-steps">{data.findings.steps.map((s) => <li key={s.text}>{s.text}</li>)}</ol></Section>
        </article>
      )}
    </div>
  );
}
