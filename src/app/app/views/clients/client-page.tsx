"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { USER_ENTERED_LABEL } from "@/lib/analytics/clients-v2";
import { useData } from "../../session";
import type { GoFn } from "../../nav";
import { ErrorState, ActionRow, SkeletonRows, type MenuItem } from "../../ds";
import { ACTION_BUTTON } from "../../ds/queue";
import { fmtMoney } from "../../ui";
import { ClientTrends } from "./trends";
import { ClientLog } from "./details";
import { copyText, HealthWord, InlineEditor, type Field } from "./book-rows";
import type { BookOne } from "./types";

// One client's page (docs/CLIENTS_REVIEW.md): why it looks the way it does and what to say, what changed in the last month, what it pays against what it got, the renewal, the private log
// of conversations, and its trends. Fee, renewal date and industry are typed here or in the row (KF-7). "What to say" is text to read out or paste; nothing on this page sends anything or
// writes to the CRM. A summary to copy or print leaves out the fee and the team's private notes.

const QUIET = "ds-press inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9";
const H2 = "mb-2 text-lg font-semibold tracking-tight";

export function ClientPage({ id, onBack, onOpen, go, embedded = false }: { id: string; onBack: () => void; onOpen: (id: string) => void; go: GoFn; embedded?: boolean }) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Field | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [trends, setTrends] = useState(false);
  const { data, error, reload } = useData<BookOne>(`clients?part=one&id=${id}&v=${version}`);
  const changed = () => setVersion((v) => v + 1);
  const said = (m: string) => { setNote(m); setTimeout(() => setNote(null), 3500); };

  if (error) return <div data-testid="client-page"><button type="button" onClick={onBack} className={QUIET}><ChevronLeft aria-hidden className="size-4" />All clients</button><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div data-testid="client-page"><SkeletonRows rows={6} label="Opening the client..." /></div>;
  const d = data;
  const r = d.row;
  const needs = r.needs !== null;
  const menu: MenuItem[] = [
    { key: "summary", label: "Copy a summary", onSelect: async () => said((await copyText(d.summary)) ? "Summary copied to your clipboard." : "Copy it from the box.") },
    ...(d.talk.length ? [{ key: "talk", label: "Copy what to say", onSelect: async () => said((await copyText(d.talk.map((t) => `${t.reason}\n${t.say}`).join("\n\n"))) ? "What to say copied to your clipboard." : "Copy it from the box.") }] : []),
    { key: "print", label: "Print the summary", onSelect: () => window.print() },
  ];
  const field = (key: Field, label: string, value: React.ReactNode, empty: string, set: boolean) => (
    <div className="min-w-0" data-testid={`field-${key}`}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        <button type="button" onClick={() => setEditing(key)} className={`ds-press min-h-11 rounded-md text-left font-medium hover:underline sm:min-h-9 ${set ? "" : "text-primary underline underline-offset-4"}`} data-testid={`edit-${key}`}>{set ? <>{value}<span className="ml-2 text-sm font-normal text-primary underline underline-offset-4">Change</span></> : empty}</button>
      </dd>
    </div>
  );

  return (
    <div data-testid="client-page" className="ds-enter">
      <div className="print:hidden">
        <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${embedded ? "hidden" : ""}`}>
          <button type="button" onClick={onBack} className={`${QUIET} -ml-2.5`} data-testid="client-back"><ChevronLeft aria-hidden className="size-4" />All clients</button>
          {d.queue.position !== null && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="client-queue">
              <button type="button" disabled={!d.queue.previous} onClick={() => d.queue.previous && onOpen(d.queue.previous)} className={`${QUIET} disabled:opacity-40`} aria-label="Previous client who needs you"><ChevronLeft aria-hidden className="size-4" /></button>
              <span className="tabular-nums">{d.queue.position} of {d.queue.total} who need you</span>
              <button type="button" disabled={!d.queue.next} onClick={() => d.queue.next && onOpen(d.queue.next)} className={`${QUIET} disabled:opacity-40`} aria-label="Next client who needs you" data-testid="client-next"><ChevronRight aria-hidden className="size-4" /></button>
            </span>
          )}
        </div>

        <header className={`mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${embedded ? "hidden" : ""}`}>
          <div className="min-w-0">
            <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight" data-testid="client-name">{r.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm"><HealthWord r={r} inNeeds={needs} /><span className="text-muted-foreground" data-testid="client-summary-line">{r.line}</span></p>
            {r.context.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{r.context.join(" ")}</p>}
          </div>
          <div className="flex items-center gap-2">
            <a href={r.url} target="_blank" rel="noopener noreferrer" className={`${ACTION_BUTTON} !w-auto px-3`} data-testid="client-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({r.name}, opens in a new tab)</span></a>
            <ActionRow items={menu} testId="client-page-more" />
          </div>
        </header>
        {note && <p className="mb-4 text-sm text-muted-foreground" role="status" data-testid="client-note">{note}</p>}

        <section className="mb-9" aria-label="What to say" data-testid="what-to-say">
          <h2 className={H2}>{needs ? "Why it needs you, and what to say" : "How it looks"}</h2>
          {d.talk.length === 0 ? <p className="border-y py-4 text-sm text-muted-foreground">Nothing needs attention. When something does, the reason and what to say about it appear here.</p> : (
            <ul className="divide-y border-y" data-testid="talk-list">
              {d.talk.map((t) => {
                const rest = t.say.startsWith(t.reason) ? t.say.slice(t.reason.length).trim() : t.say;
                return (
                  <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-3" data-testid="talk-item" data-key={t.key}>
                    <div className="min-w-0">
                      <p className="font-medium">{t.reason}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground"><span className="font-medium text-foreground">Say: </span>{rest}</p>
                    </div>
                    <button type="button" className={QUIET} onClick={async () => said((await copyText(t.say)) ? "Copied to your clipboard." : "Copy it from the box.")} aria-label={`Copy what to say about: ${t.reason}`}>Copy</button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Text to read out or paste. Nothing here is sent to anyone.</p>
        </section>

        <section className="mb-9" aria-label="What changed" data-testid="what-changed">
          <h2 className={H2}>What changed in the last month</h2>
          {d.changed.lines.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm">{d.changed.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="text-sm text-muted-foreground">{d.changed.note}</p>}
          {d.historyStartsOn && d.changed.enough && <p className="mt-2 text-xs text-muted-foreground">SubSync has watched this client since {new Date(`${d.historyStartsOn}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.</p>}
        </section>

        <section className="mb-9" aria-label="Fee, renewal and value" data-testid="fee-value">
          <h2 className={H2}>What this client pays you, and what it got</h2>
          <dl className="grid gap-x-8 gap-y-3 border-y py-4 sm:grid-cols-3">
            {field("fee", "Fee", <>{fmtMoney(r.fee ?? 0)} a month</>, "Add fee", r.fee !== null)}
            {field("renewal", "Renewal", r.renewal ? <>{r.renewal.words} ({r.renewal.dateText})</> : null, "Add renewal date", r.renewal !== null)}
            {field("industry", "Industry", r.industry, "Choose industry", Boolean(r.industry))}
          </dl>
          {editing && <div className="mt-2"><InlineEditor key={editing} r={r} field={editing} choices={d.industryChoices} onDone={() => setEditing(null)} onChanged={changed} /></div>}
          {!editing && <p className="mt-2 text-xs text-muted-foreground">{USER_ENTERED_LABEL}</p>}
          {r.industry && <p className="mt-1 text-xs text-muted-foreground">{d.playbook}</p>}
          <p className="mt-4" data-testid="value-sentence"><span className="font-medium">Value created. </span>{d.value.sentence}{d.value.kind === "ok" && d.value.multiple !== null && <span className="text-muted-foreground"> (an estimate)</span>}</p>
          <details className="mt-1 text-sm"><summary className="ds-press min-h-9 cursor-pointer list-none px-1 font-medium text-primary underline underline-offset-4" data-testid="value-formula-toggle">How this is worked out</summary><p className="max-w-2xl pt-1 text-muted-foreground" data-testid="value-formula">{d.valueFormula}</p></details>
          {d.reminders.length > 0 && (
            <div className="mt-4" data-testid="reminders">
              <p className="font-medium">Start the renewal conversation</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{d.reminders.map((x) => <li key={x.before}>{x.words}</li>)}</ul>
              <p className="mt-1 text-xs text-muted-foreground">These are dates for you to put in your calendar. SubSync does not send a reminder.</p>
            </div>
          )}
        </section>

        <section className="mb-9" aria-label="Conversations" data-testid="conversations">
          <h2 className={H2}>Conversations and notes</h2>
          <ClientLog locationId={r.id} name={r.name} reload={changed} />
        </section>

        <section className="mb-4 border-t pt-4" aria-label="More detail">
          <button type="button" onClick={() => setTrends(!trends)} aria-expanded={trends} data-testid="client-trends-toggle" className="ds-press inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Trends and reply history<ChevronDown aria-hidden className={`size-4 transition-transform ${trends ? "rotate-180" : ""}`} />
          </button>
          {trends && <div className="mt-3"><ClientTrends locationId={r.id} name={r.name} /></div>}
          <p className="mt-3 text-xs text-muted-foreground"><button type="button" className="font-medium text-primary underline" onClick={() => go("onboarding")}>Open the onboarding checklist</button></p>
        </section>
      </div>

      <div className="hidden whitespace-pre-wrap text-sm print:block" data-testid="client-print">{d.summary}</div>
    </div>
  );
}
