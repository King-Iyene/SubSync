"use client";

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { HELP, helpLines, industryFromPicker, INDUSTRY_MAX, NOTE_KIND_LABEL, NOTE_KINDS, NOTE_MAX, OTHER_INDUSTRY, pickerChoice, playbookLine, USER_ENTERED, valueCreatedWords, type NoteKind } from "@/lib/analytics/client-success";
import { useApiClient, useData } from "../../session";
import { DefinitionTip, EmptyState, HowTo, Section } from "../../ds";
import { Badge, Btn, ErrorBox, ExtLink, fmtMoney, inputClass, Loading, More, Stat, Table, Td, Th } from "../../ui";
import { PlaybooksView } from "../playbooks";
import type { GoFn } from "../../nav";
import type { ClientRow, ClientsData } from "./types";

// The Details and billing tab: what only the agency can enter about each client (fee, renewal date, industry) and the log of conversations and notes.
// Everything typed here is typed in the row itself (KF-7), with a plain label saying that SubSync does not read it from the CRM, and a first-use guide
// instead of bare "n/a". Nothing here is sent anywhere or written to the CRM.
type Field = "fee" | "renewal" | "industry";
type Editing = { id: string; field: Field } | null;
const today = () => new Date().toISOString().slice(0, 10);
const when = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function useSave(locationId: string, reload: () => void) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try { await api.put(`clients/${locationId}`, body); reload(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  return { save, busy, error };
}

const escape = (close: () => void) => (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
const addLink = "min-h-9 text-sm font-medium text-primary underline underline-offset-4 hover:no-underline";

function FeeCell({ c, editing, edit, close, reload }: { c: ClientRow; editing: boolean; edit: () => void; close: () => void; reload: () => void }) {
  const [v, setV] = useState(c.profile.monthlyFee === null ? "" : String(c.profile.monthlyFee));
  const { save, busy, error } = useSave(c.locationId, reload);
  if (!editing) {
    return c.profile.monthlyFee === null
      ? <button type="button" onClick={edit} className={addLink} data-testid="add-fee">Add fee</button>
      : <button type="button" onClick={edit} className="min-h-9 tabular-nums hover:underline" aria-label={`${fmtMoney(c.profile.monthlyFee)} a month, change the fee of ${c.name ?? "this client"}`}>{fmtMoney(c.profile.monthlyFee)}<span className="text-xs text-muted-foreground"> a month</span></button>;
  }
  return (
    <form className="flex flex-wrap items-center gap-1.5" onKeyDown={escape(close)} onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await save({ monthlyFee: v })) close(); }}>
      <label className="sr-only" htmlFor={`fee-${c.locationId}`}>What {c.name ?? "this client"} pays you per month, in dollars</label>
      <span aria-hidden className="text-muted-foreground">$</span>
      <input id={`fee-${c.locationId}`} autoFocus className={`${inputClass} w-24`} inputMode="decimal" value={v} placeholder="2500" onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))} />
      <Btn type="submit" variant="primary" disabled={busy}>Save</Btn><Btn onClick={close}>Cancel</Btn>
      {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
    </form>
  );
}

function RenewalCell({ c, editing, edit, close, reload }: { c: ClientRow; editing: boolean; edit: () => void; close: () => void; reload: () => void }) {
  const [v, setV] = useState(c.profile.renewalDate ?? "");
  const { save, busy, error } = useSave(c.locationId, reload);
  if (!editing) {
    if (!c.profile.renewalDate) return <button type="button" onClick={edit} className={addLink} data-testid="add-renewal">Add date</button>;
    const r = c.renewal;
    return (
      <span>
        <button type="button" onClick={edit} className="min-h-9 hover:underline" aria-label={`Renews ${when(c.profile.renewalDate)}, change the renewal date of ${c.name ?? "this client"}`}>{when(c.profile.renewalDate)}</button>
        {r && <span className="block"><Badge tone={r.daysLeft < 0 || r.bucket === "30" ? "bad" : r.bucket === "60" ? "warn" : "neutral"}>{r.daysLeft < 0 ? `${-r.daysLeft} days overdue` : r.daysLeft === 0 ? "today" : `in ${r.daysLeft} days`}</Badge></span>}
      </span>
    );
  }
  return (
    <form className="flex flex-wrap items-center gap-1.5" onKeyDown={escape(close)} onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await save({ renewalDate: v })) close(); }}>
      <label className="sr-only" htmlFor={`ren-${c.locationId}`}>The day {c.name ?? "this client"}&apos;s contract renews</label>
      <input id={`ren-${c.locationId}`} autoFocus type="date" className={`${inputClass} w-40`} value={v} onChange={(e) => setV(e.target.value)} />
      <Btn type="submit" variant="primary" disabled={busy}>Save</Btn><Btn onClick={close}>Cancel</Btn>
      {c.profile.renewalDate && <Btn variant="ghost" onClick={async () => { if (await save({ renewalDate: "" })) close(); }}>Clear</Btn>}
      {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
    </form>
  );
}

