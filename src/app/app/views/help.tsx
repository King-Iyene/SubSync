"use client";

import { COMPANY } from "@/lib/company";
import { GUIDE_TITLES, type GuideRole, type Step } from "@/lib/getting-started";
import { removalAnswer } from "@/lib/data-inventory";
import { SETTINGS_SECTION_KEY } from "@/lib/settings-sections";
import { CRM_WRITE_SUMMARY } from "@/lib/meeting-wording";
import type { GoFn, ViewId } from "../nav";
import { remember, remembered } from "../ds/remember";
import { useData } from "../session";
import { Badge, Btn, Card, ErrorBox, Loading, PageHeader } from "../ui";
import { StepArt } from "./step-art";

type StartStep = Step;
type Start = { kind: "agency" | "business" | "client"; role: GuideRole; steps: StartStep[]; doneCount: number; total: number };

const WORDS: Array<[string, string]> = [
  ["Health score", "0 to 100, from five parts: recent activity, new contacts, pipeline health, reply speed and data quality. Each part shows why it scored as it did."],
  ["Gone quiet", "No real activity in the account for longer than your quiet-account setting (30 days by default)."],
  ["Stale deal", "An open deal with no movement for longer than your stale setting (30 days by default)."],
  ["Waiting past reply target", "A customer message that is still unanswered after your reply target (4 hours by default)."],
  ["Unusual", "Outside that account's own normal range over the last week, not a fixed number for everyone."],
  ["Expected revenue", "Open deal value multiplied by that account's own win rate. Shown only once an account has at least 5 closed deals."],
];

const FAQ: Array<[string, string]> = [
  ["Does SubSync change anything in my accounts?", `${CRM_WRITE_SUMMARY} Anything else that changes your data, such as Data cleanup, only happens after a preview and a typed confirmation, and can be undone. SubSync never deletes contacts or deals on its own.`],
  ["Who can open it?", "The people who manage your company see every client account. A client account that installs SubSync for itself sees only its own account. A client's staff see a read-only view of their own account only if your company switches it on."],
  ["Why is a number empty or zero?", "That account has not finished syncing yet, or it genuinely has no data. The sync step above shows progress."],
  ["Why does Today say \"still learning\"?", "Changes are judged against an account's own last week, so a new account needs a few days of history first."],
  ["How do I hide a test account?", "Open Settings, Team and access, and switch on Test and practice accounts for it. It stops counting in totals, alerts and lists, and you can switch it back."],
  ["How do I remove SubSync and my data?", removalAnswer()],
  ["Who do I contact?", `${COMPANY.supportEmail}. We reply within ${COMPANY.supportReply}. You can also use Give feedback or Report a problem at the bottom of any page.`],
];

// A step ticks from a fact the server read. For a client's staff the company counter says nothing about them, so the pages they opened in this browser tick their steps.
const doneNow = (s: StartStep): boolean => s.done || (s.id !== "feedback" && (s.ticksOn ?? []).some((v) => remembered(`seen-${v}`) === "1"));

export function HelpView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Start>("start");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const ticked = data.steps.map((s) => doneNow(s));
  const done = ticked.filter(Boolean).length;
  const pct = Math.round((done / Math.max(1, data.total)) * 100);
  const titles = GUIDE_TITLES[data.role] ?? GUIDE_TITLES.account_admin;
  const next = data.steps.findIndex((s, i) => !ticked[i] && s.view && !s.optional);

  const open = (s: StartStep) => {
    if (s.section) remember(SETTINGS_SECTION_KEY, s.section);
    go(s.view as ViewId);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={titles.title} subtitle={titles.subtitle} actions={<Badge tone={pct === 100 ? "good" : "info"}>{done} of {data.total} done</Badge>} />
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      {next >= 0 && <p className="mb-4 text-sm text-muted-foreground" data-testid="next-step">Next: <strong className="font-medium text-foreground">{data.steps[next].title}</strong></p>}

      <ol className="divide-y border-y" data-testid="guide-steps">
        {data.steps.map((s, i) => (
          <li key={s.id} className="flex gap-4 py-4" data-step={s.id} data-done={ticked[i] ? "true" : "false"}>
            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${ticked[i] ? "bg-success text-white" : "border"}`} aria-label={ticked[i] ? "Done" : `Step ${i + 1}`}>{ticked[i] ? "✓" : i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.title}{s.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.body}</p>
              {s.detail && <p className="mt-1 text-sm font-medium">{s.detail}</p>}
              {s.view && s.cta && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {!ticked[i] ? <Btn variant={i === next ? "primary" : "secondary"} onClick={() => open(s)}>Do it now</Btn> : <button type="button" className="text-xs text-muted-foreground underline underline-offset-4" onClick={() => open(s)}>{s.cta}</button>}
                  {!ticked[i] && <span className="text-xs text-muted-foreground">{s.cta}</span>}
                </div>
              )}
            </div>
            <StepArt art={s.art} />
          </li>
        ))}
      </ol>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
