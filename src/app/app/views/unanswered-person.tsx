"use client";

import { AlertTriangle, ExternalLink, MoreHorizontal, PhoneOff, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { shortWords } from "@/lib/analytics/unanswered-v2";
import { DEFAULT_DENSITY, DENSITY_KEY, parseDensity, type Density } from "@/lib/design/list-density";
import { PopMenu } from "../ds";
import { RoleChip } from "../roles";
import { fmtMoney } from "../ui";
import { Slot, useRoom, type UiRow } from "./unanswered-slots";
import { waitTone, whyLine, type usePersonActions } from "./unanswered-rows";

// The people on the Unanswered screen as a dense table, the way a setter works a long list. One row is about 40 pixels (a phone row is two small lines): name, client, owner, channel,
// wait (the colour is the wait, and the words say it too), flags, and the quick actions that appear on hover, on focus or in the row menu. The header stays while the rows scroll inside
// a box of fixed height, so a page of 100 never grows the page. Only the rows of the current page exist in the page (the server pages the list), and the heavier action pieces of
// other slices are mounted for a row only when it is hovered, focused or has the keyboard cursor. Comfortable keeps a second line. The whole left side is ONE button that opens the
// lead panel; Reply opens the conversation in the CRM through the white-label link. Arrow keys move between rows. A colour is never alone. Icons are small: 14px beside text, 16px in a button.

type Actions = ReturnType<typeof usePersonActions>;
export type PersonListProps = {
  rows: readonly UiRow[]; showAccount: boolean; actions: Actions; tab: "us" | "them"; cursor: number | null; fresh: ReadonlySet<string>;
  selected: ReadonlySet<string> | null; onToggle: (key: string) => void; onCursor: (i: number) => void; onChanged: () => void; testId?: string; density?: Density;
};

const wordsFor = (r: UiRow, tab: "us" | "them") => (tab === "them" ? `Quiet for ${shortWords(r.hours)}` : `Waiting ${shortWords(r.hours)}`);
const tone = (r: UiRow, tab: "us" | "them") => (tab === "them" ? "cyan" : waitTone(r.hours) === "warn" ? "amber" : waitTone(r.hours) === "quiet" ? "quiet" : "cyan");

/** The density the person chose, kept in this browser. */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(() => { try { return typeof window === "undefined" ? DEFAULT_DENSITY : parseDensity(window.localStorage.getItem(DENSITY_KEY)); } catch { return DEFAULT_DENSITY; } });
  const set = useCallback((d: Density) => { setDensity(d); try { window.localStorage.setItem(DENSITY_KEY, d); } catch { /* not remembered in a private window */ } }, []);
  return [density, set];
}

