"use client";

import { useState } from "react";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { BUCKETS, BUCKET_LABEL, type Bucket, type View } from "@/lib/analytics/missed-board-rules";
import type { Board, BoardRow, Mode } from "@/lib/analytics/missed-board";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { WhatIs } from "../ds/what-is";
import { useData } from "../session";
import { useSpeedFilter } from "./speed-filter";
import "./speed4.css";

// Speed to lead > Missed: two clearly separate sections. Missed calls (inbound calls nobody picked up) and Missed replies (texts, emails and chats a person has not answered).
// Every count is a button that opens exactly those people. An automatic text is shown as what it is and never counts as a person. Numbers come from SubSync's own history (metadata only).
type Resp = Board & { mode: Mode; size: number; now: number };
const CH: Record<string, string> = { sms: "Text", email: "Email", whatsapp: "WhatsApp", call: "Call", chat: "Chat", other: "Other" };
const timeOf = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const chip = (on: boolean) => `ds-press min-h-9 rounded-md border px-3 text-sm font-medium ${on ? "border-primary bg-accent" : "bg-card hover:border-primary/40"}`;

function stateText(r: BoardRow, mode: Mode): string {
  if (r.state === "person") return `A person ${r.personChannel === "call" ? "called back" : mode === "calls" ? "texted or wrote back" : "replied"} at ${timeOf(r.personAt ?? r.at)}.`;
  if (r.state === "auto") return `Only an automatic text went out at ${timeOf(r.autoAt ?? r.at)}. No person has followed up.`;
  return mode === "calls" ? "Nobody has called or texted back." : "Nobody has replied.";
}

