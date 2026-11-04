"use client";

import { ExternalLink, MoreHorizontal } from "lucide-react";
import { useCallback, type KeyboardEvent } from "react";
import { rowLine } from "@/lib/people/rows";
import type { PersonRowOut } from "@/lib/people/types";
import { ActionStrip, PopMenu, useNow, type ActionPerson, type ContactActions, type LeadSeed, type MenuItem } from "../ds";

// One person on a list, the same everywhere People shows people (a search, a call list, a saved list, a tag day, going cold). The rule (KF-8): one line with the name, one line of
// reason, ONE small button in its own column (Call, 44 px high on a phone so a thumb can hit it) and a quiet three-dot menu for the rest. Colour is only ever status: "Do not
// disturb" is written in words. j and k (or the arrow keys) move from name to name while the focus is in the list, Enter opens the person.

export type PersonUi = PersonRowOut;

/** What a person's panel needs from a row. A smaller row (a person in a tag's day) has no email or reason: those are simply left out. */
export type SeedFrom = Pick<PersonRowOut, "contactId" | "locationId" | "name" | "locationName" | "phone" | "owner" | "ownerName" | "url" | "dnd" | "timeZone"> & { email?: string | null; why?: string };
export const toSeed = (r: SeedFrom): LeadSeed => ({
  contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, phone: r.phone, email: r.email ?? null, owner: r.owner ? r.ownerName : null, unassigned: !r.owner,
  url: r.url, dnd: r.dnd, timeZone: r.timeZone, pending: r.why || undefined,
});

export const actionPerson = (r: PersonRowOut, key = r.rowId): ActionPerson => ({ key, name: r.name, phone: r.phone, email: r.email, dnd: r.dnd, timeZone: r.timeZone, url: r.url, locationName: r.locationName, ownerName: r.owner ? r.ownerName : null, why: r.why || null });

const ACTION_BUTTON = "ds-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md border bg-card px-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] @3xl:h-8";
const MENU_TRIGGER = "ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:size-8";

export function PersonRows({ rows, showAccount, actions, onOpen, testId = "people-rows", empty }: {
  rows: readonly PersonRowOut[]; showAccount: boolean; actions: ContactActions; onOpen: (index: number) => void; testId?: string; empty?: string;
}) {
  const now = useNow(60_000);
  const move = useCallback((e: KeyboardEvent<HTMLUListElement>) => {
    const el = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
    if (dir === 0) return;
    const names = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-row-primary]")];
    const at = names.findIndex((n) => n === document.activeElement || n.closest("li")?.contains(document.activeElement));
    const next = names[Math.min(names.length - 1, Math.max(0, at === -1 ? 0 : at + dir))];
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: "nearest" }); }
  }, []);
  if (rows.length === 0) return empty ? <p className="border-y py-6 text-center text-sm text-muted-foreground" data-testid={`${testId}-empty`}>{empty}</p> : null;
  return (
    <ul className="@container divide-y border-y" data-testid={testId} onKeyDown={move}>
      {rows.map((r, i) => {
        const p = actionPerson(r);
        const line = rowLine({ name: r.name, why: r.why, locationName: r.locationName, phone: r.phone, email: r.email, owner: r.owner, ownerName: r.ownerName, lastActivityAt: r.lastActivityAt, dateAdded: r.dateAdded }, { showAccount, nowMs: now });
        const items: MenuItem[] = [
          { key: "show", label: "Show this person", onSelect: () => onOpen(i) },
          { key: "call", label: r.dnd ? "Call (asked not to be contacted)" : "Call in your CRM", onSelect: () => actions.call(p), disabled: !r.phone, hint: r.phone ? undefined : "No phone number" },
          { key: "email", label: r.dnd ? "Email (asked not to be contacted)" : "Email in your CRM", onSelect: () => actions.email(p), disabled: !r.email, hint: r.email ? undefined : "No email address" },
          { key: "crm", label: "Open in your CRM", onSelect: () => { window.open(r.url, "_blank", "noopener,noreferrer"); } },
          { key: "copy", label: actions.copied === r.rowId ? "Copied" : "Copy details", onSelect: () => void actions.copy(p, showAccount) },
        ];
        return (
          <li key={r.rowId} data-testid="person-row" data-dnd={r.dnd ? "true" : "false"} className="ds-row grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-x-3 gap-y-0.5 py-2 pl-1 pr-1 @3xl:grid-cols-[minmax(0,1fr)_6rem_2rem]">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <button type="button" data-row-primary onClick={() => onOpen(i)} className="block min-h-6 max-w-full truncate text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={r.name} data-testid="person-name">{r.name}</button>
                {r.dnd && <span className="shrink-0 text-xs font-medium text-warning" data-testid="person-dnd">Do not disturb</span>}
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground @3xl:truncate" title={line} data-testid="person-line">{line}</p>
            </div>
            <div>
              {r.phone
                ? <button type="button" onClick={() => actions.call(p)} className={ACTION_BUTTON} data-testid="person-call">Call<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> {r.name}, in your CRM</span></button>
                : <button type="button" onClick={() => onOpen(i)} className={ACTION_BUTTON} data-testid="person-show">Show<span className="sr-only"> {r.name}</span></button>}
            </div>
            <div><PopMenu label={`More for ${r.name}`} items={items} testId="person-more" triggerClassName={MENU_TRIGGER}><MoreHorizontal aria-hidden className="size-4" /></PopMenu></div>
            <div className="col-span-full empty:hidden"><ActionStrip actions={actions} k={r.rowId} /></div>
          </li>
        );
      })}
    </ul>
  );
}
