"use client";

import { useEffect, useState } from "react";
import { useData } from "../session";
import { ContactTimeline } from "./people";
import { Badge, Empty, ErrorBox, ExtLink, inputClass, Loading, PageHeader, Table, Td, Th, timeAgo } from "../ui";

type Hit = {
  contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null;
  tags: string[]; dateAdded: string | null; lastActivityAt: string | null; url: string;
};

export function SearchView() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const [open, setOpen] = useState<{ locationId: string; contactId: string } | null>(null);
  const { data, error, loading, reload } = useData<{ hits: Hit[] }>(debounced.length >= 2 ? `search?q=${encodeURIComponent(debounced)}` : null);

  return (
    <div>
      <PageHeader title="Contact search" subtitle="Find any contact across every client account at once. Search by name, email or phone number; results open in the right account." />
      <input className={`${inputClass} max-w-xl py-3 text-base`} placeholder="Name, email or phone..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search contacts across all client accounts" />
      {open && <div className="mt-4"><ContactTimeline key={open.contactId} locationId={open.locationId} contactId={open.contactId} onClose={() => setOpen(null)} /></div>}
      <div className="mt-6">
        {debounced.length < 2 ? (
          <Empty title="Start typing to search" body="Type at least two characters. Partial names, emails and the last digits of a phone number all work." />
        ) : loading && !data ? (
          <Loading label="Searching..." />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data || data.hits.length === 0 ? (
          <Empty title={`No contacts match "${debounced}"`} body="Check the spelling, or try just part of the email or the last digits of the number." />
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground" role="status">{data.hits.length === 60 ? "Showing the first 60 matches. Narrow your search to see others." : `${data.hits.length} match${data.hits.length === 1 ? "" : "es"}`}</p>
            <Table head={<tr><Th>Contact</Th><Th>Account</Th><Th>Phone</Th><Th>Tags</Th><Th>Last activity</Th><Th>{" "}</Th></tr>}>
              {data.hits.map((h) => (
                <tr key={`${h.locationId}:${h.contactId}`} className="hover:bg-muted/40">
                  <Td><div className="font-medium">{h.name}</div><div className="text-xs text-muted-foreground">{h.email ?? "no email"}</div></Td>
                  <Td>{h.locationName ?? "Unnamed account"}</Td>
                  <Td>{h.phone ?? <span className="text-muted-foreground">none</span>}</Td>
                  <Td><div className="flex flex-wrap gap-1">{h.tags.length ? h.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-muted-foreground">none</span>}</div></Td>
                  <Td>{timeAgo(h.lastActivityAt ?? h.dateAdded)}</Td>
                  <Td><div className="flex gap-3"><button type="button" className="text-sm underline" onClick={() => setOpen({ locationId: h.locationId, contactId: h.contactId })}>Timeline</button><ExtLink href={h.url}>Open</ExtLink></div></Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
