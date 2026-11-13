"use client";

import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { emailPlan } from "@/lib/analytics/dedupe-review";
import { OVER_A_WEEK_HOURS, shortWords } from "@/lib/analytics/unanswered-v2";
import { hasRepeatUnread, UNANSWERED_OUTCOMES, type UnansweredOutcome } from "@/lib/analytics/unanswered-advanced";
import { CALL_NOTE } from "@/lib/analytics/waiting-view";
import { dialPlan, dialWarnings, mustStop, type DialWarning } from "@/lib/people/dial";
import { useApiClient } from "../session";
import { LeadDrawer, PopMenu, RowButton, useDialer, type LeadSeed, type MenuItem } from "../ds";

// One person who is waiting for a reply: one row, one grid, one small button column and a quiet three-dot menu (KF-8). Reply opens the conversation in the CRM through the
// white-label link. Show person opens the shared lead panel. Call and Email in the menu open the contact in the CRM (its own dialer and mail box), or your own phone app
// only if the person chose that in the Dialer setting; SubSync sends a message only when a person presses Send. Before a call the person is told if the customer asked not to be contacted or if it is
// outside calling hours. SubSync keeps no message text (a promise on this screen), so a row says who, which channel, how long and who owns them, and Reply opens the message.

export type WaitRow = {
  key: string; locationId: string; locationName: string; contactId: string | null; conversationId: string; name: string; channel: string; call: boolean;
  hours: number; conversations: number; unreadMessages: number; owner: { id: string; label: string; state: string } | null; unassigned: boolean;
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; newLead: boolean;
  /** The conversation in the CRM (Reply) and the contact in the CRM (the panel, Call, Email), both through the white-label link helper on the server. */
  url: string; contactUrl: string;
};

/** The words about a person, one line: where, which channel, who owns them, and anything to be careful about. */
export function whyLine(r: WaitRow, showAccount: boolean): string {
  const bits: string[] = [];
  if (showAccount) bits.push(r.locationName);
  bits.push(r.call ? "Call, result not known" : r.channel);
  bits.push(r.owner ? `Owner ${r.owner.label}` : "No owner");
  if (r.conversations > 1) bits.push(`${r.conversations} conversations`);
  if (hasRepeatUnread(r.unreadMessages)) bits.push(`${r.unreadMessages} unread messages`);
  if (r.dnd) bits.push("Asked not to be contacted");
  return bits.join(" · ");
}

export const waitText = (r: Pick<WaitRow, "hours">) => `Waiting ${shortWords(r.hours)}`;
/** Day-old waits are the ones to chase (warning); a wait of a week or more is quiet, never an alarm. */
export const waitTone = (hours: number): "warn" | "normal" | "quiet" => (hours >= OVER_A_WEEK_HOURS ? "quiet" : hours >= 24 ? "warn" : "normal");
const toneClass = (hours: number) => (waitTone(hours) === "warn" ? "font-medium text-warning" : waitTone(hours) === "quiet" ? "text-muted-foreground" : "");

export const toSeed = (r: WaitRow): LeadSeed => ({
  contactId: r.contactId as string, locationId: r.locationId, name: r.name, locationName: r.locationName, url: r.contactUrl, phone: r.phone, dnd: r.dnd, timeZone: r.timeZone,
  unassigned: r.unassigned, owner: r.owner && r.owner.state === "named" ? r.owner.label : null,
  note: [`${waitText(r)} on ${r.call ? "a call" : r.channel.toLowerCase()}.`, r.call ? CALL_NOTE : null].filter(Boolean).join(" "),
});

const MENU_TRIGGER = "ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:size-8";
const TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_9.5rem_6rem_2rem]";

