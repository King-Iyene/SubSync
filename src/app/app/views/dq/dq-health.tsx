"use client";

import { useState } from "react";
import { InfoTip } from "../../ds/info-tip";
import { useApiClient } from "../../session";
import { sampleOn, type AreaState, type HealthRes } from "./dq-data";

// LEAD INTAKE HEALTH (part of the Lead intake tab): how many applications each form and survey got in the last 7 days against its own usual week, the pages of each funnel, and the redirects and
// trigger links with no target. Names and times only, never an answer. Every part says why it is empty: "Needs permission: reconnect", "Not read yet", or the real list.

const INPUT = "min-h-10 w-24 rounded-lg border bg-card px-2 text-sm tabular-nums";
const SAVE = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary";
const VERDICT: Record<string, { word: string; cls: string }> = {
  drop: { word: "Dropping", cls: "border-warning/50 bg-warning/10" }, ok: { word: "Normal", cls: "" },
  not_enough_data: { word: "Not enough data yet", cls: "text-muted-foreground" }, zero_baseline: { word: "Too small to compare", cls: "text-muted-foreground" },
};
const FOLD = 30;

function Gate({ state, what, children }: { state: AreaState | undefined; what: string; children: React.ReactNode }) {
  if (state === "needs_permission") return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground" data-testid="dq-health-perm">Needs permission: reconnect. {what} is read with an optional permission you have not accepted.</p>;
  if (state === undefined || state === "never") return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Not read yet. SubSync reads {what.toLowerCase()} every 30 minutes once it is connected.</p>;
  return <>{children}</>;
}

/** Five small bars, oldest week first, the last 7 days on the right. */
function Weeks({ weeks, name }: { weeks: number[]; name: string }) {
  const ordered = [...weeks].reverse(), max = Math.max(1, ...ordered);
  return (
    <svg viewBox="0 0 50 20" className="h-6 w-14 shrink-0" role="img" aria-label={`${name}: weekly applications, oldest first: ${ordered.join(", ")}`}>
      {ordered.map((v, i) => <rect key={i} x={i * 10 + 1} y={20 - (v / max) * 20} width={8} height={Math.max(1, (v / max) * 20)} rx={1} className={i === ordered.length - 1 ? "fill-primary" : "fill-primary/40"}><title>{i === ordered.length - 1 ? `Last 7 days: ${v}` : `${4 - i === 1 ? "The week before" : `${4 - i} weeks before`}: ${v}`}</title></rect>)}
    </svg>
  );
}

