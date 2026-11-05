"use client";

import { CircleAlert, Clock, ExternalLink, MoreHorizontal, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ageLabel, ageWords, INLINE_ROWS, KIND_LABEL, money, personRow, replyContext, type NeedingYou, type QueueRow, type Severity, type TodayItem } from "@/lib/analytics/today-queue";
import type { NextAction } from "@/lib/analytics/today-smart";
import { PopMenu, type MenuItem } from "./pop-menu";
import { useNow } from "./live";

// Today's work lists, one family. The rule (King, KF-8): every list has ONE fixed grid, so the name, what is wrong, what is at stake, how urgent and the action sit at the same x
// on every row, and the headings above them line up with the cells. The action is ONE small outlined button (32 px; 40 px on a phone so a thumb can hit it) in its own
// column; everything else a row can do (Show, Done for now, Snooze, Assign, Only this account) is in a quiet three-dot menu at the end of the row. A row is one line of title,
// one line of reason, and is 56 to 72 px tall, so at least six fit on a laptop screen. No list shows more than FIVE rows inline (KF-9): the rest is behind one "See all N"
// button that opens the full list in the records panel (search, sort, filter chips, 50 a page), so 100 or 1,000 accounts look the same as 6.
// Colour is only ever status: a stripe, an icon and a word say how urgent a row is, never colour alone.

export { INLINE_ROWS };

const SEVERITY: Record<Severity, { word: string; stripe: string; text: string; Icon: typeof CircleAlert }> = {
  critical: { word: "Urgent", stripe: "border-destructive", text: "text-destructive", Icon: CircleAlert },
  warning: { word: "Soon", stripe: "border-transparent", text: "text-warning", Icon: TriangleAlert },
  info: { word: "Can wait", stripe: "border-transparent", text: "text-muted-foreground", Icon: Clock },
};

/** What is at stake, in words: counted dollars, the existing estimate (labelled), or the count. */
export function stakeOf(r: Pick<QueueRow, "dollars" | "estimate" | "count" | "kind" | "partial">): { main: string; sub: string | null } {
  const n = r.count.toLocaleString("en-US");
  if (r.dollars) return { main: money(r.dollars), sub: `${n} ${r.count === 1 ? "deal" : "deals"}` };
  if (r.estimate) return { main: n, sub: `about ${money(r.estimate)}, estimated` };
  return { main: n, sub: r.partial ? "first few only" : r.kind === "replies" ? (r.count === 1 ? "person" : "people") : null };
}

export type RowAction = "done" | "snooze_day" | "snooze_monday" | "assign";
export type RowWhy = { key: string; text: string; onOpen: () => void };

// ONE button height across the page (h-8), one icon size (size-3.5), one menu trigger (size-8).
export const ACTION_BUTTON = "ds-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[4px] border border-[var(--t-rule2)] bg-transparent px-2.5 text-[0.8125rem] font-medium hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] @3xl:h-8";
const MENU_TRIGGER = "ds-press inline-flex size-11 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:size-8";

/** The one small action button of a row: an outlined link that leaves the app (with the external-link icon), or a button that stays inside it. */
export function RowButton({ href, onClick, label, sr, testId }: { href?: string; onClick?: () => void; label: string; sr: string; testId?: string }) {
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={ACTION_BUTTON} data-testid={testId}>{label}<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({sr}, opens in a new tab)</span></a>
    : <button type="button" onClick={onClick} className={ACTION_BUTTON} data-testid={testId}>{label}<span className="sr-only"> ({sr})</span></button>;
}

function Menu({ label, items, testId }: { label: string; items: MenuItem[]; testId?: string }) {
  return <PopMenu label={label} items={items} testId={testId} triggerClassName={MENU_TRIGGER}><MoreHorizontal aria-hidden className="size-4" /></PopMenu>;
}

/** The set-aside actions as menu items: Done for now, Snooze 1 day, Snooze until Monday, Assign to me. */
function actionItems(row: QueueRow, onAct: (r: QueueRow, a: RowAction) => void, canAssign: boolean, kindWord: string | null): MenuItem[] {
  return [
    { key: "done", label: kindWord ? `Mark done: ${kindWord}` : "Mark done", onSelect: () => onAct(row, "done") },
    { key: "snooze-day", label: "Snooze until tomorrow", onSelect: () => onAct(row, "snooze_day") },
    { key: "snooze-monday", label: "Snooze until Monday", onSelect: () => onAct(row, "snooze_monday") },
    ...(canAssign ? [{ key: "assign", label: "Assign to me", onSelect: () => onAct(row, "assign") }] : []),
  ];
}

