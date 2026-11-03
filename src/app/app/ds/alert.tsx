"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

// The one lightweight message style (N9): a plain row of text with a thin rule on its left in the status colour. No icon, no tinted box, no glow. The
// words carry the meaning (colour is never the only signal), and a title, when there is one, is just the first words in medium weight. It is for notices
// ("3 accounts need approval", "this list is capped"), never for content. Content lives in cards and sections; a notice never does.
export type AlertTone = "info" | "success" | "warning" | "danger";

const STYLE: Record<AlertTone, { rule: string; role: "status" | "alert" }> = {
  info: { rule: "border-primary", role: "status" },
  success: { rule: "border-success", role: "status" },
  warning: { rule: "border-warning", role: "status" },
  danger: { rule: "border-destructive", role: "alert" },
};

export function InlineAlert({ tone = "info", title, children, action, onDismiss, className = "" }: { tone?: AlertTone; title?: string; children?: ReactNode; action?: ReactNode; onDismiss?: () => void; className?: string }) {
  const s = STYLE[tone];
  return (
    <div role={s.role} data-testid="inline-alert" data-tone={tone} className={`flex items-start gap-3 border-l-2 py-1 pl-3 text-sm print:hidden ${s.rule} ${className}`}>
      <div className="min-w-0 flex-1 leading-5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "text-muted-foreground" : ""}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"><X aria-hidden className="size-3.5" /></button>}
    </div>
  );
}
