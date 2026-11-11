"use client";

import { AlertTriangle, Clock, ExternalLink, MoreHorizontal, Phone, Sparkles } from "lucide-react";
import { shortWords } from "@/lib/analytics/unanswered-v2";
import { PopMenu } from "../ds";
import { fmtMoney } from "../ui";
import { Slot, useRoom, type UiRow } from "./unanswered-slots";
import { waitTone, whyLine, type usePersonActions } from "./unanswered-rows";

// One person on the Unanswered screen, in the control-room style. The whole left side is ONE button that opens the lead panel (the full panel, not a reply link); Reply opens the
// conversation in the CRM through the white-label link; the actions of the other slices mount beside it (RowActions) and the older three-dot menu stays. A person who has just
// appeared pulses for a few seconds; the keyboard cursor and the bulk tick are shown. A colour is never alone: the wait always says how long in words.

type Actions = ReturnType<typeof usePersonActions>;
export type PersonListProps = {
  rows: readonly UiRow[]; showAccount: boolean; actions: Actions; tab: "us" | "them"; cursor: number | null; fresh: ReadonlySet<string>;
  selected: ReadonlySet<string> | null; onToggle: (key: string) => void; onCursor: (i: number) => void; onChanged: () => void; testId?: string;
};

const wordsFor = (r: UiRow, tab: "us" | "them") => (tab === "them" ? `Quiet for ${shortWords(r.hours)}` : `Waiting ${shortWords(r.hours)}`);
const tone = (r: UiRow, tab: "us" | "them") => (tab === "them" ? "cyan" : waitTone(r.hours) === "warn" ? "amber" : waitTone(r.hours) === "quiet" ? "quiet" : "cyan");

export function PersonList({ rows, showAccount, actions, tab, cursor, fresh, selected, onToggle, onCursor, onChanged, testId = "wait-list-rows" }: PersonListProps) {
  const { flags } = useRoom();
  return (
    <ul className="ur-list @container" data-testid={testId}>
      {rows.map((r, i) => {
        const isNew = fresh.has(r.key);
        const on = selected?.has(r.key) ?? false;
        return (
          <li key={r.key} data-testid="wait-row" data-hours={r.hours} data-key={r.key} data-cursor={cursor === i ? "1" : undefined} data-new={isNew ? "1" : undefined} data-selected={on ? "1" : undefined} className="ur-row"
            onMouseEnter={() => onCursor(i)}>
            {selected && (
              <label className="ur-tick" title="Select this person">
                <input type="checkbox" checked={on} onChange={() => onToggle(r.key)} aria-label={`Select ${r.name}`} data-testid="wait-row-select" />
              </label>
            )}
            <button type="button" className="ur-main" onClick={() => { onCursor(i); actions.show(r); }} disabled={!r.contactId} data-testid="wait-row-name" aria-label={`${r.name}. ${wordsFor(r, tab)}. Open the person.`}>
              <span className="ur-name">{r.name}{isNew && <span className="s6-chip ur-newchip" data-tone="cyan"><Sparkles aria-hidden className="size-3" />New</span>}</span>
              <span className="ur-why" title={whyLine(r, showAccount)}>{whyLine(r, showAccount)}</span>
            </button>
            <span className="ur-chips">
              <span className="s6-chip ur-wait" data-tone={tone(r, tab)} data-testid="wait-time" data-quiet={waitTone(r.hours) === "quiet" ? "1" : undefined}>
                {tab === "us" && waitTone(r.hours) === "warn" ? <AlertTriangle aria-hidden className="size-3" /> : <Clock aria-hidden className="size-3" />}{wordsFor(r, tab)}
              </span>
              {r.dealValue ? <span className="s6-chip" data-tone="lime" title="Open deal for this person" data-testid="wait-deal">{fmtMoney(r.dealValue)}</span> : null}
              {r.dnd && <span className="s6-chip" data-tone="orange" title="Asked not to be contacted"><Phone aria-hidden className="size-3" />Do not contact</span>}
            </span>
            <span className="ur-acts">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="s6-btn ur-reply" title="Open the conversation in your CRM" data-testid="wait-reply">Reply<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({r.name}, the conversation in your CRM, opens in a new tab)</span></a>
              <Slot name="RowActions" row={r} flags={flags} showAccount={showAccount} onChanged={onChanged} />
              <PopMenu label={`More for ${r.name}`} items={actions.menu(r, showAccount)} testId="wait-row-more" triggerClassName="ur-more"><MoreHorizontal aria-hidden className="size-4" /></PopMenu>
            </span>
            {actions.stripFor(r)}
          </li>
        );
      })}
    </ul>
  );
}