export function HealthSection({ health, reload }: { health: HealthRes; reload: () => void }) {
  const api = useApiClient(), fx = sampleOn();
  const st = health.status, s = health.settings;
  const [drop, setDrop] = useState(String(s.dropPct)), [base, setBase] = useState(String(s.minBaseline)), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false), [all, setAll] = useState(false);
  const multi = new Set(health.forms.map((f) => f.locationId)).size > 1;
  const save = async () => {
    setBusy(true); setNote(null);
    try {
      if (!fx) await api.post("dq/health-settings", { dropPct: Number(drop), minBaseline: Number(base) });
      setNote("Saved. The next refresh uses these numbers."); reload();
    } catch (e) { setNote((e as Error).message || "Could not save."); } finally { setBusy(false); }
  };
  const formsState: AreaState | undefined = st ? (st.forms === "ok" || st.surveys === "ok" ? "ok" : st.forms === "needs_permission" || st.surveys === "needs_permission" ? "needs_permission" : "never") : undefined;
  const linkRows = all ? health.links.rows : health.links.rows.slice(0, FOLD);
  const linksState: AreaState | undefined = st ? (st.links === "ok" || st.redirects === "ok" ? "ok" : st.links === "needs_permission" || st.redirects === "needs_permission" ? "needs_permission" : "never") : undefined;
  const pagesState: AreaState | undefined = st ? (st.funnels === "needs_permission" ? "needs_permission" : st.funnel_pages === "ok" ? "ok" : st.funnel_pages) : undefined;

  return (
    <div className="space-y-5" data-testid="dq-health">
      <section aria-label="Applications this week" data-testid="dq-health-forms">
        <h3 className="mb-2 text-base font-semibold">Applications this week <InfoTip text="The last 7 days of each form and survey against its own usual week (the middle of the 4 weeks before). Needs 5 weeks of that form's history. SubSync reads names and times only, never the answers." label="How this is worked out" /></h3>
        <Gate state={formsState} what="Forms and surveys">
          {health.forms.length === 0 ? <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">No form or survey found in your client accounts yet.</p> : (
            <ul className="divide-y rounded-xl border bg-card">{health.forms.slice(0, 40).map((f) => {
              const v = VERDICT[f.health.verdict] ?? VERDICT.ok;
              return (
                <li key={`${f.locationId}:${f.kind}:${f.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid="dq-health-form">
                  <div className="min-w-0"><p className="text-sm"><span className={`mr-2 rounded border px-1.5 py-0.5 text-xs ${v.cls}`}>{v.word}</span><span className="font-medium">{f.name}</span> <span className="text-xs text-muted-foreground">{f.kind === "survey" ? "Survey" : "Form"}{multi && f.locationName ? ` · ${f.locationName}` : ""}</span></p>
                    <p className="text-xs text-muted-foreground">{f.health.line}</p></div>
                  {f.health.verdict !== "not_enough_data" && <Weeks weeks={f.weeks} name={f.name} />}
                </li>);
            })}</ul>)}
          {health.forms.length > 40 && <p className="mt-1 text-xs text-muted-foreground">Showing 40 of {health.forms.length}. Dropping forms come first.</p>}
          {health.canChange && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" data-testid="dq-health-settings">
              <label className="text-sm">Alert when applications drop by more than <span className="block text-xs text-muted-foreground">percent, {s.minDropPct} to {s.maxDropPct}</span><input type="number" min={s.minDropPct} max={s.maxDropPct} className={INPUT} value={drop} onChange={(e) => setDrop(e.target.value)} aria-label="Drop percent" /></label>
              <label className="text-sm">but only if a usual week has at least <span className="block text-xs text-muted-foreground">applications, 1 to 100</span><input type="number" min={1} max={100} className={INPUT} value={base} onChange={(e) => setBase(e.target.value)} aria-label="Smallest usual week" /></label>
              <button type="button" className={SAVE} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>
              {note && <p className="basis-full text-xs text-muted-foreground" role="status">{note}</p>}
            </div>)}
        </Gate>
      </section>

      <section aria-label="Funnel pages" data-testid="dq-health-funnels">
        <h3 className="mb-2 text-base font-semibold">Funnel pages <InfoTip text="The pages and steps of each funnel. The platform does not send page views or visits, so SubSync shows none and raises no funnel alert." label="What is read" /></h3>
        <Gate state={pagesState} what="Funnel pages">
          {health.funnels.length === 0 ? <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">No funnel found in your client accounts yet.</p> : (
            <ul className="divide-y rounded-xl border bg-card text-sm">{health.funnels.map((f) => (
              <li key={`${f.locationId}:${f.id}`} className="px-3 py-2.5" data-testid="dq-health-funnel">
                <p className="font-medium">{f.name} <span className="text-xs font-normal text-muted-foreground">{f.pages === null ? "Pages not read yet" : `${f.pages} ${f.pages === 1 ? "page" : "pages"}`}{f.steps !== null ? ` · ${f.steps} ${f.steps === 1 ? "step" : "steps"}` : ""}{multi && f.locationName ? ` · ${f.locationName}` : ""}</span></p>
                {f.pageNames.length > 0 && <p className="text-xs text-muted-foreground">{f.pageNames.join(", ")}{f.pages !== null && f.pages > f.pageNames.length ? `, and ${f.pages - f.pageNames.length} more` : ""}</p>}
              </li>))}</ul>)}
          <p className="mt-1 text-xs text-muted-foreground">{health.viewsNote}.</p>
        </Gate>
      </section>

      <section aria-label="Redirects and trigger links" data-testid="dq-health-links">
        <h3 className="mb-2 text-base font-semibold">Redirects and trigger links {health.links.total > 0 && <span className="text-sm font-normal text-muted-foreground">{health.links.total} found, {health.links.empty} with no target</span>}</h3>
        <Gate state={linksState} what="Redirects and trigger links">
          {health.links.rows.length === 0 ? <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">No redirect or trigger link found in your client accounts yet.</p> : (
            <ul className="divide-y rounded-xl border bg-card text-sm">{linkRows.map((r) => (
              <li key={`${r.locationId}:${r.kind}:${r.id}`} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${r.empty ? "bg-warning/10" : ""}`} data-testid="dq-health-link">
                <span className="min-w-0"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">{r.kind === "redirect" ? "Redirect" : "Trigger link"}{multi && r.locationName ? ` · ${r.locationName}` : ""}</span></span>
                {r.empty ? <span className="rounded border border-warning/50 px-1.5 py-0.5 text-xs">No target: it goes nowhere</span> : <span className="max-w-full truncate text-xs text-muted-foreground" title={r.target ?? ""}>{r.target ?? "The platform did not say where it goes"}</span>}
              </li>))}</ul>)}
          {health.links.rows.length > FOLD && !all && <button type="button" className={`${SAVE} mt-2`} onClick={() => setAll(true)}>Show all {health.links.rows.length}</button>}
          {health.links.total > health.links.rows.length && <p className="mt-1 text-xs text-muted-foreground">Showing the first {health.links.rows.length} of {health.links.total}. Links with no target come first.</p>}
        </Gate>
      </section>
    </div>
  );
}
