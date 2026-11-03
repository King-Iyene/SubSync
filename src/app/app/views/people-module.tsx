"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { changeBetween } from "@/lib/design/range";
import { describeFilter, filterToParams, isEmptyFilter, parseSmartFilter, type SmartFilter } from "@/lib/people/filters";
import { QUIET_AFTER_DAYS } from "@/lib/analytics/contact-intel";
import { BarChart, CardRange, DataList, DialButton, DrillPanel, EmptyState, ErrorState, HowTo, InlineAlert, LeadDrawer, ModuleTabs, Page as PageShell, Section, SkeletonRows, useCardRange, useDrill, type Column, type LeadSeed } from "../ds";
import { remember, remembered, takeHandOff } from "../ds/remember";
import { useApiClient, useData } from "../session";
import { Btn, fmtInt, inputClass, timeAgo } from "../ui";
import { CallsView } from "./calls";
import { LeadsView } from "./leads";

// The People module (stage F10): one place to find, filter, list and call the people in your CRM. Tabs: Search and filters, Smart lists (saved filters plus the
// built-in call lists), Going cold, and Imports and sources. Every list opens the same lead panel, with arrows through the list it was opened from.

export type PersonUi = {
  contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; tags: string[];
  source: string | null; owner: string | null; ownerName: string; dnd: boolean; timeZone: string | null; dateAdded: string | null; lastActivityAt: string | null;
  lastCallAt: string | null; calls: number; lastResult: string | null; url: string;
};
type Page = { total: number; page: number; pageSize: number; rows: PersonUi[]; description?: string };
type Options = {
  tags: Array<{ tag: string; count: number }>; sources: Array<{ source: string; count: number }>; owners: Array<{ id: string; count: number; name: string }>;
  stages: string[]; accounts: Array<{ id: string; name: string }>; canShareLists: boolean; singleAccount: boolean;
};
type Saved = { id: string; name: string; filter: SmartFilter; shared: boolean };

export const RESULT_WORDS: Record<string, string> = { answered: "Answered", voicemail: "Voicemail", no_answer: "No answer", wrong_number: "Wrong number", booked: "Booked", not_interested: "Not interested", follow_up: "Follow up" };

export const toSeed = (r: PersonUi): LeadSeed => ({
  contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, phone: r.phone, owner: r.owner ? r.ownerName : null, unassigned: !r.owner, url: r.url, dnd: r.dnd, timeZone: r.timeZone,
});

