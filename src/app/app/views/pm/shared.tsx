"use client";

import type { ReactNode } from "react";
import { fmtMoney } from "@/lib/analytics/payments-format";
import type { PmMoney, PmSource } from "@/lib/analytics/payments-types";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { notSwitchedOn } from "./data";
import { scopeWords } from "@/lib/scope-words";

// Small pieces shared by the Payments screens. Plain words. Money is always one currency at a time.
export const RECONNECT = "Needs permission: reconnect";
export const NOT_FROM_PLATFORM = "Not available from the platform yet";
export const day = (iso: string | null | undefined): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export const ago = (iso: string | null | undefined): string => { if (!iso) return "Never"; const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
export const days = (n: number): string => (n <= 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);

type Loaded<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };
/** Loading, error ("not switched on" is its own plain note) and empty states in one place. */
export function Load<T>({ r, children, empty, label = "Loading payments..." }: { r: Loaded<T>; children: (d: T) => ReactNode; empty?: (d: T) => boolean | string; label?: string }) {
  if (r.loading && !r.data) return <SkeletonRows rows={5} label={label} />;
  if (r.error && notSwitchedOn(r.error)) return <EmptyState title="Not switched on yet" body="This part of Payments is not switched on for your account yet." />;
  if (r.error) return <ErrorState error={r.error as Error} onRetry={r.reload} />;
  if (!r.data) return null;
  const e = empty ? empty(r.data) : false;
  return e ? <EmptyState title="Nothing to show" body={typeof e === "string" ? e : "Nothing here yet."} /> : <>{children(r.data)}</>;
}

/** "$1,450 and EUR 89": one currency at a time, never a single added-up number. */
export function Money({ items, testId }: { items: Array<Pick<PmMoney, "amount" | "currency">>; testId?: string }) {
  if (!items.length) return <span className="pm-money" data-testid={testId}>No money</span>;
  return <span className="pm-money" data-testid={testId}>{items.map((m) => <span key={m.currency}>{fmtMoney(m.amount, m.currency)}</span>)}</span>;
}

/** ONE clear notice for every missing permission, naming each one. */
export function PermissionNotice({ sources }: { sources: PmSource[] }) {
  const need = sources.filter((s) => s.state === "needs_permission");
  if (!need.length) return null;
  return (
    <div className="pm-notice" role="status" data-testid="pm-permission">
      <b>{RECONNECT}.</b> To read {need.map((s) => s.label.toLowerCase()).join(", ")} SubSync needs {need.length === 1 ? "this permission" : "these permissions"}: {need.map((s, i) => <span key={s.scope}>{i ? ", " : ""}{scopeWords(s.scope)}</span>)}. Open SubSync again from your CRM&apos;s app list and accept {need.length === 1 ? "it" : "them"}. The rest of this page keeps working.
    </div>
  );
}

/** What the platform does not give us, said once and plainly. */
export function NotFromPlatform({ children }: { children: ReactNode }) {
  return <p className="ap-fine" data-testid="pm-not-available"><b>{NOT_FROM_PLATFORM}:</b> {children}</p>;
}
