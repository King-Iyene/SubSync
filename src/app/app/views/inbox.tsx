"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { CommsSections } from "./comms-sections";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, Loading, PageHeader, timeAgo } from "../ui";

type Item = {
  conversationId: string; locationId: string; locationName: string | null; contactName: string | null; lastMessageType: string | null;
  lastMessageDirection: string | null; lastMessageAt: string | null; unreadCount: number; overSla: boolean; waitingHours: number | null; url: string; channel?: string;
};

const channel = (t: string | null) => (t ?? "").replace("TYPE_", "").replace(/_/g, " ").toLowerCase() || "message";

function Row({ i }: { i: Item }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{i.contactName ?? "Unknown contact"} <span className="font-normal text-muted-foreground">· {i.locationName ?? "Unnamed account"}</span></p>
        <p className="text-xs text-muted-foreground">
          {i.lastMessageDirection === "inbound" ? "Customer wrote" : "You replied"} via {(i.channel ?? channel(i.lastMessageType)).toLowerCase()} {timeAgo(i.lastMessageAt)}
          {i.unreadCount > 0 ? ` · ${i.unreadCount} unread` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {i.overSla && <Badge tone="bad">Waiting {i.waitingHours}h</Badge>}
        {!i.overSla && i.unreadCount > 0 && <Badge tone="info">Unread</Badge>}
        <ExtLink href={i.url}>Reply</ExtLink>
      </div>
    </li>
  );
}

export function InboxView() {
  const api = useApiClient();
  const [showDead, setShowDead] = useState(false);
  const { data, error, loading, reload } = useData<{ slaHours: number; windowDays?: number; overSla: number; truncated?: boolean; channels?: Array<{ channel: string; count: number }>; items: Item[] }>("inbox");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const RECENT_HOURS = 7 * 24;
  const late = data.items.filter((i) => i.overSla && (i.waitingHours ?? 0) <= RECENT_HOURS);
  // Newest overdue first: a customer who wrote yesterday is likelier to still be a lead than one who wrote a month ago.
  late.sort((x, y) => (x.waitingHours ?? 0) - (y.waitingHours ?? 0));
  const dead = data.items.filter((i) => i.overSla && (i.waitingHours ?? 0) > RECENT_HOURS);
  const unread = data.items.filter((i) => !i.overSla && i.unreadCount > 0);

  const waitingNow = late.length + dead.length; // the same number Today and Overview show: the customer wrote last, past the target, inside the window
  return (
    <div>
      <PageHeader
        title="Inbox & SLA"
        subtitle={`Customer messages waiting across every client account. Anything unanswered for more than ${data.slaHours} hours counts as an SLA breach; change the target in Settings.`}
        actions={<Btn onClick={() => api.download("export/inbox", "subsync-inbox.csv")}>Export CSV</Btn>}
      />
      <p className="mb-3 text-sm font-medium" data-testid="waiting-headline">
        {waitingNow === 0 ? "No conversations are waiting for a reply." : `${waitingNow} ${waitingNow === 1 ? "conversation is" : "conversations are"} waiting for a reply.`}
        <span className="font-normal text-muted-foreground"> The customer wrote last, more than {data.slaHours} {data.slaHours === 1 ? "hour" : "hours"} ago, in the last {data.windowDays ?? 30} days. Older than that is not counted.</span>
      </p>
      {(data.channels ?? []).length > 0 && (
        <p className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Waiting by channel">
          {(data.channels ?? []).map((c) => <Badge key={c.channel} tone="neutral">{c.channel} {c.count}</Badge>)}
        </p>
      )}
      {data.truncated && <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">This list is cut at 2,000 conversations; the counts above are only for what is shown.</p>}
      {data.items.length === 0 ? (
        <Empty title="Inbox zero" body="No unread or unanswered conversations right now." />
      ) : (
        <div className="space-y-4">
          <Card title={`Waiting past ${data.slaHours}h, newer than a week (${late.length})`}>
            {late.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recent is overdue. Nice.</p> : <ul className="divide-y">{late.map((i) => <Row key={i.conversationId + i.locationId} i={i} />)}</ul>}
            <p className="mt-2 text-xs text-muted-foreground">Newest first: these are the ones still worth answering.</p>
          </Card>
          {dead.length > 0 && (
            <Card title={`Older than a week (${dead.length})`} action={<Btn variant="ghost" onClick={() => setShowDead(!showDead)}>{showDead ? "Hide" : "Show"}</Btn>}>
              {showDead ? <ul className="divide-y">{dead.slice(0, 100).map((i) => <Row key={i.conversationId + i.locationId} i={i} />)}</ul> : <p className="text-sm text-muted-foreground">These have waited over a week. Worth one last message or closing out, but not urgent.</p>}
            </Card>
          )}
          <Card title={`Unread (${unread.length})`}>
            {unread.length === 0 ? <p className="text-sm text-muted-foreground">No other unread conversations.</p> : <ul className="divide-y">{unread.map((i) => <Row key={i.conversationId + i.locationId} i={i} />)}</ul>}
          </Card>
        </div>
      )}
      <CommsSections />
      <p className="mt-4 text-xs text-muted-foreground">We store only who wrote, when and through which channel. Message text is never copied.</p>
    </div>
  );
}
