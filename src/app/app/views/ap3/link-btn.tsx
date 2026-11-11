"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

// The calm inline action link of the Appointments module: small, an arrow, a clear hover and focus state, a 44px tap target on a phone. One look everywhere (styles: ap3.css, `.ap3 .ap-link`).

/** An in-app action ("Open account health"). */
export function LinkBtn({ onClick, children, testId, title, className = "" }: { onClick: () => void; children: ReactNode; testId?: string; title?: string; className?: string }) {
  return <button type="button" className={`ap-link apx-go ${className}`} onClick={onClick} data-testid={testId} title={title}>{children}<ArrowRight aria-hidden className="size-3.5" /></button>;
}

/** A link that leaves the app (the person in your CRM). Opens in a new tab. */
export function LinkOut({ href, children, testId, label }: { href: string; children: ReactNode; testId?: string; label?: string }) {
  return <a className="ap-link apx-go" href={href} target="_blank" rel="noopener noreferrer" data-testid={testId} aria-label={label}>{children}<ArrowUpRight aria-hidden className="size-3.5" /></a>;
}
