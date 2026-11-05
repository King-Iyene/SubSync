"use client";

import { Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LeadDrawer, type LeadSeed } from "../ds";
import { useData } from "../session";
import { Empty, ErrorBox, fmtInt, fmtMoney, Loading, Sparkline } from "../ui";
import { StageRulesCard, type StageControls } from "./stage-rules-card";

// The Pipeline screen, money first. One sentence ("$X open across N deals, $Y stuck, Z with no next step"), one action ("Move the 5 stuck deals"), then a board by stage where each deal is
// counted once and "stuck" is judged per stage. A deal opens in the shared lead panel on its Deals tab (stage, value, status, owner and the conversation, all through the write gateway).
// Which pipelines count lives behind one gear. Definitions: docs/METRICS.md and src/lib/analytics/pipeline-board.ts.

type Card = { id: string; contactId: string | null; locationId: string; locationName: string | null; name: string; value: number; daysInStage: number | null; quietDays: number | null; stuck: boolean; noNextStep: boolean };
type Stage = { id: string; name: string; order: number; count: number; value: number; stuck: number; limitDays: number; cards: Card[]; more: number };
type Pipe = { key: string; locationId: string; locationName: string | null; name: string; openCount: number; openValue: number; stuckCount: number; stuckValue: number; stages: Stage[] };
type BoardData = {
  headline: { openCount: number; openValue: number; stuckCount: number; stuckValue: number; noNextStepCount: number };
  pipelines: Pipe[]; byClient: Array<{ locationId: string; name: string | null; stuckCount: number; stuckValue: number }>;
  stuckQueue: Array<{ id: string; contactId: string | null; locationId: string; name: string; locationName: string | null }>;
  forecast: { range: { low: number; likely: number; high: number } | null; method: string } | null; closed: number; minClosed: number;
  trend: Array<{ day: string; openValue: number }> | null; trendNote: string | null;
  excluded: { count: number; noOwner: number; noValue: number; closedOut: number };
  stageControls: StageControls | null; multi: boolean;
};

const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-card px-4 text-[15px] font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-[var(--ring)]";
const PRIMARY = "ds-press inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";
const compact = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : fmtMoney(n));

function PipelinesDrawer({ controls, onClose, onChanged }: { controls: StageControls; onClose: () => void; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const names = controls.pipelines.map((p) => p.name).filter((n) => (ql ? n.toLowerCase().includes(ql) : true));
    const keep = new Set(ql ? names : names.slice(0, 5));
    return { ...controls, pipelines: controls.pipelines.filter((p) => keep.has(p.name)), stages: controls.stages.filter((s) => keep.has(s.pipeline)), hidden: ql ? 0 : Math.max(0, names.length - 5) };
  }, [controls, q]);
  return (
    <div className="fixed inset-0 z-50 print:hidden" data-testid="pipelines-drawer-root">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="Pipelines" className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l bg-popover shadow-[var(--shadow-lift)]" data-testid="pipelines-drawer">
        <header className="flex items-center justify-between border-b px-5 py-3"><h2 className="text-lg font-semibold">Pipelines</h2><button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[15px] text-muted-foreground">Say which pipelines you really use. Deals in a pipeline you do not use, or in a closed-out stage, are left out of every dollar figure.</p>
          <label className="mt-3 block"><span className="sr-only">Find a pipeline</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a pipeline by name" className="block min-h-11 w-full rounded-lg border bg-background px-3 text-[15px]" data-testid="pipelines-search" /></label>
          {shown.hidden > 0 && <p className="mt-2 text-sm text-muted-foreground" data-testid="pipelines-hidden">Showing 5 of {shown.pipelines.length + shown.hidden}. Search to find the others.</p>}
          <div className="mt-4"><StageRulesCard controls={shown} onChanged={onChanged} /></div>
        </div>
      </aside>
    </div>
  );
}