/** j and k move down and up the rows, Enter opens the highlighted one. Not while typing, and not while the records panel is open. */
function useRowKeys(count: number, onEnter: (index: number) => void) {
  const [at, setAt] = useState(0);
  // The highlighted row is only drawn once the keyboard has been used, so the first row does not look selected on its own.
  const [used, setUsed] = useState(false);
  const moved = useRef(false);
  const active = Math.min(at, Math.max(0, count - 1));
  const enter = useRef(onEnter);
  useEffect(() => { enter.current = onEnter; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || count === 0) return;
      if (document.querySelector("[data-testid=records-panel]")) return;
      if (e.key === "j") { moved.current = true; setUsed(true); setAt((n) => Math.min(count - 1, n + 1)); }
      else if (e.key === "k") { moved.current = true; setUsed(true); setAt((n) => Math.max(0, n - 1)); }
      else if (e.key === "Enter" && !el?.closest("a,button,summary,[role=tab]")) enter.current(active);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [count, active]);
  return { active: used ? active : -1, moved, enterAt: active };
}

function ListHead({ title, hint, right, id }: { title: string; hint?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className="t-title">{title}</h2>
        {hint && <p className="t-small t-quiet mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  );
}
const SEE_ALL = "ds-press min-h-11 rounded-[4px] sm:min-h-9 px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

// ---------- agency, all accounts: one row per client account, its biggest problem ----------

const ACCOUNT_TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_6.5rem_7rem_6rem_2rem]";

export function AccountList({
  rows, total, urgent, max = INLINE_ROWS, title = "Do this first", onShow, onOnly, onSeeAll, onAct, canAssign = false, assigned = {}, whyOf, nextOf, onNext, empty, footer,
}: {
  rows: NeedingYou[]; total: number; urgent: number; max?: number; title?: string;
  /** The amount was pressed or "Show everything": open every record of that client account. */
  onShow: (a: NeedingYou) => void; onOnly: (a: NeedingYou) => void; onSeeAll: () => void;
  onAct?: (r: QueueRow, a: RowAction) => void; canAssign?: boolean; assigned?: Record<string, string | null>; whyOf?: (r: QueueRow) => RowWhy[];
  nextOf?: (a: NeedingYou) => NextAction | null; onNext?: (a: NeedingYou, n: NextAction) => void; empty: string; footer?: ReactNode;
}) {
  const shown = rows.slice(0, max);
  const { active, moved } = useRowKeys(shown.length, (i) => { const r = shown[i]; if (r) window.open(r.url, "_blank", "noopener,noreferrer"); });
  useEffect(() => { if (moved.current) document.getElementById(`account-row-${shown[active]?.locationId}`)?.scrollIntoView({ block: "nearest" }); }, [active, shown, moved]);
  return (
    <section className="mb-10" aria-labelledby="work-h" data-testid="fix-first">
      <ListHead id="work-h" title={title} hint={total === 0 ? undefined : <span data-testid="work-summary">{total.toLocaleString("en-US")} {total === 1 ? "client" : "clients"}, largest amount first{urgent > 0 ? (urgent === total && total > 1 ? ". All are urgent." : `. ${urgent.toLocaleString("en-US")} ${urgent === 1 ? "is" : "are"} urgent.`) : "."}</span>}
        right={total > shown.length ? <button type="button" onClick={onSeeAll} className={SEE_ALL} data-testid="queue-all">Show all {total.toLocaleString("en-US")} clients</button> : undefined} />
      {rows.length === 0 ? (
        <p className="t-surface t-small t-quiet px-4 py-6" data-testid="queue-empty">{empty}</p>
      ) : (
        <ul className="@container t-surface divide-y overflow-hidden" data-testid="queue-list">
          <li aria-hidden className={`hidden gap-x-3 border-l-2 border-transparent py-2 pl-4 pr-1 t-label @3xl:grid ${ACCOUNT_TRACKS}`} data-testid="queue-header">
            <span>Client</span><span className="text-right">Amount</span><span>Status</span><span /><span />
          </li>
          {shown.map((a, n) => {
            const s = SEVERITY[a.severity];
            const stake = stakeOf({ ...a.top, count: a.dollars ? a.top.count : a.count, dollars: a.dollars, estimate: null, kind: a.top.kind, partial: false });
            const age = a.top.since === null ? null : ageWords(a.top.ageMinutes);
            const na = nextOf?.(a) ?? null;
            const items: MenuItem[] = [
              { key: "show", label: "See everything for this client", onSelect: () => onShow(a) },
              { key: "only", label: "Show only this client", onSelect: () => onOnly(a) },
              ...(na && onNext ? [{ key: "next", label: `Next: ${na.text}`, hint: na.effect, onSelect: () => onNext(a, na) }] : []),
              ...((whyOf?.(a.top) ?? []).map((w) => ({ key: `why-${w.key}`, label: `Common thread: ${w.text}`, onSelect: w.onOpen }))),
              ...(onAct ? actionItems(a.top, onAct, canAssign, KIND_LABEL[a.top.kind].toLowerCase()) : []),
            ];
            const mine = assigned[a.top.key];
            return (
              <li key={a.locationId} id={`account-row-${a.locationId}`} data-testid="queue-row" data-kind={a.top.kind} data-severity={a.severity} aria-current={n === active ? "true" : undefined}
                className={`ds-row grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-x-3 gap-y-0.5 border-l-2 py-2.5 pl-4 pr-2 ${ACCOUNT_TRACKS} ${s.stripe} ${n === active ? "bg-accent/50 outline outline-2 -outline-offset-2 outline-[var(--ring)]" : ""}`}>
                <div className="min-w-0" data-col="title">
                  <p className="truncate font-semibold" title={a.name}>{a.name}</p>
                  <p className="t-small t-quiet line-clamp-2 @3xl:truncate" title={a.reason}>{a.reason}{a.count > a.top.count && <span>, plus {a.count - a.top.count} more</span>}{mine ? <span>. Assigned to {mine}</span> : null}</p>
                  <p className={`flex items-center gap-1 text-xs @3xl:hidden ${s.text}`}><s.Icon aria-hidden className="size-3.5 shrink-0" />{s.word}{age ? <span className="text-muted-foreground"> · {ageLabel(a.top.kind, age)}</span> : null}</p>
                </div>
                <div className="tnum hidden text-right @3xl:block" data-col="amount">
                  <button type="button" onClick={() => onShow(a)} aria-label={`${stake.main}${stake.sub ? `, ${stake.sub}` : ""}. See everything for ${a.name}.`} data-testid="queue-amount" data-count={a.count}
                    className="ds-press w-full rounded-md px-1 text-right hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
                    <span className="t-num block text-[0.9375rem] leading-5">{stake.main}</span>
                    {stake.sub && <span className="block truncate text-xs leading-4 text-muted-foreground">{stake.sub}</span>}
                  </button>
                </div>
                <div className="hidden min-w-0 text-sm @3xl:block" data-col="urgency">
                  <p className={`flex items-center gap-1.5 font-medium ${s.text}`}><s.Icon aria-hidden className="size-3.5 shrink-0" />{s.word}</p>
                  {age && <p className="truncate text-xs text-muted-foreground">{ageLabel(a.top.kind, age)}</p>}
                </div>
                <div data-col="crm"><RowButton href={a.url} label="Open" sr={a.name} testId="queue-open" /></div>
                <div data-col="more"><Menu label={`More for ${a.name}`} items={items} testId="queue-more" /></div>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </section>
  );
}

// ---------- one account: the people to reply to ----------

const REPLY_TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_9rem_6rem_2rem]";

export function ReplyNowList({ items, total, newLeads, max = INLINE_ROWS, onSeeAll, onAct, canAssign = false, assigned = {}, title = "Do this first", single = true }: {
  items: TodayItem[]; total: number; newLeads: number; max?: number; onSeeAll: () => void; onAct?: (r: QueueRow, a: RowAction) => void; canAssign?: boolean;
  assigned?: Record<string, string | null>; title?: string; single?: boolean;
}) {
  const now = useNow();
  const shown = items.slice(0, max);
  const { active, moved } = useRowKeys(shown.length, (i) => { const r = shown[i]; if (r) window.open(r.url, "_blank", "noopener,noreferrer"); });
  useEffect(() => { if (moved.current) document.getElementById(`reply-${shown[active]?.id}`)?.scrollIntoView({ block: "nearest" }); }, [active, shown, moved]);
  if (total === 0) return null;
  const oldest = items[0]?.at ?? null;
  const hint = [oldest !== null && now > 0 ? `Longest wait: ${ageWords(Math.max(0, (now - oldest) / 60_000))}.` : null, newLeads > 0 ? `${newLeads.toLocaleString("en-US")} of the ${total.toLocaleString("en-US")} ${newLeads === 1 ? "is a new lead" : "are new leads"}.` : null].filter(Boolean).join(" ");
  return (
    <section className="mb-10" aria-label={title} data-testid="reply-now">
      <ListHead title={title} hint={hint ? <span data-testid="reply-summary">{hint}</span> : undefined}
        right={total > shown.length ? <button type="button" onClick={onSeeAll} className={SEE_ALL} data-testid="reply-all">Show all {total.toLocaleString("en-US")}</button> : undefined} />
      <ul className="@container t-surface divide-y overflow-hidden" data-testid="my-leads">
        <li aria-hidden className={`t-label hidden gap-x-3 py-2 pl-4 pr-2 @3xl:grid ${REPLY_TRACKS}`}><span>Person</span><span>Wait</span><span /><span /></li>
        {shown.map((p, n) => {
          const row = personRow(p, now || p.at || 0);
          const wait = p.never === true ? "Never answered" : p.at === null ? "Waiting" : `${ageWords(Math.max(0, ((now || p.at) - p.at) / 60_000))}`;
          const mine = assigned[row.key];
          const items: MenuItem[] = onAct ? actionItems(row, onAct, canAssign, null) : [];
          return (
            <li key={p.id} id={`reply-${p.id}`} data-testid="reply-row" aria-current={n === active ? "true" : undefined} data-new-lead={p.newLead ? "true" : "false"}
              className={`ds-row grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-x-3 gap-y-0.5 py-2.5 pl-4 pr-2 ${REPLY_TRACKS} ${n === active ? "bg-accent/50 outline outline-2 -outline-offset-2 outline-[var(--ring)]" : ""}`}>
              <div className="min-w-0">
                <p className="truncate font-semibold" title={p.name}>{p.name}</p>
                <p className="t-small t-quiet line-clamp-2 @3xl:truncate">{!single && <span>{p.accountName}. </span>}{replyContext(p)}{mine ? <span>. Assigned to {mine}</span> : null}</p>
                <p className={`text-xs @3xl:hidden ${p.never ? "text-destructive" : "text-muted-foreground"}`} data-testid="lead-wait-narrow">{p.never ? wait : `Waiting ${wait}`}</p>
              </div>
              <p className={`tnum hidden items-center gap-1.5 text-sm @3xl:flex ${p.never ? "font-medium text-destructive" : ""}`} data-testid="lead-wait">{p.never && <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}{p.never ? wait : `Waiting ${wait}`}</p>
              <div><RowButton href={p.url} label="Reply" sr={`${p.name}, in your CRM`} testId="lead-open" /></div>
              <div>{onAct ? <Menu label={`More for ${p.name}`} items={items} testId="reply-more" /> : null}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- one account: the other things to do, grouped by kind ----------

export type KindRow = { kind: "appointments" | "noshows" | "stale"; count: number; text: string; onOpen: () => void; action: { label: string; href?: string; onClick?: () => void; sr: string } };

const KIND_TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_5rem_6rem]";
export function KindList({ rows, title = "Also on your list", hint }: { rows: KindRow[]; title?: string; hint?: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-10" aria-label={title} data-testid="also-needs">
      <ListHead title={title} hint={hint} />
      <ul className="@container t-surface divide-y overflow-hidden" data-testid="kind-list">
        {rows.map((r) => (
          <li key={r.kind} data-testid="kind-row" data-kind={r.kind} className={`ds-row grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-0.5 py-2.5 pl-4 pr-2 ${KIND_TRACKS}`}>
            <div className="min-w-0">
              <p className="truncate font-semibold">{KIND_LABEL[r.kind]}</p>
              <p className="line-clamp-2 text-sm text-muted-foreground @3xl:truncate" title={r.text}>{r.text}</p>
            </div>
            <button type="button" onClick={r.onOpen} data-testid="kind-count" data-count={r.count} aria-label={`${r.count.toLocaleString("en-US")} ${KIND_LABEL[r.kind].toLowerCase()}. Show them.`}
              className="tnum ds-press order-3 col-span-2 w-fit rounded-md px-1 text-left text-sm text-muted-foreground underline underline-offset-4 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:order-none @3xl:col-span-1 @3xl:w-full @3xl:text-right @3xl:text-base @3xl:font-semibold @3xl:text-foreground @3xl:no-underline">{r.count.toLocaleString("en-US")}<span className="@3xl:hidden"> to check</span></button>
            <div><RowButton href={r.action.href} onClick={r.action.onClick} label={r.action.label} sr={r.action.sr} testId="kind-open" /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
