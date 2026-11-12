"use client";

import { useState } from "react";
import { dialPlan, dialWarnings, mustStop, type DialerChoice } from "@/lib/people/dial";

// The Call button. SubSync sticks to the CRM's own calling: Call opens the contact in the CRM (through the white-label link helper), where its own dialer places the call.
// There is no choice of call provider in the screens any more (removed 11 Nov 2026). The stored per-person preference and its route are kept, unused. SubSync builds no
// telephony. Before any call the person is told if the contact asked not to be contacted, or if it is outside calling hours where the account is.

const CRM_CHOICE: DialerChoice = { provider: "crm" };

/** Tells the open lead panel that a call was just started, so "Log how the call went" opens and the result can be written to the CRM. */
export const CALL_STARTED = "subsync:call-started";
export const announceCall = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CALL_STARTED)); };

/** How Call works: always the CRM's own dialer. A hook so every Call button shares one place that decides. */
export function useDialer() {
  const withChoice = (go: (c: DialerChoice) => void) => go(CRM_CHOICE);
  return { provider: CRM_CHOICE.provider, choice: CRM_CHOICE, withChoice };
}

export function DialButton({ phone, contactUrl, dnd, timeZone, compact }: { phone: string | null | undefined; contactUrl: string | null | undefined; dnd?: boolean; timeZone?: string | null; compact?: boolean }) {
  const { choice, withChoice } = useDialer();
  const [open, setOpen] = useState(false);
  const plan = dialPlan(choice, { phone, contactUrl });
  if (!plan.href) return <span className="text-xs text-muted-foreground">{plan.note}</span>;
  const href = plan.href;
  const warnings = open ? dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() }) : [];
  const go = () => { window.open(href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); setOpen(false); announceCall(); };
  const press = () => withChoice((c) => {
    const p = dialPlan(c, { phone, contactUrl });
    const w = dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() });
    if (!p.href) return;
    if (w.length === 0) { window.open(p.href, p.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); announceCall(); } else setOpen(true);
  });
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button type="button" onClick={press} className="min-h-9 cursor-pointer text-left text-sm font-medium text-primary underline underline-offset-2" data-testid="dial-button">{plan.label}</button>
      {!compact && !open && <span className="max-w-xs text-xs text-muted-foreground" data-testid="dial-note">{plan.note}</span>}
      {open && (
        <span className="block max-w-sm border-l-2 border-warning py-1 pl-3 text-sm" role="alertdialog" aria-label="Before you call" data-testid="dial-warning">
          {warnings.map((w) => <span key={w.id} className={`block ${w.level === "stop" ? "font-semibold" : ""}`}>{w.text}</span>)}
          <span className="mt-2 flex gap-3">
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 font-medium underline" autoFocus>Do not call</button>
            <button type="button" onClick={go} className="min-h-9 text-muted-foreground underline" data-testid="dial-anyway">{mustStop(warnings) ? "Call anyway" : "Call now"}</button>
          </span>
        </span>
      )}
    </span>
  );
}
