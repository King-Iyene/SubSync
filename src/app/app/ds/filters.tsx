"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  describeHidden, EMPTY_FILTER, isFiltered, nameList, RANGES, scopeOf, visibleControls, type AccountOption, type ControlId, type FilterKind, type FilterOptions, type FilterValue, type RangeKey,
} from "@/lib/design/filters";
import { useData } from "../session";

// ONE filter bar for the whole app (N8, N34). Its controls depend on who is looking: an agency picks client accounts, industry, owner and hides test
// accounts; a client's staff have one account, so they get their own people, calendars, pipelines, sources and a date range instead. A control with
// nothing to choose between is not drawn, and the bar is absent on a page that is about one account. Whatever is hidden is said in words, with the way
// to bring it back. The value lives in the page address (src/lib/design/route.ts), so it is carried in a link and survives a reload.

const select = "ds-press min-h-9 min-w-0 max-w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30";

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"><span className="font-medium">{label}</span>{children}</label>;
}

function AccountPicker({ accounts, picked, onChange }: { accounts: Array<{ id: string; name: string }>; picked: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => accounts.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())), [accounts, q]);
  const set = new Set(picked);
  const toggle = (id: string) => onChange(set.has(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} className={`${select} inline-flex items-center gap-2`}>
        <span className="text-xs font-medium text-muted-foreground">Client accounts</span>
        <span>{picked.length === 0 ? `All (${accounts.length})` : `${picked.length} of ${accounts.length}`}</span>
        <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[85vw] rounded-xl border bg-popover p-2 shadow-[var(--shadow-lift)]">
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client account" aria-label="Find a client account" className="min-h-9 w-full rounded-lg border bg-card py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
          </label>
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {shown.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No client account matches.</li>}
            {shown.map((a) => (
              <li key={a.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent">
                  <input type="checkbox" className="size-4" checked={set.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="truncate">{a.name}</span>
                  {set.has(a.id) && <Check aria-hidden className="ml-auto size-4 text-primary" />}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
            <button type="button" className="underline" onClick={() => onChange([])}>Show all</button>
            <button type="button" className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Choices = NonNullable<FilterOptions["industries"]>;
function Pick({ label, choices, value, onChange, any }: { label: string; choices: Choices; value: string; onChange: (v: string) => void; any: string }) {
  return (
    <Labelled label={label}>
      <select className={select} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{any}</option>
        {choices.map((c) => <option key={c.key} value={c.key}>{c.label}{c.count !== undefined ? ` (${c.count})` : ""}</option>)}
      </select>
    </Labelled>
  );
}

// KF-2: which client accounts are in, by name (removable), and which are left out and why. The numbers use the same rules (segmentSet on the server).
export function AccountScope({ options, value, onChange, className = "mt-2 space-y-1 text-xs" }: { options: FilterOptions; value: FilterValue; onChange: (v: FilterValue) => void; className?: string }) {
  const live = (options.accounts ?? []).filter((a) => !a.ignored);
  if (live.length < 2) return null;
  const scope = scopeOf(value, options);
  const remove = (id: string) => onChange({ ...value, accounts: value.accounts.length > 0 ? value.accounts.filter((x) => x !== id) : scope.included.filter((a) => a.id !== id).map((a) => a.id) });
  const names = scope.included.map((a) => a.name);
  return (
    <div className={className} data-testid="account-scope">
      <details className="open:basis-full">
        <summary className="cursor-pointer select-none rounded text-muted-foreground hover:text-foreground" data-testid="account-scope-summary">
          <span className="font-medium text-foreground">{scope.included.length === live.length ? `All ${live.length} client accounts` : `${scope.included.length} of ${live.length} client accounts`}</span>
          {names.length > 0 && scope.included.length !== live.length ? `: ${nameList(names)}` : ""}
        </summary>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {scope.included.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5">
              {a.name}
              {scope.included.length > 1 && <button type="button" aria-label={`Leave out ${a.name}`} onClick={() => remove(a.id)} className="rounded px-0.5 text-muted-foreground hover:text-foreground">&times;</button>}
            </li>
          ))}
        </ul>
      </details>
      {scope.left.length > 0 && (
        <details data-testid="account-left-out" className="open:basis-full">
          <summary className="cursor-pointer select-none rounded text-muted-foreground hover:text-foreground">Left out ({scope.left.length})</summary>
          <ul className="mt-1.5 space-y-0.5">
            {scope.left.map((a) => <li key={a.id}><span className="font-medium">{a.name}</span> <span className="text-muted-foreground">: {a.reason}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// N1: what each control means, where its choices come from and what the number in brackets counts, in plain words. Only the controls that are drawn are explained.
export function FilterHelp({ controls }: { controls: ControlId[] }) {
  const lines: string[] = [];
  if (controls.includes("industry")) lines.push("Kind of business is the industry you typed for each client under Clients (Details). SubSync does not read it from your CRM, so a client with none typed is not counted. The number in brackets is how many client accounts have that kind.");
  if (controls.includes("owner")) lines.push("Account owner is the person you set on the Accounts page as looking after each client. The number in brackets is how many client accounts they look after.");
  if (controls.includes("test")) lines.push("A test account is one whose name contains test, demo, sample, sandbox or dummy. Hiding them leaves them out of every number on every page, not only here. Owners can change which accounts count as test accounts in Settings.");
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="filter-help">
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

export function ScopeFilterBar({ kind, options, value, onChange, singleAccount = false, hideScope = false }: { kind: FilterKind; options: FilterOptions; value: FilterValue; onChange: (v: FilterValue) => void; singleAccount?: boolean; hideScope?: boolean }) {
  const controls = visibleControls(kind, options, singleAccount);
  if (controls.length === 0) return null;
  const has = (c: ControlId) => controls.includes(c);
  const set = (patch: Partial<FilterValue>) => onChange({ ...value, ...patch });
  const notes = describeHidden(value, options);
  return (
    <div data-testid="scope-filter-bar">
      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Show only">
        <span className="font-medium">Show only</span>
        {has("accounts") && <AccountPicker accounts={options.accounts ?? []} picked={value.accounts} onChange={(accounts) => set({ accounts })} />}
        {has("industry") && <Pick label="Kind of business" choices={options.industries ?? []} value={value.industry} onChange={(industry) => set({ industry })} any="All kinds" />}
        {has("owner") && <Pick label="Account owner" choices={(options.owners ?? []).map((o) => ({ key: o.key, label: o.label, count: o.count }))} value={value.owner} onChange={(owner) => set({ owner })} any="Every owner" />}
        {has("user") && <Pick label="Person" choices={options.users ?? []} value={value.user} onChange={(user) => set({ user })} any="Everyone" />}
        {has("calendar") && <Pick label="Calendar" choices={options.calendars ?? []} value={value.calendar} onChange={(calendar) => set({ calendar })} any="All calendars" />}
        {has("pipeline") && <Pick label="Pipeline" choices={options.pipelines ?? []} value={value.pipeline} onChange={(pipeline) => set({ pipeline })} any="All pipelines" />}
        {has("source") && <Pick label="Where the lead came from" choices={options.sources ?? []} value={value.source} onChange={(source) => set({ source })} any="All sources" />}
        {has("range") && (
          <Labelled label="Time">
            <select className={select} aria-label="Time" value={value.range} onChange={(e) => set({ range: e.target.value as RangeKey })}>
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </Labelled>
        )}
        {has("test") && (
          <label className="flex min-h-9 items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" className="size-4" checked={value.hideTest} onChange={(e) => set({ hideTest: e.target.checked })} />
            Hide {options.testAccounts} test account{options.testAccounts === 1 ? "" : "s"}
          </label>
        )}
        {isFiltered(value) && <button type="button" className="text-xs underline" onClick={() => onChange(EMPTY_FILTER)}>Clear every filter</button>}
      </div>
      <FilterHelp controls={controls} />
      {!hideScope && has("accounts") && <AccountScope options={options} value={value} onChange={onChange} />}
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="filter-hidden-notes">
          {notes.map((n) => <li key={n.text}>{n.text} <button type="button" className="font-medium text-primary underline" onClick={() => set(n.clear)}>{n.clear.hideTest === false ? "Show them" : "Show all"}</button></li>)}
        </ul>
      )}
    </div>
  );
}

type Segments = { total: number; testAccounts?: number; accounts?: AccountOption[]; industries: Array<{ key: string; label: string; accounts: number }>; owners: Array<{ name: string; accounts: number }> };

// The shell's own filter: reads what can be chosen between from the server (unfiltered, so the choice can always be changed) and draws the bar in a
// slim drawer above the page. It draws nothing when there is nothing to choose (UX-13), and says what is hidden even when the drawer is closed.
export function FilterDrawer({ kind, value, onChange }: { kind: FilterKind; value: FilterValue; onChange: (v: FilterValue) => void }) {
  const { data } = useData<Segments>("segments");
  const options = useMemo<FilterOptions | null>(() => {
    if (!data) return null;
    return {
      accounts: data.accounts ?? [],
      industries: data.industries.filter((i) => i.key !== "unset" || data.industries.length > 1).map((i) => ({ key: i.key, label: i.label, count: i.accounts })),
      owners: data.owners.map((o) => ({ key: o.name, label: o.name, count: o.accounts })),
      testAccounts: data.testAccounts ?? 0,
    };
  }, [data]);
  if (!options || data!.total < 2 || visibleControls(kind, options).length === 0) return null;
  const notes = describeHidden(value, options);
  // One quiet row: "Filter accounts", which client accounts are counted, and which are left out. Opening one of them gives it the full width underneath (D1).
  return (
    <div className="print:hidden" data-testid="filter-row">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
        <details className="open:order-last open:basis-full" data-testid="filter-drawer">
          <summary className="ds-press inline-flex min-h-9 cursor-pointer select-none items-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40">Filter accounts{isFiltered(value) ? " (on)" : ""}</summary>
          <div className="mt-2 text-sm"><ScopeFilterBar kind={kind} options={options} value={value} onChange={onChange} hideScope /></div>
        </details>
        <AccountScope options={options} value={value} onChange={onChange} className="contents" />
      </div>
      {notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground" data-testid="filter-hidden-summary">
          {notes.map((n) => <li key={n.text}>{n.text} <button type="button" className="font-medium text-primary underline" onClick={() => onChange({ ...value, ...n.clear })}>{n.clear.hideTest === false ? "Show them" : "Show all"}</button></li>)}
        </ul>
      )}
    </div>
  );
}
