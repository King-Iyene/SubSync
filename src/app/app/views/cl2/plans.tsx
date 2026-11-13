"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { Cl2Attention, Cl2Today } from "@/lib/analytics/clients2-types";
import { useApiClient } from "../../session";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { agoText, c2post, c2q, copy, hasPayments, money, useC2 } from "./data";
import { PayChip } from "./chips";

// Plans needing attention: every client account whose paid plan is past due, cancelled, paused or in a status SubSync does not recognise, longest in that state first, with a note field.
// SubSync cannot retry a card or change what you bill, so the steps are for you and the client; the message is text to copy (nothing is sent). Money at risk is an estimate: the plan's monthly price.
const FORMULA = "Estimate: the monthly price of each plan that needs a look (a yearly price divided by 12). Per currency, never added across currencies. The platform does not tell SubSync what was actually charged.";

export function TodayPanel({ onButton, onTile }: { onButton: (b: NonNullable<Cl2Today["button"]>) => void; onTile: (t: Cl2Today["tiles"][number]) => void }) {
  const r = useC2<Cl2Today>(c2q("today"));
  if (r.loading && !r.data) return <SkeletonRows rows={3} label="Loading..." />;
  if (r.error || !r.data) return r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null;
  const t = r.data;
  return (
    <div className="cl-stack" data-testid="cl2-today">
      <section className="cl-today" aria-label="What to do today">
        <h2 className="cl-h">What to do today</h2>
        <p className="cl-sentence" data-testid="cl2-today-sentence">{t.headline}</p>
        {t.button && <button type="button" className="s6-btn" data-kind="primary" data-testid="cl2-today-go" onClick={() => onButton(t.button as NonNullable<Cl2Today["button"]>)}>{t.button.label} ({t.button.count.toLocaleString("en-US")})</button>}
        {t.atRisk.length > 0 && <p className="ap-fine" title={FORMULA}>Plans at risk (estimate): {t.atRisk.map((a) => `${money(a.monthly, a.currency)} a month across ${a.accounts} ${a.accounts === 1 ? "client" : "clients"}`).join("; ")}.</p>}
        {t.planAccess === "no_data" && <p className="ap-fine" data-testid="cl2-plans-na"><b>Not available for this kind of app.</b> The platform only gives plan details to company-level apps.</p>}
      </section>
      <div className="cl-tiles">{t.tiles.map((x) => <button key={x.key} type="button" className="cl-tile" data-testid={`cl2-tile-${x.key}`} onClick={() => onTile(x)}><b>{x.count.toLocaleString("en-US")}</b><span>{x.label}</span></button>)}</div>
    </div>
  );
}

const MESSAGE = (name: string, plan: string | null, label: string) =>
  `Hi, a quick note about your ${plan ? `"${plan}" ` : ""}plan for ${name}. It is showing as "${label.toLowerCase()}" on our side. Could you check your payment details so it does not interrupt your service? Reply here and I will help.`;

