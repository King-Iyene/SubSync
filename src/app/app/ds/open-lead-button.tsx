"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { LeadDrawer, type LeadSeed } from "./lead-drawer";

// ONE "Open" button for any list row that has a person on it. It sits at the far end of the row and opens the shared lead panel (the person, their messages, notes, tasks, tags and
// deals, all through the panel's own checked sends), so nobody has to leave SubSync to look at them. "Open in your CRM" stays as a small secondary icon link next to it.
// Nothing here is trusted as proof: the panel fetches through the server, which checks that the account belongs to the signed-in user. When the person is not known (or asked not to be
// contacted) the reason is shown as one plain line instead of a dead button. Clicks and keys stop here so a clickable row behind it does not also fire.

type Props = {
  /** What the panel opens with; null when the row has no person (then `reason` says why). */
  seed: LeadSeed | null;
  /** The person's page in your CRM (small secondary link). */
  crmUrl?: string | null;
  /** One plain line when there is nobody to open, or a note about messaging (asked not to be contacted). */
  reason?: string | null;
  /** Name used in the accessible label. */
  name?: string;
  /** Say which client account the person belongs to inside the panel (lists across accounts). */
  showAccount?: boolean;
  testId?: string;
};

export function OpenLeadButton({ seed, crmUrl, reason, name, showAccount = true, testId = "open-lead" }: Props) {
  const [open, setOpen] = useState(false);
  const who = name ?? seed?.name ?? "this person";
  return (
    <span className="inline-flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-testid={`${testId}-wrap`}>
      {seed ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={`Open ${who}`} title={reason ?? "See them, note, task, tag and message them without leaving SubSync"} data-testid={testId}
          className="inline-flex min-h-9 shrink-0 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-8">Open</button>
      ) : <span className="max-w-[16rem] text-right text-xs text-muted-foreground" data-testid={`${testId}-reason`}>{reason ?? "No person is linked to this row."}</span>}
      {crmUrl && (
        <a href={crmUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${who} in your CRM (new tab)`} title="Open in your CRM" data-testid={`${testId}-crm`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary sm:size-8"><ExternalLink aria-hidden className="size-3.5" /></a>
      )}
      {seed && open && <LeadDrawer leads={[seed]} index={0} onIndex={() => undefined} onClose={() => setOpen(false)} showAccount={showAccount} />}
    </span>
  );
}
