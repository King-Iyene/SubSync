"use client";

import type { GoFn, ViewId } from "../nav";
import { useData } from "../session";
import { Badge, Btn, Card, ErrorBox, Loading, PageHeader } from "../ui";

type Step = { id: string; title: string; body: string; done: boolean; detail: string | null; view: ViewId | null; cta: string | null; optional?: boolean };
type Start = { kind: "agency" | "business" | "client"; steps: Step[]; doneCount: number; total: number };

const WORDS: Array<[string, string]> = [
  ["Engagement score", "0 to 100, from five parts: recent activity, new contacts, pipeline health, reply speed and data quality. Each part shows why it scored as it did."],
  ["Dormant", "No real activity in the account for longer than your dormant setting (30 days by default)."],
  ["Stale deal", "An open deal with no movement for longer than your stale setting (30 days by default)."],
  ["Waiting past reply target", "A customer message that is still unanswered after your reply target (4 hours by default)."],
  ["Unusual", "Outside that account's own normal range over the last week, not a fixed number for everyone."],
  ["Expected revenue", "Open deal value multiplied by that account's own win rate. Shown only once an account has at least 5 closed deals."],
];

const FAQ: Array<[string, string]> = [
  ["Does SubSync change anything in my accounts?", "Almost never. It mostly reads data. The one thing it adds on its own is a note on a contact when a meeting summary arrives from a tool you connected (you can switch this off in Settings). Anything else that changes your data, such as Data cleanup, only happens after a preview and a typed confirmation, and can be undone. SubSync never deletes contacts or deals on its own."],
  ["Who can open it?", "Agency users see every client account. A client account that installs SubSync for itself sees only its own account. A client's staff see a read-only view of their own account only if their agency switches it on."],
  ["Why is a number empty or zero?", "That account has not finished syncing yet, or it genuinely has no data. Step 2 above shows sync progress."],
  ["Why does Today say \"still learning\"?", "Changes are judged against an account's own last week, so a new account needs a few days of history first."],
  ["How do I hide a test account?", "Open the account and choose Ignore. It stops counting in totals and alerts."],
  ["How do I remove SubSync and my data?", "Settings has a Delete my data button. Uninstalling the app also removes everything we stored."],
  ["Who do I contact?", "code@kdsquares.com. We reply within one business day."],
];

export function HelpView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Start>("start");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const pct = Math.round((data.doneCount / Math.max(1, data.total)) * 100);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Getting started"
        subtitle={data.kind === "agency" ? "A short checklist that ticks itself off as you go." : "A short checklist for your account that ticks itself off as you go."}
        actions={<Badge tone={pct === 100 ? "good" : "info"}>{data.doneCount} of {data.total} done</Badge>}
      />
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ol className="space-y-3">
        {data.steps.map((s, i) => (
          <li key={s.id} className={`flex gap-4 rounded-xl border p-4 ${s.done ? "bg-muted/30" : ""}`}>
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${s.done ? "bg-emerald-100 text-emerald-800" : "bg-muted"}`} aria-label={s.done ? "Done" : `Step ${i + 1}`}>{s.done ? "✓" : i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.title}{s.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.body}</p>
              {s.detail && <p className="mt-1 text-sm font-medium">{s.detail}</p>}
              {!s.done && s.view && s.cta && <div className="mt-3"><Btn onClick={() => go(s.view as ViewId)}>{s.cta}</Btn></div>}
              {s.done && s.view && s.cta && <div className="mt-2"><button type="button" className="text-xs text-muted-foreground underline" onClick={() => go(s.view as ViewId)}>{s.cta}</button></div>}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title="What the words mean">
          <dl className="space-y-3 text-sm">
            {WORDS.map(([term, text]) => (
              <div key={term}>
                <dt className="font-medium">{term}</dt>
                <dd className="mt-0.5 leading-6 text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Common questions">
          <dl className="space-y-3 text-sm">
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <dt className="font-medium">{q}</dt>
                <dd className="mt-0.5 leading-6 text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