function IndustryCell({ c, choices, editing, edit, close, reload }: { c: ClientRow; choices: string[]; editing: boolean; edit: () => void; close: () => void; reload: () => void }) {
  const start = pickerChoice(c.profile.industry);
  const [choice, setChoice] = useState(start.choice);
  const [other, setOther] = useState(start.other);
  const { save, busy, error } = useSave(c.locationId, reload);
  if (!editing) {
    return c.profile.industry
      ? <span><button type="button" onClick={edit} className="min-h-9 text-left hover:underline" aria-label={`${c.profile.industry}, change the industry of ${c.name ?? "this client"}`}>{c.profile.industry}</button><span className="block text-xs text-muted-foreground">{playbookLine(c.profile.industry)}</span></span>
      : <button type="button" onClick={edit} className={addLink} data-testid="add-industry">Choose industry</button>;
  }
  return (
    <form className="flex flex-wrap items-center gap-1.5" onKeyDown={escape(close)} onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await save({ industry: industryFromPicker(choice, other) ?? "" })) close(); }}>
      <label className="sr-only" htmlFor={`ind-${c.locationId}`}>The kind of business {c.name ?? "this client"} runs</label>
      <select id={`ind-${c.locationId}`} autoFocus className={`${inputClass} w-56`} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">No industry</option>
        {choices.map((x) => <option key={x} value={x}>{x}</option>)}
        <option value={OTHER_INDUSTRY}>Another industry (type it)</option>
      </select>
      {choice === OTHER_INDUSTRY && <><label className="sr-only" htmlFor={`ind-other-${c.locationId}`}>Industry, in your own words</label><input id={`ind-other-${c.locationId}`} className={`${inputClass} w-44`} maxLength={INDUSTRY_MAX} value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Bakery" /></>}
      <Btn type="submit" variant="primary" disabled={busy}>Save</Btn><Btn onClick={close}>Cancel</Btn>
      {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
    </form>
  );
}