export function PersonList({ rows, showAccount, actions, tab, cursor, fresh, selected, onToggle, onCursor, onChanged, testId = "wait-list-rows", density = DEFAULT_DENSITY }: PersonListProps) {
  const { flags } = useRoom();
  // the rows that have been hovered, focused or held the cursor: only their slot pieces are mounted
  const [armed, setArmed] = useState<ReadonlySet<string>>(new Set());
  const arm = (key: string) => setArmed((p) => (p.has(key) ? p : new Set(p).add(key)));
  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const el = e.target as HTMLElement;
    if (el.closest("[role=menu], [role=dialog], input, select, textarea")) return;
    const li = el.closest("li.ur-t-row");
    if (!li) return;
    const next = (e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling) as HTMLElement | null;
    const target = next?.querySelector<HTMLElement>("button.ur-t-main:not(:disabled), a.ur-t-reply");
    if (target) { e.preventDefault(); target.focus(); next?.scrollIntoView({ block: "nearest" }); }
  };
  return (
    <div className="ur-t" data-density={density} data-multi={showAccount ? "1" : undefined} data-testid="wait-table">
      <div className="ur-t-scroll" data-testid="wait-list-scroll">
        <div className="ur-t-head" aria-hidden>
          {selected && <span />}
          <span>Name</span>{showAccount && <span>Client</span>}<span>Owner</span><span>Channel</span>
          <span>{tab === "them" ? "Quiet" : "Waiting"}</span><span>Flags</span><span />
        </div>
        <ul className="ur-t-list" data-testid={testId} onKeyDown={onKeyDown}>
          {rows.map((r, i) => {
            const isNew = fresh.has(r.key);
            const on = selected?.has(r.key) ?? false;
            const hot = cursor === i || armed.has(r.key);
            const owner = r.owner ? r.owner.label : "No owner";
            const channel = r.call ? "Call" : r.channel;
            return (
              <li key={r.key} data-testid="wait-row" data-hours={r.hours} data-key={r.key} data-cursor={cursor === i ? "1" : undefined} data-new={isNew ? "1" : undefined} data-selected={on ? "1" : undefined}
                className="ur-t-row" onMouseEnter={() => { arm(r.key); onCursor(i); }} onFocusCapture={() => arm(r.key)} onTouchStart={() => arm(r.key)}>
                {selected && (
                  <label className="ur-tick" title="Select this person">
                    <input type="checkbox" checked={on} onChange={() => onToggle(r.key)} aria-label={`Select ${r.name}`} data-testid="wait-row-select" />
                  </label>
                )}
                <button type="button" className="ur-t-main" onClick={() => { onCursor(i); actions.show(r); }} disabled={!r.contactId} data-testid="wait-row-name" aria-label={`${r.name}. ${wordsFor(r, tab)}. Open the person.`} title={whyLine(r, showAccount)}>
                  <span className="ur-t-name">{r.name}{isNew && <Sparkles aria-hidden className="ur-t-new size-3.5" />}</span>
                  {density === "comfortable" && <span className="ur-t-sub">{whyLine(r, showAccount)}</span>}
                </button>
                {showAccount && <span className="ur-t-c ur-t-c-acct" title={r.locationName}>{r.locationName}</span>}
                <span className="ur-t-c ur-t-c-owner" data-none={r.owner ? undefined : "1"} title={owner}>{owner}{r.owner && <RoleChip userId={r.owner.id} locationId={r.locationId} />}</span>
                <span className="ur-t-c ur-t-c-chan" title={r.call ? "Call, result not known" : r.channel}>{channel}</span>
                <span className="ur-t-wait" data-tone={tone(r, tab)} data-testid="wait-time" data-quiet={waitTone(r.hours) === "quiet" ? "1" : undefined}>
                  {tab === "us" && waitTone(r.hours) === "warn" && <AlertTriangle aria-hidden className="size-3.5" />}{wordsFor(r, tab)}
                </span>
                <span className="ur-t-flags">
                  {r.dnd && <span className="ur-t-flag" data-tone="orange" title="Asked not to be contacted" data-testid="wait-dnd"><PhoneOff aria-hidden className="size-3.5" />DND</span>}
                  {r.newLead && <span className="ur-t-flag" data-tone="cyan" title="A new lead: Speed to lead times this person" data-testid="wait-newlead">New lead</span>}
                  {r.dealValue ? <span className="ur-t-flag" data-tone="lime" title="Open deal for this person" data-testid="wait-deal">{fmtMoney(r.dealValue)}</span> : null}
                </span>
                <span className="ur-t-meta" aria-hidden>{[showAccount ? r.locationName : null, owner, channel].filter(Boolean).join(" · ")}</span>
                <span className="ur-t-acts" data-hot={hot ? "1" : undefined}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="ur-t-reply" title="Open the conversation in your CRM" data-testid="wait-reply"><span className="ur-t-reply-t">Reply</span><ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({r.name}, the conversation in your CRM, opens in a new tab)</span></a>
                  {hot && <Slot name="RowActions" row={r} flags={flags} showAccount={showAccount} onChanged={onChanged} />}
                  <PopMenu label={`More for ${r.name}`} items={actions.menu(r, showAccount)} testId="wait-row-more" triggerClassName="ur-t-more"><MoreHorizontal aria-hidden className="size-4" /></PopMenu>
                </span>
                {actions.stripFor(r)}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
