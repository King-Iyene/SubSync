"use client";

import { useState } from "react";
import { RoleChip } from "../roles";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, inputClass, Loading, PageHeader, Table, Td, Th, timeAgo } from "../ui";

// ---------------- Team ----------------

type Member = {
  userId: string; label: string; name: string | null; openCount: number; openValue: number; staleCount: number;
  wonCount: number; wonValue: number; lostCount: number; contacts: number; avgCycleDays: number | null; winRate: number | null; pace: { lastReplyHoursAgo: number | null; idle: boolean; replies: number; medianReplySeconds: number | null; held: number; noShow: number; showRate: number | null };
};

const paceText = (s: number) => (s < 90 ? `${s} sec` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);

export function TeamView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ members: Member[]; staleDays: number }>("team");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const save = async (userId: string) => {
    try {
      await api.put(`team/${userId}`, { name: draft.trim() || null });
      setEditing(null);
      setMsg(null);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Team" subtitle="Who owns the pipeline: open and won value, deals going stale, and how fast each person closes. Deals with nobody assigned are shown as Unassigned." />
      {msg && <p className="mb-3 text-sm text-destructive" role="alert">{msg}</p>}
      {data.members.length === 0 ? (
        <Empty title="No assigned deals yet" body="Once deals or contacts have an owner in your CRM, each person appears here." />
      ) : (
        <Card>
          <Table head={<tr><Th>Person</Th><Th className="text-right">Open deals</Th><Th className="text-right">Open value</Th><Th className="text-right">Stale ({data.staleDays}d+)</Th><Th className="text-right">Won</Th><Th className="text-right">Win rate</Th><Th className="text-right">Last reply</Th><Th className="text-right">First reply (30d)</Th><Th className="text-right">Show rate (30d)</Th><Th className="text-right">Avg days to win</Th><Th className="text-right">Contacts</Th></tr>}>
            {data.members.map((m) => (
              <tr key={m.userId} className="hover:bg-muted/40">
                <Td>
                  {editing === m.userId ? (
                    <div className="flex gap-2">
                      <input className={inputClass} value={draft} maxLength={60} autoFocus aria-label="Name" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(m.userId)} />
                      <Btn onClick={() => save(m.userId)}>Save</Btn>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.label}</span>{m.userId !== "unassigned" && <RoleChip userId={m.userId} />}
                      {m.userId !== "unassigned" && (
                        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setEditing(m.userId); setDraft(m.name ?? ""); }}>{m.name ? "Rename" : "Add name"}</button>
                      )}
                    </div>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{fmtInt(m.openCount)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(m.openValue)}</Td>
                <Td className="text-right tabular-nums">{m.staleCount > 0 ? <Badge tone="warn">{m.staleCount}</Badge> : "0"}</Td>
                <Td className="text-right tabular-nums">{fmtInt(m.wonCount)} · {fmtMoney(m.wonValue)}</Td>
                <Td className="text-right tabular-nums">{m.winRate === null ? <span className="text-muted-foreground" title="Needs 20 closed deals">n/a</span> : `${Math.round(m.winRate * 100)}%`}</Td>
                <Td className="text-right tabular-nums">{m.pace.lastReplyHoursAgo === null ? <span className="text-muted-foreground">none</span> : m.pace.idle ? <Badge tone="warn">idle {m.pace.lastReplyHoursAgo} h</Badge> : `${m.pace.lastReplyHoursAgo} h ago`}</Td>
                <Td className="text-right tabular-nums">{m.pace.medianReplySeconds === null ? <span className="text-muted-foreground" title="Needs 3 replies">n/a</span> : paceText(m.pace.medianReplySeconds)}</Td>
                <Td className="text-right tabular-nums">{m.pace.showRate === null ? <span className="text-muted-foreground" title="Needs 5 recorded outcomes">n/a</span> : `${Math.round(m.pace.showRate * 100)}% (${m.pace.held}/${m.pace.held + m.pace.noShow})`}</Td>
                <Td className="text-right tabular-nums">{m.avgCycleDays ?? "n/a"}</Td>
                <Td className="text-right tabular-nums">{fmtInt(m.contacts)}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">The platform only gives us an id for each person, so names are ones you type here. They stay in SubSync and are not written back.</p>
        </Card>
      )}
    </div>
  );
}

// ---------------- Recent deal movement ----------------

type Move = { at: string; kind: string; dealName: string | null; contactName: string | null; value: number; locationName: string | null; fromLabel: string | null; toLabel: string | null; url: string };

export function DealMoves() {
  const { data, error, loading, reload } = useData<{ moves: Move[] }>("deal-events");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const sentence = (m: Move) =>
    m.kind === "created" ? "was created" : m.kind === "status" ? `changed from ${m.fromLabel ?? "?"} to ${m.toLabel ?? "?"}` : `moved from ${m.fromLabel ?? "?"} to ${m.toLabel ?? "?"}`;
  return (
    <div className="mt-6">
      <Card title="Recent deal movement">
        {data.moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has moved since SubSync started watching. Stage moves, wins and losses appear here after each sync.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.moves.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{m.dealName ?? "A deal"}</span> {sentence(m)}{m.locationName ? <span className="text-muted-foreground"> · {m.locationName}</span> : null}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">{m.value > 0 && fmtMoney(m.value)}{timeAgo(m.at)}<ExtLink href={m.url}>Open</ExtLink></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------- One contact's timeline ----------------

type Timeline = {
  contact: { name: string; email: string | null; phone: string | null; tags: string[]; source: string | null; dnd: boolean; locationName: string | null };
  deals: Array<{ id: string; name: string | null; status: string; value: number; stage: string | null }>;
  unread: number;
  timeline: Array<{ at: string; kind: string; title: string; detail?: string }>;
  url: string;
};

export function ContactTimeline({ locationId, contactId, onClose }: { locationId: string; contactId: string; onClose: () => void }) {
  const { data, error, loading, reload } = useData<Timeline>(`contact/${locationId}/${contactId}`);
  return (
    <Card title="Contact timeline" action={<Btn variant="ghost" onClick={onClose}>Close</Btn>}>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p className="text-base font-medium">{data.contact.name} {data.contact.dnd && <Badge tone="bad">Do not disturb</Badge>}</p>
            <p className="text-muted-foreground">{data.contact.email ?? "no email"} · {data.contact.phone ?? "no phone"}</p>
            <p>Account: {data.contact.locationName ?? "Unnamed"} · Source: {data.contact.source ?? "unknown"}</p>
            <div className="flex flex-wrap gap-1">{data.contact.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
            <p className="font-medium pt-2">Deals</p>
            {data.deals.length === 0 ? <p className="text-muted-foreground">No deals for this contact.</p> : (
              <ul className="space-y-1">{data.deals.map((d) => <li key={d.id}>{d.name ?? "Untitled"} · {fmtMoney(d.value)} · <Badge tone={d.status === "won" ? "good" : d.status === "lost" ? "bad" : "info"}>{d.status}</Badge>{d.stage ? ` · ${d.stage}` : ""}</li>)}</ul>
            )}
            <ExtLink href={data.url}>Open in the platform</ExtLink>
          </div>
          <ol className="space-y-2 border-l pl-4 text-sm">
            {data.timeline.length === 0 ? <li className="text-muted-foreground">No history yet.</li> : data.timeline.map((t, i) => (
              <li key={i}><span className="text-xs text-muted-foreground">{timeAgo(t.at)}</span><br />{t.title}{t.detail ? <span className="text-muted-foreground"> · {t.detail}</span> : null}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
