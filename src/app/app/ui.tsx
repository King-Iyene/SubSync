"use client";

import type { ReactNode } from "react";
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

const toneClass: Record<Tone, string> = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  bad: "bg-red-500/15 text-red-700 dark:text-red-300",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${toneClass[tone]}`}>{children}</span>;
}

const bandTone: Record<Band, Tone> = { thriving: "good", healthy: "good", watch: "warn", at_risk: "bad" };
const bandLabel: Record<Band, string> = { thriving: "Thriving", healthy: "Healthy", watch: "Watch", at_risk: "At risk" };
export const BandBadge = ({ band }: { band: Band }) => <Badge tone={bandTone[band]}>{bandLabel[band]}</Badge>;

export function ChurnBadge({ level }: { level: string }) {
  if (level === "high") return <Badge tone="bad">High churn risk</Badge>;
  if (level === "medium") return <Badge tone="warn">Medium risk</Badge>;
  return <Badge tone="neutral">Low risk</Badge>;
}

export const severityTone = (s: string): Tone => (s === "critical" ? "bad" : s === "warning" ? "warn" : s === "info" ? "info" : "good");

// ---------- layout ----------

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-card text-card-foreground print:break-inside-avoid ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground" role="status">{label}</p>;
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const upgrade = (error as ApiError).status === 402;
  return (
    <div className={`rounded-xl border p-6 text-center ${upgrade ? "border-sky-500/40 bg-sky-500/5" : "border-red-500/40 bg-red-500/5"}`}>
      <p className="text-sm font-medium">{upgrade ? "This feature is part of the paid plan" : "Something went wrong"}</p>
      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      {onRetry && !upgrade && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Try again</button>
      )}
    </div>
  );
}

// ---------- controls ----------

export function Btn({
  children, onClick, variant = "secondary", disabled, type = "button", title,
}: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; type?: "button" | "submit"; title?: string }) {
  const style =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/85"
      : variant === "ghost"
        ? "hover:bg-muted"
        : "border hover:bg-muted";
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${style}`}>
      {children}
    </button>
  );
}

export const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">{children}</a>;
}

// ---------- score + charts ----------

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 55 ? "bg-emerald-400" : score >= 35 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2" title={`Engagement score ${score} of 100`}>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted"><div className={`h-full ${color}`} style={{ width: `${score}%` }} /></div>
      <span className="w-7 text-right text-sm font-medium tabular-nums">{score}</span>
    </div>
  );
}

export function Sparkline({ values, width = 240, height = 56, label }: { values: number[]; width?: number; height?: number; label: string }) {
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
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">{head}</thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const Th = ({ children, onClick, active, className = "" }: { children: ReactNode; onClick?: () => void; active?: boolean; className?: string }) => (
  <th scope="col" className={`px-3 py-2 font-medium ${className}`} aria-sort={active ? "descending" : undefined}>
    {onClick ? (
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>{children}{active ? " ↓" : ""}</button>
    ) : children}
  </th>
);

export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
