"use client";

import { useEffect, useRef, useState } from "react";
import { describeFilter, isEmptyFilter, type SmartFilter } from "@/lib/people/filters";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { useApiClient, useData } from "../session";
import { Btn, fmtInt, inputClass } from "../ui";
import { SearchPick, type PickOption } from "./find-more";

// The filter builder behind "Filters" on the People page, and the lists a person saves from it. The words typed in the search box are NOT part of this form (the box is at the top of
// the page), so a saved list is only the choices. A list never holds a contact. Saved per person, or shared with the team (never created by or shown to a client's staff).

export type Options = {
  tags: Array<{ tag: string; count: number }>; sources: Array<{ source: string; count: number }>; owners: Array<{ id: string; count: number; name: string }>;
  stages: string[]; accounts: Array<{ id: string; name: string }>; canShareLists: boolean; singleAccount: boolean;
};
export type Saved = { id: string; name: string; filter: SmartFilter; shared: boolean };

const sel = (label: string, id: string, value: string, set: (v: string) => void, options: Array<[string, string]>) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
    <select id={id} className={inputClass} value={value} onChange={(e) => set(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  </div>
);

export function FilterBuilder({ opts, value, onChange, onClear, plus = false }: { opts: Options | null | undefined; value: SmartFilter; onChange: (f: SmartFilter) => void; onClear: () => void; plus?: boolean }) {
  const set = (patch: Partial<SmartFilter>) => {
    const next: Record<string, unknown> = { ...value, ...patch };
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined || next[k] === false) delete next[k];
    onChange(next as SmartFilter);
  };
  // The typed box keeps what is typed and applies it a moment after the last key. The parent gives this component a new key when the choices are replaced from outside
  // (a saved list is opened, a tag day is followed, the choices are cleared), so the box starts again from them.
  const [days, setDays] = useState(value.quietDays === undefined ? "" : String(value.quietDays));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(set);
  useEffect(() => { latest.current = set; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const later = (patch: Partial<SmartFilter>) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => latest.current(patch), 350); };
  const tag = value.tags?.[0] ?? "";
  // With the Find a lead flag the long lists (tags, owners, sources, stages, accounts) are typed into instead of scrolled: fifty accounts or three hundred tags stay usable on a phone.
  const pick = (label: string, id: string, v: string, setV: (v: string) => void, options: Array<[string, string]>, any: string) => plus
    ? <SearchPick key={id} label={label} value={v} onChange={setV} anyLabel={any} testId={`pick-${id}`} options={options.filter(([val]) => val !== "").map(([val, l]) => ({ value: val, label: l.replace(/ (d[d,]*)$/, ""), hint: /((d[d,]*))$/.exec(l)?.[1] }) satisfies PickOption)} />
    : sel(label, id, v, setV, [["", any], ...options]);
  return (
    <div className="space-y-3" data-testid="filter-builder">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pick("Tag", "f-tag", tag, (v) => set({ tags: v ? [v] : undefined, tagMode: undefined, seenFrom: v ? value.seenFrom : undefined, seenTo: v ? value.seenTo : undefined }), (opts?.tags.slice(0, plus ? 300 : 150).map((t) => [t.tag, `${t.tag} (${fmtInt(t.count)})`] as [string, string]) ?? []), "Any tag")}
        {pick("Without the tag", "f-nottag", value.notTag ?? "", (v) => set({ notTag: v }), (opts?.tags.slice(0, plus ? 300 : 150).map((t) => [t.tag, t.tag] as [string, string]) ?? []), "No exclusion")}
        <div>
          <label htmlFor="f-from" className="mb-1 block text-xs font-medium">Tag first seen from</label>
          <input id="f-from" type="date" className={inputClass} disabled={!tag} value={value.seenFrom ?? ""} onChange={(e) => set({ seenFrom: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-to" className="mb-1 block text-xs font-medium">Tag first seen to</label>
          <input id="f-to" type="date" className={inputClass} disabled={!tag} value={value.seenTo ?? ""} onChange={(e) => set({ seenTo: e.target.value })} />
        </div>
        {pick("Owner", "f-owner", value.owner ?? "", (v) => set({ owner: v }), [["none", "No owner"], ...(opts?.owners.map((o) => [o.id, `${o.name} (${fmtInt(o.count)})`] as [string, string]) ?? [])], "Anyone")}
        {pick("Source", "f-source", value.source ?? "", (v) => set({ source: v }), [["none", "No source recorded"], ...(opts?.sources.map((s) => [s.source, `${s.source} (${fmtInt(s.count)})`] as [string, string]) ?? [])], "Any source")}
        {pick("Deal stage", "f-stage", value.stage ?? "", (v) => set({ stage: v }), (opts?.stages.map((s) => [s, s] as [string, string]) ?? []), "Any stage")}
        {opts && !opts.singleAccount && pick("Client account", "f-acct", value.location ?? "", (v) => set({ location: v }), opts.accounts.map((a) => [a.id, a.name] as [string, string]), "All client accounts")}
        <div>
          <label htmlFor="f-quiet" className="mb-1 block text-xs font-medium">No activity for (days)</label>
          <input id="f-quiet" className={inputClass} inputMode="numeric" value={days} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4); setDays(v); later({ quietDays: v === "" ? undefined : Number(v) }); }} placeholder="e.g. 30" />
        </div>
        {sel("Last call from SubSync", "f-call", value.lastCall ?? "", (v) => set({ lastCall: v as SmartFilter["lastCall"] }), [["", "Any"], ["never", "Never called"], ["7", "Not in 7 days"], ["30", "Not in 30 days"]])}
        {sel("Deal", "f-deal", value.deal ?? "", (v) => set({ deal: v as SmartFilter["deal"] }), [["", "Any"], ["open", "Has an open deal"], ["won", "Customer"], ["none", "No deal"]])}
        {sel("Working or cold", "f-cold", value.cold ?? "", (v) => set({ cold: v as SmartFilter["cold"] }), [["", "Both"], ["working", "Working leads"], ["cold", "Cold lists only"]])}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={value.hasPhone === true} onChange={(e) => set({ hasPhone: e.target.checked })} />Has a phone number</label>
        <label className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={value.hideDnd === true} onChange={(e) => set({ hideDnd: e.target.checked })} />Leave out do not disturb</label>
        {!isEmptyFilter(value) && <Btn variant="ghost" onClick={() => onClear()}>Clear the choices</Btn>}
      </div>
      <p className="text-xs text-muted-foreground">Custom fields are not stored by SubSync, so they cannot be filtered on yet. They are shown on each person&apos;s panel.</p>
    </div>
  );
}

