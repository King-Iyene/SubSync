"use client";

import type { ReactNode } from "react";
import { EmptyState, ErrorState } from "./ds/states";
import type { ApiError } from "./session";
import type { Band } from "./types";

// ---------- formatting ----------

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const fmtPct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "never";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const daysLabel = (d: number | null) => (d === null ? "never" : d === 0 ? "today" : `${d}d ago`);

// ---------- tones ----------

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";

// A status is plain text in the status colour with a thin rule on its left (no dot, no tinted fill, no pill). The words carry the meaning, so colour is
// never the only signal; every text colour here is checked for contrast on the page and card surfaces (src/lib/__tests__/design-tokens.test.ts).
const toneClass: Record<Tone, string> = {
  good: "border-success text-success",
  warn: "border-warning text-warning",
  bad: "border-destructive text-destructive",
  info: "border-primary text-primary",
  neutral: "border-border text-muted-foreground",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span data-tone={tone} className={`inline-block border-l-2 pl-2 text-xs font-medium leading-4 whitespace-nowrap ${toneClass[tone]}`}>{children}</span>;
}

const bandTone: Record<Band, Tone> = { thriving: "good", healthy: "good", watch: "warn", at_risk: "bad" };
const bandLabel: Record<Band, string> = { thriving: "Thriving", healthy: "Healthy", watch: "Watch", at_risk: "At risk" };
export const BandBadge = ({ band }: { band: Band }) => <Badge tone={bandTone[band]}>{bandLabel[band]}</Badge>;

export function ChurnBadge({ level }: { level: string }) {
  if (level === "high") return <Badge tone="bad">Likely to leave</Badge>;
  if (level === "medium") return <Badge tone="warn">Could leave</Badge>;
  return <Badge tone="neutral">Steady</Badge>;
}

export const severityTone = (s: string): Tone => (s === "critical" ? "bad" : s === "warning" ? "warn" : s === "info" ? "info" : "good");

// ---------- layout ----------

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border bg-card text-card-foreground print:break-inside-avoid ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          {title && <h2 className="text-[0.9rem] font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card p-4 pl-5">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-0.5 ${tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : tone === "good" ? "bg-success" : "bg-border"}`} />
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`tnum mt-1.5 text-[1.7rem] font-semibold leading-none tracking-tight ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : ""}`}>{value}</p>
      {sub && <div className="mt-2 text-xs leading-5 text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
      <div>
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return <EmptyState title={title} body={body} />;
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground" role="status">
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />{label}
    </p>
  );
}

// Shows what went wrong with an error ID for support (the shared ErrorState, stage D0).
export function ErrorBox({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return <ErrorState error={error} onRetry={onRetry} />;
}

// ---------- controls ----------

export function Btn({
  children, onClick, variant = "secondary", disabled, type = "button", title,
}: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; type?: "button" | "submit"; title?: string }) {
  const style =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90 active:translate-y-px"
      : variant === "ghost"
        ? "text-muted-foreground hover:bg-muted hover:text-foreground"
        : "border bg-card hover:border-primary/40 hover:bg-accent/50 active:translate-y-px";
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 ${style}`}>
      {children}
    </button>
  );
}

export const inputClass = "w-full rounded-lg border bg-card px-3 py-2 text-sm shadow-sm outline-none transition-colors hover:border-primary/30 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/30";

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">{children}</a>;
}

// ---------- score + charts ----------

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 55 ? "bg-emerald-400" : score >= 35 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2" title={`Health score ${score} of 100`}>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted"><div className={`h-full ${color}`} style={{ width: `${score}%` }} /></div>
      <span className="w-7 text-right text-sm font-medium tabular-nums">{score}</span>
    </div>
  );
}

export function Sparkline({ values, width = 240, height = 56, label, marks = [] }: { values: number[]; width?: number; height?: number; label: string; marks?: number[] }) {
  if (values.length < 2) return <p className="text-xs text-muted-foreground">Not enough history yet</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 4 - ((v - min) / span) * (height - 8)}`).join(" ");
  const last = values[values.length - 1];
  const first = values[0];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full max-w-xs" role="img" aria-label={`${label}: from ${Math.round(first)} to ${Math.round(last)}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className={last >= first ? "text-emerald-500" : "text-red-500"} />
      {marks.filter((i) => i >= 0 && i < values.length).map((i) => (
        <circle key={i} cx={(i / (values.length - 1)) * width} cy={height - 4 - ((values[i] - min) / span) * (height - 8)} r="3.5" className="fill-red-500 stroke-background" strokeWidth="1.5"><title>Unusual point</title></circle>
      ))}
    </svg>
  );
}

export function StackedBar({ parts }: { parts: Array<{ label: string; value: number; className: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((p) => (p.value > 0 ? <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} /> : null))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5"><span className={`inline-block size-2 rounded-full ${p.className}`} />{p.label} <strong className="text-foreground">{p.value}</strong></li>
        ))}
      </ul>
    </div>
  );
}

// ---------- table ----------

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card print:overflow-visible">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b bg-muted/60 text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground">{head}</thead>
        <tbody className="divide-y [&>tr]:transition-colors [&>tr:hover]:bg-accent/40">{children}</tbody>
      </table>
    </div>
  );
}

export const Th = ({ children, onClick, active, className = "" }: { children: ReactNode; onClick?: () => void; active?: boolean; className?: string }) => (
  <th scope="col" className={`px-3 py-2.5 font-semibold ${className}`} aria-sort={active ? "descending" : undefined}>
    {onClick ? (
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>{children}{active ? " ↓" : ""}</button>
    ) : children}
  </th>
);

export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
