"use client";

import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { shortWords, summaryText } from "@/lib/analytics/unanswered-v2";
import { useApiClient, useData } from "../session";
import type { GoFn } from "../nav";
import { EmptyState, ErrorState, HeadlineBlock, HowTo, InlineAlert, PopMenu, SkeletonRows, type MenuItem } from "../ds";
import { focusClient } from "../ds/global-filter";
import { PrimaryButton } from "./today-chrome";
import { WaitList } from "./unanswered-all";
import { WaitedSection, WhereSection, type AccountRankOut, type BucketOut, type OwnerRankOut } from "./unanswered-picture";
import { PersonRows, usePersonActions, type WaitRow } from "./unanswered-rows";

// Unanswered messages, rebuilt (docs/UNANSWERED_REVIEW.md). One question: "who wrote to us and is still waiting for a reply, and who do I answer first?". Top to bottom: one
// sentence, one button ("Reply to the oldest of the 14 people waiting", which opens that conversation in your CRM), the five people to reply to now (See all opens the whole
// list, searched, filtered by how long, channel and owner, and paged on the server), how long they have waited (the one chart; each bar opens its people), and where they are
// (clients for an agency, owners inside one account). A person is counted once, by the rule Today uses; the new leads who have not written yet are the only difference from
// Today's number and the page says so. SubSync shows who is waiting and never sends a reply; it keeps no message text, so a row says who, which channel, how long and who owns them.

type Home = {
  now: number; slaHours: number; windowDays: number; multi: boolean; accountCount: number; seePeople: boolean; kind: string;
  waiting: {
    people: number; clients: Array<{ locationId: string; name: string; count: number }>; money: { line: string; dollars: number; peopleWithDeals: number; deals: number }; conversations: number; accounts: number; oldestHours: number | null; noOwner: number; newLeads: number; over24: number;
    headline: { parts: Array<{ t: string; strong?: boolean }>; text: string; allClear: boolean }; meaning: string;
    rows: WaitRow[]; cost: { line: string | null; formula: string; amount: number | null; leftOutAccounts: number };
  };
  buckets: BucketOut[]; channels: Array<{ key: string; label: string; count: number }>;
  accounts: { total: number; rows: AccountRankOut[] } | null; owners: { total: number; rows: OwnerRankOut[] } | null;
  mine: number;
  today: { count: number; people: number; newLeadsOnly: number; newLeadsAmongThem: number; partial: boolean } | null;
  next: { key: string; text: string };
  readLimit: string | null; truncated: boolean; conversationsRead: number;
};
type ListSpec = { title: string; params: Record<string, string>; noun?: string };

const MORE_TRIGGER = "ds-press inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";
const quietButton = "ds-press min-h-11 rounded-md border bg-card px-4 text-sm font-medium hover:border-primary/40 sm:min-h-10";