export function SaveList({ filter, canShare, onSaved }: { filter: SmartFilter; canShare: boolean; onSaved: () => void }) {
  const api = useApiClient();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try { await api.post("people/lists", { name, filter, shared }); setName(""); setMsg("Saved. It is under Your lists."); onSaved(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${inputClass} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this list to save it" maxLength={40} aria-label="List name" data-testid="save-list-name" />
      {canShare && <label className="inline-flex min-h-9 items-center gap-1.5 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Share with my team</label>}
      <Btn onClick={save} disabled={!name.trim() || isEmptyFilter(filter)} testId="save-list">Save this list</Btn>
      {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
    </div>
  );
}

/** The saved lists as a manage list: open or delete. (The one-tap way to open them is the row of chips on the page.) */
export function ManageLists({ lists, names, onOpen, onChanged }: { lists: Saved[]; names: { owner: (id: string) => string; account: (id: string) => string }; onOpen: (f: SmartFilter) => void; onChanged: () => void }) {
  const api = useApiClient();
  const [msg, setMsg] = useState<string | null>(null);
  const del = async (id: string) => { setMsg(null); try { await api.del(`people/lists/${id}`); onChanged(); } catch (e) { setMsg((e as Error).message); } };
  const group = (shared: boolean, title: string) => {
    const mine = lists.filter((l) => l.shared === shared);
    if (mine.length === 0) return null;
    return (
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <ul className="divide-y border-y text-sm">
          {mine.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground">{describeFilter(l.filter, names)}</span></span>
              <span className="flex gap-3"><button type="button" className="min-h-9 font-medium text-primary underline" onClick={() => onOpen(l.filter)}>Open</button><button type="button" className="min-h-9 text-muted-foreground underline" onClick={() => void del(l.id)} aria-label={`Delete ${l.name}`}>Delete</button></span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return <div className="space-y-4" data-testid="saved-lists">{group(false, "Your lists")}{group(true, "Shared with your team")}{msg && <p className="text-sm text-destructive" role="alert">{msg}</p>}</div>;
}

/** Loads the person's saved lists (and the options to name owners and accounts in a list's sentence). */
export function useSavedLists() {
  const lists = useData<{ lists: Saved[]; canShare: boolean }>("people/lists");
  const opts = useData<Options>("people/options");
  const names = { owner: (id: string) => opts.data?.owners.find((o) => o.id === id)?.name ?? "a team member", account: (id: string) => opts.data?.accounts.find((a) => a.id === id)?.name ?? "one client account" };
  return { lists, opts, names };
}

export function SavedListsState({ lists }: { lists: ReturnType<typeof useData<{ lists: Saved[]; canShare: boolean }>> }) {
  if (lists.loading && !lists.data) return <SkeletonRows rows={2} label="Loading your lists..." />;
  if (lists.error) return <ErrorState error={lists.error} onRetry={lists.reload} />;
  if ((lists.data?.lists ?? []).length === 0) return <EmptyState compact title="No saved lists yet" body="Choose your filters, name them, and press Save this list. A list is only the choices; it always shows today's people." />;
  return null;
}
