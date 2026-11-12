"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { attentionFor, fmtMoneyExact, historyLines, historyStarts, stageDwell, stageProgress, summarize, type HistoryRow } from "@/lib/people/deal-view";
import { useData } from "../../session";
import { fmtMoney, timeAgo } from "../../ui";
import type { Runner } from "./runner";
import type { WbContext, WbDeal } from "./types";

// The extra parts of the deals section: a summary header, the facts on each deal, a stage bar, a one-tap "Move stage" and a folded history. Everything here only reads;
// every change still goes through runner.preview (the preview and the server's write gateway).

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export function DealSummary({ deals }: { deals: WbDeal[] }) {
  const s = summarize(deals);
  if (!deals.length) return null;
  return (
    <section aria-label="Deal summary" className="rounded-xl border bg-card p-3" data-testid="deal-summary">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Open value</dt><dd className="text-[17px] font-semibold tabular-nums" data-testid="deal-sum-open-value">{fmtMoney(s.openValue)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Won value</dt><dd className="text-[17px] font-semibold tabular-nums" data-testid="deal-sum-won-value">{fmtMoney(s.wonValue)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Deals</dt><dd className="text-[17px] font-semibold tabular-nums" data-testid="deal-sum-total">{s.total}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Open / won / lost</dt><dd className="text-[17px] font-semibold tabular-nums" data-testid="deal-sum-counts">{s.open} / {s.won} / {s.lost}</dd></div>
      </dl>
      {s.testNote && <p className="mt-2 text-sm text-muted-foreground" data-testid="deal-sum-test">Looks like a test deal: the value is a placeholder, so treat these totals with care.</p>}
    </section>
  );
}

/** Small step bar: which stage of the pipeline this deal is in. Text is the real content; the bar is a visual aid. */
export function StageSteps({ stages, stageId }: { stages: Array<{ id: string; name: string }>; stageId: string | null }) {
  const p = stageProgress(stages, stageId);
  if (!p) return null;
  return (
    <div className="mt-2" data-testid="deal-steps">
      <ol className="flex gap-1" aria-label={`Stage ${p.index} of ${p.total}`}>
        {stages.map((st, i) => <li key={st.id} title={st.name} className={`h-1.5 min-w-0 flex-1 rounded-full ${i < p.index ? "bg-primary" : "bg-muted"}`} aria-current={i + 1 === p.index ? "step" : undefined} />)}
      </ol>
      <p className="mt-1 text-xs text-muted-foreground">Stage {p.index} of {p.total}</p>
    </div>
  );
}

export function DealFacts({ d, ctx, now }: { d: WbDeal; ctx: WbContext; now: number }) {
  const x = ctx.dealExtra?.[d.id];
  const owner = d.ownerId ? ctx.users.find((u) => u.id === d.ownerId)?.name ?? (ctx.ownerId === d.ownerId ? ctx.ownerName : null) : null;
  const dwell = stageDwell(x?.stageSince ?? null, x?.usualP75Days ?? null, x?.stays ?? 0, now);
  const quietDays = x?.lastActivityAt ? Math.floor((now - Date.parse(x.lastActivityAt)) / 86_400_000) : null;
  const att = attentionFor({ status: d.status, value: d.value, ownerId: d.ownerId, dwell, quietDays });
  const appts = ctx.appointments;
  const nextAppt = appts.filter((a) => a.at && Date.parse(a.at) > now).sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""))[0];
  const lc = ctx.lastConversation;
  const row = (k: string, v: React.ReactNode, id?: string) => <div className="flex gap-3 py-0.5 text-sm"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words" data-testid={id}>{v}</dd></div>;
  return (
    <div className="mt-3" data-testid="deal-facts">
      {att && (
        <p className="mb-2 flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-2.5 text-sm" data-testid="deal-attention" role="note">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" /><span><span className="font-semibold">Why this needs attention:</span> {att.why} <span className="font-medium">Next: {att.next}</span></span>
        </p>
      )}
      <dl>
        {d.status === "open" && row("In this stage", <span className={dwell.tone === "slow" ? "font-medium text-warning" : ""}>{dwell.text}</span>, "deal-dwell")}
        {row("Owner", owner ?? (d.ownerId ? "Someone outside your list" : "No owner"))}
        {x?.createdAt ? row("Created", day(x.createdAt)) : null}
        {x?.stageSince ? row("Last stage change", day(x.stageSince), "deal-stage-since") : null}
        {x?.lastActivityAt ? row("Last activity", `${day(x.lastActivityAt)} (${timeAgo(x.lastActivityAt)})`) : null}
        {x?.source ? row("Source", x.source) : null}
        {d.status === "lost" ? row("Lost reason", x?.lostReason ?? "Not recorded", "deal-lost-reason") : null}
        {nextAppt ? row("Next appointment", `${day(nextAppt.at)}${nextAppt.title ? `, ${nextAppt.title}` : ""}`) : appts.length ? row("Appointments", `${appts.length} for this person`) : null}
        {lc ? row("Last conversation", `${day(lc.at)}${lc.channel ? `, ${lc.channel.replace(/^TYPE_/, "").toLowerCase()}` : ""}${lc.by ? `, ${lc.by === "you" ? "your team wrote last" : "they wrote last"}` : ""}`, "deal-lastconv") : null}
      </dl>
    </div>
  );
}

