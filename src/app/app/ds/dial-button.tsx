"use client";

import { Phone } from "lucide-react";
import { useState } from "react";
import { dialPlan, dialWarnings } from "@/lib/people/dial";

// The Dial button (stage F10, KF-3). By default it opens the CRM's own dialer for the contact through the white-label link; the CRM publishes no link that opens
// its dialer directly, so today it opens the contact in the CRM and says so. SubSync
// builds no telephony. Before any dial the person is told if the contact asked not to be contacted, or if it is outside calling hours where the account is.

export function DialButton({ phone, contactUrl, dnd, timeZone }: { phone: string | null | undefined; contactUrl: string | null | undefined; dnd?: boolean; timeZone?: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const plan = dialPlan({ phone, contactUrl });
  const btn = "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium";
  if (dnd === true) return <button type="button" disabled className={`${btn} cursor-not-allowed text-muted-foreground opacity-70`} data-testid="dial-button"><Phone aria-hidden className="size-4" />Do not call</button>;
  if (!plan.href) return null;
  const href = plan.href;
  const warnings = open ? dialWarnings({ dnd: false, phone, timeZone: timeZone ?? null, now: new Date() }) : [];
  const go = () => { window.open(href, "_blank", "noopener,noreferrer"); setOpen(false); };
  const press = () => {
    const w = dialWarnings({ dnd: false, phone, timeZone: timeZone ?? null, now: new Date() }).filter((x) => x.id === "quiet_hours");
    if (w.length === 0) go(); else setOpen(true);
  };
  return (
    <span className="inline-flex min-w-0 flex-col items-end gap-1">
      <button type="button" onClick={press} className={`${btn} hover:border-primary/40`} data-testid="dial-button"><Phone aria-hidden className="size-4" />Call</button>
      {open && (
        <span className="block max-w-xs text-xs" role="alertdialog" aria-label="Before you call" data-testid="dial-warning">
          {warnings.filter((w) => w.id === "quiet_hours").map((w) => <span key={w.id} className="block">{w.text}</span>)}
          <span className="mt-1 flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 font-medium underline" autoFocus>Cancel</button>
            <button type="button" onClick={go} className="min-h-9 text-muted-foreground underline" data-testid="dial-anyway">Call now</button>
          </span>
        </span>
      )}
    </span>
  );
}
