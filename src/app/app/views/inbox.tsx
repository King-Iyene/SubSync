"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { waitLabel } from "@/lib/design/ui-logic";
import {
  accountGroups, agingGroups, CALL_NOTE, chipCounts, DEFAULT_QUEUE, isCallChannel, isDefaultQueue, isWaitingTab, lastLine, listFor, narrows, peekFor, queueFromHash, queueIntoHash,
  reconcile, rowText, sanitizeQueue, TABS, tabCounts, waitingSet, type QueueFilter, type QueueRow, type TabId,
} from "@/lib/analytics/waiting-view";
import { useApiClient, useData } from "../session";
import type { GoFn } from "../nav";
import { DataList, DefinitionTip, Distribution, DrillPanel, EmptyState, HowTo, InlineAlert, LeadDrawer, ModuleTabs, Page, remember, remembered, Section, useDrill, type Column, type LeadSeed } from "../ds";
import { Badge, Btn, ErrorBox, ExtLink, fmtInt, Loading, timeAgo } from "../ui";
import { AfterHoursCard } from "./comms-sections";
import { QueueChoices, SavedViews, WaitChips, type ViewLite } from "./inbox-controls";

type Data = {
  slaHours: number; windowDays?: number; overSla: number; waitingTotal: number; truncated?: boolean; me: string | null; namesMissing?: boolean;
  items: QueueRow[]; readLimit?: string | null;
  unread?: { unread: number; unreadAndWaiting: number; unreadNotWaiting: number };
};
type Views = { views: ViewLite[]; max: number };

// Unanswered messages (stage F4). Which conversations are waiting is decided on the server (docs/METRICS.md, "Waiting for a reply"); this page sorts,
// filters and splits them with the pure rules in waiting-view.ts, so the number on a tab is always the number of rows under it.
const TAB_LABEL: Record<TabId, string> = { recent: "Last 7 days", older: "Older", unread: "Unread" };

function initialQueue(): QueueFilter {
  if (typeof window === "undefined") return DEFAULT_QUEUE;
  const fromLink = queueFromHash(window.location.hash);
  if (fromLink) return fromLink;
  const kept = remembered("inbox-queue");
  if (!kept) return DEFAULT_QUEUE;
  try { return sanitizeQueue(JSON.parse(kept)); } catch { return DEFAULT_QUEUE; }
}
const writeHash = (f: QueueFilter) => { try { window.history.replaceState(null, "", queueIntoHash(window.location.hash, f)); } catch { /* the address stays as it is; the page still works */ } };

const keyOf = (r: QueueRow) => `${r.locationId}:${r.conversationId}`;
const waitedText = (r: QueueRow) => waitLabel((r.waitingHours ?? 0) * 60);

function toSeed(r: QueueRow): LeadSeed {
  const wait = r.overSla ? `Waiting ${waitedText(r)}.` : null;
  return {
    contactId: r.contactId as string, locationId: r.locationId, name: r.contactName ?? "Unknown contact", locationName: r.locationName,
    owner: r.assignedTo ? r.assignee : null, unassigned: !r.assignedTo, url: r.url,
    note: [lastLine(r, timeAgo(r.lastMessageAt)), wait, isCallChannel(r) ? CALL_NOTE : null].filter(Boolean).join(" "),
  };
}

function columns(showAccount: boolean): Array<Column<QueueRow>> {
  return [
    { key: "name", header: "Customer", primary: true, width: "minmax(0,2fr)", cell: (r) => r.contactName ?? "Unknown contact" },
    ...(showAccount ? [{ key: "account", header: "Client account", width: "minmax(0,1.5fr)", cell: (r: QueueRow) => <span className="text-muted-foreground">{r.locationName ?? "Unnamed account"}</span> }] : []),
    { key: "channel", header: "Channel", width: "8rem", cell: (r) => <span title={isCallChannel(r) ? CALL_NOTE : undefined}>{r.channel}{isCallChannel(r) && <span className="block text-xs text-muted-foreground">result not known</span>}</span> },
    {
      key: "wait", header: "Waiting", width: "12rem",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {r.overSla ? <Badge tone={(r.waitingHours ?? 0) >= 7 * 24 ? "warn" : "bad"}>Waiting {waitedText(r)}</Badge> : <span className="text-muted-foreground">Last message {timeAgo(r.lastMessageAt)}</span>}
          {r.unreadCount > 0 && <Badge tone="info">{r.unreadCount} unread</Badge>}
        </span>
      ),
    },
    { key: "owner", header: "Assigned to", width: "minmax(0,1fr)", cell: (r) => (r.assignedTo ? <span className="text-muted-foreground">{r.assignee}</span> : <Badge tone="warn">No owner</Badge>) },
    { key: "open", header: "", width: "11rem", align: "right", cell: (r) => <ExtLink href={r.url}>Reply in your CRM</ExtLink> },
  ];
}