/** Pick the next stage from the pipeline's own order; the current one is highlighted. Goes through the preview, never straight to the CRM. */
export function MoveStage({ d, ctx, runner }: { d: WbDeal; ctx: WbContext; runner: Runner }) {
  const stages = ctx.pipelines.find((p) => p.id === d.pipelineId)?.stages ?? [];
  if (d.status !== "open" || stages.length < 2) return null;
  const move = (id: string, name: string) => void runner.preview({ kind: "deal", opportunityId: d.id, stageId: id, ...(d.pipelineId ? { pipelineId: d.pipelineId } : {}) }, { quote: `Move this deal to ${name}`, verb: "Move deal" });
  return (
    <div className="mt-3" data-testid="deal-move">
      <p className="mb-1 text-sm font-medium text-muted-foreground">Move stage</p>
      <ol className="flex flex-wrap gap-1.5">
        {stages.map((s) => {
          const here = s.id === d.stageId;
          return <li key={s.id}><button type="button" disabled={here || runner.busy} aria-current={here ? "step" : undefined} onClick={() => move(s.id, s.name)} className={`min-h-9 cursor-pointer rounded-full border px-3 text-sm ${here ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-accent"}`} data-testid={here ? "deal-move-current" : "deal-move-to"}>{s.name}</button></li>;
        })}
      </ol>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="deal-move-state">{ctx.mode.live ? "You will see a preview first. Confirming changes the deal in your CRM." : ctx.mode.demo ? "Demo: nothing is ever sent." : "Not sent: writing is switched off. Confirming only records what would have happened."}</p>
    </div>
  );
}

type HistoryAnswer = { state: "ok" | "empty" | "unavailable"; rows: HistoryRow[] };
function HistoryBody({ path }: { path: string }) {
  const q = useData<HistoryAnswer>(path);
  if (q.loading) return <p className="py-2 text-sm text-muted-foreground" role="status">Loading history...</p>;
  if (q.error || !q.data || q.data.state === "unavailable") return <p className="py-2 text-sm text-muted-foreground" data-testid="deal-history-off">We cannot see this yet. Try again in a moment.</p>;
  const lines = historyLines(q.data.rows, fmtMoneyExact);
  const start = historyStarts(q.data.rows);
  if (!lines.length) return <p className="py-2 text-sm text-muted-foreground" data-testid="deal-history-empty">No changes recorded yet.{start ? "" : " History starts when SubSync first sees a change."}</p>;
  return (
    <div>
      <ol className="space-y-1.5 border-l pl-3" data-testid="deal-history-list">
        {lines.map((l) => <li key={l.id} className="text-sm"><span className="mr-2 text-xs tabular-nums text-muted-foreground">{day(l.at)}</span>{l.text}</li>)}
      </ol>
      {start && <p className="mt-1.5 text-xs text-muted-foreground" data-testid="deal-history-start">History starts {day(start)}.</p>}
    </div>
  );
}

/** Folded by default; the history is asked for only when opened. */
export function DealHistory({ d, locationId, contactId }: { d: WbDeal; locationId: string; contactId: string }) {
  const [open, setOpen] = useState(false);
  const path = `workbench/deal-history?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&opportunityId=${encodeURIComponent(d.id)}`;
  return (
    <div className="mt-3 border-t pt-2" data-testid="deal-history">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-9 w-full cursor-pointer items-center gap-1.5 text-left text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="deal-history-toggle">
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />History
      </button>
      {open && <HistoryBody path={path} />}
    </div>
  );
}

/** Collapsible wrapper for the "Other deals" groups. Open deals start open; closed ones start folded. */
export function DealGroup({ title, count, defaultOpen, children, testid }: { title: string; count: number; defaultOpen: boolean; children: React.ReactNode; testid: string }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <section data-testid={testid}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`flex min-h-9 w-full cursor-pointer items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground`}>
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />{title} ({count})
      </button>
      {open && children}
    </section>
  );
}
