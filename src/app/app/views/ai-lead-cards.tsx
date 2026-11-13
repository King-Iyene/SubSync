"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApiClient, useData } from "../session";
import { SentBox, useAiLead, whyNot, type Sent } from "../ds/ai-lead";
import { openLeadPanel } from "../ds/lead-drawer-host";

// Two cards for the lead AI jobs (docs/AI_AGENTS_PLAN.md). Both are suggest-only and both show their numbers WITHOUT any AI: the ranking and the cold-lead counts are plain code over SubSync's own
// data, and every number opens exactly the rows it counts. The model only adds the words (a one-line reason per lead, a plain explanation with three fixes).

const BTN = "ds-press inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
const LINK = "cursor-pointer font-medium text-primary underline underline-offset-2 hover:opacity-80";

// ---------------------------------------------------------------- who to call first (Call mode)

type Factor = { key: string; points: number; text: string };
type Top = { n: number; contactId: string; locationId: string; locationName: string | null; name: string; phone: string | null; timeZone: string | null; source: string | null; noRecord: boolean; openValue: number; ageHours: number | null; score: number; factors: Factor[]; reason: string; url: string };
type Rank = { list: string; total: number; considered: number; leftOutDnd: number; ready: boolean; sent: Sent; lines: Record<string, string>; top: Top[]; ok?: boolean; error?: string | null; code?: string | null };

