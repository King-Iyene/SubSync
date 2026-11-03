"use client";

import { useState } from "react";
import { dialPlan, dialWarnings, mustStop } from "@/lib/people/dial";

// The Dial button (stage F10, KF-3). By default it opens the CRM's own dialer for the contact through the white-label link; the CRM publishes no link that opens
// its dialer directly, so today it opens the contact in the CRM and says so. SubSync
// builds no telephony. Before any dial the person is told if the contact asked not to be contacted, or if it is outside calling hours where the account is.

export function DialButton({ phone, contactUrl, dnd, timeZone, compact }: { phone: string | null | undefined; contactUrl: string | null | undefined; dnd?: boolean; timeZone?: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const plan = dialPlan({ phone, contactUrl });
  if (!plan.href) return <span className="text-xs text-muted-foreground">{plan.note}</span>;
  const href = plan.href;
  const warnings = open ? dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() }) : [];
  const go = () => { window.open(href, "_blank", "noopener,noreferrer"); setOpen(false); };
  const press = () => {
    const w = dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() });
    if (w.length === 0) go(); else setOpen(true);
  };
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button type="button" onClick={press} className="min-h-9 text-left text-sm font-medium text-primary underline underline-offset-2" data-testid="dial-button">{plan.label}</button>
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