export function Plans({ onOpen, onPayments }: { onOpen: (id: string) => void; onPayments?: (id: string) => void }) {
  const api = useApiClient();
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [rev, setRev] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<Cl2Attention["rows"]>([]);
  const cursor = cursors[cursors.length - 1];
  const r = useC2<Cl2Attention>(c2q("plans", { size: 20, cursor, v: rev }));
  useEffect(() => {
    if (!r.data) return;
    const d = r.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows((cur) => (cursor === null ? d.rows : [...cur, ...d.rows.filter((x) => !cur.some((y) => y.locationId === x.locationId))]));
  }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.loading && !r.data && rows.length === 0) return <SkeletonRows rows={5} label="Loading plans..." />;
  if (r.error && rows.length === 0) return <ErrorState error={r.error} onRetry={r.reload} />;
  const d = r.data;
  if (!d) return null;
  const empty = d.total === 0;
  return (
    <div data-testid="cl2-plans">
      <p className="ap-fine mb-2">{d.total.toLocaleString("en-US")} {d.total === 1 ? "plan needs" : "plans need"} a look.{d.atRisk.length > 0 && <span title={FORMULA}> At risk (estimate): {d.atRisk.map((a) => `${money(a.monthly, a.currency)} a month`).join(", ")}.</span>} {d.sinceNote}</p>
      {msg && <p className="ap-fine mb-2" role="status">{msg}</p>}
      {empty ? (
        <EmptyState title={d.needPermission ? "Needs permission: reconnect" : d.notChecked ? "Plans not read yet" : "No plan needs a look"} body={d.needPermission ? "SubSync cannot read your clients' paid plans. Reconnect and allow plan access." : d.notChecked ? "The next hourly read fills this in." : "Every client plan SubSync could read is paid up."} />
      ) : (
        <ul className="cl2-cards" aria-label="Plans needing attention">
          {rows.map((x) => <PlanCard key={x.locationId} x={x} onOpen={onOpen} onPayments={onPayments} onSaved={() => { setCursors([null]); setRev((n) => n + 1); }} say={setMsg} api={api} />)}
        </ul>
      )}
      {d.next && <div className="cl-pager"><button type="button" className="s6-btn" disabled={r.loading} onClick={() => setCursors((c) => [...c, d.next])}>Show more</button></div>}
    </div>
  );
}

function PlanCard({ x, onOpen, onPayments, onSaved, say, api }: { x: Cl2Attention["rows"][number]; onOpen: (id: string) => void; onPayments?: (id: string) => void; onSaved: () => void; say: (m: string) => void; api: ReturnType<typeof useApiClient> }) {
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [text, setText] = useState(MESSAGE(x.name, x.plan.name, x.plan.payLabel)), [editing, setEditing] = useState(false);
  const save = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await c2post(api, "note-add", { location: x.locationId, kind: "plan", body: note.trim() }); setNote(""); say(`Saved your note on ${x.name}.`); onSaved(); } catch (e) { say(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  };
  return (
    <li className="cl2-card" data-testid="cl2-plan-card">
      <div className="flex flex-wrap items-center gap-2"><button type="button" className="ap-link ap-name" onClick={() => onOpen(x.locationId)}>{x.name}</button><PayChip plan={x.plan} />{x.plan.name && <span className="ap-fine">{x.plan.name}{x.plan.monthly !== null ? `, ${money(x.plan.monthly, x.plan.currency)} a month (estimate)` : ""}</span>}</div>
      <p className="ap-fine mt-1">{x.plan.daysInStatus !== null ? `${x.plan.daysInStatus === 0 ? "Since today" : `${x.plan.daysInStatus} days`} in this status (since SubSync first saw it).` : "Days in this status are not known yet."} {x.plan.explain}</p>
      <ol className="cl2-steps"><li>Check the card in your payment dashboard.</li><li>Ask the client to update it.</li><li>SubSync shows here when it is paid.</li></ol>
      {x.note && <p className="text-sm" data-testid="cl2-plan-note"><b>Your note:</b> {x.note}<span className="ap-fine"> ({agoText(x.noteAt)})</span></p>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="ap-field min-w-[12rem] flex-1" aria-label={`Note about ${x.name}`} placeholder="Add a note (for example: client contacted)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="s6-btn" disabled={busy || !note.trim()} onClick={save}>Save note</button>
        <button type="button" className="s6-btn" onClick={async () => say((await copy(text)) ? "Message copied. SubSync sends nothing: paste it where you talk to the client." : "Copy it from the box.")}>Copy message to client</button>
        <button type="button" className="ap-link" onClick={() => setEditing(!editing)}>{editing ? "Hide message" : "Edit message"}</button>
        {x.url && <a href={x.url} target="_blank" rel="noopener noreferrer" className="ap-link inline-flex items-center gap-1">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
        {hasPayments() && onPayments && <button type="button" className="ap-link" onClick={() => onPayments(x.locationId)}>Open in Payments</button>}
      </div>
      {editing && <textarea className="ap-field mt-2 w-full" rows={4} aria-label="Message to the client" value={text} onChange={(e) => setText(e.target.value)} />}
    </li>
  );
}
