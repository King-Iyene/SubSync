"use client";

import { ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";
import { useId } from "react";
import { PROTECTED_EXPLAINER, protectChips } from "@/lib/dq/dupe-copies";
import { OpenLeadButton } from "../../ds/open-lead-button";
import { InfoTip } from "../../ds/info-tip";
import { sampleOn, useDq, type DupeDetail, type GroupRow } from "./dq-data";

// "Show copies": every copy of one duplicate group, listed inside its row. The list already knows name, email, phone, owner and source, so the rows show AT ONCE; the rest (tags, deals,
// coming appointment, last activity, which copy is kept) loads lazily from the same detail call Merge uses, only when the row is opened. Nothing is fetched for a closed row.

const tip = "pointer-events-none invisible absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[80vw] rounded-md border bg-popover p-2.5 text-left text-xs font-normal leading-snug text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/cp:visible group-hover/cp:opacity-100 group-focus-within/cp:visible group-focus-within/cp:opacity-100";
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
const cell = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/** "N copies" as a real button: toggles the list, and shows a quick who-is-who preview on hover or keyboard focus. */
export function CopiesToggle({ g, open, onToggle, panelId }: { g: GroupRow; open: boolean; onToggle: () => void; panelId: string }) {
  const id = useId();
  return (
    <span className="group/cp relative inline-flex">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} aria-describedby={id} data-testid="dq-copies-toggle"
        className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
        {g.people.length} copies<ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        <span className="sr-only">{open ? "Hide copies" : "Show copies"}</span>
      </button>
      {!open && (
        <span id={id} role="tooltip" className={tip} data-testid="dq-copies-preview">
          {g.people.slice(0, 6).map((p) => <span key={p.contactId} className="block truncate">{p.name}{p.email || p.phone ? <span className="text-muted-foreground"> · {p.email ?? p.phone}</span> : null}</span>)}
          {g.people.length > 6 && <span className="block text-muted-foreground">and {g.people.length - 6} more</span>}
          <span className="mt-1 block text-muted-foreground">Click to see every copy.</span>
        </span>
      )}
    </span>
  );
}

/** "Protected" with a visible, keyboard and touch friendly explanation (not a hidden title). */
export function ProtectedBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="dq-protected"><ShieldCheck aria-hidden className="size-3.5" />Protected
      <InfoTip text={PROTECTED_EXPLAINER} label="What Protected means" testId="dq-protected-info" /></span>
  );
}

/** A disabled button cannot take focus or hover, so the reason sits on a focusable wrapper that shows it. */
export function WhyDisabled({ disabled, why, children }: { disabled: boolean; why: string; children: React.ReactNode }) {
  const id = useId();
  if (!disabled) return <>{children}</>;
  return (
    <span className="group/cp relative inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-primary" tabIndex={0} aria-describedby={id} data-testid="dq-why-disabled">
      {children}
      <span id={id} role="tooltip" className={`${tip} left-auto right-0`} data-testid="dq-why-text">{why}</span>
    </span>
  );
}

export function CopiesPanel({ g, panelId }: { g: GroupRow; panelId: string }) {
  const ids = g.people.map((p) => p.contactId);
  const sample = sampleOn();
  const d = useDq<DupeDetail>(sample ? null : `dq/dupe?account=${g.locationId}&ids=${ids.join(",")}`, () => ({
    locationId: g.locationId, locationName: g.locationName, key: g.key, keepId: ids[0], different: false, guard: [], picks: [], workflow: { set: false, optedIn: false, canAsk: false, blockers: [], goneName: null, survivorId: ids[0], switchOn: false },
    people: g.people.map((p, i) => ({ contactId: p.contactId, name: p.name, email: p.email, phone: p.phone, tags: i ? ["new"] : ["vip"], createdAt: p.createdAt, source: p.source, ownerName: p.owner, openDeals: p.openDeals, openValue: p.openDeals ? 1200 : 0, wonDeals: 0, hasConversation: false, dnd: p.dnd, url: p.url, protectWords: p.protectWords })),
  }));
  const det = d.data;
  const byId = new Map((det?.people ?? []).map((p) => [p.contactId, p]));
  return (
    <div id={panelId} className="border-t bg-muted/20 px-3 py-3" data-testid="dq-copies" data-count={g.people.length}>
      <ul className="space-y-2">
        {g.people.map((lp) => {
          const p = byId.get(lp.contactId);
          const chips = protectChips({ dnd: p?.dnd ?? lp.dnd, openDeals: p?.openDeals ?? lp.openDeals, openValue: p?.openValue, appointments: p?.appointments, nextAppointmentAt: p?.nextAppointmentAt });
          const kept = det?.keepId === lp.contactId;
          const facts: Array<[string, string]> = [["Email", cell(lp.email)], ["Phone", cell(lp.phone)], ["Created", date(lp.createdAt)], ["Source", cell(lp.source)], ["Owner", cell(p?.ownerName ?? lp.owner)],
            ["Tags", p ? cell(p.tags.join(", ")) : "…"], ["Last activity", p ? date(p.lastActivityAt) : "…"]];
          return (
            <li key={lp.contactId} className="rounded-lg border bg-card p-3" data-testid="dq-copy">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 text-sm"><b>{lp.name}</b>
                  {kept && <span className="rounded-md border border-primary/40 px-1.5 py-0.5 text-xs text-primary" data-testid="dq-copy-kept">Kept by default</span>}
                  {chips.map((c) => <span key={c.reason} title={c.title} className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs" data-testid="dq-copy-chip" data-reason={c.reason}><ShieldCheck aria-hidden className="size-3" />{c.text}</span>)}
                </p>
                <span className="inline-flex flex-wrap items-center gap-1">
                  <OpenLeadButton seed={{ contactId: lp.contactId, locationId: g.locationId, name: lp.name, locationName: g.locationName, phone: lp.phone, email: lp.email, owner: lp.owner, url: lp.url, dnd: p?.dnd ?? lp.dnd }} name={lp.name} showAccount={false} testId="dq-copy-open" />
                  <a href={lp.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary" data-testid="dq-copy-crm"><ExternalLink aria-hidden className="size-3.5" />Open in your CRM</a>
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {facts.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
                <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><dt className="w-20 shrink-0 text-muted-foreground">Activity</dt>
                  <dd className="min-w-0">{p ? [p.openDeals > 0 ? `${p.openDeals} open ${p.openDeals === 1 ? "deal" : "deals"}` : "No open deals", p.nextAppointmentAt ? `Coming appointment ${date(p.nextAppointmentAt)}` : "No coming appointment"].join(" · ") : "…"}</dd></div>
              </dl>
            </li>
          );
        })}
      </ul>
      {d.error && <p className="mt-2 text-xs text-muted-foreground" role="status">More details could not load. The copies above are still right.</p>}
      <p className="mt-2 text-xs text-muted-foreground">The kept copy is only a suggestion. You choose in Merge.</p>
    </div>
  );
}
