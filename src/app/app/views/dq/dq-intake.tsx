"use client";

import { useMemo, useState } from "react";
import { avgTouchMin, goodRate, pctOf, rate, MIN_LEADS } from "@/lib/dq/dq-core";
import { EmptyState, ErrorState, LocalAccountPicker, SkeletonRows } from "../../ds";
import { InfoTip } from "../../ds/info-tip";
import { useApiClient } from "../../session";
import { fmtInt, timeAgo } from "../../ui";
import { sampleOn, SAMPLE, useDq, type AlertRow, type Counts, type FormRow, type IntakeRes, type Opts, type SourceDetail, type SourceRow } from "./dq-data";
import { Sheet, type LeadsPick } from "./dq-leads";

// LEAD INTAKE: where leads come from and which source is worth it. A leaderboard of sources (and forms, surveys and funnels), ranked by leads, bookings, sales or quality; a per-source drawer with its
// trend; low-rate and dead-source alerts against each source's OWN history; a "best and worst" line. Every count opens exactly its people. Money is counted only from won deals linked to the person.
// Honest about the platform: it sends no form-view or funnel-conversion numbers and no "form submitted" event, so rates are computed from the leads SubSync holds.

const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const Q_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary";
const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"]] as const;
type Rank = "leads" | "booked" | "sales" | "quality";
const RANK_LABEL: Record<Rank, string> = { leads: "Most leads", booked: "Most bookings", sales: "Most sales $", quality: "Best quality" };
const KIND_WORD: Record<AlertRow["kind"], string> = { dead: "Gone quiet", low_rate: "Dropping", dup_heavy: "Many duplicates", junk_heavy: "Many junk" };

/** A number that opens the people behind it. Zero is plain text. */
function Count({ n, label, onOpen, testId }: { n: number; label: string; onOpen: () => void; testId?: string }) {
  if (n <= 0) return <span className="tabular-nums text-muted-foreground">0</span>;
  return <button type="button" onClick={onOpen} aria-label={`${fmtInt(n)} ${label}. Open them.`} data-testid={testId} className="ds-press -mx-1 min-h-8 rounded px-1 text-left font-semibold tabular-nums underline-offset-4 hover:bg-accent/60 hover:underline focus-visible:outline-2 focus-visible:outline-primary">{fmtInt(n)}</button>;
}

