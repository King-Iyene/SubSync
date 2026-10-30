"use client";

import type { GoFn, ViewId } from "../nav";
import { Btn, Card, PageHeader } from "../ui";

const STEPS: Array<{ title: string; body: string; go?: ViewId; cta?: string }> = [
  {
    title: "Wait for the first sync",
    body: "SubSync reads your client accounts in the background. The first sync usually takes a few minutes, longer for agencies with many contacts. The Overview shows progress, and numbers fill in as it finishes.",
    go: "overview", cta: "Open Overview",
  },
  {
    title: "Start on the Overview",
    body: "Every client account at a glance. \"Needs attention\" lists the accounts most worth a call today, with the reasons. Click an account to see the detail.",
    go: "overview", cta: "Open Overview",
  },
  {
    title: "Find any contact in any account",
    body: "Search by name, email or phone across every client account at once. Each result shows which account it belongs to, with a link straight into it.",
    go: "search", cta: "Open contact search",
  },
  {
    title: "See which accounts are healthy",
    body: "Accounts shows an engagement score for each one, plus churn risk and data quality. Open an account to see exactly how its score is built, with no hidden adjustments.",
    go: "accounts", cta: "Open Accounts",
  },
  {
    title: "Chase stale deals and slow replies",
    body: "Deals lists open deals that have stopped moving, across all pipelines. Inbox & SLA lists inbound messages nobody has answered within your reply target.",
    go: "deals", cta: "Open Deals",
  },
  {
    title: "Set your own rules",
    body: "In Settings choose how many days make a deal stale, how long before an account counts as dormant, and your reply target in hours. Scores and alerts update to match.",
    go: "settings", cta: "Open Settings",
  },
  {
    title: "Get a weekly summary in Slack",
    body: "Paste a Slack incoming-webhook address in Settings, press Test, and SubSync posts a short digest every Monday. Alerts clear themselves once the problem is fixed.",
    go: "settings", cta: "Open Settings",
  },
  {
    title: "Ask an AI assistant about your accounts",
    body: "In Settings, create a read-only connector key and add it to an AI assistant that supports MCP. Then ask things like \"which clients are going quiet?\" It can only read, never change anything.",
    go: "settings", cta: "Open Settings",
  },
];

const WORDS: Array<[string, string]> = [
  ["Engagement score", "0 to 100, from five parts: recent activity, new contacts, pipeline health, reply speed and data quality. Each part shows why it scored as it did."],
  ["Dormant", "No real activity in the account for longer than your dormant setting (30 days by default)."],
  ["Stale deal", "An open deal with no movement for longer than your stale setting (30 days by default)."],
  ["Waiting past SLA", "A customer message that is still unanswered after your reply target (4 hours by default)."],
  ["Revenue at risk", "The value of stale open deals. A prompt to look, not a prediction."],
  ["Expected revenue", "Open deal value multiplied by that account's own win rate. Shown only once an account has at least 5 closed deals."],
];

const FAQ: Array<[string, string]> = [
  ["Does SubSync change anything in my accounts?", "No. It only reads data and never edits contacts, deals or settings."],
  ["Who can open it?", "Agency users only. Account-level users cannot see the dashboard."],
  ["Why is a number empty or zero?", "That account has not finished syncing yet, or it genuinely has no data. Check the Data sync card on the Overview."],
  ["How do I hide a test account?", "Open the account and choose Ignore. It stops counting in totals and alerts."],
  ["How do I remove SubSync and my data?", "Settings has a Delete my data button. Uninstalling the app from your agency also removes everything we stored."],
  ["Who do I contact?", "code@kdsquares.com. We reply within one business day."],
];

export function HelpView({ go }: { go: GoFn }) {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Getting started"
        subtitle="SubSync gives you one dashboard across every client account. Here is how to get value from it in a few minutes."
      />

      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-xl border p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.body}</p>
              {s.go && <div className="mt-3"><Btn onClick={() => go(s.go as ViewId)}>{s.cta}</Btn></div>}
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