/** In Call mode: the top 10 of the open list, ranked by code (wait time, hot tags, deal value, earlier replies). The AI only writes the one-line reason; the ranking is the same without it. */
export function CallFirstCard({ list, range }: { list: string; range: { from: string; to: string } | null }) {
  const api = useApiClient();
  const st = useAiLead();
  const q = `list=${encodeURIComponent(list)}${range ? `&from=${range.from}&to=${range.to}` : ""}`;
  const data = useData<Rank>(st?.flags.call_first ? `ai/lead/rank?${q}` : null);
  const [extraFor, setExtra] = useState<{ q: string; lines: Record<string, string>; error: string | null; sent: Sent } | null>(null);
  const [busy, setBusy] = useState(false);
  const extra = extraFor && extraFor.q === q ? extraFor : null; // reasons asked for another list or dates are not shown under this one
  if (!st?.flags.call_first) return null;
  const d = data.data;
  if (!d || d.top.length === 0) return null;
  const lines = { ...d.lines, ...(extra?.lines ?? {}) };
  const ready = st.ready.call_first === true;
  const ask = async () => {
    setBusy(true);
    try {
      const r = await api.post<Rank>("ai/lead/rank-lines", { list, ...(range ? { from: range.from, to: range.to } : {}) });
      setExtra({ q, lines: r.lines ?? {}, error: r.ok === false ? r.error ?? "The AI did not answer." : null, sent: r.sent });
    } catch { setExtra({ q, lines: {}, error: "The AI reasons did not work. The ranking is unchanged.", sent: null }); }
    setBusy(false);
  };
  return (
    <section className="mb-6 rounded-xl border bg-card p-4" aria-label="Who to call first" data-testid="ai-call-first">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Who to call first</h3>
          <p className="mt-0.5 text-sm text-muted-foreground" data-testid="ai-rank-note">Ranked from the first {d.considered.toLocaleString("en-US")} people on this list by how long they have waited, hot tags, deal value and earlier replies.{d.leftOutDnd > 0 ? ` ${d.leftOutDnd.toLocaleString("en-US")} who asked not to be contacted are left out.` : ""}</p>
        </div>
        <button type="button" className={BTN} disabled={busy || !ready} onClick={() => void ask()} title={ready ? "Adds a one-line reason to each lead. The order does not change." : whyNot(st, "call_first")} data-testid="ai-rank-reasons">
          <Sparkles aria-hidden className="size-4" />{busy ? "Writing reasons..." : "Add a one-line reason with AI"}
        </button>
      </div>
      {!ready && <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-rank-why">The ranking works without AI. {whyNot(st, "call_first")}</p>}
      <ol className="mt-3 divide-y rounded-lg border text-sm" data-testid="ai-rank-list">
        {d.top.map((t) => (
          <li key={`${t.locationId}:${t.contactId}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2" data-testid="ai-rank-row">
            <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-muted-foreground">{t.n}</span>
            <span className="min-w-0 flex-1">
              <button type="button" className="cursor-pointer text-left font-medium hover:underline" data-testid="ai-rank-open" onClick={() => openLeadPanel({ contactId: t.contactId, locationId: t.locationId, name: t.name, locationName: t.locationName, phone: t.phone, url: t.url, timeZone: t.timeZone }, true)}>{t.name}</button>
              {t.locationName && <span className="text-muted-foreground"> · {t.locationName}</span>}
              <span className="mt-0.5 block text-muted-foreground" data-testid="ai-rank-reason">{lines[String(t.n)] ? <><span className="mr-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">AI</span>{lines[String(t.n)]}</> : t.reason}</span>
              {lines[String(t.n)] && <span className="block text-xs text-muted-foreground">{t.reason}</span>}
            </span>
            <span className="rounded-full border px-2 py-0.5 text-xs tabular-nums" title="Waiting up to 30 points, hot tag up to 30, open deal up to 25, earlier replies up to 15. Total out of 100.">score {t.score}</span>
          </li>
        ))}
      </ol>
      {extra?.error && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="ai-rank-error">{extra.error}</p>}
      <SentBox sent={extra?.sent ?? null} testId="ai-rank-sent" />
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">How this is ranked</summary>
        <p className="mt-1">Score out of 100: waiting time up to 30 (best between 1 and 3 days, older leads count a little less), a hot tag such as quote or interested up to 30, an open deal up to 25 (about 18 points at $1,000, 24 at $10,000), and earlier replies from the lead up to 15. SubSync never calls anyone and never hides the reason. AI suggestion: the reason line only.</p>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------- why leads go cold (Speed to lead, Going cold)

type Pattern = { key: string; label: string; cold: number; of: number; ratePct: number };
type Report = { windowDays: number; waitHours: number; judged: number; cold: number; coldPct: number | null; patterns: Pattern[] };
type Explain = { explanation: string; fixes: string[] };
type Cold = { report: Report; truncated: boolean; ready: boolean; why: string; enough: boolean; explanation: Explain | null; sent: Sent };
type ExplainAnswer = { ok: true; json: Explain | null; cached: boolean; sent: Sent } | { ok: false; error: string; sent: Sent };

/** A card of leads no person replied to, grouped by pattern. Every count opens exactly the leads it counts. The AI only writes the explanation and three fixes. */
export function ColdCard() {
  const api = useApiClient();
  const st = useAiLead();
  const data = useData<Cold>(st?.flags.cold_reasons ? "ai/lead/cold" : null);
  const [open, setOpen] = useState<{ key: string; title: string } | null>(null);
  const [ans, setAns] = useState<ExplainAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  if (!st?.flags.cold_reasons) return null;
  const d = data.data;
  if (!d) return null;
  const r = d.report;
  const ex: Explain | null = ans && ans.ok ? ans.json : d.explanation;
  const run = async () => {
    setBusy(true);
    try { setAns(await api.post<ExplainAnswer>("ai/lead/cold-explain", {})); } catch { setAns({ ok: false, error: "The AI explanation did not work. The counts are unchanged.", sent: null }); }
    setBusy(false);
  };
  return (
    <section className="mb-8 rounded-xl border bg-card p-4" aria-label="Why leads go cold" data-testid="ai-cold">
      <h3 className="text-base font-semibold">Why leads go cold</h3>
      {r.judged === 0 ? <p className="mt-1 text-sm text-muted-foreground" data-testid="ai-cold-empty">No leads from the last {r.windowDays} days are old enough to judge yet.</p> : (
        <>
          <p className="mt-1 text-sm" data-testid="ai-cold-headline">
            <button type="button" className={LINK} data-testid="ai-cold-all" onClick={() => setOpen({ key: "all", title: "Leads no person replied to" })}>{r.cold.toLocaleString("en-US")} of {r.judged.toLocaleString("en-US")}</button>{" "}
            leads from the last {r.windowDays} days never got a reply from a person{r.coldPct !== null ? ` (${r.coldPct}%)` : ""}. A lead counts once it is more than {r.waitHours} hours old. Leads who asked not to be contacted are left out.{d.truncated ? " This range holds more leads than SubSync reads at once; the newest 20,000 are used." : ""}
          </p>
          {r.patterns.length === 0 ? <p className="mt-2 text-sm text-muted-foreground" data-testid="ai-cold-nopattern">No pattern stands out yet: each group needs at least 5 leads with at least 3 unanswered.</p> : (
            <ul className="mt-3 divide-y rounded-lg border text-sm" data-testid="ai-cold-patterns">
              {r.patterns.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="ai-cold-pattern">
                  <span className="min-w-0 flex-1">{p.label}</span>
                  <button type="button" className={LINK} data-testid="ai-cold-count" onClick={() => setOpen({ key: p.key, title: p.label })}>{p.cold.toLocaleString("en-US")} of {p.of.toLocaleString("en-US")}</button>
                  <span className="w-12 text-right tabular-nums text-muted-foreground">{p.ratePct}%</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3" data-testid="ai-cold-explain">
            {ex ? (
              <div className="space-y-1.5 text-sm">
                <p><span className="mr-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">AI</span>{ex.explanation}</p>
                <p className="font-medium">Three things to try</p>
                <ol className="list-decimal space-y-0.5 pl-5">{ex.fixes.slice(0, 3).map((f, i) => <li key={i}>{f}</li>)}</ol>
                <p className="text-xs text-muted-foreground">AI suggestion based on the counts above. Nothing was changed and nobody was messaged.</p>
              </div>
            ) : !d.enough ? <p className="text-sm text-muted-foreground" data-testid="ai-cold-thin">Fewer than 5 leads went unanswered, which is too few to explain a pattern.</p> : (
              <button type="button" className={BTN} disabled={busy || !d.ready} onClick={() => void run()} title={d.ready ? undefined : whyNot(st, "cold_reasons")} data-testid="ai-cold-run"><Sparkles aria-hidden className="size-4" />{busy ? "Explaining..." : "Explain this with AI"}</button>
            )}
            {!d.ready && d.enough && !ex && <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-cold-why">The counts work without AI. {whyNot(st, "cold_reasons")}</p>}
            {ans && !ans.ok && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="ai-cold-error">{ans.error}</p>}
            <SentBox sent={(ans?.sent ?? null) ?? (ex ? d.sent : null)} testId="ai-cold-sent" />
          </div>
        </>
      )}
      {open && <ColdRows pattern={open.key} title={open.title} onClose={() => setOpen(null)} />}
    </section>
  );
}

type ColdRow = { contactId: string; locationId: string; name: string; locationName: string | null; leadAt: number; source: string | null; url: string };
type ColdPage = { pattern: string; label: string; total: number; page: number; size: number; truncated: boolean; rows: ColdRow[] };

/** The exact leads behind one count, paged on the server (20, 50 or 100 at a time). */
function ColdRows({ pattern, title, onClose }: { pattern: string; title: string; onClose: () => void }) {
  const [pg, setPg] = useState({ page: 0, size: 20 });
  const q = useData<ColdPage>(`ai/lead/cold-rows?pattern=${encodeURIComponent(pattern)}&page=${pg.page}&size=${pg.size}`);
  const d = q.data;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title} data-testid="ai-cold-popup" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-card p-4 text-card-foreground shadow-[var(--shadow-lift)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3"><h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="ds-press -m-1 rounded-md p-2 hover:bg-muted"><X aria-hidden className="size-4" /></button></div>
        {q.error ? <p className="py-4 text-sm text-destructive">These leads could not be loaded. Close this and try again.</p> : !d ? <p className="py-4 text-sm text-muted-foreground">Loading...</p> : d.rows.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nobody here.</p> : (
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border text-sm" data-testid="ai-cold-rows">
            {d.rows.map((r) => (
              <li key={`${r.locationId}:${r.contactId}`} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5" data-testid="ai-cold-row">
                <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:underline" onClick={() => openLeadPanel({ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, url: r.url }, true)}>{r.name}{r.locationName ? <span className="font-normal text-muted-foreground"> · {r.locationName}</span> : null}</button>
                <span className="text-xs text-muted-foreground">arrived {new Date(r.leadAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{r.source ? `, ${r.source}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {d && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span data-testid="ai-cold-total">{d.total.toLocaleString("en-US")} {d.total === 1 ? "lead" : "leads"}. Page {d.page + 1} of {pages.toLocaleString("en-US")}.</span>
            <span className="flex items-center gap-1.5">
              <select aria-label="Rows per page" className="min-h-8 rounded-md border bg-card px-1" value={pg.size} onChange={(e) => setPg({ page: 0, size: Number(e.target.value) })}>{[20, 50, 100].map((p) => <option key={p} value={p}>{p} rows</option>)}</select>
              <button type="button" className="min-h-8 rounded-md border px-2 disabled:opacity-40" disabled={pg.page === 0} onClick={() => setPg({ ...pg, page: pg.page - 1 })}>Previous</button>
              <button type="button" className="min-h-8 rounded-md border px-2 disabled:opacity-40" disabled={pg.page >= pages - 1} onClick={() => setPg({ ...pg, page: pg.page + 1 })}>Next</button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