function Section({ mode, multi }: { mode: Mode; multi: boolean }) {
  const { query } = useSpeedFilter();
  const [view, setView] = useState<View>("waiting");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [channel, setChannel] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const calls = mode === "calls";
  const url = `speed?part=missed&mode=${mode}&view=${view}&page=${page}${bucket ? `&bucket=${bucket}` : ""}${channel ? `&channel=${channel}` : ""}${owner ? `&owner=${encodeURIComponent(owner)}` : ""}${query}`;
  const { data: d, error, reload } = useData<Resp>(url);
  const id = calls ? "missed-calls-board" : "missed-replies-board";
  const reset = (f: () => void) => { f(); setPage(0); };
  const title = calls ? "Missed calls" : "Missed replies";
  const tip = calls
    ? "A caller is counted from their latest missed call in this period (an inbound call nobody picked up). A person calling or texting back clears it. An automatic text-back does not: it is shown, but the caller is still waiting for a person."
    : "A person is counted from their latest message to you (text, email, WhatsApp or chat) in this period. A reply from a person clears it. An automatic reply does not.";
  return (
    <section aria-labelledby={id} className="spd-rise mb-12 border-t border-[var(--t-rule)] pt-5" data-testid={id}>
      <h3 id={id} className="t-title mb-2">{title} <WhatIs text={tip} /></h3>
      {error ? <ErrorState error={error} onRetry={reload} /> : !d ? <SkeletonRows rows={4} label={calls ? "Counting missed calls..." : "Counting missed replies..."} /> : (() => {
        const c = d.counts;
        const head = c.total === 0 ? (calls ? "No missed calls recorded in this period." : "No messages from customers recorded in this period.")
          : c.waiting === 0 ? (calls ? "Every caller who phoned and missed us has had a person follow up." : "Every customer message has had a reply from a person.")
          : `${c.waiting.toLocaleString("en-US")} ${calls ? (c.waiting === 1 ? "caller is" : "callers are") : (c.waiting === 1 ? "person is" : "people are")} still waiting for a person${c.auto > 0 ? ` (${c.auto.toLocaleString("en-US")} got only an automatic text)` : ""}.`;
        const views: Array<[View, string, number]> = [["waiting", "Waiting for a person", c.waiting], ["none", "Nothing sent", c.none], ["auto", "Only an automatic text", c.auto], ["person", "A person followed up", c.person], ["all", "All", c.total]];
        return (
          <>
            <p className="t-display" data-testid={`${id}-headline`}>{head}</p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${title}: show`} data-testid={`${id}-views`}>
              {views.map(([v, label, n]) => <button key={v} type="button" className={chip(view === v)} aria-pressed={view === v} data-testid={`${id}-view-${v}`} data-tip="Click to see exactly these people" onClick={() => reset(() => setView(v))}>{label} <strong className="tnum">{n.toLocaleString("en-US")}</strong></button>)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="How long they have waited" data-testid={`${id}-buckets`}>
              <span className="t-small t-quiet">Waiting for:</span>
              {BUCKETS.map((b) => <button key={b} type="button" className={chip(bucket === b)} aria-pressed={bucket === b} data-testid={`${id}-bucket-${b}`} onClick={() => reset(() => setBucket(bucket === b ? null : b))}>{BUCKET_LABEL[b]} <strong className="tnum">{c.buckets[b].toLocaleString("en-US")}</strong></button>)}
              {!calls && Object.keys(c.channels).length > 0 && (
                <select aria-label="Channel" className="h-9 rounded-md border bg-card px-2 text-sm" value={channel} onChange={(e) => reset(() => setChannel(e.target.value))} data-testid={`${id}-channel`}>
                  <option value="">All channels</option>
                  {Object.entries(c.channels).map(([k, n]) => <option key={k} value={k}>{CH[k] ?? k} ({n})</option>)}
                </select>
              )}
              {owner && <button type="button" className={chip(true)} onClick={() => reset(() => setOwner(null))} data-testid={`${id}-owner-clear`}>Owner: {owner === "none" ? "nobody" : "one person"} (clear)</button>}
              {!owner && <button type="button" className={chip(false)} onClick={() => reset(() => setOwner("none"))} data-tip="People with no owner assigned" data-testid={`${id}-owner-none`}>No owner</button>}
            </div>
            <p className="t-small t-quiet mt-1">The buckets count people still waiting for a person. They add up to {c.waiting.toLocaleString("en-US")}.</p>
            {d.rows.length === 0 ? <div className="mt-3"><EmptyState title="Nobody here" body="Nothing matches this choice right now." /></div> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm" data-testid={`${id}-table`}>
                  <thead><tr className="t-small t-quiet text-left"><th className="py-1 pr-3">{calls ? "Caller" : "Person"}</th>{multi && <th className="pr-3">Account</th>}<th className="pr-3">{calls ? "Called" : "Wrote"}</th><th className="pr-3">Waiting</th><th className="pr-3">{calls ? "Line" : "Channel"}</th><th className="pr-3">What happened since</th><th>Owner</th></tr></thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.key} className="border-t align-top" data-testid={`${id}-row`} data-state={r.state}>
                        <td className="py-1.5 pr-3 font-medium">{(r as BoardRow & { url?: string }).url ? <a className="s6-link underline decoration-dotted underline-offset-4" href={(r as BoardRow & { url?: string }).url} target="_blank" rel="noreferrer" data-tip="Open in your CRM">{r.name}</a> : r.name}{r.dnd && <span className="t-small t-quiet"> (asked not to be contacted)</span>}</td>
                        {multi && <td className="pr-3">{r.locationName}</td>}
                        <td className="pr-3 whitespace-nowrap" data-tip={BUCKET_LABEL[r.bucket]}>{timeOf(r.at)}</td>
                        <td className="tnum pr-3 whitespace-nowrap">{r.state === "person" ? "done" : fmtDuration(Math.max(0, Math.round(r.waitMs / 1000)))}</td>
                        <td className="pr-3">{calls ? (r.line ?? (d.lineKnown ? "not recorded" : "not recorded yet")) : CH[r.channel] ?? r.channel}</td>
                        <td className="pr-3" data-testid={`${id}-state`}>{stateText(r, mode)}</td>
                        <td>{r.ownerId ? <button type="button" className="s6-link underline decoration-dotted underline-offset-4" data-tip="Show only this owner's people" onClick={() => reset(() => setOwner(r.ownerId))}>{r.ownerName ?? "Assigned"}</button> : <span className="t-quiet">nobody</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(page > 0 || d.shown === d.size) && (
              <p className="mt-2 flex items-center gap-2 text-sm"><button type="button" className={chip(false)} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="t-small t-quiet">Page {page + 1}</span><button type="button" className={chip(false)} disabled={d.shown < d.size} onClick={() => setPage(page + 1)}>Next</button></p>
            )}
          </>
        );
      })()}
    </section>
  );
}

export function MissedTab({ multi }: { multi: boolean }) {
  return (
    <div data-testid="missed-tab">
      <p className="t-small t-quiet mb-4">Two lists, kept apart. A call or message counts as handled only when a person followed up; an automatic text does not count. History starts filling after the next sync.</p>
      <Section mode="calls" multi={multi} />
      <Section mode="replies" multi={multi} />
    </div>
  );
}