type Note = { id: string; kind: string; body: string; author: string | null; occurredOn: string; createdAt: string };
function ClientLog({ c, reload }: { c: ClientRow; reload: () => void }) {
  const api = useApiClient();
  const { data, error, loading, reload: reloadNotes } = useData<{ notes: Note[] }>(`clients/${c.locationId}/notes`);
  const [kind, setKind] = useState<NoteKind>("conversation");
  const [on, setOn] = useState(today());
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await reloadNotes(); reload(); setMsg(done); return true; } catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(false); }
  };
  return (
    <div className="mt-1 border-l-2 border-primary pl-4" data-testid="client-log">
      <p className="text-sm font-medium">Conversations and notes with {c.name ?? "this client"}</p>
      <p className="mb-3 text-xs text-muted-foreground">A private log for your team: who spoke to the client, what was said or decided, and when. It is never shown to the client and never sent to your CRM.</p>
      <form className="mb-4 grid gap-2 sm:grid-cols-[10rem_10rem_1fr]" onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await run(() => api.post(`clients/${c.locationId}/notes`, { kind, occurredOn: on, body }), "Added to the log.")) setBody(""); }}>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`k-${c.locationId}`}>What it is</label><select id={`k-${c.locationId}`} className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>{NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_LABEL[k]}</option>)}</select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`d-${c.locationId}`}>When</label><input id={`d-${c.locationId}`} type="date" className={inputClass} value={on} max={today()} onChange={(e) => setOn(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`b-${c.locationId}`}>What was said or decided</label><textarea id={`b-${c.locationId}`} className={`${inputClass} min-h-16`} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Agreed to move the review to Friday" /></div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          <Btn type="submit" variant="primary" disabled={busy || !body.trim()}>Add to the log</Btn>
          <Btn disabled={busy} onClick={() => run(() => api.put(`clients/${c.locationId}`, { markContacted: true }), "Logged: you spoke to them today.")}>I spoke to them today</Btn>
          {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
        </div>
      </form>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} onRetry={reloadNotes} />}
      {data && data.notes.length === 0 && <p className="text-sm text-muted-foreground">Nothing logged yet. Add the last conversation you had with this client so the next person knows where things stand.</p>}
      {data && data.notes.length > 0 && (
        <ul className="divide-y text-sm" aria-label="Log entries">
          {data.notes.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{when(n.occurredOn)} · {NOTE_KIND_LABEL[n.kind as NoteKind] ?? n.kind}{n.author ? ` · ${n.author}` : ""}</p>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </div>
              <button type="button" className="min-h-9 text-xs text-muted-foreground underline hover:text-destructive" onClick={() => run(() => api.del(`clients/${c.locationId}/notes?id=${n.id}`), "Removed from the log.")}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const tip = (key: keyof typeof HELP, term: string): ReactNode => {
  const [one, two] = helpLines(HELP[key]);
  return <DefinitionTip term={term} label={`What ${term} means`}>{one} {two}</DefinitionTip>;
};

export function DetailsTab({ data, reload, go, showPlaybooks = true }: { data: ClientsData; reload: () => void; go: GoFn; showPlaybooks?: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [log, setLog] = useState<string | null>(null);
  const first = data.clients[0];
  const stale = data.clients.filter((c) => c.contactGap.flagged).length;
  const noFee = data.firstUse.noFees;
  const clients = data.clients;
  const set = (id: string, field: Field) => ({ editing: editing?.id === id && editing.field === field, edit: () => setEditing({ id, field }), close: () => setEditing(null) });

  const explain = (key: keyof typeof HELP) => { const [one, two] = helpLines(HELP[key]); return <span className="block"><span className="block">{one}</span><span className="block">{two}</span></span>; };
  return (
    <div className="space-y-6">
      <HowTo id="clients-details" title="How this page works" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
        You type fee, renewal date and industry in the row. {USER_ENTERED}<More label="How value is counted">{valueCreatedWords()}</More>
      </HowTo>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly client revenue"
          value={noFee ? <span className="text-base font-semibold">Not set up yet</span> : fmtMoney(data.revenue.monthly)}
          sub={<>{noFee && first ? <span className="mb-2 block"><Btn variant="primary" onClick={() => setEditing({ id: first.locationId, field: "fee" })}>Add your first client fee</Btn></span> : <span className="block">{data.revenue.clientsWithFee} of {clients.length} clients have a fee</span>}{explain("monthlyRevenue")}</>} />
        <Stat label="Revenue at risk" value={noFee ? <span className="text-base font-semibold">Needs fees</span> : fmtMoney(data.revenue.atRisk)} tone={data.revenue.atRisk > 0 ? "bad" : undefined} sub={explain("revenueAtRisk")} />
        <Stat label="Not spoken to in 14+ days" value={stale} tone={stale > 0 ? "warn" : undefined} sub={explain("notSpoken")} />
        <Stat label="Renewals in 90 days" value={data.firstUse.noRenewals ? <span className="text-base font-semibold">No dates yet</span> : data.renewals.length} sub={explain("renewals")} />
      </div>

      {data.renewals.length > 0 && (
        <Section title="Renewals coming up" hint="Contracts renewing in the next 90 days, soonest first (and any that are overdue).">
          <ul className="divide-y text-sm">
            {data.renewals.map((r) => (
              <li key={r.locationId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{r.name ?? "Unnamed account"}{r.fee ? <span className="text-muted-foreground">, {fmtMoney(r.fee)} a month</span> : null}</span>
                <Badge tone={r.bucket === "overdue" || r.bucket === "30" ? "bad" : r.bucket === "60" ? "warn" : "neutral"}>{r.daysLeft < 0 ? `${-r.daysLeft} days overdue` : `in ${r.daysLeft} days`}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Your clients" hint="Press a value to change it. Press Log to see or add conversations and notes.">
        {clients.length === 0 ? <EmptyState title="No clients yet" body="Client accounts appear here once the first sync finishes." /> : (
          <Table head={<tr>
            <Th>Client</Th>
            <Th><span>{tip("industry", "Industry")}<span className="block text-[10px] font-normal normal-case tracking-normal">you enter this</span></span></Th>
            <Th><span>{tip("fee", "Monthly fee")}<span className="block text-[10px] font-normal normal-case tracking-normal">you enter this</span></span></Th>
            <Th><span>{tip("renewal", "Renewal")}<span className="block text-[10px] font-normal normal-case tracking-normal">you enter this</span></span></Th>
            <Th><span>{tip("valueCreated", "Value created")}<span className="block text-[10px] font-normal normal-case tracking-normal">needs the fee</span></span></Th>
            <Th><span>{tip("lastSpoken", "Last spoken")}<span className="block text-[10px] font-normal normal-case tracking-normal">you enter this</span></span></Th>
          </tr>}>
            {clients.flatMap((c) => [
              <tr key={c.locationId} className="hover:bg-muted/40" data-testid="client-row">
                <Td className="font-medium">
                  <button type="button" onClick={() => go("account", c.locationId)} className="min-h-9 text-left hover:underline">{c.name ?? "Unnamed account"}</button>
                  {c.progress.needsIntervention && <div className="text-xs font-normal text-warning">{c.progress.daysSinceInstall} days in, no deal won yet. Needs a conversation.</div>}
                  <div className="mt-0.5"><ExtLink href={c.url}>Open in your CRM</ExtLink></div>
                </Td>
                <Td><IndustryCell c={c} choices={data.industryChoices} {...set(c.locationId, "industry")} reload={reload} /></Td>
                <Td><FeeCell c={c} {...set(c.locationId, "fee")} reload={reload} /></Td>
                <Td><RenewalCell c={c} {...set(c.locationId, "renewal")} reload={reload} /></Td>
                <Td className="tabular-nums">{c.roi ? <span>{c.roi.pipelineMultiple}x<span className="block text-xs text-muted-foreground">new deals against the fee</span></span> : <span className="text-muted-foreground">Add the fee to see this</span>}</Td>
                <Td>
                  {c.contactGap.days === null ? <Badge tone="warn">Never logged</Badge> : c.contactGap.flagged ? <Badge tone="warn">{c.contactGap.days} days ago</Badge> : <span>{c.contactGap.days === 0 ? "today" : `${c.contactGap.days} days ago`}</span>}
                  <span className="block"><button type="button" onClick={() => setLog(log === c.locationId ? null : c.locationId)} aria-expanded={log === c.locationId} className={addLink}>{log === c.locationId ? "Close log" : c.log.count > 0 ? `Log (${c.log.count})` : "Log a conversation"}</button></span>
                  {c.log.lastNote && log !== c.locationId && <span className="mt-0.5 block max-w-56 truncate text-xs text-muted-foreground" title={c.log.lastNote.body}>{c.log.lastNote.body}</span>}
                </Td>
              </tr>,
              ...(log === c.locationId ? [<tr key={`${c.locationId}-log`}><td colSpan={6} className="px-3 pb-4"><ClientLog c={c} reload={reload} /></td></tr>] : []),
            ])}
          </Table>
        )}
        <details className="mt-3 text-sm" open={noFee} data-testid="column-help">
          <summary className="cursor-pointer font-medium">What each column means</summary>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            {([["industry", "Industry"], ["fee", "Monthly fee"], ["renewal", "Renewal"], ["valueCreated", "Value created"], ["lastSpoken", "Last spoken"]] as const).map(([k, name]) => (
              <div key={k}><dt className="font-medium">{name}</dt><dd className="text-muted-foreground">{explain(k)}</dd></div>
            ))}
          </dl>
        </details>
      </Section>

      {data.segments.length > 0 && !(data.segments.length === 1 && data.segments[0].industry === "Not set") && (
        <Section title="Clients by industry" hint="Groups of clients with their average health and open pipeline.">
          <Table head={<tr><Th>Industry</Th><Th className="text-right">Clients</Th><Th className="text-right">Average health</Th><Th className="text-right">Average win rate</Th><Th className="text-right">Open pipeline</Th></tr>}>
            {data.segments.map((s) => (
              <tr key={s.industry}><Td className="font-medium">{s.industry}</Td><Td className="text-right tabular-nums">{s.accounts}</Td><Td className="text-right tabular-nums">{s.avgScore}</Td><Td className="text-right tabular-nums">{s.avgWinRate === null ? "not enough deals" : `${Math.round(s.avgWinRate * 100)}%`}</Td><Td className="text-right tabular-nums">{fmtMoney(s.openValue)}</Td></tr>
            ))}
          </Table>
        </Section>
      )}

      {showPlaybooks && <PlaybooksView go={(view) => (view === "clients" ? setEditing(clients.find((c) => !c.profile.industry) ? { id: clients.find((c) => !c.profile.industry)!.locationId, field: "industry" } : null) : go(view))} embedded />}
    </div>
  );
}