export function IntakeTab({ opts, account, setAccount, pick }: { opts: Opts; account: string | null; setAccount: (v: string | null) => void; pick: (p: LeadsPick) => void }) {
  const [range, setRange] = useState<string>("30"), [rank, setRank] = useState<Rank>("leads"), [drawer, setDrawer] = useState<string | null>(null);
  const fx = sampleOn(), api = useApiClient();
  const q = `range=${range}${account ? `&account=${account}` : ""}`;
  const d = useDq<IntakeRes>(`dq/intake?${q}`, () => SAMPLE.intake);
  const [note, setNote] = useState<string | null>(null);
  const rows = useMemo(() => {
    const all = d.data?.sources ?? [];
    const key = (r: SourceRow) => (rank === "booked" ? r.booked : rank === "sales" ? r.wonValue : rank === "quality" ? (goodRate(r) ?? -1) : r.leads);
    return [...all].sort((a, b) => key(b) - key(a) || b.leads - a.leads);
  }, [d.data, rank]);
  if (d.loading && !d.data) return <SkeletonRows rows={6} label="Loading lead intake..." />;
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  const data = d.data;
  if (!data) return null;
  const leadsQ = (extra: string) => `${extra}&range=${range}${account ? `&account=${account}` : ""}`;
  const open = (r: SourceRow, flag: string, title: string) => pick({ title: `${title}: ${r.label}`, sub: `Last ${range} days`, query: leadsQ(`src=${encodeURIComponent(r.key)}&flag=${flag}`) });
  const mute = async (a: AlertRow, on: boolean) => {
    try { if (!fx) await api.post("dq/mute", { account: a.locationId, src: a.key, on, days: on ? 7 : undefined }); setNote(on ? "Muted for 7 days." : "Alerts are back on."); d.reload(); } catch (e) { setNote((e as Error).message); }
  };
  const best = data.best && data.worst ? data.line : null;

  return (
    <div className="space-y-5" data-testid="dq-intake">
      {fx && <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="dq-sample">Sample data: these are not your real leads.</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-3xl font-semibold tabular-nums" data-testid="dq-intake-total">{fmtInt(data.total)}</p><p className="text-sm text-muted-foreground">new leads in {range} days{data.asOf ? ` · updated ${timeAgo(data.asOf)}` : ""}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {opts.accounts.length > 1 && <LocalAccountPicker accounts={opts.accounts} picked={account ? [account] : []} onChange={(ids) => setAccount(ids.length ? ids[ids.length - 1] : null)} label="Client account" />}
          <div role="group" aria-label="Time range" className="inline-flex overflow-hidden rounded-lg border">{RANGES.map(([v, l]) => <button key={v} type="button" aria-pressed={range === v} onClick={() => setRange(v)} className={`min-h-10 px-3 text-sm font-medium ${range === v ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent/50"}`}>{l}</button>)}</div>
        </div>
      </div>

      <p className="text-base" data-testid="dq-bestworst">{best ?? <span className="text-muted-foreground">{data.note ?? ""}</span>}</p>

      {data.alerts.length > 0 && (
        <section aria-label="Alerts" data-testid="dq-intake-alerts">
          <h3 className="mb-2 text-base font-semibold">Needs a look <span className="text-sm font-normal text-muted-foreground">{data.alerts.filter((a) => !a.muted).length}</span></h3>
          <ul className="divide-y rounded-xl border bg-card">{data.alerts.slice(0, 12).map((a) => (
            <li key={`${a.locationId}:${a.kind}:${a.key}`} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 ${a.muted ? "opacity-60" : ""}`}>
              <div className="min-w-0"><p className="text-sm"><span className="mr-2 rounded border px-1.5 py-0.5 text-xs">{KIND_WORD[a.kind]}</span>{a.title}</p><p className="text-xs text-muted-foreground">{a.locationName}</p></div>
              <div className="flex gap-2">
                <button type="button" className={Q_BTN} onClick={() => pick({ title: `Leads from ${a.label}`, sub: `Last ${range} days`, query: `src=${encodeURIComponent(a.key)}&flag=all&range=${range}&account=${a.locationId}` })}>See leads</button>
                {data.canMute && <button type="button" className={Q_BTN} onClick={() => void mute(a, !a.muted)} data-testid="dq-mute">{a.muted ? "Unmute" : "Mute 7 days"}</button>}
              </div></li>))}</ul>
          {note && <p className="mt-1 text-xs text-muted-foreground" role="status">{note}</p>}
        </section>
      )}

      <section aria-label="Where leads come from">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Where leads come from <InfoTip text={`Good lead = not a duplicate, not junk, and a person has touched it. Sales = won deals linked to the same person. A rate needs at least ${data.minLeads} leads.`} label="How this is worked out" /></h3>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">Rank by <select value={rank} onChange={(e) => setRank(e.target.value as Rank)} className="min-h-10 rounded-lg border bg-card px-2 text-sm text-foreground" data-testid="dq-rank">{(Object.keys(RANK_LABEL) as Rank[]).map((k) => <option key={k} value={k}>{RANK_LABEL[k]}</option>)}</select></label>
        </div>
        {rows.length === 0 ? <EmptyState title="No new leads in this range" body="When leads arrive you will see which source sent them." /> : (
          <div className="rounded-xl border bg-card" data-testid="dq-sources">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(6,minmax(0,1fr))] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid"><span>Source</span><span>Leads</span><span>Good</span><span>Duplicates</span><span>Booked</span><span>Sales</span><span>First reply</span></div>
            <ul className="divide-y">{rows.map((r, i) => <SourceItem key={r.key} r={r} rank={i + 1} open={open} onDrawer={() => setDrawer(r.key)} />)}</ul>
          </div>
        )}
      </section>

      <FormsSection data={data} range={range} pick={pick} />
      {drawer && <SourceDrawer srcKey={drawer} range={range} account={account} onClose={() => setDrawer(null)} pick={pick} />}
    </div>
  );
}

function SourceItem({ r, rank, open, onDrawer }: { r: SourceRow; rank: number; open: (r: SourceRow, flag: string, title: string) => void; onDrawer: () => void }) {
  const good = goodRate(r), dup = rate(r.dups, r.leads), reply = avgTouchMin(r);
  return (
    <li className="grid grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1.6fr)_repeat(6,minmax(0,1fr))] sm:gap-2" data-testid="dq-source-row">
      <button type="button" onClick={onDrawer} className="col-span-2 flex min-w-0 items-center gap-2 text-left font-medium hover:underline sm:col-span-1" data-testid="dq-source-name"><span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{rank}</span><span className="truncate">{r.label}</span></button>
      <span><span className="text-xs text-muted-foreground sm:hidden">Leads </span><Count n={r.leads} label="leads" onOpen={() => open(r, "all", "All leads")} testId="dq-count-leads" /></span>
      <span title={good === null ? `Needs ${MIN_LEADS} leads` : ""}><span className="text-xs text-muted-foreground sm:hidden">Good </span>{good === null ? <span className="text-muted-foreground">{pctOf(good)}</span> : <button type="button" onClick={() => open(r, "clean", "Good leads")} className="min-h-8 font-semibold tabular-nums hover:underline" aria-label={`${r.quality} good leads. Open them.`}>{pctOf(good)}</button>}</span>
      <span><span className="text-xs text-muted-foreground sm:hidden">Duplicates </span>{dup === null ? <Count n={r.dups} label="duplicates" onOpen={() => open(r, "dup", "Duplicates")} /> : <><Count n={r.dups} label="duplicates" onOpen={() => open(r, "dup", "Duplicates")} testId="dq-count-dups" /> <span className="text-xs text-muted-foreground">({pctOf(dup)})</span></>}</span>
      <span><span className="text-xs text-muted-foreground sm:hidden">Booked </span><Count n={r.booked} label="booked" onOpen={() => open(r, "booked", "Booked")} /></span>
      <span title="Won deals linked to the same person"><span className="text-xs text-muted-foreground sm:hidden">Sales </span>{r.wonValue > 0 ? <button type="button" onClick={() => open(r, "won", "Won")} className="min-h-8 font-semibold tabular-nums hover:underline" aria-label={`${money(r.wonValue)} from ${r.won} won deals. Open them.`}>{money(r.wonValue)}</button> : <span className="text-muted-foreground">—</span>}</span>
      <span className="text-muted-foreground"><span className="text-xs sm:hidden">First reply </span>{reply === null ? "—" : reply < 60 ? `${reply} min` : `${Math.round(reply / 60)} h`}</span>
    </li>
  );
}

function bars(trend: Array<{ day: string; leads: number }>, w = 320, h = 70) {
  const max = Math.max(1, ...trend.map((t) => t.leads)), bw = w / Math.max(1, trend.length);
  return trend.map((t, i) => <rect key={t.day} x={i * bw + 0.5} y={h - (t.leads / max) * h} width={Math.max(1, bw - 1)} height={(t.leads / max) * h} rx={1} className="fill-primary/60"><title>{`${t.day}: ${t.leads} leads`}</title></rect>);
}

function SourceDrawer({ srcKey, range, account, onClose, pick }: { srcKey: string; range: string; account: string | null; onClose: () => void; pick: (p: LeadsPick) => void }) {
  const d = useDq<SourceDetail>(`dq/intake-source?src=${encodeURIComponent(srcKey)}&range=${range}${account ? `&account=${account}` : ""}`, () => SAMPLE.source(srcKey));
  const c: Counts | undefined = d.data?.counts;
  const q = (flag: string, acc?: string) => `src=${encodeURIComponent(srcKey)}&flag=${flag}&range=${range}${acc ?? account ? `&account=${acc ?? account}` : ""}`;
  const go = (flag: string, title: string) => pick({ title: `${title}: ${d.data?.label ?? ""}`, sub: `Last ${range} days`, query: q(flag) });
  const trend = (d.data?.trend ?? []).slice(-Math.max(Number(range), 14));
  return (
    <Sheet title={d.data?.label ?? "Source"} sub={`Last ${range} days`} onClose={onClose} testId="dq-source-drawer">
      {d.loading && !d.data ? <SkeletonRows rows={4} label="Loading this source..." /> : d.error ? <ErrorState error={d.error} onRetry={d.reload} /> : d.data && c ? (
        <div className="space-y-5">
          <div><p className="mb-1 text-xs text-muted-foreground">Leads per day</p><svg viewBox="0 0 320 70" className="h-20 w-full" role="img" aria-label={`Leads per day for ${d.data.label}, ${c.leads} in ${range} days`}>{bars(trend)}</svg></div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {([["Leads", "all", c.leads], ["Clean leads", "ok", c.leads - c.dups - c.junk], ["Duplicates", "dup", c.dups], ["Junk", "junk", c.junk], ["Answered", "answered", c.answered], ["Booked", "booked", c.booked], ["Showed up", "showed", c.showed], ["Won", "won", c.won]] as const).map(([l, f, n]) => (
              <div key={l} className="rounded-lg border bg-card p-2.5"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-xl font-semibold"><Count n={n} label={l.toLowerCase()} onOpen={() => go(f, l)} /></dd></div>))}
            <div className="rounded-lg border bg-card p-2.5"><dt className="text-xs text-muted-foreground">Sales</dt><dd className="text-xl font-semibold tabular-nums">{c.wonValue > 0 ? money(c.wonValue) : "—"}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Sales are won deals on the same person as the lead. Good lead rate: {pctOf(goodRate(c))}.</p>
          {d.data.alerts.length > 0 && <ul className="space-y-1 text-sm">{d.data.alerts.map((a) => <li key={a.kind + a.locationId} className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">{a.title}</li>)}</ul>}
          {d.data.perAccount.length > 1 && (
            <div><h4 className="mb-1 text-sm font-semibold">By client account</h4><ul className="divide-y rounded-xl border bg-card text-sm">{d.data.perAccount.map((a) => (
              <li key={a.locationId} className="flex items-center justify-between gap-3 px-3 py-2"><span className="truncate">{a.name ?? "Account"}</span><span className="flex items-center gap-3 tabular-nums text-muted-foreground"><Count n={a.leads} label="leads" onOpen={() => pick({ title: `${d.data!.label}: ${a.name ?? "account"}`, query: q("all", a.locationId) })} /> leads <span>{pctOf(goodRate(a))} good</span></span></li>))}</ul></div>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function FormsSection({ data, range, pick }: { data: IntakeRes; range: string; pick: (p: LeadsPick) => void }) {
  const st = data.formsStatus;
  const open = (f: FormRow, flag: string, title: string) => pick({ title: `${title}: ${f.name}`, sub: `Last ${range} days`, query: `form=${f.kind}:${f.id}&flag=${flag}&range=${range}&account=${f.locationId}` });
  return (
    <section aria-label="Forms, surveys and funnels" data-testid="dq-forms">
      <h3 className="mb-2 text-base font-semibold">Forms, surveys and funnels <InfoTip text="SubSync reads the names and submission times of your forms and surveys, never the answers. The platform sends no page views and no conversion for funnels." label="What is read" /></h3>
      {st.forms === "needs_permission" ? <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground" data-testid="dq-forms-perm">Needs permission: reconnect. Form and survey submissions are read with an optional permission you have not accepted.</p>
        : st.forms === "never" ? <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Not read yet. SubSync reads your forms every 30 minutes once it is connected.</p>
        : data.forms.length === 0 ? <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">No form or survey was submitted in this range.</p> : (
          <ul className="divide-y rounded-xl border bg-card" data-testid="dq-form-rows">{data.forms.map((f) => (
            <li key={`${f.locationId}:${f.kind}:${f.id}`} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
              <p className="col-span-2 min-w-0 sm:col-span-1"><span className="font-medium">{f.name}</span> <span className="text-xs text-muted-foreground">{f.kind === "survey" ? "Survey" : "Form"}{data.forms.some((x) => x.locationId !== f.locationId) ? ` · ${f.locationName}` : ""}</span></p>
              <span><span className="text-xs text-muted-foreground sm:hidden">Submissions </span><b className="tabular-nums">{fmtInt(f.submissions)}</b></span>
              <span><span className="text-xs text-muted-foreground sm:hidden">People </span><Count n={f.people} label="people" onOpen={() => open(f, "all", "People")} /></span>
              <span title="People who already existed before this submission"><span className="text-xs text-muted-foreground sm:hidden">Repeat </span>{fmtInt(f.repeat)}</span>
              <span><span className="text-xs text-muted-foreground sm:hidden">Booked </span><Count n={f.booked} label="booked" onOpen={() => open(f, "booked", "Booked")} /></span>
              <span><span className="text-xs text-muted-foreground sm:hidden">Sales </span>{f.wonValue > 0 ? <button type="button" onClick={() => open(f, "won", "Won")} className="min-h-8 font-semibold tabular-nums hover:underline">{money(f.wonValue)}</button> : "—"}</span>
            </li>))}</ul>)}
      {data.funnels.length > 0 && (
        <div className="mt-3" data-testid="dq-funnels"><p className="mb-1 text-xs text-muted-foreground">Funnels: {data.funnelNote}</p>
          <ul className="divide-y rounded-xl border bg-card text-sm">{data.funnels.map((f) => (
            <li key={`${f.locationId}:${f.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate font-medium">{f.name}{f.steps ? <span className="ml-2 text-xs font-normal text-muted-foreground">{f.steps} steps</span> : null}</span>
              {f.leads > 0 ? <button type="button" className="min-h-8 text-sm hover:underline" onClick={() => pick({ title: `Leads from ${f.name}`, sub: "Last 90 days, by source name", query: `src=${encodeURIComponent(f.name.toLowerCase().slice(0, 80))}&flag=all&range=90&account=${f.locationId}` })}><b className="tabular-nums">{fmtInt(f.leads)}</b> leads with this source name</button> : <span className="text-xs text-muted-foreground">No leads carry this name</span>}</li>))}</ul></div>)}
      <p className="mt-2 text-xs text-muted-foreground">{data.matchNote}</p>
    </section>
  );
}
