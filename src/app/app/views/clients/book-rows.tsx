"use client";

import { CircleAlert, CircleCheck, MoreHorizontal, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { COLUMN_HELP, USER_ENTERED_LABEL } from "@/lib/analytics/clients-v2";
import { industryFromPicker, INDUSTRY_MAX, OTHER_INDUSTRY, pickerChoice } from "@/lib/analytics/client-success";
import { useApiClient } from "../../session";
import { DefinitionTip, PopMenu, type MenuItem } from "../../ds";
import { ACTION_BUTTON } from "../../ds/queue";
import { fmtMoney, inputClass } from "../../ui";
import type { BookRowOut } from "./types";

// The rows of the client book, one family for "Who needs you", "See all" and the renewals list. One grid shared with the headings, so name, health, fee, renewal and the one
// action sit at the same x on every row (KF-8): the action is ONE small outlined button (32 px; 44 px on a phone) and everything else is in the three-dot menu. Fee, renewal date
// and industry are typed in the row itself (KF-7): press the value, type, press Enter. A row is one line of name and one line of reason; fee and renewal sit beside them on a laptop
// and under them on a phone. Colour is only status: a stripe, an icon and a word say how a client looks, never colour alone.

export type Field = "fee" | "renewal" | "industry";
export type Editing = { id: string; field: Field } | null;
const MENU_TRIGGER = "ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:size-8";
const LINK = "ds-press min-h-11 rounded-md px-1 text-left text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:min-h-8";
const VALUE = "ds-press min-h-11 rounded-md px-1 text-left text-sm tabular-nums hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:min-h-8";

const LEVEL: Record<string, { stripe: string; text: string; Icon: LucideIcon | null }> = {
  at_risk: { stripe: "border-destructive", text: "text-destructive", Icon: CircleAlert },
  watch: { stripe: "border-warning", text: "text-warning", Icon: TriangleAlert },
  healthy: { stripe: "border-transparent", text: "text-muted-foreground", Icon: CircleCheck },
  new: { stripe: "border-transparent", text: "text-muted-foreground", Icon: null },
  not_read: { stripe: "border-transparent", text: "text-muted-foreground", Icon: null },
};
/** The word a client wears in "Who needs you": its health when that is At risk or Watch, else why it is listed ("Renewal due"). Never "Healthy" in a needs list. */
export const wordOf = (r: Pick<BookRowOut, "level" | "label" | "needs">, inNeeds: boolean) => (inNeeds && r.needs && r.level !== "at_risk" && r.level !== "watch" ? r.needs.label : r.label);

export function HealthWord({ r, inNeeds }: { r: BookRowOut; inNeeds: boolean }) {
  const l = LEVEL[r.level] ?? LEVEL.healthy;
  const word = wordOf(r, inNeeds);
  const Icon = inNeeds && word !== r.label ? TriangleAlert : l.Icon;
  const tone = inNeeds && word !== r.label ? "text-warning" : l.text;
  return <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${tone}`} data-testid="client-health">{Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}{word}</span>;
}

/** The inline editor of one value: opens under the row, Enter saves, Escape cancels. Says in plain words that the user enters it. */
export function InlineEditor({ r, field, choices, onDone, onChanged }: { r: BookRowOut; field: Field; choices: string[]; onDone: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const start = pickerChoice(r.industry);
  const [fee, setFee] = useState(r.fee === null ? "" : String(r.fee));
  const [date, setDate] = useState(r.renewal?.date ?? "");
  const [choice, setChoice] = useState(start.choice);
  const [other, setOther] = useState(start.other);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await api.put(`clients/${r.id}`, body); onChanged(); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDone(); } };
  const btn = "ds-press inline-flex h-11 items-center rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent disabled:opacity-50 @3xl:h-8";
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (field === "fee") void save({ monthlyFee: fee });
    else if (field === "renewal") void save({ renewalDate: date });
    else void save({ industry: industryFromPicker(choice, other) ?? "" });
  };
  return (
    <form onSubmit={go} onKeyDown={esc} className="flex flex-wrap items-center gap-2 border-t border-dashed pt-2" data-testid="inline-editor" data-field={field}>
      {field === "fee" && <>
        <label className="sr-only" htmlFor={`fee-${r.id}`}>What {r.name} pays you per month, in dollars</label>
        <span aria-hidden className="text-muted-foreground">$</span>
        <input id={`fee-${r.id}`} autoFocus className={`${inputClass} w-28`} inputMode="decimal" value={fee} placeholder="2500" onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ""))} />
        <span className="text-sm text-muted-foreground">a month</span>
      </>}
      {field === "renewal" && <>
        <label className="sr-only" htmlFor={`ren-${r.id}`}>The day {r.name}&apos;s contract renews</label>
        <input id={`ren-${r.id}`} autoFocus type="date" className={`${inputClass} w-44`} value={date} onChange={(e) => setDate(e.target.value)} />
      </>}
      {field === "industry" && <>
        <label className="sr-only" htmlFor={`ind-${r.id}`}>The kind of business {r.name} runs</label>
        <select id={`ind-${r.id}`} autoFocus className={`${inputClass} w-60`} value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">No industry</option>
          {choices.map((x) => <option key={x} value={x}>{x}</option>)}
          <option value={OTHER_INDUSTRY}>Another industry (type it)</option>
        </select>
        {choice === OTHER_INDUSTRY && <><label className="sr-only" htmlFor={`ind-o-${r.id}`}>Industry, in your own words</label><input id={`ind-o-${r.id}`} className={`${inputClass} w-44`} maxLength={INDUSTRY_MAX} value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Bakery" /></>}
      </>}
      <button type="submit" disabled={busy} className={`${btn} border-primary bg-primary text-primary-foreground hover:bg-primary/90`}>Save</button>
      <button type="button" onClick={onDone} className={btn}>Cancel</button>
      {field === "renewal" && r.renewal && <button type="button" disabled={busy} className={btn} onClick={() => void save({ renewalDate: "" })}>Clear</button>}
      {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
      <p className="w-full text-xs text-muted-foreground">{USER_ENTERED_LABEL}</p>
    </form>
  );
}

const TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_9.5rem_7.5rem_2rem]";
const stripeOf = (r: BookRowOut, inNeeds: boolean) => (inNeeds ? (r.level === "at_risk" ? "border-destructive" : r.level === "watch" || r.needs ? "border-warning" : "border-transparent") : "border-transparent");

/** The one-line headings above the rows, drawn on the same grid; each says what the column is in two lines on press (KF-7). Hidden on a phone, where the rows say it themselves. */
export function BookHead() {
  const tip = (term: string, key: keyof typeof COLUMN_HELP) => <DefinitionTip term={term} label={`What ${term} means`}>{COLUMN_HELP[key][0]} {COLUMN_HELP[key][1]}</DefinitionTip>;
  return (
    <li aria-hidden={false} className={`hidden gap-x-3 border-l-[3px] border-transparent py-1.5 pl-4 pr-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @3xl:grid ${TRACKS}`} data-testid="book-header">
      <span>Client</span><span>{tip("Health", "health")}</span><span>{tip("Fee", "fee")}</span><span>{tip("Renews", "renews")}</span><span /><span />
    </li>
  );
}

export function ClientRows({ rows, choices, inNeeds, editing, setEditing, onChanged, onOpen, onCopy, testId = "book-rows" }: {
  rows: BookRowOut[]; choices: string[]; inNeeds: boolean; editing: Editing; setEditing: (e: Editing) => void; onChanged: () => void; onOpen: (id: string) => void;
  /** Copy the client's summary (the page fetches it and puts it on the clipboard). */ onCopy: (id: string) => void; testId?: string;
}): ReactNode {
  return (
    <ul className="@container divide-y border-y" data-testid={testId}>
      <BookHead />
      {rows.map((r) => {
        const mine = editing?.id === r.id ? editing.field : null;
        const set = (field: Field) => () => setEditing({ id: r.id, field });
        const rn = r.renewal;
        const rtone = rn && (rn.daysLeft < 0 ? "text-destructive" : rn.daysLeft <= 30 ? "text-warning" : "text-muted-foreground");
        const items: MenuItem[] = [
          { key: "crm", label: "Open in your CRM", onSelect: () => { window.open(r.url, "_blank", "noopener,noreferrer"); } },
          { key: "fee", label: r.fee === null ? "Add fee" : "Change fee", onSelect: set("fee") },
          { key: "renewal", label: rn ? "Change renewal date" : "Add renewal date", onSelect: set("renewal") },
          { key: "industry", label: r.industry ? "Change industry" : "Choose industry", onSelect: set("industry") },
          { key: "copy", label: "Copy a summary", onSelect: () => onCopy(r.id) },
        ];
        return (
          <li key={r.id} data-testid="client-row" data-level={r.level} data-id={r.id}
            className={`ds-row grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 gap-y-1 border-l-[3px] py-2 pl-4 pr-1 ${TRACKS} ${stripeOf(r, inNeeds)}`}>
            <p className="col-start-1 row-start-1 min-w-0 font-semibold @3xl:self-end @3xl:truncate" title={r.name}>{r.name}</p>
            <p className="col-span-3 row-start-2 min-w-0 text-sm text-muted-foreground @3xl:col-span-1 @3xl:self-start @3xl:truncate" title={r.line} data-testid="client-line">{r.line}</p>
            <div className="col-span-3 row-start-3 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm @3xl:contents">
              <div className="@3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1" data-col="health"><HealthWord r={r} inNeeds={inNeeds} /></div>
              <div className="flex items-center @3xl:col-start-3 @3xl:row-span-2 @3xl:row-start-1" data-col="fee">
                <span className="text-muted-foreground @3xl:hidden">Fee</span>
                {r.fee === null
                  ? <button type="button" onClick={set("fee")} className={LINK} data-testid="add-fee">Add fee</button>
                  : <button type="button" onClick={set("fee")} className={VALUE} aria-label={`${fmtMoney(r.fee)} a month, change the fee of ${r.name}`} data-testid="fee-value">{fmtMoney(r.fee)}<span className="text-muted-foreground @3xl:block"> a month</span></button>}
              </div>
              <div className="flex items-center @3xl:col-start-4 @3xl:row-span-2 @3xl:row-start-1" data-col="renewal">
                {!rn
                  ? <button type="button" onClick={set("renewal")} className={LINK} data-testid="add-renewal">Add renewal date</button>
                  : <button type="button" onClick={set("renewal")} className={`${VALUE} leading-5`} aria-label={`${rn.words}, ${rn.dateText}. Change the renewal date of ${r.name}`} data-testid="renewal-value">
                    <span className={rtone ?? ""}>{rn.words}</span><span className="block text-xs text-muted-foreground">{rn.dateText}</span>
                  </button>}
              </div>
            </div>
            <div className="col-start-2 row-start-1 @3xl:col-start-5 @3xl:row-span-2" data-col="action">
              <button type="button" onClick={() => onOpen(r.id)} className={ACTION_BUTTON} data-testid="open-client">Open account<span className="sr-only"> ({r.name})</span></button>
            </div>
            <div className="col-start-3 row-start-1 @3xl:col-start-6 @3xl:row-span-2" data-col="more">
              <PopMenu label={`More for ${r.name}`} items={items} testId="client-more" triggerClassName={MENU_TRIGGER}><MoreHorizontal aria-hidden className="size-4" /></PopMenu>
            </div>
            {mine && <div className="col-span-3 row-start-4 @3xl:col-span-6 @3xl:row-start-3"><InlineEditor r={r} field={mine} choices={choices} onDone={() => setEditing(null)} onChanged={onChanged} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

/** The renewals list: name, what is left, the fee and the one button. Soonest first. */
export function RenewalRows({ rows, onOpen }: { rows: BookRowOut[]; onOpen: (id: string) => void }) {
  return (
    <ul className="@container divide-y border-y" data-testid="renewal-rows">
      {rows.map((r) => {
        const rn = r.renewal;
        if (!rn) return null;
        const tone = rn.daysLeft < 0 ? "text-destructive" : rn.daysLeft <= 30 ? "text-warning" : "text-muted-foreground";
        return (
          <li key={r.id} data-testid="renewal-row" className="ds-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 pl-4 pr-1 @3xl:grid-cols-[minmax(0,1fr)_7.5rem]">
            <div className="min-w-0">
              <p className="truncate font-semibold" title={r.name}>{r.name}</p>
              <p className="text-sm text-muted-foreground"><span className={`font-medium ${tone}`}>{rn.words}</span> ({rn.dateText}){r.fee !== null ? `, ${fmtMoney(r.fee)} a month` : ""}</p>
            </div>
            <button type="button" onClick={() => onOpen(r.id)} className={ACTION_BUTTON} data-testid="open-renewal">Open account<span className="sr-only"> ({r.name})</span></button>
          </li>
        );
      })}
    </ul>
  );
}

/** What a press on "Copy a summary" does: ask for the summary, put it on the clipboard (or show it to copy by hand if the browser refuses). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { window.prompt("Copy this", text); return false; }
}
