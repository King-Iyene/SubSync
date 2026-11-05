"use client";

import { useState, type ReactNode } from "react";
import { emailPlan } from "@/lib/analytics/dedupe-review";
import { dialPlan, dialWarnings, emailWarnings, mustStop, type DialWarning, type EmailWarning } from "@/lib/people/dial";
import { copyDetails } from "@/lib/people/person";
import { announceCall, useDialer } from "./dial-button";

// Call and Email for ONE person, the same way everywhere People shows one (a list row, the lead panel, the header search). Both open the CRM through the white-label link:
// the CRM's own dialer and mail box do the rest (it publishes no link straight to them yet, so today they open the person and the page says so once). SubSync never
// places a call and never sends a message. Before a call or an email the person is told if this contact asked not to be contacted, or if it is outside calling hours.
// The Dialer setting (the person's own phone app) is honoured only when they chose it.

export type ActionPerson = {
  key: string; name: string; phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; url: string;
  locationName?: string | null; ownerName?: string | null; why?: string | null;
};

export type Strip =
  | { key: string; kind: "call" | "email"; warnings: Array<DialWarning | EmailWarning>; href: string; same: boolean }
  | { key: string; note: string }
  | null;

export function useContactActions() {
  const { provider, choice, withChoice } = useDialer();
  const [strip, setStrip] = useState<Strip>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const open = (href: string, same: boolean) => window.open(href, same ? "_self" : "_blank", "noopener,noreferrer");

  const call = (p: ActionPerson) => withChoice((c) => {
    const plan = dialPlan(c, { phone: p.phone, email: p.email, contactUrl: p.url });
    if (!plan.href) { setStrip({ key: p.key, note: plan.note }); return; }
    const w = dialWarnings({ dnd: p.dnd, phone: p.phone, timeZone: p.timeZone, now: new Date() });
    if (w.length === 0) { open(plan.href, plan.provider === "phone"); setStrip(null); announceCall(); return; }
    setStrip({ key: p.key, kind: "call", warnings: w, href: plan.href, same: plan.provider === "phone" });
  });

  const email = (p: ActionPerson) => {
    const plan = emailPlan({ email: p.email, contactUrl: p.url });
    if (!plan.href) { setStrip({ key: p.key, note: plan.note }); return; }
    const w = emailWarnings({ dnd: p.dnd, email: p.email });
    if (w.length === 0) { open(plan.href, false); setStrip(null); return; }
    setStrip({ key: p.key, kind: "email", warnings: w, href: plan.href, same: false });
  };

  const copy = async (p: ActionPerson, showAccount: boolean) => {
    const text = copyDetails({ name: p.name, account: showAccount ? p.locationName : null, phone: p.phone, email: p.email, owner: p.ownerName, why: p.why });
    try { await navigator.clipboard.writeText(text); setCopied(p.key); setTimeout(() => setCopied(null), 2000); } catch { window.prompt("Copy this person", text); }
  };

  return { provider, call, email, copy, copied, strip, closeStrip: () => setStrip(null), openStrip: (s: Strip) => { if (s && "href" in s) { open(s.href, s.same); setStrip(null); if (s.kind === "call") announceCall(); } } };
}

export type ContactActions = ReturnType<typeof useContactActions>;

/** The plain line under a row or a button when something needs saying: a warning before the call or email, or "not available" for a person with no number. */
export function ActionStrip({ actions, k, className = "" }: { actions: ContactActions; k: string; className?: string }): ReactNode {
  const s = actions.strip;
  if (!s || s.key !== k) return null;
  if ("note" in s) {
    return <p className={`border-l-2 border-warning py-1 pl-3 text-sm ${className}`} role="status" data-testid="row-note">{s.note} <button type="button" onClick={actions.closeStrip} className="ml-2 min-h-9 font-medium underline">Close</button></p>;
  }
  const verb = s.kind === "call" ? "call" : "email";
  return (
    <div className={`border-l-2 border-warning py-1 pl-3 text-sm ${className}`} role="alertdialog" aria-label={`Before you ${verb}`} data-testid="dial-warning">
      {s.warnings.map((w) => <p key={w.id} className={w.level === "stop" ? "font-semibold" : ""}>{w.text}</p>)}
      <p className="mt-1 flex gap-4">
        <button type="button" onClick={actions.closeStrip} className="min-h-9 font-medium underline" autoFocus>{`Do not ${verb}`}</button>
        <button type="button" onClick={() => actions.openStrip(s)} className="min-h-9 text-muted-foreground underline" data-testid="dial-anyway">{mustStop(s.warnings as DialWarning[]) ? `${verb === "call" ? "Call" : "Email"} anyway` : `${verb === "call" ? "Call" : "Email"} now`}</button>
      </p>
    </div>
  );
}

/** What Call and Email do, per choice. */
export function dialNoteText(provider: string): string {
  return provider === "phone"
    ? "Call opens the phone or softphone on this device, which places the call (your choice in the Call with setting). Email opens the person in your CRM. SubSync itself never places a call or sends a message."
    : provider === "connected"
      ? "Call opens your connected dialer in a new tab, which places the call (your choice in the Call with setting). Email opens the person in your CRM. SubSync itself never places a call or sends a message."
      : "Call and Email open the person in your CRM, where its own dialer and mail box place the call or send the message. SubSync itself never places a call or sends a message.";
}

/** One line, shown once on a page, that says what Call and Email do (and that SubSync sends nothing). */
export function DialNote({ className = "" }: { className?: string }) {
  const { provider } = useDialer();
  return <p className={`text-xs text-muted-foreground ${className}`} data-testid="dial-note">{dialNoteText(provider)}</p>;
}
