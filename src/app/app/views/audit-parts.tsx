"use client";

import { ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { ACTION_BUTTON } from "../ds/queue";
import { InlineAlert, Section } from "../ds";
import { Btn } from "../ui";
import { EASE_LABEL, type Finding, type FindingKey, type Verdict } from "@/lib/analytics/audit-v2";
import type { ClientPage, ProgressLine, Reading } from "@/lib/analytics/audit-clients";

// The pieces of the rebuilt Account audit screen (docs/AUDIT_REVIEW.md). One sentence about the money, one calm primary action, the findings as short rows
// with ONE button each, then the good news and the progress. No tinted boxes or dot badges (KF-1); every estimate is called an estimate where it is shown, and its
// formula is one tap away.

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const num = (n: number) => n.toLocaleString("en-US");

/** The dollar amounts of a sentence in the accent colour, the rest as plain words. */
export function Dollars({ text }: { text: string }) {
  return <>{text.split(/(\$[\d,]+)/).map((p, i) => (/^\$[\d,]+$/.test(p) ? <span key={i} className="tnum text-primary">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export const LIST_TITLE: Record<FindingKey, string> = {
  replies: "People waiting for a reply", stale: "Deals that have gone quiet", noshows: "No-shows not rebooked", appointments: "Past appointments with no outcome", leftovers: "Old or test deals still open",
};

/** The verb of the one thing to do, as a button: "Reply to the 23 people". */
export function startLabel(f: Finding): string {
  const n = num(f.count);
  const w = f.count === 1 ? f.noun.one : f.noun.many;
  switch (f.key) {
    case "replies": return `Reply to the ${n} ${w}`;
    case "stale": return `Review the ${n} ${w}`;
    case "noshows": return `Call the ${n} ${w}`;
    case "appointments": return `Mark the ${n} ${w}`;
    case "leftovers": return `Close out the ${n} ${w}`;
  }
}
export const showLabel = (f: Finding) => `Show ${num(f.count)} ${f.count === 1 ? f.noun.one : f.noun.many}`;

export function dollarsText(f: Finding): string | null {
  if (f.dollars === null) return null;
  if (f.dollarKind === "estimate") return `About ${money(f.dollars)} a month (estimate${f.range ? `, most likely ${money(f.range.low)} to ${money(f.range.high)}` : ""})`;
  return `${money(f.dollars)} (counted from your CRM)`;
}

export function Formula({ children, label = "How this is worked out", sr }: { children: ReactNode; label?: string; /** What the formula is about, for a screen reader (five of them share one visible label). */ sr?: string }) {
  return (
    <details className="group mt-1 text-xs text-muted-foreground" data-testid="audit-formula">
      <summary className="inline-flex min-h-8 cursor-pointer select-none items-center text-primary underline-offset-4 hover:underline max-sm:min-h-11">{label}{sr && <span className="sr-only"> for {sr}</span>}</summary>
      <p className="mt-1 max-w-3xl leading-5">{children}</p>
    </details>
  );
}

export function VerdictBlock({ v, grade, accountsLine, start, onStart, extra, staleDays }: {
  v: Verdict; staleDays: number; grade: string | null; accountsLine: string | null; start: Finding | null; onStart: () => void; extra?: ReactNode;
}) {
  return (
    <section className="mb-8" aria-label="What the audit found" data-testid="audit-verdict" data-kind={v.kind}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid="audit-verdict-kind">{v.kind === "leak" ? "Estimate" : v.kind === "count" ? "Counted" : "All clear"}</p>
      <h2 className="max-w-4xl text-[clamp(1.6rem,3.3vw,2.6rem)] font-semibold leading-[1.1] tracking-tight" data-testid="audit-headline">
        {v.kind === "clear" && <CircleCheck aria-hidden className="mr-3 inline-block size-[0.8em] -translate-y-[0.05em] text-success" />}
        <Dollars text={v.text} />
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="audit-sub">{v.sub}</p>
      {v.kind !== "clear" && <Formula>{v.formula}</Formula>}
      {v.sitting !== null && v.sitting > 0 && (
        <p className="mt-3 max-w-3xl text-sm leading-6" data-testid="audit-sitting">
          Counted separately: <span className="tnum font-medium">{money(v.sitting)}</span> sits in open deals nobody has touched for {staleDays} days or more. It is not part of the estimate.
          {v.outlier && <span data-testid="audit-outlier"> One deal ({money(v.outlier.value)}) is {Math.round(v.outlier.share * 100)}% of it, so check that it is a real deal before relying on the number.</span>}
        </p>
      )}
      {grade && <p className="mt-2 text-sm text-muted-foreground" data-testid="audit-grade">{grade}</p>}
      {accountsLine && <p className="mt-2 text-sm text-muted-foreground" data-testid="audit-accounts-line">{accountsLine}</p>}
      {start && (
        <div className="mt-5 flex flex-wrap items-center gap-3 print:hidden" data-testid="audit-primary">
          <Btn variant="primary" onClick={onStart} testId="audit-start"><span className="max-sm:py-2">{startLabel(start)}</span></Btn>
        </div>
      )}
      {extra}
    </section>
  );
}

export function FindingRow({ f, n, onShow }: { f: Finding; n: number; onShow: () => void }) {
  const d = dollarsText(f);
  return (
    <li className="ds-row grid gap-x-6 gap-y-2 py-4 @3xl:grid-cols-[minmax(0,1fr)_12rem]" data-testid="audit-finding" data-key={f.key} data-count={f.count}>
      <div className="min-w-0">
        <p className="font-medium leading-6"><span aria-hidden className="tnum mr-2 text-muted-foreground">{n}.</span><Dollars text={f.title} /></p>
        <p className="mt-0.5 max-w-3xl text-sm leading-5 text-muted-foreground">{f.what}</p>
        {f.aside && <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{f.aside}</p>}
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
          {d && <span className="tnum font-medium" data-testid="audit-finding-money">{d}</span>}
          <span className="text-muted-foreground">{EASE_LABEL[f.ease]}</span>
        </p>
        <p className="mt-1 text-sm"><span className="font-medium">How to fix it:</span> {f.fix}</p>
        <Formula label="How this is counted" sr={f.title}>{f.formula}</Formula>
      </div>
      <div className="flex items-start @3xl:justify-end print:hidden">
        <button type="button" onClick={onShow} className={ACTION_BUTTON} data-testid="audit-show">{showLabel(f)}<span className="sr-only">, the list of {LIST_TITLE[f.key].toLowerCase()}</span></button>
      </div>
    </li>
  );
}

export function GoodNews({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Section title="What is healthy" hint="Measured on enough cases to be worth saying.">
      <ul className="space-y-2 text-sm" data-testid="audit-healthy">
        {lines.map((l) => <li key={l} className="flex items-start gap-2"><CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /><span>{l}</span></li>)}
      </ul>
    </Section>
  );
}

const verdictWord: Record<ProgressLine["verdict"], string> = { better: "Better", worse: "Worse", same: "About the same", not_enough: "Not enough data yet" };
export function ProgressBlock({ lines }: { lines: ProgressLine[] }) {
  return (
    <Section title="Progress" hint="Compared with SubSync's own earlier readings, never a guess.">
      <dl className="divide-y border-y text-sm" data-testid="audit-progress">
        {lines.map((l) => (
          <div key={l.key} className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[17rem_minmax(0,1fr)]" data-verdict={l.verdict}>
            <dt className="font-medium">{l.label}</dt>
            <dd className={l.verdict === "not_enough" ? "text-muted-foreground" : ""}><span className="font-medium">{verdictWord[l.verdict]}.</span> <span className="text-muted-foreground">{l.text}</span></dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function ReadingStrip({ r }: { r: Reading }) {
  if (!r.reading) return null;
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  return (
    <InlineAlert tone="info" className="mb-6" >
      <div data-testid="audit-reading">
        <p>{r.text}</p>
        <div role="progressbar" aria-label="Accounts read" aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.done} className="mt-2 h-1 w-full max-w-sm overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
      </div>
    </InlineAlert>
  );
}

const SORTS: Array<{ v: string; l: string }> = [{ v: "money", l: "Most money at risk" }, { v: "things", l: "Most things to fix" }, { v: "name", l: "Name" }];
const field = "min-h-11 rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-9";

export function ClientRowView({ r, onOpen }: { r: ClientPage["rows"][number]; onOpen: () => void }) {
  const bits = [
    r.replies > 0 ? `${num(r.replies)} waiting for a reply` : null, r.stale > 0 ? `${num(r.stale)} quiet ${r.stale === 1 ? "deal" : "deals"}` : null,
    r.noshows > 0 ? `${num(r.noshows)} ${r.noshows === 1 ? "no-show" : "no-shows"}` : null, r.appointments > 0 ? `${num(r.appointments)} to mark` : null,
  ].filter(Boolean).join(", ");
  return (
    <li className="ds-row grid items-center gap-x-6 gap-y-2 py-3 @3xl:grid-cols-[minmax(0,1fr)_12rem]" data-testid="audit-client" data-id={r.id}>
      <div className="min-w-0">
        <p className="truncate font-medium">{r.name}</p>
        <p className="text-sm text-muted-foreground">{bits}</p>
        <p className="tnum text-sm">
          {r.staleDollars > 0 && <span>{money(r.staleDollars)} counted</span>}
          {r.staleDollars > 0 && r.estimate !== null && <span className="text-muted-foreground"> · </span>}
          {r.estimate !== null && <span>about {money(r.estimate)} a month (estimate)</span>}
        </p>
      </div>
      <div className="flex @3xl:justify-end print:hidden"><button type="button" onClick={onOpen} className={ACTION_BUTTON} data-testid="audit-client-open">Audit this client<span className="sr-only">: {r.name}</span></button></div>
    </li>
  );
}

export function Pager({ page, onPage, label }: { page: ClientPage; onPage: (p: number) => void; label: string }) {
  if (page.pages <= 1) return null;
  const btn = "inline-flex size-11 items-center justify-center rounded-lg border bg-card hover:border-primary/40 disabled:opacity-40 sm:size-9";
  return (
    <nav aria-label={label} className="mt-3 flex items-center justify-between text-sm print:hidden" data-testid="audit-pager">
      <span className="tnum text-muted-foreground">{num(page.from)} to {num(page.to)} of {num(page.total)}</span>
      <span className="flex gap-2">
        <button type="button" aria-label="Previous page" disabled={page.page <= 0} onClick={() => onPage(page.page - 1)} className={btn}><ChevronLeft aria-hidden className="size-4" /></button>
        <button type="button" aria-label="Next page" disabled={page.page >= page.pages - 1} onClick={() => onPage(page.page + 1)} className={btn}><ChevronRight aria-hidden className="size-4" /></button>
      </span>
    </nav>
  );
}

export const clientControls = { SORTS, field };
