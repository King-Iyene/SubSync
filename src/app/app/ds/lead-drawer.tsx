"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { neighbours } from "@/lib/design/ui-logic";
import { useData } from "../session";
import { Badge, fmtMoney, timeAgo } from "../ui";
import { ErrorState, SkeletonRows } from "./states";

// One panel for any lead, opened from any list (N50): profile, tags, source, owner, deals and a timeline, with arrows to step to the previous and next
// lead of the list it was opened from. It is a read-only panel; "Open in your CRM" is a quiet link at the bottom for the rare time a person needs the
// CRM itself. Slots are filled where the data exists and are left out where it does not (no empty boxes, no invented values). It never shows what only
// the agency may see: it reads one contact through the same per-account endpoint a client's staff may use.
export type LeadSeed = {
  contactId: string; locationId: string; name: string;
  /** What the list already knew, shown at once while the rest loads. */
  locationName?: string | null; phone?: string | null; owner?: string | null; unassigned?: boolean; url?: string; note?: string;
};

type Detail = {
  contact: { contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; tags: string[]; source: string | null; dnd: boolean; lastActivityAt: string | null };
  deals: Array<{ id: string; name: string | null; status: string; value: number; stage: string | null }>;
  unread: number;
  timeline: Array<{ at: string; kind: string; title: string; detail?: string }>;
  url: string;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex gap-3 py-1.5 text-sm"><dt className="w-24 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}

function Body({ seed }: { seed: LeadSeed }) {
  const { data, error, loading, reload } = useData<Detail>(`contact/${encodeURIComponent(seed.locationId)}/${encodeURIComponent(seed.contactId)}`);
  const c = data?.contact;
  const phone = c?.phone ?? seed.phone ?? null;
  const url = data?.url ?? seed.url;
  const owner = seed.unassigned ? "No owner" : seed.owner ?? null;
  return (
    <>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold" data-testid="drawer-name">{c?.name ?? seed.name}</h2>
        <p className="truncate text-sm text-muted-foreground">{c?.locationName ?? seed.locationName ?? ""}</p>
      </div>
      {(c?.dnd || (data?.unread ?? 0) > 0 || seed.unassigned) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c?.dnd && <Badge tone="warn">Asked not to be contacted</Badge>}
          {(data?.unread ?? 0) > 0 && <Badge tone="info">{data!.unread} unread</Badge>}
          {seed.unassigned && <Badge tone="warn">No owner</Badge>}
        </div>
      )}
      {seed.note && <p className="mt-3 text-sm text-muted-foreground">{seed.note}</p>}

      {loading && !data && <div className="mt-5"><SkeletonRows rows={4} label="Loading this lead..." /></div>}
      {error && <div className="mt-5"><ErrorState error={error} onRetry={reload} /></div>}

      <dl className="mt-4 divide-y border-y">
        {c?.email && <Row label="Email"><a className="text-primary underline-offset-2 hover:underline" href={`mailto:${c.email}`}>{c.email}</a></Row>}
        {phone && <Row label="Phone"><span className="tabular-nums">{phone}</span>{url && <> <a className="text-primary underline-offset-2 hover:underline" href={url} target="_blank" rel="noopener noreferrer">Call in your CRM</a><span className="block text-xs text-muted-foreground">Opens this contact in your CRM, where its own dialer places the call.</span></>}</Row>}
        {owner && <Row label="Owner">{owner}</Row>}
        {c && <Row label="Source">{c.source ?? "Not recorded"}</Row>}
        {c && <Row label="Last activity">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "None recorded"}</Row>}
      </dl>

      {c && c.tags.length > 0 && (
        <section className="mt-5" aria-label="Tags">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</h3>
          <ul className="flex flex-wrap gap-1.5">{c.tags.slice(0, 30).map((t) => <li key={t} className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{t}</li>)}</ul>
        </section>
      )}

      {data && data.deals.length > 0 && (
        <section className="mt-5" aria-label="Deals">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deals</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {data.deals.slice(0, 8).map((d) => <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate">{d.name ?? "Untitled deal"}<span className="text-muted-foreground">{d.stage ? ` · ${d.stage}` : ""}</span></span><span className="shrink-0 tabular-nums text-muted-foreground">{d.status === "open" ? fmtMoney(d.value) : d.status}</span></li>)}
          </ul>
        </section>
      )}

      {data && (
        <section className="mt-5" aria-label="Timeline">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
          {data.timeline.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded yet.</p> : (
            <ol className="space-y-3 border-l pl-4">
              {data.timeline.slice(0, 12).map((t, i) => (
                <li key={t.at + i} className="relative text-sm">
                  <span aria-hidden className="absolute -left-[1.3rem] top-2 size-1.5 bg-primary" />
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(t.at)}{t.detail ? ` · ${t.detail}` : ""}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {url && <p className="mt-6 text-xs"><a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">Open in your CRM</a></p>}
    </>
  );
}

export function LeadDrawer({ leads, index, onIndex, onClose }: { leads: readonly LeadSeed[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const open = index !== null && index >= 0 && index < leads.length;
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  const nb = neighbours(index, leads.length);
  const seed = leads[index];
  return (
    <div className="fixed inset-0 z-50 print:hidden" data-testid="lead-drawer-root">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={`Lead: ${seed.name}`} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l bg-popover text-popover-foreground shadow-[var(--shadow-lift)]" data-testid="lead-drawer">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous lead" disabled={nb.prev === null} onClick={() => nb.prev !== null && onIndex(nb.prev)} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35"><ChevronLeft aria-hidden className="size-5" /></button>
            <span className="min-w-14 text-center text-xs text-muted-foreground tabular-nums" data-testid="drawer-position">{index + 1} of {leads.length}</span>
            <button type="button" aria-label="Next lead" disabled={nb.next === null} onClick={() => nb.next !== null && onIndex(nb.next)} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35"><ChevronRight aria-hidden className="size-5" /></button>
          </div>
          <button ref={close} type="button" aria-label="Close" onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><Body key={seed.locationId + seed.contactId} seed={seed} /></div>
      </aside>
    </div>
  );
}