/** What a row's menu does, the warning strip under a row, and the lead panel. One instance serves a whole list. */
export function usePersonActions(rows: readonly WaitRow[], canRecordOutcome = true) {
  const api = useApiClient();
  const { provider } = useDialer();
  const [open, setOpen] = useState<number | null>(null);
  const [strip, setStrip] = useState<{ key: string; warnings: DialWarning[]; href: string; same: boolean } | { key: string; note: string } | { key: string; outcome: true } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const withContact = rows.filter((r) => r.contactId);

  const call = (r: WaitRow) => {
    const plan = dialPlan(provider, { phone: r.phone, contactUrl: r.contactUrl });
    if (!plan.href) { setStrip({ key: r.key, note: plan.note }); return; }
    const w = dialWarnings({ dnd: r.dnd, phone: r.phone, timeZone: r.timeZone, now: new Date() });
    if (w.length === 0) { window.open(plan.href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); return; }
    setStrip({ key: r.key, warnings: w, href: plan.href, same: plan.provider === "phone" });
  };
  const email = (r: WaitRow) => {
    const p = emailPlan({ email: r.email, contactUrl: r.contactUrl });
    if (!p.href) { setStrip({ key: r.key, note: p.note }); return; }
    window.open(p.href, "_blank", "noopener,noreferrer");
  };
  const copy = async (r: WaitRow, showAccount: boolean) => {
    const text = `${r.name}${showAccount ? `, ${r.locationName}` : ""}: ${waitText(r).toLowerCase()} on ${r.call ? "a call" : r.channel.toLowerCase()}${r.phone ? `, ${r.phone}` : ""}${r.email ? `, ${r.email}` : ""}`;
    try { await navigator.clipboard.writeText(text); setCopied(r.key); setTimeout(() => setCopied(null), 2000); } catch { window.prompt("Copy these details", text); }
  };
  const show = (r: WaitRow) => { const at = withContact.findIndex((x) => x.key === r.key); if (at >= 0) setOpen(at); };
  const recordOutcome = async (r: WaitRow, outcome: UnansweredOutcome) => {
    try {
      await api.post("inbox/outcome", { locationId: r.locationId, conversationId: r.conversationId, outcome });
      setStrip({ key: r.key, note: "Saved in SubSync. This does not change the CRM." });
    } catch (error) {
      setStrip({ key: r.key, note: error instanceof Error ? error.message : "Could not save this outcome." });
    }
  };
  const menu = (r: WaitRow, showAccount: boolean): MenuItem[] => [
    { key: "show", label: "Show person", onSelect: () => show(r), disabled: !r.contactId, hint: r.contactId ? undefined : "No contact on file" },
    { key: "call", label: r.dnd ? "Call (asked not to be contacted)" : "Call in your CRM", onSelect: () => call(r), disabled: !r.phone, hint: r.phone ? undefined : "No phone number" },
    { key: "email", label: "Email in your CRM", onSelect: () => email(r), disabled: !r.email, hint: r.email ? undefined : "No email address" },
    ...(canRecordOutcome ? [{ key: "outcome", label: "Record follow-up outcome", onSelect: () => setStrip({ key: r.key, outcome: true }) }] : []),
    { key: "copy", label: copied === r.key ? "Copied" : "Copy details", onSelect: () => void copy(r, showAccount) },
  ];
  const stripFor = (r: WaitRow): ReactNode => {
    if (!strip || strip.key !== r.key) return null;
    if ("outcome" in strip) {
      const labels: Record<UnansweredOutcome, string> = {
        replied: "Replied", appointment_booked: "Appointment booked", not_a_lead: "Not a lead", needs_follow_up: "Needs follow-up",
      };
      return (
        <div className="col-span-full border-l-2 border-primary/50 py-2 pl-3 text-sm" role="group" aria-label="Record follow-up outcome" data-testid="outcome-choices">
          <p className="mb-1">This note stays in SubSync; nothing is written to the CRM.</p>
          <div className="flex flex-wrap gap-2">
            {UNANSWERED_OUTCOMES.map((outcome) => <button key={outcome} type="button" onClick={() => void recordOutcome(r, outcome)} className="min-h-9 rounded-md border px-2.5 font-medium hover:bg-muted">{labels[outcome]}</button>)}
            <button type="button" onClick={() => setStrip(null)} className="min-h-9 px-2 font-medium underline">Cancel</button>
          </div>
        </div>
      );
    }
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
  const drawer = <LeadDrawer leads={withContact.map(toSeed)} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />;
  return { menu, stripFor, drawer, show };
}

export function PersonRows({ rows, showAccount, actions, testId = "wait-rows", head = true }: { rows: readonly WaitRow[]; showAccount: boolean; actions: ReturnType<typeof usePersonActions>; testId?: string; head?: boolean }) {
  return (
    <ul className="@container divide-y border-y" data-testid={testId}>
      {head && <li aria-hidden className={`hidden gap-x-3 py-1.5 pl-1 pr-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @3xl:grid ${TRACKS}`}><span>Customer</span><span>Waiting</span><span /><span /></li>}
      {rows.map((r) => {
        return (
          <li key={r.key} data-testid="wait-row" data-hours={r.hours} className={`ds-row grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] items-center gap-x-3 gap-y-0.5 py-2 pl-1 pr-1 ${TRACKS}`}>
            <div className="min-w-0">
              {r.contactId
                ? <button type="button" onClick={() => actions.show(r)} className="block min-h-6 max-w-full truncate text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={r.name} data-testid="wait-row-name">{r.name}</button>
                : <p className="min-h-6 max-w-full truncate font-semibold" title={r.name} data-testid="wait-row-name">{r.name}</p>}
              <p className="line-clamp-2 text-sm text-muted-foreground @3xl:truncate" title={whyLine(r, showAccount)}>{whyLine(r, showAccount)}</p>
              <p className={`text-xs @3xl:hidden ${toneClass(r.hours)}`}>{waitText(r)}</p>
            </div>
            <p className={`tnum hidden items-center gap-1.5 text-sm @3xl:flex ${toneClass(r.hours)}`} data-testid="wait-time">
              {waitText(r)}
            </p>
            <div><RowButton {...(r.contactId ? { onClick: () => actions.show(r) } : { href: r.url })} label="Reply" sr={`${r.name}, open them here`} testId="wait-reply" /></div>
            <div><PopMenu label={`More for ${r.name}`} items={actions.menu(r, showAccount)} testId="wait-row-more" triggerClassName={MENU_TRIGGER}><MoreHorizontal aria-hidden className="size-4" /></PopMenu></div>
            {actions.stripFor(r)}
          </li>
        );
      })}
    </ul>
  );
}
