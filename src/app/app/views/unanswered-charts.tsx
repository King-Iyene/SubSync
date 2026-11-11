"use client";

import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { shortWords } from "@/lib/analytics/unanswered-v2";
import { ColumnChart, ErrorState, SkeletonRows, type ColumnItem } from "../ds";
import { CountUp, useReducedMotion } from "./speed6-base";

// The pictures of the Unanswered screen. Every mark opens exactly the people it counts (the list under the cards, the same selection the number came from).
//  - WaitColumns: how long people have waited, four big columns.
//  - WhereChart: where they wait. Vertical columns that shrink as clients are added (the shared column chart: 200 clients fit, Top 20 / 50 / All, a table view paged 20, 50, 100).
//  - ReplayCard: the waiting pile as a short animation (each dot is a group of people; press Replay). Reduced motion shows it still.

type Bucket = { key: string; label: string; count: number };
const n = (v: number) => v.toLocaleString("en-US");
const person = (c: number) => (c === 1 ? "person" : "people");

export function WaitColumns({ buckets, onPick }: { buckets: Bucket[]; onPick: (key: string) => void }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="ur-cols" role="list" data-testid="wait-bars">
      {buckets.map((b, i) => {
        const hot = b.key === "h24" || b.key === "h48";
        const inner = (
          <>
            <span className="ur-col-n"><CountUp value={b.count} /></span>
            <span className="ur-col-bar" aria-hidden><i style={{ height: `${b.count === 0 ? 2 : Math.max(6, (b.count / max) * 100)}%`, animationDelay: `${i * 70}ms` }} /></span>
            <span className="ur-col-l">{b.label}</span>
          </>
        );
        return b.count > 0
          ? <button key={b.key} type="button" role="listitem" className="ur-col" data-hot={hot ? "1" : undefined} data-testid="wait-bar" data-bucket={b.key} data-count={b.count} onClick={() => onPick(b.key)} aria-label={`${b.label}: ${b.count} ${person(b.count)}. Open them.`} data-tip="Click to see these people">{inner}</button>
          : <div key={b.key} role="listitem" className="ur-col" data-empty="1" data-testid="wait-bar" data-bucket={b.key} data-count={0}>{inner}</div>;
      })}
    </div>
  );
}

type Rank = { id: string; name: string; count: number; oldestHours: number };
type OwnerRank = { key: string; label: string; count: number; oldestHours: number };
export type Paged<T> = { total: number; rows: T[] };
export type { Rank, OwnerRank };

export function WhereChart({ by, data, error, reload, onAccount, onOwner }: { by: "account" | "owner"; data: Paged<Rank & OwnerRank> | null; error: Error | null; reload: () => void; onAccount: (id: string) => void; onOwner: (key: string) => void }) {
  const items: ColumnItem[] = useMemo(() => (data?.rows ?? []).map((r) => ({
    key: by === "account" ? r.id : r.key, label: by === "account" ? r.name : r.label, note: `longest ${shortWords(r.oldestHours)}`,
    segments: [{ key: "waiting", label: "Waiting", value: r.count, colour: r.oldestHours >= 24 ? "var(--s6-amber)" : "var(--s6-cyan)" }],
  })), [data, by]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={3} label="Counting by client..." />;
  return (
    <>
      <ColumnChart title={by === "account" ? "People waiting by client" : "People waiting by owner"} items={items} unit="people waiting" subject={by === "account" ? "client" : "team member"} height={260}
        onSelect={(key) => (by === "account" ? onAccount(key) : onOwner(key))} testId="where-chart" />
      {data.total > 100 && <p className="s6-label mt-2">The 100 busiest of {n(data.total)} are shown. Search the list below to find any client.</p>}
    </>
  );
}

const STATIONS: Record<string, number> = { h1: 14, h4: 38, h24: 62, h48: 86 };
/** The waiting pile as a picture: customers write on the left, wait along the line and settle where they are now. Each dot stands for a group (the label says how many). */
export function ReplayCard({ buckets, onPick }: { buckets: Bucket[]; onPick: (key: string) => void }) {
  const reduced = useReducedMotion();
  const [round, setRound] = useState(0);
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const per = Math.max(1, Math.ceil(total / 48));
  const dots = useMemo(() => buckets.flatMap((b) => Array.from({ length: Math.ceil(b.count / per) }, (_, i) => ({ k: `${b.key}-${i}`, b: b.key, i }))), [buckets, per]);
  return (
    <div data-testid="replay">
      <div className="ur-flow" key={round} aria-hidden>
        <div className="ur-flow-line" />
        {dots.map((d, idx) => {
          const x = (STATIONS[d.b] ?? 50) + ((d.i * 37) % 9) - 4;
          const y = 96 + ((d.i * 23) % 5) * 12;
          return <span key={d.k} className="ur-dot" data-hot={d.b === "h24" || d.b === "h48" ? "1" : undefined} style={{ ["--x1" as string]: `${x}%`, ["--y1" as string]: `${y}px`, animationDelay: reduced ? "0s" : `${(idx % 24) * 90}ms` }} />;
        })}
      </div>
      <div className="ur-flow-keys">
        {buckets.map((b) => (
          <button key={b.key} type="button" className="ur-flow-key" disabled={b.count === 0} onClick={() => onPick(b.key)} data-tip="Click to see these people" aria-label={`${b.label}: ${b.count} ${person(b.count)}. Open them.`}>
            <span className="tnum">{n(b.count)}</span><span className="s6-label">{b.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="s6-btn" onClick={() => setRound((r) => r + 1)} data-testid="replay-btn"><Play aria-hidden className="size-4" />Replay</button>
        <span className="s6-label">{per > 1 ? `Each dot is about ${per} people.` : "Each dot is one person."}</span>
      </div>
    </div>
  );
}
