"use client";

import { MoreHorizontal, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { emailPlan } from "@/lib/analytics/dedupe-review";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { ageWords } from "@/lib/analytics/today-queue";
import { dialPlan, dialWarnings, mustStop, type DialWarning } from "@/lib/people/dial";
import { LeadDrawer, PopMenu, RowButton, useDialer, type LeadSeed, type MenuItem } from "../ds";
import { PersonName, type PersonView } from "./speed-cards";

// One lead row, one grid, one small button column and a quiet three-dot menu (KF-8). The Reply button opens the lead in the CRM through the white-label link; Call
// and Email in the menu open the CRM's own dialer and mail box the same way (your own phone app only if the person chose it in the Dialer setting, and never
// a message sent from here). Before a call the person is told if the lead asked not to be contacted or if it is outside calling hours (people/dial.ts).

export type LeadRow = {
  locationId: string; locationName: string; contactId: string; name: string; url: string;
  status: "within" | "late" | "waiting"; neverAnswered: boolean; minutes: number; source: string;
  owner: PersonView | null; unassigned: boolean; repliedBy: PersonView | null; autoSeconds: number | null; detailed: boolean;
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null;
  suggestion: { userId?: string; label: string; medianSeconds: number; replies: number } | null;
  /** Stage SPEED5 (Race only): an older record of the same person, whether this is a repeat enquiry, and the next person in line. */
  duplicateOf?: { contactId: string; name: string; score: number; tier: string; reasons: string[]; url?: string } | null; repeat?: boolean;
  roundRobin?: { userId: string; label: string } | null;
};

export const rowKey = (r: LeadRow) => r.locationId + ":" + r.contactId;

/** The words about a lead, one line: where it came from, who owns it (or who might reply), and anything to be careful about. */
export function whyLine(r: LeadRow, showAccount: boolean): string {
  const bits: string[] = [];
  if (showAccount) bits.push(r.locationName);
  if (r.source && r.source !== "No source recorded") bits.push(r.source);
  if (r.status !== "waiting" && r.repliedBy) bits.push(`Replied by ${r.repliedBy.label}`);
  else if (r.owner) bits.push(`Owner ${r.owner.label}`);
  else if (r.suggestion) bits.push(`No owner. ${r.suggestion.label} usually replies fastest here (${fmtDuration(r.suggestion.medianSeconds)})`);
  else bits.push("No owner");
  if (r.dnd) bits.push("Asked not to be contacted");
  return bits.join(" · ");
}

export const waitWords = (r: Pick<LeadRow, "status" | "neverAnswered" | "minutes">): string =>
  r.status === "waiting" ? (r.neverAnswered ? "Never answered" : `Waiting ${ageWords(r.minutes)}`) : r.status === "late" ? `Replied after ${fmtDuration(r.minutes * 60)}` : `Replied in ${fmtDuration(r.minutes * 60)}`;

export const toSeed = (r: LeadRow): LeadSeed => ({
  contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, url: r.url, phone: r.phone, dnd: r.dnd, timeZone: r.timeZone,
  unassigned: r.unassigned, owner: r.owner && r.owner.state === "named" ? r.owner.label : null,
  note: [`${waitWords(r)}.`, r.suggestion && r.unassigned ? `No owner. ${r.suggestion.label} usually replies fastest here.` : null, r.repliedBy && r.status !== "waiting" ? `Replied by ${r.repliedBy.label}.` : null, r.duplicateOf ? `Possible duplicate of ${r.duplicateOf.name}: reply to the older record.` : null, r.repeat ? "Repeat enquirer: they asked again." : null].filter(Boolean).join(" "),
});

const MENU_TRIGGER = "ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:size-8";
const TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_9.5rem_6rem_2rem]";

