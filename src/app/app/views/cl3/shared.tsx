"use client";

import { Search } from "lucide-react";
import type { ReactNode } from "react";
import type { Delta, Rate } from "@/lib/analytics/clients3-types";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { notSwitchedOn } from "./data";

// Small pieces shared by the sections of the Clients screen. Plain words, no scores: every number is a count from the synced data.
export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const NOT_ENOUGH = "Not enough data";
export const RECONNECT = "Needs permission: reconnect";
export const NOT_FROM_PLATFORM = "Not available from the platform yet";

/** "+12%" or "-8%", only when the earlier period had enough to compare (the server decides: Delta.enough). */
export const change = (d: Delta): string | null => (d.enough && d.change !== null ? `${d.change > 0 ? "+" : ""}${Math.round(d.change * 100)}%` : null);
export const share = (r: Rate): string => (r.enough && r.value !== null ? `${Math.round(r.value * 100)}%` : NOT_ENOUGH);
export const ago = (iso: string | null): string => { if (!iso) return "Never"; const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
export const minutes = (m: number | null): string => (m === null ? NOT_ENOUGH : m < 1 ? "Under a minute" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
export const day = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 3) return <span className="ap-fine">{NOT_ENOUGH}</span>;
  const lo = Math.min(...values), span = Math.max(...values) - lo || 1, pts = values.map((v, i) => `${(i / (values.length - 1)) * 80},${22 - ((v - lo) / span) * 20}`).join(" ");
  return <svg className="cl-spark" viewBox="0 0 80 24" role="img" aria-label={label}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

type Loaded<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };
/** Loading, error ("not switched on" is its own plain note) and empty states in one place. */
export function Load<T>({ r, children, empty }: { r: Loaded<T>; children: (d: T) => ReactNode; empty: (d: T) => boolean | string }) {
  if (r.loading && !r.data) return <SkeletonRows rows={6} label="Loading clients..." />;
  if (r.error && notSwitchedOn(r.error)) return <EmptyState title="Not switched on yet" body="This part of Clients is not switched on for your account yet." />;
  if (r.error) return <ErrorState error={r.error as Error} onRetry={r.reload} />;
  if (!r.data) return null;
  const e = empty(r.data);
  return e ? <EmptyState title="Nothing to show yet" body={typeof e === "string" ? e : "Client accounts appear here after the first sync finishes."} /> : <>{children(r.data)}</>;
}

export function Pager({ page, pages, total, set }: { page: number; pages: number; total: number; set: (n: number) => void }) {
  return (
    <div className="cl-pager print:hidden" role="navigation" aria-label="Pages">
      <span className="ap-fine">{total.toLocaleString("en-US")} in total</span>
      <button type="button" className="s6-btn" disabled={page <= 0} onClick={() => set(page - 1)}>Previous</button>
      <span className="ap-fine">Page {page + 1} of {Math.max(1, pages)}</span>
      <button type="button" className="s6-btn" disabled={page + 1 >= pages} onClick={() => set(page + 1)}>Next</button>
    </div>
  );
}

export function Find({ q, setQ, children }: { q: string; setQ: (s: string) => void; children?: ReactNode }) {
  return (
    <div className="ap-head print:hidden" role="search">
      <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search accounts</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="cl-search" /></label>
      {children}
    </div>
  );
}

/** One level in plain words, with the shape as well as the colour so it never relies on colour alone. */
export function LevelChip({ level }: { level: "ok" | "watch" | "act" | "unknown" }) {
  const t = level === "act" ? ["Act now", "amber"] : level === "watch" ? ["Keep an eye", "cyan"] : level === "unknown" ? ["No data yet", ""] : ["Fine", ""];
  return <span className="ap-chip" data-tone={t[1] || undefined}>{t[0]}</span>;
}
