"use client";

import { useState } from "react";
import type { RecordsSpec } from "@/lib/analytics/today-records";
import { EmptyState, InlineAlert, Section, SkeletonCards } from "../ds";
import { WfTrend } from "../ds/workflow-charts";
import { useApiClient, useData } from "../session";
import { Btn } from "../ui";
import type { Acct, DhData } from "./data-health";

type Open = (loc: string, rule: string | null, when?: string | null, extra?: string) => void;
type Common = { data: DhData; target: Acct | null };
const Pick = () => <EmptyState title="Choose one client account" body="Use the client account picker above. This section works on one account at a time." />;
const Locked = ({ what }: { what: string }) => <InlineAlert tone="info" title="On the paid plan">{what} is part of the paid plan.</InlineAlert>;

export function ImportsTab({ data, target, openRecords }: Common & { openRecords: Open }) {
  const s = useData<{ locked: boolean; sources: Array<{ source: string; count: number; recent: number; rules: string[] }>; spikes: Array<{ source: string; recent: number; created: number; usual: number }> }>(target && data.can.pro ? `data-health/sources?loc=${target.locationId}` : null);
  if (!target) return <Pick />;
  if (!data.can.pro) return <Locked what="The import guard" />;
  if (s.loading && !s.data) return <SkeletonCards cards={2} label="Reading sources..." />;
  const d = s.data;
  if (!d) return null;
  return (
    <div data-testid="dh-imports">
      <p className="mb-4 text-sm text-muted-foreground">SubSync cannot block a bad import, but it tells you the same day. An alert is raised when one source creates many bad records compared with this account's own normal (at least {data.settings.spikeMin}).</p>
      {d.spikes.length ? <div className="mb-6 space-y-2" data-testid="dh-spikes">{d.spikes.map((x) => <InlineAlert key={x.source} tone="warning" title={`${x.source}: ${x.recent} bad records in the last 24 hours`}>It created {x.created} records and its usual is {x.usual} bad ones a day.</InlineAlert>)}</div> : <p className="mb-6 text-sm" data-testid="dh-no-spikes">No source is sending an unusual number of bad records right now.</p>}
      <Section title="Bad records by where they came from" hint="Duplicates, junk, invalid phones and emails. Press a number to see them.">
        {d.sources.length === 0 ? <EmptyState compact title="Nothing to show" body="No open duplicate, junk or invalid records." /> : (
          <div role="table" aria-label="Sources" className="text-sm" data-testid="dh-sources">
            <div role="row" className="grid grid-cols-[minmax(0,3fr)_7rem_8rem_minmax(0,3fr)] gap-3 border-b py-2 text-xs font-semibold text-muted-foreground"><span role="columnheader">Source</span><span role="columnheader" className="text-right">Bad records</span><span role="columnheader" className="text-right">New in 3 days</span><span role="columnheader">Kinds</span></div>
            {d.sources.map((r) => (
              <div role="row" key={r.source} className="grid grid-cols-[minmax(0,3fr)_7rem_8rem_minmax(0,3fr)] items-center gap-3 border-b py-2" data-testid="dh-source-row">
                <span role="cell" className="font-medium">{r.source}</span>
                <span role="cell" className="text-right"><button type="button" onClick={() => openRecords(target.locationId, null, null, `&mode=source&src=${encodeURIComponent(r.source)}`)} className="min-h-9 font-semibold tabular-nums text-primary hover:underline" data-testid="dh-source-n">{r.count}</button></span>
                <span role="cell" className="text-right tabular-nums">{r.recent}</span>
                <span role="cell" className="text-muted-foreground">{r.rules.join(", ")}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

const FINDERS: Array<{ rule: string; label: string }> = [{ rule: "junk", label: "Junk and test records" }, { rule: "orphan", label: "No deal and no conversation" }, { rule: "stale", label: "No activity for a long time" }, { rule: "duplicate", label: "Duplicates" }];

export function QueueTab({ data, target, openRecords, reload }: Common & { openRecords: Open; reload: () => void }) {
  const api = useApiClient();
  const [rule, setRule] = useState("junk");
  const [owner, setOwner] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const list = useData<{ spec: RecordsSpec }>(target && data.can.pro ? `data-health/records?loc=${target.locationId}&rule=${rule}` : null);
  if (!target) return <Pick />;
  if (!data.can.pro) return <Locked what="The finder lists" />;
  const act = async (id: string, state: "todo" | "ignored" | "fixed" | "open") => {
    setErr(null);
    try { await api.post("data-health/mark", { locationId: target.locationId, contactIds: [id.split("|")[0]], state, owner: state === "todo" ? owner || null : undefined }); await list.reload(); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const spec = list.data?.spec;
  return (
    <div data-testid="dh-queue">
      <p className="mb-4 text-sm text-muted-foreground">These lists only read. Ignore, Mark fixed and the queue are kept in SubSync and never change your CRM. Ignored records leave the score.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Finder lists">
        {FINDERS.map((f) => <button key={f.rule} type="button" aria-pressed={rule === f.rule} onClick={() => setRule(f.rule)} data-testid={`dh-find-${f.rule}`} className={`min-h-9 rounded-lg border px-3 text-sm ${rule === f.rule ? "bg-accent font-semibold" : "hover:bg-accent/50"}`}>{f.label}</button>)}
        <button type="button" onClick={() => openRecords(target.locationId, null, null, "&mode=queue")} data-testid="dh-open-queue" className="min-h-9 rounded-lg border px-3 text-sm hover:bg-accent">My queue</button>
        <label className="text-sm"><span className="sr-only">Give to</span><input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} placeholder="Give to (a name)" data-testid="dh-owner" className="h-9 w-40 rounded-lg border bg-background px-2 text-sm" /></label>
      </div>
      {err ? <InlineAlert tone="warning" className="mb-3">{err}</InlineAlert> : null}
      {list.loading && !spec ? <SkeletonCards cards={2} label="Finding records..." /> : !spec || spec.rows.length === 0 ? <EmptyState compact title="Nothing found" body="No open records of this kind." /> : (
        <div role="table" aria-label="Records" className="text-sm" data-testid="dh-finder-table">
          <p className="mb-2 text-xs text-muted-foreground" data-testid="dh-finder-count">{spec.count} record{spec.count === 1 ? "" : "s"}{spec.note ? `. ${spec.note}` : ""}</p>
          <div role="row" className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_8rem_minmax(0,1fr)_16rem] gap-3 border-b py-2 text-xs font-semibold text-muted-foreground"><span role="columnheader">Name</span><span role="columnheader">Email or phone</span><span role="columnheader">State</span><span role="columnheader">Owner</span><span role="columnheader">Decide</span></div>
          {spec.rows.slice(0, 100).map((r) => (
            <div role="row" key={r.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_8rem_minmax(0,1fr)_16rem] items-center gap-3 border-b py-1.5" data-testid="dh-finder-row">
              <span role="cell" className="truncate font-medium">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{String(r.cells.name)}</a> : String(r.cells.name)}</span>
              <span role="cell" className="truncate text-muted-foreground">{String(r.cells.email ?? r.cells.phone ?? "")}</span>
              <span role="cell">{String(r.cells.state)}</span>
              <span role="cell" className="truncate">{String(r.cells.owner ?? "")}</span>
              <span role="cell" className="flex gap-1">{data.can.mark ? (["todo", "ignored", "fixed"] as const).map((s) => <button key={s} type="button" onClick={() => act(r.id, s)} data-testid={`dh-act-${s}`} className="min-h-8 rounded border px-2 text-xs hover:bg-accent">{s === "todo" ? "Queue" : s === "ignored" ? "Ignore" : "Fixed"}</button>) : null}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Plan = { changes: Array<{ contactId: string; field: string; before: string; after: string }>; skipped: number; skippedWhy: string[]; cut: boolean; token: string; live: boolean; capPerDay: number; note: string };
export function FixTab({ data, target, reload }: Common & { reload: () => void }) {
  const api = useApiClient();
  const [kinds, setKinds] = useState<Array<"phone" | "name">>(["phone"]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hist = useData<{ rows: Array<{ id: number; contactId: string; field: string; before: string; after: string; outcome: string; who: string; at: number; undoable: boolean }> }>(target && data.can.fix ? `data-health/fixes?loc=${target.locationId}` : null);
  if (!target) return <Pick />;
  if (data.needs.upgradeFix) return <Locked what="Safe fixes" />;
  if (!data.can.fix) return <InlineAlert tone="info">Only an administrator can fix records.</InlineAlert>;
  if (!data.permissions.fix) return <InlineAlert tone="warning" title="Needs permission: reconnect">Open SubSync again from your CRM and allow <code>{data.permissions.scope}</code>. Until then nothing can be changed.</InlineAlert>;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); } };
  return (
    <div data-testid="dh-fix">
      <p className="mb-3 text-sm text-muted-foreground">Only two things: phone numbers written in one standard format, and names typed all in capitals or all in lower case. Nothing is merged or deleted. Contacts with do not disturb, an open deal or an upcoming appointment are skipped. You can undo for 24 hours.</p>
      {!data.permissions.writeLive ? <InlineAlert tone="info" className="mb-3">Rehearsal mode: changes are checked and recorded here, and nothing is sent to your CRM.</InlineAlert> : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {(["phone", "name"] as const).map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} data-testid={`dh-kind-${k}`} />{k === "phone" ? "Phone format" : "Name capitals"}</label>)}
        <Btn variant="primary" disabled={busy || kinds.length === 0} testId="dh-preview" onClick={() => run(async () => { setPlan(await api.post<Plan>("data-health/preview", { locationId: target.locationId, kinds })); })}>Preview changes</Btn>
      </div>
      {msg ? <InlineAlert tone={msg.ok ? "success" : "warning"} className="mb-3">{msg.text}</InlineAlert> : null}
      {plan ? (
        <section data-testid="dh-plan" className="mb-8">
          <p className="mb-2 text-sm" data-testid="dh-plan-count">{plan.changes.length} change{plan.changes.length === 1 ? "" : "s"} ready{plan.skipped ? `. ${plan.skipped} protected contact${plan.skipped === 1 ? "" : "s"} skipped (${plan.skippedWhy.join(", ")})` : ""}{plan.cut ? `. Cut at the daily limit of ${plan.capPerDay}` : ""}.</p>
          <p className="mb-2 text-xs text-muted-foreground">{plan.note}</p>
          <div role="table" aria-label="Preview" className="text-sm">
            <div role="row" className="grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b py-2 text-xs font-semibold text-muted-foreground"><span role="columnheader">What</span><span role="columnheader">Before</span><span role="columnheader">After</span></div>
            {plan.changes.slice(0, 100).map((c, i) => <div role="row" key={i} className="grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b py-1.5"><span role="cell">{c.field === "phone" ? "Phone" : c.field === "firstName" ? "First name" : "Last name"}</span><span role="cell" className="truncate">{c.before}</span><span role="cell" className="truncate">{c.after}</span></div>)}
          </div>
          <div className="mt-3 flex gap-2">
            <Btn variant="primary" disabled={busy || plan.changes.length === 0} testId="dh-confirm" onClick={() => run(async () => { const r = await api.post<{ message: string; ok: boolean }>("data-health/confirm", { locationId: target.locationId, kinds, token: plan.token }); setMsg({ ok: r.ok, text: r.message }); setPlan(null); await hist.reload(); reload(); })}>Confirm and apply</Btn>
            <Btn onClick={() => setPlan(null)}>Cancel</Btn>
          </div>
        </section>
      ) : null}
      <Section title="Recent fixes" hint="Each can be undone for 24 hours.">
        {!hist.data || hist.data.rows.length === 0 ? <EmptyState compact title="No fixes yet" /> : (
          <div role="table" aria-label="Fixes" className="text-sm" data-testid="dh-fix-history">
            {hist.data.rows.slice(0, 50).map((r) => (
              <div role="row" key={r.id} className="grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_7rem_6rem] items-center gap-3 border-b py-1.5">
                <span role="cell">{r.field}</span><span role="cell" className="truncate">{r.before}</span><span role="cell" className="truncate">{r.after}</span><span role="cell">{r.outcome}</span>
                <span role="cell">{r.undoable ? <button type="button" className="min-h-8 rounded border px-2 text-xs hover:bg-accent" data-testid="dh-undo" onClick={() => run(async () => { await api.post("data-health/undo", { locationId: target.locationId, id: r.id }); await hist.reload(); })}>Undo</button> : null}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function RulesTab({ data, target, reload }: Common & { reload: () => void }) {
  const api = useApiClient();
  const s = data.settings;
  const [words, setWords] = useState(s.junkWords.join(", "));
  const [stale, setStale] = useState(String(s.staleDays));
  const [region, setRegion] = useState(s.phoneRegion);
  const [spike, setSpike] = useState(String(s.spikeMin));
  const [opt, setOpt] = useState(s.optOut);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!target) return <Pick />;
  if (!data.can.rules) return <InlineAlert tone="info">{data.can.pro ? "Only an administrator can change the rules." : "Saved rules are part of the paid plan."}</InlineAlert>;
  const save = async () => {
    try {
      await api.put("data-health/rules", { locationId: target.locationId, junkWords: words.split(",").map((w) => w.trim()).filter(Boolean), staleDays: Number(stale), phoneRegion: region, spikeMin: Number(spike) });
      if (data.kind === "agency" || data.kind === "business") await api.put("data-health/rules", { locationId: "*", optOut: opt }).catch(() => undefined);
      setMsg({ ok: true, text: "Saved. The score uses these from the next update." }); reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const field = "h-9 rounded-lg border bg-background px-2 text-sm";
  return (
    <div data-testid="dh-rules" className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">These rules belong to this client account and stay in SubSync. You can download them with the rest of your record at any time.</p>
      <label className="block text-sm">Extra junk words (names or email domains, separated by commas)<input value={words} onChange={(e) => setWords(e.target.value)} className={`${field} mt-1 w-full`} data-testid="dh-words" /></label>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm">Days without activity<input value={stale} onChange={(e) => setStale(e.target.value)} inputMode="numeric" className={`${field} mt-1 w-full`} data-testid="dh-stale" /></label>
        <label className="text-sm">Phone country code<input value={region} onChange={(e) => setRegion(e.target.value)} inputMode="numeric" className={`${field} mt-1 w-full`} data-testid="dh-region" /></label>
        <label className="text-sm">Alert minimum<input value={spike} onChange={(e) => setSpike(e.target.value)} inputMode="numeric" className={`${field} mt-1 w-full`} data-testid="dh-spike" /></label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={opt} onChange={(e) => setOpt(e.target.checked)} data-testid="dh-optout" className="mt-1" /><span>Do not take part in anonymous comparisons. Only a score and a coarse size group are ever shared, never a record, a name or an id, and a group shows only when at least 10 accounts from at least 3 companies are in it.</span></label>
      {msg ? <InlineAlert tone={msg.ok ? "success" : "warning"}>{msg.text}</InlineAlert> : null}
      <div className="flex gap-2"><Btn variant="primary" onClick={save} testId="dh-rules-save">Save rules</Btn><Btn onClick={() => api.download(`data-health/export?loc=${target.locationId}`, `data-health-${target.name.replace(/[^a-z0-9]+/gi, "-")}.json`)} testId="dh-export">Download my record</Btn></div>
    </div>
  );
}

export function ProofTab({ data, target }: Common) {
  const p = useData<{ account: string; since: { since: string; first: number; now: number; found: number; fixed: number } | null; series: Array<{ day: string; score: number | null }>; outcomes: { raised: number; fixed: number; avgHoursToFix: number | null }; open: Array<{ label: string; count: number }>; lines: string[] }>(target ? `data-health/proof?loc=${target.locationId}` : null);
  if (!target) return <Pick />;
  if (p.loading && !p.data) return <SkeletonCards cards={2} label="Building the proof..." />;
  const d = p.data;
  if (!d) return null;
  void data;
  return (
    <div data-testid="dh-proof" className="max-w-2xl">
      <h2 className="mb-2 text-lg font-semibold">{d.account}: data health proof</h2>
      <ul className="mb-6 list-disc space-y-1 pl-5 text-sm" data-testid="dh-proof-lines">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="mb-6"><WfTrend title="Score over time" points={d.series.map((s) => ({ day: s.day, value: s.score }))} need={2} /></div>
      <p className="mb-2 text-sm text-muted-foreground" data-testid="dh-proof-outcomes">{d.outcomes.raised ? `${d.outcomes.raised} quality alerts caught, ${d.outcomes.fixed} resolved${d.outcomes.avgHoursToFix !== null ? `, on average ${d.outcomes.avgHoursToFix} hours to fix` : ""}. We cannot tell from the platform whether a client noticed first, so that is not claimed.` : "No quality alerts yet."}</p>
      <Btn onClick={() => window.print()} testId="dh-proof-print">Print this page</Btn>
    </div>
  );
}