/** What a row's menu does, the warning strip under a row, and the lead panel. One instance serves a whole list. */
export function useLeadActions(rows: readonly LeadRow[]) {
  const { provider } = useDialer();
  const [open, setOpen] = useState<number | null>(null);
  const [strip, setStrip] = useState<{ key: string; warnings: DialWarning[]; href: string; same: boolean } | { key: string; note: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);

  const call = (r: LeadRow) => {
    const plan = dialPlan(provider, { phone: r.phone, contactUrl: r.url });
    if (!plan.href) { setStrip({ key: rowKey(r), note: plan.note }); return; }
    const w = dialWarnings({ dnd: r.dnd, phone: r.phone, timeZone: r.timeZone, now: new Date() });
    if (w.length === 0) { window.open(plan.href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); return; }
    setStrip({ key: rowKey(r), warnings: w, href: plan.href, same: plan.provider === "phone" });
  };
  const email = (r: LeadRow) => {
    const p = emailPlan({ email: r.email, contactUrl: r.url });
    if (!p.href) { setStrip({ key: rowKey(r), note: p.note }); return; }
    window.open(p.href, "_blank", "noopener,noreferrer");
  };
  const copy = async (r: LeadRow, showAccount: boolean) => {
    const text = `${r.name}${showAccount ? `, ${r.locationName}` : ""}: ${waitWords(r).toLowerCase()}${r.phone ? `, ${r.phone}` : ""}${r.email ? `, ${r.email}` : ""}`;
    try { await navigator.clipboard.writeText(text); setCopied(rowKey(r)); setTimeout(() => setCopied(null), 2000); } catch { window.prompt("Copy this lead", text); }
  };
  const menu = (r: LeadRow, i: number, showAccount: boolean): MenuItem[] => [
    { key: "show", label: "Show this lead", onSelect: () => show(i) },
    { key: "crm", label: "Open in your CRM", onSelect: () => { window.open(r.url, "_blank", "noopener,noreferrer"); } },
    { key: "call", label: r.dnd ? "Call (asked not to be contacted)" : "Call in your CRM", onSelect: () => call(r), disabled: !r.phone, hint: r.phone ? undefined : "No phone number" },
    { key: "email", label: "Email in your CRM", onSelect: () => email(r), disabled: !r.email, hint: r.email ? undefined : "No email address" },
    { key: "copy", label: copied === rowKey(r) ? "Copied" : "Copy details", onSelect: () => void copy(r, showAccount) },
  ];
  const stripFor = (r: LeadRow): ReactNode => {
    if (!strip || strip.key !== rowKey(r)) return null;
    if ("note" in strip) return <p className="col-span-full border-l-2 border-warning py-1 pl-3 text-sm" role="status" data-testid="row-note">{strip.note} <button type="button" onClick={() => setStrip(null)} className="ml-2 min-h-9 font-medium underline">Close</button></p>;
    const go = () => { window.open(strip.href, strip.same ? "_self" : "_blank", "noopener,noreferrer"); setStrip(null); };
    return (
      <div className="col-span-full border-l-2 border-warning py-1 pl-3 text-sm" role="alertdialog" aria-label="Before you call" data-testid="dial-warning">
        {strip.warnings.map((w) => <p key={w.id} className={w.level === "stop" ? "font-semibold" : ""}>{w.text}</p>)}
        <p className="mt-1 flex gap-4">
          <button type="button" onClick={() => setStrip(null)} className="min-h-9 font-medium underline" autoFocus>Do not call</button>
          <button type="button" onClick={go} className="min-h-9 text-muted-foreground underline" data-testid="dial-anyway">{mustStop(strip.warnings) ? "Call anyway" : "Call now"}</button>
        </p>
      </div>
    );
  };
  // Reply opens the same full panel as a click on the name, on the Conversation tab with the message box open and focused, so the last message is in view first. Previous and next keep that mode.
  const show = (i: number) => { setReplying(false); setOpen(i); };
  const reply = (r: LeadRow) => { const i = rows.findIndex((x) => rowKey(x) === rowKey(r)); if (i >= 0) { setReplying(true); setOpen(i); } };
  const drawer = <LeadDrawer leads={rows.map((r) => ({ ...toSeed(r), ...(replying ? { reply: true } : {}) }))} index={open} onIndex={setOpen} onClose={() => { setOpen(null); setReplying(false); }} />;
  return { menu, stripFor, drawer, show, reply };
}

export function LeadRows({ rows, showAccount, actions, testId = "speed-rows", head = true }: { rows: readonly LeadRow[]; showAccount: boolean; actions: ReturnType<typeof useLeadActions>; testId?: string; head?: boolean }) {
  return (
    <ul className="@container divide-y border-y" data-testid={testId}>
      {head && <li aria-hidden className={`hidden gap-x-3 py-1.5 pl-1 pr-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @3xl:grid ${TRACKS}`}><span>Lead</span><span>Status</span><span /><span /></li>}
      {rows.map((r, i) => {
        const bad = r.status === "waiting";
        return (
          <li key={rowKey(r)} data-testid="speed-row" data-status={r.status} data-never={r.neverAnswered ? "true" : "false"} className={`ds-row grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] items-center gap-x-3 gap-y-0.5 py-2 pl-1 pr-1 ${TRACKS}`}>
            <div className="min-w-0">
              <button type="button" onClick={() => actions.show(i)} className="block min-h-6 max-w-full truncate text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={r.name} data-testid="speed-row-name">{r.name}</button>
              <p className="line-clamp-2 text-sm text-muted-foreground @3xl:truncate" title={whyLine(r, showAccount)}>{whyLine(r, showAccount)}</p>
              <p className={`text-xs @3xl:hidden ${bad ? (r.neverAnswered ? "text-destructive" : "text-warning") : "text-muted-foreground"}`}>{waitWords(r)}</p>
            </div>
            <p className={`tnum hidden items-center gap-1.5 text-sm @3xl:flex ${bad ? (r.neverAnswered ? "font-medium text-destructive" : "font-medium text-warning") : "text-muted-foreground"}`} data-testid="speed-wait">
              {r.neverAnswered && <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}{waitWords(r)}
            </p>
            <div><RowButton onClick={() => actions.reply(r)} label="Reply" sr={`reply to ${r.name}`} testId="speed-reply" /></div>
            <div><PopMenu label={`More for ${r.name}`} items={actions.menu(r, i, showAccount)} testId="speed-row-more" triggerClassName={MENU_TRIGGER}><MoreHorizontal aria-hidden className="size-4" /></PopMenu></div>
            {actions.stripFor(r)}
          </li>
        );
      })}
    </ul>
  );
}

export { PersonName };
