"use client";

import { useApiClient, useData } from "../session";
import { CommsSections } from "./comms-sections";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, Loading, PageHeader, timeAgo } from "../ui";

type Item = {
  conversationId: string; locationId: string; locationName: string | null; contactName: string | null; lastMessageType: string | null;
  lastMessageDirection: string | null; lastMessageAt: string | null; unreadCount: number; overSla: boolean; waitingHours: number | null; url: string;
};

const channel = (t: string | null) => (t ?? "").replace("TYPE_", "").replace(/_/g, " ").toLowerCase() || "message";

function Row({ i }: { i: Item }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{i.contactName ?? "Unknown contact"} <span className="font-normal text-muted-foreground">· {i.locationName ?? "Unnamed account"}</span></p>
        <p className="text-xs text-muted-foreground">
          {i.lastMessageDirection === "inbound" ? "Customer wrote" : "You replied"} via {channel(i.lastMessageType)} {timeAgo(i.lastMessageAt)}
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
  const { data, error, loading, reload } = useData<{ slaHours: number; overSla: number; items: Item[] }>("inbox");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const late = data.items.filter((i) => i.overSla);
  const unread = data.items.filter((i) => !i.overSla && i.unreadCount > 0);

  return (
    <div>
      <PageHeader
        title="Inbox & SLA"
        subtitle={`Customer messages waiting across every client account. Anything unanswered for more than ${data.slaHours} hours counts as an SLA breach; change the target in Settings.`}
        actions={<Btn onClick={() => api.download("export/inbox", "subsync-inbox.csv")}>Export CSV</Btn>}
      />
      {data.items.length === 0 ? (
        <Empty title="Inbox zero" body="No unread or unanswered conversations right now." />
      ) : (
        <div className="space-y-4">
          <Card title={`Waiting past ${data.slaHours}h (${late.length})`}>
            {late.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is overdue. Nice.</p> : <ul className="divide-y">{late.map((i) => <Row key={i.conversationId + i.locationId} i={i} />)}</ul>}
          </Card>
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
