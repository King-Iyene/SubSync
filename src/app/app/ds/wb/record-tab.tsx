"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { useData } from "../../session";
import { InfoTip } from "../info-tip";
import { NoteToSelf } from "../lead-parts";

// The rest of the contact record in one wide tab, in collapsible sections. Each part is read live from the CRM only when it is opened (notes, tasks, orders) or comes from the
// panel's own live read (custom fields). Nothing is stored. A part that needs a permission says "Needs permission: reconnect"; nothing is ever faked.

type Part<T> = { state: "ok" | "needs_permission" | "unavailable" | "off"; note: string | null; items: T[]; /** How many the platform says there are in all (orders only). */ total?: number | null };
type Note = { id: string | null; text: string; by: string | null; at: string | null; ours: boolean };
type Task = { id: string | null; title: string; due: string | null; done: boolean; by: string | null };
type Order = { id: string | null; title: string; amount: number | null; currency: string | null; status: string | null; at: string | null };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Section({ title, tip, count, children, defaultOpen = false, testId }: { title: string; tip: string; count?: number | null; children: (open: boolean) => React.ReactNode; defaultOpen?: boolean; testId: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border bg-card" data-testid={testId}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-9 flex-1 cursor-pointer items-center gap-2 text-left text-[15px] font-semibold">
          <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />{title}{count != null && <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{count}</span>}
        </button>
        <InfoTip text={tip} label={`About ${title}`} />
      </div>
      {open && <div className="border-t px-4 py-3">{children(open)}</div>}
    </section>
  );
}

function Live<T>({ locationId, contactId, part, render, empty }: { locationId: string; contactId: string; part: string; render: (items: T[], total: number | null) => React.ReactNode; empty: string }) {
  const d = useData<Part<T>>(`workbench/record?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&part=${part}`);
  if (d.loading && !d.data) return <div className="space-y-2" aria-label="Loading"><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-10 animate-pulse rounded-lg bg-muted" /></div>;
  if (d.error) return <p className="text-sm text-destructive" role="alert">Could not load this. <button type="button" className="cursor-pointer font-medium underline" onClick={() => void d.reload()}>Try again</button></p>;
  if (!d.data) return null;
  if (d.data.state !== "ok") return <p className="text-sm text-muted-foreground" data-testid={`record-${part}-state`}>{d.data.note}</p>;
  return d.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <>{render(d.data.items, d.data.total ?? null)}</>;
}

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" aria-label="Copy value" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }} className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">{done ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}</button>;
}

export function RecordTab({ locationId, contactId, name, account, fields }: { locationId: string; contactId: string; name: string; account: string | null; fields: Array<{ name: string; value: string }> }) {
  const [empty, setEmpty] = useState(false);
  const filled = fields.filter((f) => f.value.trim());
  const shown = empty ? fields : filled;
  return (
    <div className="space-y-4" data-testid="wb-record">
      <Section title="Notes" testId="record-notes" defaultOpen tip="Every note on this contact in your CRM, newest first. Notes SubSync added are marked SubSync. Read live when you open this; SubSync does not store them.">
        {() => (
          <div className="space-y-3">
            <Live<Note> locationId={locationId} contactId={contactId} part="notes" empty="No notes yet." render={(items) => (
              <ul className="space-y-2" data-testid="record-notes-list">{items.map((n, i) => (
                <li key={n.id ?? i} className="rounded-lg border bg-background p-3 text-[15px]">
                  <p className="whitespace-pre-wrap break-words">{n.text}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{n.by && <span className={`rounded-full px-2 py-0.5 font-medium ${n.ours ? "bg-primary/15 text-primary" : "bg-muted text-foreground/80"}`}>{n.by}</span>}<span>{day(n.at)}</span></p>
                </li>))}</ul>
            )} />
            <NoteToSelf locationId={locationId} contactId={contactId} name={name} account={account} />
          </div>
        )}
      </Section>
      <Section title="Tasks" testId="record-tasks" tip="Tasks on this contact in your CRM, read live when you open this.">
        {() => <Live<Task> locationId={locationId} contactId={contactId} part="tasks" empty="No tasks." render={(items) => (
          <ul className="divide-y rounded-lg border">{items.map((t, i) => (
            <li key={t.id ?? i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[15px]"><span className={`min-w-0 flex-1 truncate ${t.done ? "text-muted-foreground line-through" : "font-medium"}`}>{t.title}</span>{t.by && <span className="text-xs text-muted-foreground">{t.by}</span>}{t.due && <span className="text-xs tabular-nums text-muted-foreground">Due {day(t.due)}</span>}<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.done ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}>{t.done ? "Done" : "Open"}</span></li>))}</ul>
        )} />}
      </Section>
      <Section title="Custom fields" testId="record-fields" count={filled.length} defaultOpen tip="Every custom field on this contact, read live from your CRM when the panel opens. Empty ones are hidden until you ask.">
        {() => fields.length === 0 ? <p className="text-sm text-muted-foreground">No custom fields on this contact.</p> : (
          <div>
            <dl className="divide-y">{shown.map((f, i) => <div key={i} className="flex items-center gap-3 py-2 text-[15px]"><dt className="w-40 shrink-0 truncate text-muted-foreground">{f.name}</dt><dd className="min-w-0 flex-1 break-words">{f.value || <span className="text-muted-foreground">Empty</span>}</dd>{f.value && <CopyValue value={f.value} />}</div>)}</dl>
            {fields.length > filled.length && <button type="button" onClick={() => setEmpty(!empty)} className="mt-2 min-h-9 cursor-pointer text-sm font-medium text-primary underline underline-offset-2" data-testid="record-show-empty">{empty ? "Hide empty fields" : `Show empty (${fields.length - filled.length})`}</button>}
          </div>
        )}
      </Section>
      <Section title="Workflows and campaigns" testId="record-workflows" tip="Which workflows or campaigns this contact is in right now.">
        {() => <p className="text-sm text-muted-foreground" data-testid="record-workflows-state">Not available from your CRM yet: it does not let apps list the workflows a contact is in. Open the contact in your CRM to see them. Nothing is guessed here.</p>}
      </Section>
      <Section title="Orders and payments" testId="record-money" tip="Orders for this contact, read live and never stored. Needs the optional payments permission.">
        {() => <Live<Order> locationId={locationId} contactId={contactId} part="money" empty="No orders." render={(items, total) => (
          <>
            <p className="mb-2 text-xs text-muted-foreground" data-testid="record-money-count">{total != null && total > items.length ? `Latest ${items.length} of ${total.toLocaleString("en-US")} orders.` : `${items.length} ${items.length === 1 ? "order" : "orders"}.`} Amounts are as your CRM reports them.</p>
            <ul className="divide-y rounded-lg border">{items.map((o, i) => <li key={o.id ?? i} className="flex flex-wrap items-center gap-x-3 px-3 py-2.5 text-[15px]"><span className="min-w-0 flex-1 truncate">{o.title}</span>{o.amount != null && <span className="tabular-nums">{o.currency ?? ""} {o.amount}</span>}{o.status && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{o.status}</span>}<span className="text-xs text-muted-foreground">{day(o.at)}</span></li>)}</ul>
          </>
        )} />}
      </Section>
    </div>
  );
}