// The first few rows of a tab, so no tab hides its contents behind a click (N13).
function Peek({ tab, count, rows, onOpen }: { tab: TabId; count: number; rows: QueueRow[]; onOpen: () => void }) {
  return (
    <section className="border-t py-3" aria-label={`${TAB_LABEL[tab]}: the first few`} data-testid={`peek-${tab}`}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{TAB_LABEL[tab]} <span className="font-normal text-muted-foreground">({count})</span></h3>
        {count > 0 && <button type="button" onClick={onOpen} className="min-h-8 text-xs font-medium text-primary underline">Open {TAB_LABEL[tab]} ({count})</button>}
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{tab === "unread" ? "Nothing unread with these choices." : "Nobody is waiting here with these choices."}</p> : (
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={keyOf(r)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
              <span className="min-w-0"><span className="font-medium">{r.contactName ?? "Unknown contact"}</span> <span className="text-muted-foreground">· {r.locationName ?? "Unnamed account"} · {r.channel}{r.overSla ? ` · waiting ${waitedText(r)}` : ""}</span></span>
              <ExtLink href={r.url}>Reply in your CRM</ExtLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The wait buckets from a day to a week are the ones still worth winning; they are drawn in the warning colour. Older than a week is never an alarm.
const bucketTone = (i: number) => (i === 4 || i === 5 ? ("warn" as const) : ("series" as const));

export function InboxView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("inbox");
  const { data: viewData } = useData<Views>("inbox/views");
  const [filter, setFilterState] = useState<QueueFilter>(initialQueue);
  const [saved, setSaved] = useState<Views | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const agingDrill = useDrill();
  const accountDrill = useDrill();
  const first = useRef(filter);
  useEffect(() => { writeHash(first.current); }, []);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const me = data?.me ?? null;
  const eff = useMemo(() => reconcile(filter, rows, me), [filter, rows, me]);
  const setFilter = useCallback((next: QueueFilter) => {
    const clean = sanitizeQueue(next);
    setFilterState(clean);
    setOpen(null);
    remember("inbox-queue", isDefaultQueue(clean) ? null : JSON.stringify(clean));
    writeHash(clean);
  }, []);

  const total = useMemo(() => tabCounts(rows, DEFAULT_QUEUE, me), [rows, me]);
  const counts = useMemo(() => tabCounts(rows, eff, me), [rows, eff, me]);
  const chips = useMemo(() => chipCounts(rows, eff, me), [rows, eff, me]);
  const list = useMemo(() => listFor(rows, eff, me), [rows, eff, me]);
  const waiting = useMemo(() => waitingSet(rows, eff, me), [rows, eff, me]);
  const aging = useMemo(() => agingGroups(waiting), [waiting]);
  const byAccount = useMemo(() => accountGroups(waiting), [waiting]);
  const openable = useMemo(() => list.filter((r) => r.contactId), [list]);
  const seeds = useMemo(() => openable.map(toSeed), [openable]);

  if (loading && !data) return <Loading label="Reading your conversations..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const views = saved ?? viewData ?? { views: [], max: 10 };
  const waitingNow = total.recent + total.older;
  const showAccount = new Set(rows.map((r) => r.locationId)).size > 1;
  const cols = columns(showAccount);
  const nothingAtAll = waitingNow === 0 && total.unread === 0;
  const shownWaiting = counts.recent + counts.older;
  const target = `${data.slaHours} ${data.slaHours === 1 ? "hour" : "hours"}`;
  const doSave = async (name: string) => {
    setNote(null);
    try { const r = await api.post<Views>("inbox/views", { name, filters: eff }); setSaved(r); setNote(`Saved "${name}".`); } catch (e) { setNote((e as Error).message); }
  };
  const doRemove = async (id: string) => {
    setNote(null);
    try { const r = await api.del<Views>(`inbox/views/${id}`); setSaved(r); setNote("Removed."); } catch (e) { setNote((e as Error).message); }
  };
  // A conversation with no contact on file cannot open the customer panel, so it opens in the CRM instead.
  const openRow = (r: QueueRow) => {
    const at = openable.findIndex((x) => keyOf(x) === keyOf(r));
    if (at >= 0) setOpen(at); else window.open(r.url, "_blank", "noopener,noreferrer");
  };
  const tabIndex = Math.max(0, TABS.findIndex((t) => t.id === eff.tab));
  const others = TABS.filter((t) => t.id !== eff.tab);

  const body = (
    <div data-testid={`tab-body-${eff.tab}`}>
      {isWaitingTab(eff.tab) && <div className="mb-3"><WaitChips filter={eff} counts={chips} onChange={setFilter} /></div>}
      <p className="mb-2 text-xs text-muted-foreground">
        {eff.tab === "recent" ? `Customers who wrote in the last 7 days and have waited more than your ${target} reply target.` : eff.tab === "older" ? "Customers who have waited a week or more. They are not marked critical: after a week most are no longer waiting for you. Worth one last message, or closing out." : "Conversations with a message nobody has opened. Unread is not the same as waiting for a reply."}{" "}
        {eff.sort === "longest" ? (eff.tab === "unread" ? "Oldest message first." : "Longest wait first.") : "Newest first."}
      </p>
      <DataList key={eff.tab} rows={list} columns={cols} rowKey={keyOf} onOpen={(r) => openRow(r)} caption={`${TAB_LABEL[eff.tab]} conversations`} copyText={(r) => rowText(r, waitedText(r))}
        empty={eff.tab === "unread" ? "Nothing is unread with these choices." : eff.tab === "recent" ? "Nobody has been waiting for a reply in the last 7 days with these choices." : "Nobody has waited a week or more with these choices."} />
      <div className="mt-6">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Also in this queue</p>
        {others.map((t) => <Peek key={t.id} tab={t.id} count={counts[t.id]} rows={peekFor(rows, eff, me, t.id)} onOpen={() => setFilter({ ...eff, tab: t.id })} />)}
      </div>
    </div>
  );

  const picked = agingDrill.selected !== null ? aging[agingDrill.selected] : undefined;
  const pickedAccount = accountDrill.selected !== null ? byAccount[accountDrill.selected] : undefined;

  return (
    <Page
      title="Unanswered messages"
      subtitle="Customer messages that are still waiting for a reply. Late means past your reply target; change it in Settings."
      actions={<Btn onClick={() => api.download("export/inbox", "subsync-unanswered-messages.csv")}>Export CSV</Btn>}
    >
      <p className="mb-1 text-sm font-medium" data-testid="waiting-headline">
        {waitingNow === 0 ? "No conversations are waiting for a reply." : `${fmtInt(waitingNow)} ${waitingNow === 1 ? "conversation is" : "conversations are"} waiting for a reply.`}
        <span className="font-normal text-muted-foreground"> The customer wrote last, more than {target} ago (<DefinitionTip term="your reply target" label="What a reply target is">The number of hours a customer message may wait before it counts as late. You choose it in Settings; the standard is 4 hours.</DefinitionTip>), in the last {data.windowDays ?? 30} days. Older than that is not counted.</span>
      </p>
      {waitingNow > 0 && <p className="mb-3 text-xs text-muted-foreground" data-testid="what-to-do">What to do: start at the top of the Last 7 days tab and reply in your CRM. Then look at Older and decide who is worth one last message.</p>}
      {narrows(eff) && <p className="mb-3 text-xs text-muted-foreground" data-testid="queue-scope">Your choices leave {fmtInt(shownWaiting)} of the {fmtInt(waitingNow)} waiting conversations.</p>}
      {data.truncated && <div className="mb-3" data-testid="list-cap"><InlineAlert tone="warning">Showing the first 2,000 conversations. There are more, so the counts here are only for what is shown.</InlineAlert></div>}
      {data.readLimit && <p className="mb-3 text-xs text-muted-foreground" data-testid="read-limit">{data.readLimit}</p>}

      {nothingAtAll ? (
        <EmptyState title="Nothing is waiting for a reply" body="Every customer message in the last 30 days has an answer and nothing is unread. A good moment to look at new leads, or at appointments that still need an outcome."
          action={<span className="flex flex-wrap justify-center gap-2"><Btn onClick={() => go("speed")}>Open Speed to lead</Btn><Btn onClick={() => go("appointments")}>Open Appointments</Btn></span>} />
      ) : (
        <>
          <HowTo id="unanswered" title="How to use this page" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
            Pick a tab, narrow it by how long they waited, the channel, the client account or who it is assigned to, and save the view you use every day. Press a name to see the customer, and use the arrows to step to the next one.
          </HowTo>
          <div className="mb-4 space-y-3">
            <QueueChoices rows={rows} filter={eff} me={me} onChange={setFilter} />
            <SavedViews filter={eff} views={views.views} max={views.max} onApply={setFilter} onSave={doSave} onRemove={doRemove} message={note} />
          </div>
          {waiting.length > 0 && (
            <div className="mb-6" data-testid="summary-charts">
              <div className={`grid gap-x-10 gap-y-6 ${byAccount.length > 1 ? "lg:grid-cols-2" : ""}`}>
                <Section title="How long customers have waited" hint="Everyone who is waiting, by how long. Press a row to see them. The tab and wait chips do not change it; the other choices do." className="mb-0">
                  <Distribution title="Waiting conversations by wait" noun="conversations"
                    rows={aging.map((g, i) => ({ label: g.label, value: g.count, count: g.count, tone: bucketTone(i) }))}
                    onSelect={(i) => { accountDrill.clear(); agingDrill.select(i); }} selected={agingDrill.selected} />
                </Section>
                {byAccount.length > 1 && (
                  <Section title="Where the waiting is" hint="Waiting conversations by client account, most first. Press a row to see them." className="mb-0">
                    <Distribution title="Waiting conversations by client account" noun="conversations"
                      rows={byAccount.map((g) => ({ label: g.label, value: g.count, count: g.count }))}
                      onSelect={(i) => { agingDrill.clear(); accountDrill.select(i); }} selected={accountDrill.selected} />
                  </Section>
                )}
              </div>
              {picked && (
                <DrillPanel drill={agingDrill} title={`Waiting ${picked.label.toLowerCase()}`} count={picked.count} noun={picked.count === 1 ? "conversation" : "conversations"}
                  rows={picked.rows} columns={cols} rowKey={keyOf} toLead={toSeed} />
              )}
              {pickedAccount && (
                <DrillPanel drill={accountDrill} title={pickedAccount.label} count={pickedAccount.count} noun={pickedAccount.count === 1 ? "conversation" : "conversations"}
                  rows={pickedAccount.rows} columns={cols} rowKey={keyOf} toLead={toSeed} />
              )}
            </div>
          )}
          <ModuleTabs label="Unanswered messages" value={tabIndex} onChange={(i) => setFilter({ ...eff, tab: TABS[i].id })}
            tabs={TABS.map((t) => ({ id: t.id, label: `${TAB_LABEL[t.id]} (${counts[t.id]})`, node: body }))} />
          {data.namesMissing && <p className="mb-4 text-xs text-muted-foreground" data-testid="names-missing">Some team member names are not available yet, so they show as &ldquo;Team member (name not available)&rdquo;. Whoever manages SubSync can add the names on the Team page.</p>}
          <p className="mb-6 text-xs text-muted-foreground">&ldquo;Assigned to&rdquo; is the team member the customer&apos;s contact is assigned to. A call is the customer&apos;s last action, but SubSync cannot tell whether it was answered.</p>
        </>
      )}

      <AfterHoursCard />
      <p className="mt-6 text-xs text-muted-foreground" data-testid="deals-moved">Open deals whose contact has gone quiet are now in Pipeline. <button type="button" onClick={() => go("deals")} className="font-medium text-primary underline">Open them in Pipeline</button></p>
      <p className="mt-2 text-xs text-muted-foreground">We store only who wrote, when and through which channel. Message text is never copied.</p>
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </Page>
  );
}