function StageColumn({ s, pipe, onOpen }: { s: Stage; pipe: Pipe; onOpen: (c: Card, from: Card[]) => void }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card/60 p-3 md:w-72 md:shrink-0" aria-label={`${s.name}: ${s.count} deals`} data-testid="board-stage" data-stuck={s.stuck}>
      <header className="px-1 pb-2">
        <h3 className="text-[15px] font-semibold leading-tight">{s.name}</h3>
        <p className="mt-0.5 text-sm tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{compact(s.value)}</span> · {fmtInt(s.count)} {s.count === 1 ? "deal" : "deals"}{s.stuck > 0 ? <span className="text-warning"> · {s.stuck} stuck</span> : null}</p>
      </header>
      <ul className="space-y-2">
        {s.cards.map((c) => (
          <li key={c.id}>
            <button type="button" disabled={!c.contactId} onClick={() => onOpen(c, s.cards)} className="ds-press block w-full rounded-xl border bg-background p-3 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:cursor-default disabled:opacity-80" data-testid="board-card" data-stuck={c.stuck ? "true" : "false"}>
              <span className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate text-[15px] font-medium">{c.name}</span><span className="shrink-0 text-[15px] font-semibold tabular-nums">{fmtMoney(c.value)}</span></span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {c.stuck ? <span className="font-medium text-warning">Stuck: {c.daysInStage} days here (limit for this stage: {s.limitDays})</span> : c.daysInStage !== null ? `${c.daysInStage} ${c.daysInStage === 1 ? "day" : "days"} in this stage` : "Time in stage unknown"}
                {c.noNextStep && !c.stuck ? " · no next step" : ""}{pipe.locationName && c.locationName ? ` · ${c.locationName}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {s.more > 0 && <p className="mt-2 px-1 text-sm text-muted-foreground">and {s.more} more</p>}
    </section>
  );
}

export function PipelineBoard() {
  const { data, error, loading, reload } = useData<BoardData>("pipeline-intel?view=board");
  const [pipeKey, setPipeKey] = useState<string | null>(null);
  const [client, setClient] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  const [seeds, setSeeds] = useState<LeadSeed[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [clientPage, setClientPage] = useState(0);
  const [allClients, setAllClients] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const h = data.headline;
  const pipes = data.pipelines.filter((p) => !client || p.locationId === client);
  const pipe = pipes.find((p) => p.key === pipeKey) ?? pipes[0] ?? null;
  const open = (cards: Array<{ id: string; contactId: string | null; locationId: string; name: string; locationName?: string | null; note?: string }>, i: number) => {
    const list = cards.filter((c) => c.contactId);
    const target = cards[i];
    const idx = list.findIndex((c) => c.id === target.id);
    setSeeds(list.map((c) => ({ contactId: c.contactId as string, locationId: c.locationId, name: c.name, locationName: c.locationName ?? null, tab: "deals" as const, dealId: c.id, ...(c.note ? { note: c.note } : {}) })));
    setAt(idx >= 0 ? idx : 0);
  };
  const moveStuck = () => {
    const cards = data.stuckQueue.map((q) => ({ id: q.id, contactId: q.contactId, locationId: q.locationId, name: q.name, locationName: q.locationName, note: "This deal has been stuck in its stage." }));
    open(cards, 0);
  };
  const clientsShown = allClients ? data.byClient.slice(clientPage * 10, clientPage * 10 + 10) : data.byClient.slice(0, 5);

  if (h.openCount === 0 && data.pipelines.length === 0) return <Empty title="No open deals yet" body="Deals appear here once the first sync finishes." />;

  return (
    <div className="space-y-8" data-testid="pipeline-board">
      <section aria-label="Pipeline at a glance" className="rounded-3xl border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Open pipeline</p>
            <p className="mt-1 text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl" data-testid="board-total">{compact(h.openValue)}</p>
            <p className="mt-3 max-w-2xl text-[17px] leading-snug" data-testid="board-headline">
              open across {fmtInt(h.openCount)} {h.openCount === 1 ? "deal" : "deals"}. <span className={h.stuckCount ? "font-semibold text-warning" : ""}>{compact(h.stuckValue)} is stuck</span>{h.noNextStepCount > 0 ? <>, and {fmtInt(h.noNextStepCount)} {h.noNextStepCount === 1 ? "deal has" : "deals have"} no next step</> : null}.
            </p>
          </div>
          {data.stageControls && <button type="button" onClick={() => setGear(true)} className={BTN} aria-label="Choose which pipelines count" data-testid="pipelines-gear"><Settings2 aria-hidden className="size-4" />Pipelines</button>}
        </div>
        {h.stuckCount > 0 && <div className="mt-5"><button type="button" onClick={moveStuck} className={PRIMARY} data-testid="move-stuck">Move the {Math.min(h.stuckCount, 200)} stuck {h.stuckCount === 1 ? "deal" : "deals"}</button><p className="mt-2 text-sm text-muted-foreground">Opens each one in turn, with its conversation, so you can message, move or close it.</p></div>}
        {h.stuckCount === 0 && <p className="mt-5 text-[15px] font-medium">Nothing is stuck right now.</p>}
        <p className="mt-5 border-t pt-4 text-sm text-muted-foreground" data-testid="board-forecast">
          {data.forecast?.range ? <>Likely revenue (an estimate): <span className="font-medium text-foreground">{fmtMoney(data.forecast.range.likely)}</span>, between {fmtMoney(data.forecast.range.low)} and {fmtMoney(data.forecast.range.high)}.</> : <>Not enough closed deals yet for a forecast ({data.closed} of {data.minClosed}).</>}
          {data.excluded.count > 0 ? ` ${fmtInt(data.excluded.count)} deals are not counted: ${fmtInt(data.excluded.noOwner)} have no owner, ${fmtInt(data.excluded.noValue)} have no value, ${fmtInt(data.excluded.closedOut)} are closed out.` : ""}
        </p>
      </section>

      {data.multi && data.byClient.length > 0 && (
        <section aria-label="Where the stuck money is" data-testid="board-clients">
          <h2 className="text-lg font-semibold">Where the stuck money is</h2>
          <ul className="mt-3 divide-y rounded-2xl border bg-card">
            {clientsShown.map((c) => (
              <li key={c.locationId}><button type="button" onClick={() => { setClient(client === c.locationId ? null : c.locationId); setPipeKey(null); }} aria-pressed={client === c.locationId} className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left hover:bg-accent/50 ${client === c.locationId ? "bg-accent/60" : ""}`}>
                <span className="min-w-0 truncate text-[15px] font-medium">{c.name ?? "Unnamed account"}</span>
                <span className="shrink-0 text-[15px] tabular-nums"><span className="font-semibold">{compact(c.stuckValue)}</span><span className="text-muted-foreground"> · {c.stuckCount} {c.stuckCount === 1 ? "deal" : "deals"}</span></span>
              </button></li>
            ))}
          </ul>
          {data.byClient.length > 5 && (
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => { setAllClients(!allClients); setClientPage(0); }} className="min-h-11 text-[15px] font-medium text-primary underline underline-offset-4" data-testid="clients-all">{allClients ? "Show the top 5" : `See all ${data.byClient.length}`}</button>
              {allClients && <span className="flex items-center gap-1 text-sm text-muted-foreground"><button type="button" className="min-h-11 px-2" disabled={clientPage === 0} onClick={() => setClientPage(clientPage - 1)}>Previous</button>{clientPage + 1} of {Math.ceil(data.byClient.length / 10)}<button type="button" className="min-h-11 px-2" disabled={(clientPage + 1) * 10 >= data.byClient.length} onClick={() => setClientPage(clientPage + 1)}>Next</button></span>}
              {client && <button type="button" onClick={() => setClient(null)} className="min-h-11 text-sm underline">Show every client</button>}
            </div>
          )}
        </section>
      )}

      {pipe && (
        <section aria-label="Board by stage">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">By stage</h2>
            {pipes.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><span>Pipeline</span>
                <select value={pipe.key} onChange={(e) => setPipeKey(e.target.value)} className="min-h-11 max-w-[16rem] rounded-lg border bg-background px-3 text-[15px] text-foreground" data-testid="board-pipeline">
                  {pipes.slice(0, 60).map((p) => <option key={p.key} value={p.key}>{p.name}{data.multi && p.locationName ? ` · ${p.locationName}` : ""} · {compact(p.openValue)}</option>)}
                </select></label>
            )}
          </div>
          <p className="mb-3 text-sm text-muted-foreground">{pipe.name}: {compact(pipe.openValue)} across {fmtInt(pipe.openCount)} deals, each counted once.</p>
          <div className="flex flex-col gap-3 md:flex-row md:overflow-x-auto md:pb-3" data-testid="board-columns">
            {pipe.stages.map((s) => <StageColumn key={s.id} s={s} pipe={pipe} onOpen={(c, from) => open(from.map((x) => ({ ...x, locationName: x.locationName })), from.findIndex((x) => x.id === c.id))} />)}
          </div>
        </section>
      )}

      {data.trend ? (
        <section aria-label="Open pipeline over time" data-testid="board-trend">
          <h2 className="mb-2 text-lg font-semibold">Open pipeline over time</h2>
          <Sparkline values={data.trend.map((t) => t.openValue)} label="Open pipeline value" width={520} height={96} />
          <p className="mt-1 text-sm text-muted-foreground">{compact(data.trend[0].openValue)} to {compact(data.trend[data.trend.length - 1].openValue)} over {data.trend.length} days.</p>
        </section>
      ) : null}

      {at !== null && seeds.length > 0 && <LeadDrawer leads={seeds} index={at} onIndex={setAt} onClose={() => { setAt(null); void reload(); }} onLogged={() => void reload()} />}
      {gear && data.stageControls && <PipelinesDrawer controls={data.stageControls} onClose={() => setGear(false)} onChanged={() => void reload()} />}
    </div>
  );
}
