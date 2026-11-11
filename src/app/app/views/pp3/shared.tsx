"use client";

import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PpDelta, PpRate } from "@/lib/analytics/people3-types-interim";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { notSwitchedOn } from "./data";

// Small pieces shared by the sections of the Team screen. Plain words, no scores: every number is a count or a share from the synced data.
export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const NOT_ENOUGH = "Not enough data";
export const RECONNECT = "Needs permission: reconnect";
export const NO_ACTIVITY = "No activity recorded in your CRM";

export const share = (r: PpRate): string => (r.enough && r.value !== null ? `${Math.round(r.value * 100)}%` : NOT_ENOUGH);
/** "+12%" or "-8%", only when the earlier period had enough to compare (the server decides: enough). */
export const change = (d: PpDelta): string | null => (d.enough && d.change !== null ? `${d.change > 0 ? "+" : ""}${Math.round(d.change * 100)}%` : null);
export const ago = (iso: string | null): string => { if (!iso) return "Nothing recorded"; const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
export const minutes = (m: number | null): string => (m === null ? NOT_ENOUGH : m < 1 ? "Under a minute" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
export const day = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/** The change against the previous period as a small arrow and a percentage, only when there was enough before to compare. */
export function Trend({ d }: { d: PpDelta }) {
  if (!d.enough || d.change === null) return null;
  const up = d.change > 0.02, down = d.change < -0.02, pct = Math.round(Math.abs(d.change) * 100);
  return <span className="ap-sub pp-hide-sm" title={`${up ? "Up" : down ? "Down" : "About the same"} ${pct}% on the previous period`}> {up ? "▲" : down ? "▼" : "–"} {pct}%</span>;
}

/** A small neutral circle with the person's initials. It is never a status colour. */
export function Initials({ name }: { name: string }) { return <span className="pp-init" aria-hidden>{initials(name)}</span>; }

/** A status in words plus a small mark, so it never relies on colour. `on` draws the filled mark (needs a look); otherwise a hollow one. */
export function Status({ on, children }: { on?: boolean; children: ReactNode }) { return <span className="pp-status" data-on={on ? "1" : undefined}><i aria-hidden />{children}</span>; }

/** Eight weekly points as a small line. Under three points it says there is not enough data. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 3) return <span className="ap-fine">{NOT_ENOUGH}</span>;
  const lo = Math.min(...values), span = Math.max(...values) - lo || 1, pts = values.map((v, i) => `${(i / (values.length - 1)) * 80},${22 - ((v - lo) / span) * 20}`).join(" ");
  return <svg className="pp-spark" viewBox="0 0 80 24" role="img" aria-label={label}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

type Loaded<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };
/** Loading, error ("not switched on" and "needs permission" are their own plain notes) and empty states in one place. */
export function Load<T>({ r, children, empty }: { r: Loaded<T>; children: (d: T) => ReactNode; empty: (d: T) => boolean | string }) {
  if (r.loading && !r.data) return <SkeletonRows rows={6} label="Loading the team..." />;
  if (r.error && notSwitchedOn(r.error)) return <EmptyState title="Not switched on yet" body="This part of Team is not switched on for your account yet." />;
  if (r.error) return <ErrorState error={r.error as Error} onRetry={r.reload} />;
  if (!r.data) return null;
  const m = r.data as { needsUsersPermission?: boolean };
  if (m.needsUsersPermission) return <EmptyState title={RECONNECT} body="To list your team we need permission to read the users in your CRM. Reconnect SubSync and approve it." />;
  const e = empty(r.data);
  return e ? <EmptyState title="Nothing to show yet" body={typeof e === "string" ? e : "People appear here once their first messages and calls have synced."} /> : <>{children(r.data)}</>;
}

/** Keyset paging: the server answers with the cursor of the next page. Previous goes back through the cursors already seen. */
export function useCursor(resetKey: string) {
  const [state, setState] = useState<{ key: string; stack: string[] }>({ key: resetKey, stack: [""] });
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setState({ key: resetKey, stack: [""] }); }, [resetKey]);
  const stack = state.key === resetKey ? state.stack : [""];
  return { cursor: stack[stack.length - 1], index: stack.length - 1, forward: (next: string) => setState({ key: resetKey, stack: [...stack, next] }), back: () => setState({ key: resetKey, stack: stack.length > 1 ? stack.slice(0, -1) : stack }) };
}

export function Pager({ c, next, total, noun = "in total" }: { c: ReturnType<typeof useCursor>; next: string | null; total: number; noun?: string }) {
  return (
    <div className="pp-pager print:hidden" role="navigation" aria-label="Pages">
      <span className="ap-fine">{total.toLocaleString("en-US")} {noun}</span>
      <button type="button" className="s6-btn" disabled={c.index <= 0} onClick={c.back}>Previous</button>
      <span className="ap-fine">Page {c.index + 1}</span>
      <button type="button" className="s6-btn" disabled={!next} onClick={() => next && c.forward(next)}>Next</button>
    </div>
  );
}

export function Find({ q, setQ, label = "Search people", children }: { q: string; setQ: (s: string) => void; label?: string; children?: ReactNode }) {
  return (
    <div className="ap-head print:hidden" role="search">
      <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">{label}</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} data-testid="pp-search" /></label>
      {children}
    </div>
  );
}

/** A search box value that waits 300 ms before it is used, so typing does not read on every key. */
export function useDebounced(value: string, ms = 300): string {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** The one line under a table that says where the numbers come from. */
export function Note({ children }: { children: ReactNode }) { return <p className="ap-fine mt-2">{children}</p>; }