/** The one list of people: name, account, phone and Dial, owner, tags, last activity, last call. Opens the lead panel; server pages of 50. */
export function PeopleList({ page, onPage, showAccount, caption, empty, drawerOnly }: { page: Page; onPage?: (n: number) => void; showAccount: boolean; caption: string; empty?: string; drawerOnly?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const rows = page.rows;
  const columns: Array<Column<PersonUi>> = useMemo(() => [
    { key: "name", header: "Name", primary: true, width: "minmax(0,1.6fr)", cell: (r) => <span>{r.name}{r.email ? <span className="block truncate text-xs font-normal text-muted-foreground">{r.email}</span> : null}</span> },
    ...(showAccount ? [{ key: "acct", header: "Account", width: "minmax(0,1.1fr)", cell: (r: PersonUi) => <span className="block truncate">{r.locationName ?? "Unnamed account"}</span> }] : []),
    { key: "phone", header: "Phone", width: "minmax(0,1.4fr)", cell: (r) => r.phone ? <span className="flex items-center justify-between gap-2"><span className="tabular-nums">{r.phone}</span><DialButton phone={r.phone} contactUrl={r.url} dnd={r.dnd} timeZone={r.timeZone} /></span> : <span className="text-muted-foreground">No phone</span> },
    { key: "owner", header: "Owner", width: "minmax(0,1fr)", cell: (r) => <span className="block truncate" title={r.owner ? r.ownerName : undefined}>{r.owner ? r.ownerName : "No owner"}</span> },
    { key: "tags", header: "Tags", width: "minmax(0,1.2fr)", cell: (r) => r.tags.length ? <span className="block truncate text-xs text-muted-foreground">{r.tags.slice(0, 3).join(", ")}{r.tags.length > 3 ? ` +${r.tags.length - 3}` : ""}</span> : <span className="text-xs text-muted-foreground">No tags</span> },
    { key: "act", header: "Last activity", width: "minmax(0,0.9fr)", cell: (r) => <span>{r.lastActivityAt ? timeAgo(r.lastActivityAt) : r.dateAdded ? `Added ${timeAgo(r.dateAdded)}` : "None recorded"}</span> },
    { key: "call", header: "Last call, tries, result", width: "minmax(0,1.3fr)", cell: (r) => r.lastCallAt ? <span className="text-xs">{timeAgo(r.lastCallAt)}, {r.calls} {r.calls === 1 ? "try" : "tries"}{r.lastResult ? `, ${RESULT_WORDS[r.lastResult] ?? r.lastResult}` : ""}</span> : <span className="text-xs text-muted-foreground">Not called from SubSync</span> },
  ], [showAccount]);
  const seeds = rows.map(toSeed);
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  return (
    <div data-testid="people-list">
      <DataList rows={rows} columns={columns} rowKey={(r) => `${r.locationId}:${r.contactId}`} onOpen={(_, i) => setOpen(i)} caption={caption} preview={Math.max(10, rows.length)} pageSize={Math.max(10, rows.length)} empty={empty ?? "Nobody matches these choices."}
        copyText={(r) => [r.name, r.phone ?? "", r.email ?? "", r.locationName ?? ""].join("\t")} />
      {onPage && page.total > page.pageSize && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="people-pager">
          <span>{fmtInt((page.page - 1) * page.pageSize + 1)} to {fmtInt(Math.min(page.total, page.page * page.pageSize))} of {fmtInt(page.total)}</span>
          <span className="flex items-center gap-2">
            <Btn variant="secondary" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>Previous</Btn>
            <span aria-live="polite">Page {page.page} of {fmtInt(pages)}</span>
            <Btn variant="secondary" disabled={page.page >= pages} onClick={() => onPage(page.page + 1)}>Next</Btn>
          </span>
        </div>
      )}
      {!drawerOnly && <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

const sel = (label: string, id: string, value: string, set: (v: string) => void, options: Array<[string, string]>) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
    <select id={id} className={inputClass} value={value} onChange={(e) => set(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  </div>
);

function FilterBuilder({ opts, value, onChange, onClear }: { opts: Options | null | undefined; value: SmartFilter; onChange: (f: SmartFilter) => void; onClear: () => void }) {
  const set = (patch: Partial<SmartFilter>) => {
    const next: Record<string, unknown> = { ...value, ...patch };
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined || next[k] === false) delete next[k];
    onChange(next as SmartFilter);
  };
  // The two typed boxes keep what is typed and apply it a moment after the last key. The parent gives this component a new key when the choices are replaced
  // from outside (a saved list is opened, a tag day is followed, the choices are cleared), so the boxes start again from them.
  const [q, setQ] = useState(value.q ?? "");
  const [days, setDays] = useState(value.quietDays === undefined ? "" : String(value.quietDays));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(set);
  useEffect(() => { latest.current = set; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const later = (patch: Partial<SmartFilter>) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => latest.current(patch), 350); };
  const tag = value.tags?.[0] ?? "";
  return (
    <div className="space-y-3" data-testid="filter-builder">
      <div>
        <label htmlFor="people-q" className="mb-1 block text-xs font-medium">Name, email or phone</label>
        <input id="people-q" className={`${inputClass} max-w-xl py-2.5 text-base`} value={q} onChange={(e) => { setQ(e.target.value); later({ q: e.target.value.trim() || undefined }); }} placeholder="Name, email or phone..." maxLength={100} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sel("Tag", "f-tag", tag, (v) => set({ tags: v ? [v] : undefined, tagMode: undefined, seenFrom: v ? value.seenFrom : undefined, seenTo: v ? value.seenTo : undefined }), [["", "Any tag"], ...(opts?.tags.slice(0, 150).map((t) => [t.tag, `${t.tag} (${fmtInt(t.count)})`] as [string, string]) ?? [])])}
        {sel("Without the tag", "f-nottag", value.notTag ?? "", (v) => set({ notTag: v }), [["", "No exclusion"], ...(opts?.tags.slice(0, 150).map((t) => [t.tag, t.tag] as [string, string]) ?? [])])}
        <div>
          <label htmlFor="f-from" className="mb-1 block text-xs font-medium">Tag first seen from</label>
          <input id="f-from" type="date" className={inputClass} disabled={!tag} value={value.seenFrom ?? ""} onChange={(e) => set({ seenFrom: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-to" className="mb-1 block text-xs font-medium">Tag first seen to</label>
          <input id="f-to" type="date" className={inputClass} disabled={!tag} value={value.seenTo ?? ""} onChange={(e) => set({ seenTo: e.target.value })} />
        </div>
        {sel("Owner", "f-owner", value.owner ?? "", (v) => set({ owner: v }), [["", "Anyone"], ["none", "No owner"], ...(opts?.owners.map((o) => [o.id, `${o.name} (${fmtInt(o.count)})`] as [string, string]) ?? [])])}
        {sel("Source", "f-source", value.source ?? "", (v) => set({ source: v }), [["", "Any source"], ["none", "No source recorded"], ...(opts?.sources.map((s) => [s.source, `${s.source} (${fmtInt(s.count)})`] as [string, string]) ?? [])])}
        {sel("Deal stage", "f-stage", value.stage ?? "", (v) => set({ stage: v }), [["", "Any stage"], ...(opts?.stages.map((s) => [s, s] as [string, string]) ?? [])])}
        {opts && !opts.singleAccount && sel("Client account", "f-acct", value.location ?? "", (v) => set({ location: v }), [["", "All client accounts"], ...opts.accounts.map((a) => [a.id, a.name] as [string, string])])}
        <div>
          <label htmlFor="f-quiet" className="mb-1 block text-xs font-medium">No activity for (days)</label>
          <input id="f-quiet" className={inputClass} inputMode="numeric" value={days} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4); setDays(v); later({ quietDays: v === "" ? undefined : Number(v) }); }} placeholder="e.g. 30" />
        </div>
        {sel("Last call from SubSync", "f-call", value.lastCall ?? "", (v) => set({ lastCall: v as SmartFilter["lastCall"] }), [["", "Any"], ["never", "Never called"], ["7", "Not in 7 days"], ["30", "Not in 30 days"]])}
        {sel("Deal", "f-deal", value.deal ?? "", (v) => set({ deal: v as SmartFilter["deal"] }), [["", "Any"], ["open", "Has an open deal"], ["won", "Customer"], ["none", "No deal"]])}
        {sel("Working or cold", "f-cold", value.cold ?? "", (v) => set({ cold: v as SmartFilter["cold"] }), [["", "Both"], ["working", "Working leads"], ["cold", "Cold lists only"]])}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={value.hasPhone === true} onChange={(e) => set({ hasPhone: e.target.checked })} />Has a phone number</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={value.hideDnd === true} onChange={(e) => set({ hideDnd: e.target.checked })} />Leave out do not disturb</label>
        {!isEmptyFilter(value) && <Btn variant="ghost" onClick={() => onClear()}>Clear all choices</Btn>}
      </div>
      <p className="text-xs text-muted-foreground">Custom fields are not stored by SubSync, so they cannot be filtered on yet. They are shown on each lead&apos;s panel.</p>
    </div>
  );
}

function SaveList({ filter, canShare, onSaved }: { filter: SmartFilter; canShare: boolean; onSaved: () => void }) {
  const api = useApiClient();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try { await api.post("people/lists", { name, filter, shared }); setName(""); setMsg("Saved. It is under Smart lists."); onSaved(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${inputClass} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this list to save it" maxLength={40} aria-label="List name" />
      {canShare && <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Share with my team</label>}
      <Btn onClick={save} disabled={!name.trim() || isEmptyFilter(filter)}>Save as a smart list</Btn>
      {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
    </div>
  );
}

// ---------------- tags: click a tag, see its leads and per-day counts ----------------

function TagPanel({ tag, showAccount, onSeeAll }: { tag: string; showAccount: boolean; onSeeAll: (day: string) => void }) {
  const range = useCardRange("tag-days", { preset: "90d", compare: "none" });
  const cur = range.resolved?.current;
  const cmp = range.resolved?.compare ?? null;
  const path = cur ? `people/tags/${encodeURIComponent(tag)}?from=${cur.from}&to=${cur.to}` : null;
  const { data, error, loading, reload } = useData<{ tagged: number; carrying: number; since: string | null; removedInWindow: number; days: Array<{ day: string; count: number; members: PersonUi[] }> }>(path);
  const prev = useData<{ tagged: number }>(cmp ? `people/tags/${encodeURIComponent(tag)}?from=${cmp.from}&to=${cmp.to}` : null);
  const drill = useDrill();
  const bars = (data?.days ?? []).map((d) => ({ label: d.day.slice(5), value: d.count, count: d.count, detail: `${d.day}: ${d.count} tagged` }));
  const picked = drill.selected !== null ? data?.days[drill.selected] : undefined;
  const change = cmp && data && prev.data ? changeBetween(data.tagged, prev.data.tagged, "") : null;
  return (
    <section className="mt-4 border-t pt-4" aria-label={`Tag ${tag}`} data-testid="tag-panel">
      <h3 className="text-sm font-semibold">Tag: {tag}</h3>
      <CardRange state={range} label={`${tag} per day`} maxDays={180} />
      {loading && !data ? <SkeletonRows rows={3} label="Loading this tag..." /> : error ? <ErrorState error={error} onRetry={reload} /> : data ? (
        <>
          <p className="mt-2 text-sm">{fmtInt(data.carrying)} {data.carrying === 1 ? "person has" : "people have"} this tag now. {fmtInt(data.tagged)} {data.tagged === 1 ? "was" : "were"} tagged in this window{change ? ` (${change.text})` : ""}{data.removedInWindow > 0 ? `, and it was taken off ${fmtInt(data.removedInWindow)} ${data.removedInWindow === 1 ? "person" : "people"}` : ""}.</p>
          <InlineAlert tone="info">{data.since ? `Your CRM does not say when a tag was added. These days are when SubSync first saw the tag, since SubSync started watching on ${new Date(data.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. Tags added earlier have no day.` : "Your CRM does not say when a tag was added, and SubSync has not seen a tag change yet. Days appear from now on as tags are added."}</InlineAlert>
          <div className="mt-3">
            <BarChart title={`Tagged per day, ${tag}`} bars={bars} unit="people" noun="people" onSelect={drill.select} selected={drill.selected} height={140} />
          </div>
          {picked && (
            <DrillPanel drill={drill} title={`Tagged on ${picked.day}`} count={picked.count} noun="people" rows={picked.members} rowKey={(r) => `${r.locationId}:${r.contactId}`} toLead={toSeed} backLabel="Back to the chart"
              columns={[
                { key: "n", header: "Name", primary: true, cell: (r) => r.name },
                ...(showAccount ? [{ key: "a", header: "Account", cell: (r: PersonUi) => r.locationName ?? "Unnamed account" }] : []),
                { key: "o", header: "Owner", cell: (r) => (r.owner ? r.ownerName : "No owner") },
              ]} />
          )}
          {picked && picked.count > 0 && <p className="mt-2 text-xs"><button type="button" className="font-medium text-primary underline" onClick={() => onSeeAll(picked.day)} data-testid="tag-see-all">See all {fmtInt(picked.count)} in Search and filters</button></p>}
        </>
      ) : null}
    </section>
  );
}

// ---------------- Search and filters ----------------

function SearchTab({ filter, setFilter, replaceFilter, version }: { filter: SmartFilter; setFilter: (f: SmartFilter) => void; replaceFilter: (f: SmartFilter) => void; version: number }) {
  const opts = useData<Options>("people/options");
  // The page restarts at 1 whenever the choices change (derived, not an effect).
  const fk = JSON.stringify(filter);
  const [pg, setPg] = useState({ fk, n: 1 });
  const pageNo = pg.fk === fk ? pg.n : 1;
  const setPageNo = (n: number) => setPg({ fk, n });
  const [tag, setTag] = useState<string | null>(null);
  const params = useMemo(() => { const p = filterToParams(filter); p.set("page", String(pageNo)); return p.toString(); }, [filter, pageNo]);
  const list = useData<Page>(`people/search?${params}`);
  const lists = useData<{ lists: Saved[]; canShare: boolean }>("people/lists");
  const showAccount = !(opts.data?.singleAccount ?? false);
  return (
    <div className="space-y-5">
      <HowTo id="people-search" title="How to use this page">Search by name, email or phone, or narrow the list with the choices. Press a name to see the person, then use the arrows to move to the next. Press Dial to call. Save a list you use often and it is kept under Smart lists.</HowTo>
      <FilterBuilder key={version} opts={opts.data} value={filter} onChange={setFilter} onClear={() => replaceFilter({})} />
      <SaveList filter={filter} canShare={opts.data?.canShareLists ?? false} onSaved={() => void lists.reload()} />
      <Section title={list.data ? `${fmtInt(list.data.total)} ${list.data.total === 1 ? "person" : "people"}` : "People"} hint={list.data?.description}>
        {list.loading && !list.data ? <SkeletonRows rows={6} label="Finding people..." /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.data ? (
          <PeopleList page={list.data} onPage={setPageNo} showAccount={showAccount} caption="People" empty={isEmptyFilter(filter) ? "No contacts yet. Contacts appear once the first sync finishes." : "Nobody matches these choices. Clear one of them to widen the list."} />
        ) : null}
      </Section>
      <Section title="Tags" hint="Press a tag to see who has it and how many were tagged each day.">
        {opts.data && opts.data.tags.length === 0 ? <p className="text-sm text-muted-foreground">No tags on your contacts yet.</p> : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {(opts.data?.tags ?? []).slice(0, 40).map((t) => (
              <li key={t.tag}><button type="button" onClick={() => setTag(tag === t.tag ? null : t.tag)} aria-pressed={tag === t.tag} className={`min-h-8 border-b-2 px-2 text-sm ${tag === t.tag ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.tag} <span className="tabular-nums text-xs">{fmtInt(t.count)}</span></button></li>
            ))}
          </ul>
        )}
        {tag && <TagPanel key={tag} tag={tag} showAccount={showAccount} onSeeAll={(day) => { replaceFilter({ tags: [tag], seenFrom: day, seenTo: day }); window.scrollTo({ top: 0 }); }} />}
      </Section>
    </div>
  );
}

// ---------------- Smart lists ----------------

function SavedLists({ onOpen }: { onOpen: (f: SmartFilter) => void }) {
  const api = useApiClient();
  const lists = useData<{ lists: Saved[]; canShare: boolean }>("people/lists");
  const opts = useData<Options>("people/options");
  const [msg, setMsg] = useState<string | null>(null);
  const names = { owner: (id: string) => opts.data?.owners.find((o) => o.id === id)?.name ?? "a person on your team", account: (id: string) => opts.data?.accounts.find((a) => a.id === id)?.name ?? "one client account" };
  const del = async (id: string) => { setMsg(null); try { await api.del(`people/lists/${id}`); await lists.reload(); } catch (e) { setMsg((e as Error).message); } };
  if (lists.loading && !lists.data) return <SkeletonRows rows={2} label="Loading your lists..." />;
  if (lists.error) return <ErrorState error={lists.error} onRetry={lists.reload} />;
  const all = lists.data?.lists ?? [];
  if (all.length === 0) return <EmptyState compact title="No saved lists yet" body="Choose your filters under Search and filters, name them, and press Save as a smart list. A list is only the choices; it always shows today's people." />;
  const group = (shared: boolean, title: string) => {
    const mine = all.filter((l) => l.shared === shared);
    if (mine.length === 0) return null;
    return (
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <ul className="divide-y border-y text-sm">
          {mine.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground">{describeFilter(l.filter, names)}</span></span>
              <span className="flex gap-3"><button type="button" className="min-h-9 font-medium text-primary underline" onClick={() => onOpen(l.filter)}>Open</button><button type="button" className="min-h-9 text-muted-foreground underline" onClick={() => del(l.id)} aria-label={`Delete ${l.name}`}>Delete</button></span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return <div className="space-y-4" data-testid="saved-lists">{group(false, "Your lists")}{group(true, "Shared with your team")}{msg && <p className="text-sm text-destructive" role="alert">{msg}</p>}</div>;
}

function SmartListsTab({ onOpen, callsAllowed }: { onOpen: (f: SmartFilter) => void; callsAllowed: boolean }) {
  return (
    <div className="space-y-8">
      <Section title="Saved smart lists" hint="Your own lists, and the ones your team shares. Open one to see today's people.">
        <SavedLists onOpen={onOpen} />
      </Section>
      {callsAllowed && (
        <Section title="Call lists" hint="Built-in lists of who to call next, most important first. Nothing is sent from here.">
          <CallsView embedded />
        </Section>
      )}
    </div>
  );
}

// ---------------- Going cold ----------------

const BUCKET_WORDS: Record<string, { title: string; hint: string; empty: string }> = {
  quiet: { title: "Engaged, then quiet", hint: `Working leads who wrote, booked or had a deal, and nothing since ${QUIET_AFTER_DAYS} days. The best people to bring back.`, empty: "Nobody has gone quiet yet." },
  recent: { title: "Seen recently", hint: `Working leads with something seen in the last ${QUIET_AFTER_DAYS} days.`, empty: "Nobody was seen recently." },
  none: { title: "Nothing seen yet", hint: "Working leads with no reply, booking or deal seen. This is not the same as never replying: SubSync reads the newest conversations of each account.", empty: "Nobody here." },
};

function GoingColdTab({ showAccount }: { showAccount: boolean }) {
  const [bucket, setBucket] = useState("quiet");
  const [pageNo, setPageNo] = useState(1);
  const intel = useData<{ engagement?: { working: number; cold: number; noneSeen: number; recent: number; quietAfter: number; quietDays: number; coldLists: Array<{ tag: string; contacts: number; engaged: number }> } }>("contact-intel");
  const list = useData<Page>(`people/going-cold?bucket=${bucket}&page=${pageNo}`);
  const eg = intel.data?.engagement;
  const rows = eg ? [
    { label: `Engaged, then quiet ${eg.quietDays}+ days`, value: eg.quietAfter, count: eg.quietAfter, detail: "quiet", key: "quiet" },
    { label: `Seen in the last ${eg.quietDays} days`, value: eg.recent, count: eg.recent, detail: "recent", key: "recent" },
    { label: "Nothing seen yet", value: eg.noneSeen, count: eg.noneSeen, detail: "none", key: "none" },
  ] : [];
  const pick = (i: number) => { setBucket(rows[i].key); setPageNo(1); };
  const info = BUCKET_WORDS[bucket];
  return (
    <div className="space-y-6">
      <HowTo id="people-cold" title="How to use this page">Press a bar to see the people behind it. Start with &quot;Engaged, then quiet&quot;: they have talked to you before. Contacts on a cold list are counted apart, so they never hide the people you are really working.</HowTo>
      <Section title="Who is going quiet" hint="Working leads only. Cold lists are counted apart.">
        {eg ? (
          <>
            <div className="max-w-xl">
              <BarChart title="Working leads by what SubSync has seen" bars={rows.map((r) => ({ label: r.label, value: r.value, count: r.count, detail: `${fmtInt(r.value)} people` }))} unit="people" noun="people" onSelect={pick} selected={rows.findIndex((r) => r.key === bucket)} height={150} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{fmtInt(eg.working)} working leads, {fmtInt(eg.cold)} on cold lists{eg.coldLists.length ? ` (${eg.coldLists.slice(0, 3).map((c) => `${c.tag}: ${fmtInt(c.contacts)}`).join(", ")})` : ""}.</p>
          </>
        ) : intel.loading ? <SkeletonRows rows={3} label="Counting..." /> : intel.error ? <ErrorState error={intel.error} onRetry={intel.reload} /> : null}
      </Section>
      <Section title={`${info.title}${list.data ? `: ${fmtInt(list.data.total)}` : ""}`} hint={info.hint}>
        {list.loading && !list.data ? <SkeletonRows rows={6} label="Finding people..." /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.data ? <PeopleList page={list.data} onPage={setPageNo} showAccount={showAccount} caption={info.title} empty={info.empty} /> : null}
      </Section>
      <Section title="Cold lists and lifecycle" hint="Mark a tag as a cold list so it never hides the people you are really working.">
        <LeadsView part="cold" />
      </Section>
    </div>
  );
}

// ---------------- Imports and sources ----------------

function ImportsTab() {
  return (
    <div className="space-y-6">
      <LeadsView part="sources" />
    </div>
  );
}

// Kept for later; hidden from view (simplify cut 3, docs/SIMPLIFY_M1_M2.md).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SourceChart({ showAccount }: { showAccount: boolean }) {
  const { data, error, loading, reload } = useData<{ sources: Array<{ source: string; contacts: number }> }>("contact-intel");
  const drill = useDrill();
  const bars = (data?.sources ?? []).slice(0, 8).map((s) => ({ label: s.source, value: s.contacts, count: s.contacts, detail: `${fmtInt(s.contacts)} contacts` }));
  const picked = drill.selected !== null ? bars[drill.selected] : undefined;
  const filter: SmartFilter | null = picked ? { source: picked.label === "Unknown" ? "none" : picked.label } : null;
  const list = useData<Page>(filter ? `people/search?${filterToParams(filter).toString()}&page=1` : null);
  if (loading && !data) return <SkeletonRows rows={3} label="Loading sources..." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || bars.length === 0) return null;
  return (
    <Section title="Where your contacts come from" hint="Press a bar to see the people. A source of Unknown means the CRM has none recorded.">
      <div className="max-w-xl"><BarChart title="Contacts by source" bars={bars} unit="contacts" noun="contacts" onSelect={drill.select} selected={drill.selected} height={150} /></div>
      {picked && drill.open && (
        <div className="mt-3" data-testid="source-drill">
          <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{picked.label}: {list.data ? fmtInt(list.data.total) : "..."} contacts</h3><button type="button" className="min-h-9 text-xs font-medium text-primary underline" onClick={drill.close}>Back to the chart</button></div>
          {list.loading && !list.data ? <SkeletonRows rows={4} label="Finding people..." /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.data ? <PeopleList page={list.data} showAccount={showAccount} caption={picked.label} /> : null}
          {list.data && list.data.total > list.data.rows.length && <p className="mt-1 text-xs text-muted-foreground">Showing the first {list.data.rows.length}. Choose the source under Search and filters to see them all.</p>}
        </div>
      )}
    </Section>
  );
}

// ---------------- the module ----------------

const TABS = ["Search and filters", "Smart lists", "Going cold", "Imports and sources"] as const;

export function PeopleModule({ start = 0, callsAllowed }: { start?: number; callsAllowed: boolean }) {
  const [tab, setTab] = useState(start);
  const [filter, setFilterState] = useState<SmartFilter>(() => {
    const first = takeHandOff("people-q");
    if (first) return { q: first.slice(0, 100) };
    const saved = remembered("people-filter");
    // The remembered filter never holds the typed search (a name, email or phone is customer data and stays out of browser storage); an older saved value is read without it.
    if (saved) { try { const p = parseSmartFilter(JSON.parse(saved)); if (p.ok) { const { q: _q, ...rest } = p.filter; return rest; } } catch { /* a damaged value is ignored */ } }
    return {};
  });
  const [version, setVersion] = useState(0);
  const setFilter = (f: SmartFilter) => { setFilterState(f); const { q: _q, ...keep } = f; remember("people-filter", isEmptyFilter(keep) ? null : JSON.stringify(keep)); };
  // A change that does not come from the boxes themselves (a saved list, a tag day, clearing) also restarts the boxes.
  const replaceFilter = (f: SmartFilter) => { setFilter(f); setVersion((v) => v + 1); };
  const opts = useData<Options>("people/options");
  const showAccount = !(opts.data?.singleAccount ?? false);
  return (
    <PageShell title="People" subtitle="Find anyone across your client accounts, keep lists you use often, and see who is going cold.">
    <ModuleTabs value={tab} onChange={setTab} label="People" tabs={[
      { label: TABS[0], node: <SearchTab filter={filter} setFilter={setFilter} replaceFilter={replaceFilter} version={version} /> },
      { label: TABS[1], node: <SmartListsTab callsAllowed={callsAllowed} onOpen={(f) => { replaceFilter(f); setTab(0); }} /> },
      { label: TABS[2], node: <GoingColdTab showAccount={showAccount} /> },
      { label: TABS[3], node: <ImportsTab /> },
    ]} />
    </PageShell>
  );
}