export function InboxView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, reload } = useData<Home>("inbox?part=home");
  const [list, setList] = useState<ListSpec | null>(null);
  const [copied, setCopied] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const rows = data?.waiting.rows ?? [];
  const actions = usePersonActions(rows);

  if (error) return <div data-testid="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div data-testid="page"><SkeletonRows rows={6} label="Reading your conversations..." /></div>;

  const d = data;
  const w = d.waiting;
  const open = (spec: ListSpec) => { setList(spec); setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const oldest = rows[0];
  const canExport = d.kind !== "client";
  const canChange = d.kind !== "client";

  const copy = async () => {
    const text = summaryText({
      who: d.multi ? "All client accounts" : "Your account", headline: w.headline.text, cost: w.cost.line,
      waiting: rows.map((x) => ({ name: x.name, account: d.multi ? x.locationName : null, waited: shortWords(x.hours), channel: x.call ? "call" : x.channel.toLowerCase(), owner: x.owner ? `owner ${x.owner.label}` : "no owner" })),
      accounts: (d.accounts?.rows ?? []).slice(0, 3).map((a) => ({ name: a.name, count: a.count })),
    });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };
  const menu: MenuItem[] = [
    { key: "copy", label: copied ? "Copied to your clipboard" : "Copy a summary", onSelect: () => void copy() },
    { key: "print", label: "Print", onSelect: () => window.print() },
    ...(canExport ? [{ key: "csv", label: "Download the list (CSV)", onSelect: () => void api.download("export/inbox", "subsync-unanswered-messages.csv") }] : []),
    ...(canChange ? [{ key: "settings", label: "Change the reply target", onSelect: () => go("settings") }] : []),
    { key: "help", label: "How to use this page", onSelect: () => go("help") },
  ];

  const waitingList: ListSpec = { title: "Waiting for a reply", params: {} };
  const mineList: ListSpec = { title: "Assigned to you", params: { owner: "me" } };
  const none = d.conversationsRead === 0;
  const agree = d.today;

  return (
    <div data-testid="page" className="ds-enter" ref={top}>
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 print:hidden">
        <div className="mr-auto min-w-0">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">Unanswered messages</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground" data-testid="page-subtitle">Customers who wrote and are still waiting for a reply. SubSync shows who they are; it never sends a reply.</p>
        </div>
        <PopMenu label="More" items={menu} testId="inbox-more" triggerClassName={MORE_TRIGGER}>More<ChevronDown aria-hidden className="size-3.5" /></PopMenu>
      </header>

      {none ? (
        <EmptyState title="Waiting for the first sync" body="Conversations appear here once SubSync has read your accounts. This usually takes a few minutes after you connect; check back soon."
          action={<button type="button" onClick={() => go("help")} className={quietButton}>Open Getting started</button>} />
      ) : (
        <>
          <HowTo id="unanswered2" title="How to use this page">Reply to the person at the top, then the next. Every number and every bar opens the people behind it, and a person&apos;s three dots call or email them through your CRM.</HowTo>

          <HeadlineBlock headline={{ ...w.headline, breakdown: null, accounts: w.accounts, dollars: w.cost.amount ?? 0 } as never}
            action={oldest ? <PrimaryButton p={{ label: w.people > 1 ? `Reply to the oldest of the ${w.people.toLocaleString("en-US")} people waiting` : "Reply to the person waiting", sr: `${oldest.name}, the longest wait, in your CRM`, href: oldest.url }} /> : undefined}>
            {w.people > 0 && (
              <div className="mt-3 max-w-3xl space-y-2" data-testid="wait-money-block">
                <p className="text-[0.95rem] font-medium" data-testid="wait-money">{w.money.line}</p>
                {w.clients.length > 1 && (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-testid="wait-clients">
                    <span>Clients with people waiting:</span>
                    {w.clients.slice(0, 8).map((c) => <button key={c.locationId} type="button" onClick={() => focusClient(c.locationId)} className="min-h-9 rounded-md border bg-card px-2.5 text-foreground hover:border-primary/40" aria-label={`Only ${c.name}, ${c.count} waiting`}>{c.name} ({c.count})</button>)}
                    {w.clients.length > 8 && <span>and {w.clients.length - 8} more: pick them in the filter above.</span>}
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="wait-proof">
              {w.people > 0 ? w.meaning : null}{w.cost.line ? <> <span className="font-medium text-foreground" data-testid="wait-cost">{w.cost.line}</span></> : null}
              {w.cost.line && <details className="mt-1 inline-block align-top"><summary className="ds-press min-h-9 cursor-pointer list-none px-1 font-medium text-primary underline underline-offset-4" data-testid="cost-formula-toggle">How this is worked out</summary><span className="block max-w-xl pt-1" data-testid="cost-formula">{w.cost.formula}</span></details>}
            </div>
            {agree && (w.newLeads > 0 || agree.newLeadsOnly > 0) && (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="wait-today">
                {w.newLeads > 0 ? `${w.newLeads.toLocaleString("en-US")} of them ${w.newLeads === 1 ? "is a new lead" : "are new leads"}. ` : ""}
                {agree.newLeadsOnly > 0 ? <>Today shows {agree.count.toLocaleString("en-US")} because it also counts {agree.newLeadsOnly.toLocaleString("en-US")} new {agree.newLeadsOnly === 1 ? "lead" : "leads"} nobody has replied to yet (a form fill, or only an automatic message).{" "}
                  <button type="button" onClick={() => go("speed")} className="min-h-9 font-medium text-primary underline underline-offset-4" data-testid="wait-today-speed">Open Speed to lead</button></> : null}
              </p>
            )}
            {w.people === 0 && (
              <p className="mt-2 text-sm" data-testid="wait-next">
                <span className="font-medium">Next best step.</span> {d.next.text}
                <span className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => go("speed")} className={quietButton}>Open Speed to lead</button>
                  <button type="button" onClick={() => go("appointments")} className={quietButton}>Open Appointments</button>
                </span>
              </p>
            )}
          </HeadlineBlock>

          {d.truncated && <InlineAlert tone="warning" className="mb-4">SubSync reads the 20,000 conversations that have waited longest. There are more, so the numbers here are for what was read.</InlineAlert>}

          {list ? (
            <WaitList key={JSON.stringify(list.params)} title={list.title} params={list.params} showAccount={d.multi} canMine noun={list.noun}
              onBack={() => { setList(null); setTimeout(() => document.querySelector<HTMLElement>("[data-testid=wait-all], [data-testid=wait-picture] h2")?.focus(), 60); }} backLabel="Back to Reply now" />
          ) : w.people > 0 && (
            <section className="mb-10" aria-label="Reply now" data-testid="reply-now">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">Reply now</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground" data-testid="reply-summary">
                    Longest wait first.{w.noOwner > 0 ? ` ${w.noOwner.toLocaleString("en-US")} ${w.noOwner === 1 ? "has" : "have"} no owner.` : ""}
                    {d.mine > 0 ? <> {d.mine.toLocaleString("en-US")} {d.mine === 1 ? "is" : "are"} assigned to you. <button type="button" onClick={() => open(mineList)} className="min-h-9 font-medium text-primary underline underline-offset-4" data-testid="show-mine">Show mine</button></> : null}
                  </p>
                </div>
                {w.people > rows.length && <button type="button" onClick={() => open(waitingList)} className="ds-press min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline sm:min-h-9" data-testid="wait-all">See all {w.people.toLocaleString("en-US")}</button>}
              </div>
              <PersonRows rows={rows} showAccount={d.multi} actions={actions} testId="reply-rows" />
              {actions.drawer}
            </section>
          )}

          {w.people > 0 && (
            <div className={list ? "hidden" : ""}>
              <WaitedSection buckets={d.buckets} slaHours={d.slaHours} open={open} />
              <WhereSection accounts={d.accounts} owners={d.owners} open={open} />
            </div>
          )}

          <div className="mb-2 space-y-1 text-xs text-muted-foreground" data-testid="wait-notes">
            <p>
              SubSync keeps only who wrote, when and on which channel. It never copies message text, so Reply opens the conversation in your CRM.{" "}
              Owner is the team member the customer is assigned to in your CRM. For a call, SubSync cannot tell whether it was answered.{" "}
              Conversations waiting more than {d.windowDays} days are not counted.{" "}
              {canChange ? <button type="button" onClick={() => go("settings")} className="font-medium text-primary underline" data-testid="wait-settings-link">Change the reply target in Settings</button> : "Ask the person who manages your account to change the reply target."}
            </p>
            <p data-testid="wait-unread-note">Unread is not the same as waiting for a reply: a conversation can hold a message nobody opened and already have your answer. Today shows the unread conversations.</p>
            {d.readLimit && <p data-testid="read-limit">{d.readLimit}</p>}
          </div>
        </>
      )}
    </div>
  );
}
