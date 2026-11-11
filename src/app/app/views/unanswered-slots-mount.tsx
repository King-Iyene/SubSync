"use client";

import { ListChecks } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PopMenu } from "../ds";
import { ActionPanel, HiddenPeople, peekActionCaps, useActionCaps, useWaitingActions, type Kind } from "./unanswered-actions-ui";
import { BenchmarkCard, ChannelsCard, ClockCard, CurveCard, ProofCard, ReceiptCard, ScorecardsCard, SetupCard } from "./moat-panel";
import { registerUnansweredAction, registerUnansweredSlot, useRoom, type Flags, type UiRow } from "./unanswered-slots";

// The one place the finished pieces of other slices are plugged into the Unanswered screen (round 3 integration). Each piece decides for itself, from its own flag and from what
// the server says this person may do, whether it shows; a switched-off piece leaves no gap. Nothing here reads data of its own: the pieces call their own endpoints.

const ACT_EVENT = "unanswered:act";

// ---------------- actions beside a person (claim, assign, set aside, note, what happened, clear) ----------------

/** The actions menu for one person, and the panel it opens (drawn under the person's row, through the row's own list item). */
function RowActionsPiece({ row, onChanged }: { row: UiRow; flags: Flags; showAccount: boolean; onChanged: () => void }) {
  const wa = useWaitingActions({ rows: [row], onChanged });
  const items = wa.menuItems(row);
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  // the keys (c, s) ask the person's own menu to open the matching panel: the same preview and confirm as the menu
  const open = wa.open;
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ kind: Kind; key: string }>).detail; if (d.key === row.key) open(row, d.kind); };
    window.addEventListener(ACT_EVENT, on);
    return () => window.removeEventListener(ACT_EVENT, on);
  }, [row, open]);
  useEffect(() => { setHost(anchor.current?.closest("li") ?? null); }, []);
  const strip = wa.strip(row);
  return (
    <>
      <span ref={anchor} hidden />
      {items.length > 0 && (
        <PopMenu label={`Actions for ${row.name}`} items={items} testId="wait-row-actions" triggerClassName="ur-more"><ListChecks aria-hidden className="size-4" /></PopMenu>
      )}
      {strip && host ? createPortal(strip, host) : null}
    </>
  );
}

/** The buttons for several chosen people (one client account at a time) and the panel they open, in the floating bar. */
function BulkActionsPiece({ rows, onChanged, clear }: { rows: UiRow[]; flags: Flags; clear: () => void; onChanged: () => void }) {
  const caps = useActionCaps();
  const [kind, setKind] = useState<Kind | null>(null);
  const oneAccount = rows.every((r) => r.locationId === rows[0]?.locationId);
  const withContact = rows.every((r) => r.contactId);
  const btn = "s6-btn";
  if (rows.length === 0) return null;
  return (
    <>
      {caps.assign && <button type="button" className={btn} disabled={!oneAccount || !withContact || rows.length > caps.caps.assign * 3} onClick={() => setKind("assign")} data-testid="bulk-assign">Assign owner</button>}
      {caps.snooze && <button type="button" className={btn} disabled={!oneAccount || rows.length > 50} onClick={() => setKind("snooze")} data-testid="bulk-snooze">Set aside</button>}
      {caps.outcome && <button type="button" className={btn} disabled={!oneAccount} onClick={() => setKind("outcome")} data-testid="bulk-outcome">What happened?</button>}
      {caps.clearJunk && <button type="button" className={btn} disabled={!oneAccount || rows.length > caps.caps.clear * 3} onClick={() => setKind("clear")} data-testid="bulk-clear">Clear junk</button>}
      {!oneAccount && (caps.assign || caps.snooze || caps.outcome || caps.clearJunk) && <span className="s6-label basis-full text-center">Choose people from one client account at a time.</span>}
      {kind && oneAccount && (
        <div className="basis-full max-h-[50vh] overflow-y-auto text-left">
          <ActionPanel kind={kind} targets={rows} caps={caps} onClose={() => setKind(null)} onChanged={() => { setKind(null); clear(); onChanged(); }} />
        </div>
      )}
    </>
  );
}

function ListFooterPiece({ account, onChanged }: { flags: Flags; account: string | null; onChanged: () => void }) {
  return <HiddenPeople onChanged={onChanged} account={account} />;
}

// The keys: they open the same preview-and-confirm panel as the menu, so a key press never changes anything by itself.
const keyAction = (kind: "claim" | "snooze") => (row: UiRow) => {
  const caps = peekActionCaps();
  if (!caps || !(kind === "claim" ? caps.claim && row.unassigned && !!row.contactId : caps.snooze)) return false;
  window.dispatchEvent(new CustomEvent(ACT_EVENT, { detail: { kind, key: row.key } }));
  return undefined;
};

// ---------------- the proof cards (receipts, curve, scorecards, benchmark, verified page) ----------------

const anyOn = (...names: string[]) => (f: Flags) => names.some((n) => f[n] === true);

function ReceiptPiece() { return <ReceiptCard q="" />; }
function CurvePiece() { return <CurveCard q="" />; }
function ScorecardPiece() { return <ScorecardsCard q="" />; }
function BenchmarkPiece() { return <BenchmarkCard />; }
/** The verified reply-time page, the wait clocks, the channel mix and the per-account set-up share one place, behind More. */
function ProofPiece() {
  const { flags, kind } = useRoom();
  return (
    <div className="grid gap-4">
      {flags.moat_proof_page === true && <ProofCard />}
      {flags.inbox_wait_clock === true && <ClockCard q="" />}
      {flags.inbox_channel_mix === true && <ChannelsCard q="" />}
      {kind !== "client" && anyOn("moat_benchmark", "inbox_reply_target")(flags) && <SetupCard features={flags} />}
    </div>
  );
}

registerUnansweredSlot("RowActions", RowActionsPiece, anyOn("inbox_claim", "inbox_assign", "inbox_snooze", "inbox_note", "inbox_outcome_ui", "inbox_clear_junk"));
registerUnansweredSlot("BulkActions", BulkActionsPiece, anyOn("inbox_assign", "inbox_snooze", "inbox_outcome_ui", "inbox_clear_junk"));
registerUnansweredSlot("ListFooter", ListFooterPiece, anyOn("inbox_snooze", "inbox_hide_noise"));
registerUnansweredSlot("ReceiptCard", ReceiptPiece, anyOn("moat_receipt"));
registerUnansweredSlot("CurveCard", CurvePiece, anyOn("moat_curve"));
registerUnansweredSlot("ScorecardCard", ScorecardPiece, anyOn("moat_scorecards"));
registerUnansweredSlot("BenchmarkCard", BenchmarkPiece, anyOn("moat_benchmark"));
registerUnansweredSlot("VerifiedPageCard", ProofPiece, anyOn("moat_proof_page", "inbox_wait_clock", "inbox_channel_mix"));
registerUnansweredAction("claim", keyAction("claim"));
registerUnansweredAction("snooze", keyAction("snooze"));
