"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { guardrails, REASON_LABELS, SORT_LABELS } from "@/lib/analytics/dedupe-review";
import { EmptyState, ErrorState, HowTo, InlineAlert, Page, PopMenu, RowButton, Section, SkeletonCards } from "../ds";
import { useApiClient, useData } from "../session";
import { fmtInt } from "../ui";
import { buttons, Compare, GroupRow, MergeSheet, RecordCard, type Row, type WithUrl } from "./duplicates-parts";

// Duplicate contacts, rebuilt (stage DUP; docs/DUPLICATES_REVIEW.md). One group at a time: the best record is already picked and the reason is in words,
// only what differs is shown, and one big button starts the merge. SubSync only READS the CRM, so the merge is finished in the CRM's own screen with one
// click ("Open both in your CRM"); the one-click merge from here is built and switched off (docs/features/DUPLICATES.md). Every number comes from the same
// open list the stepper walks. The server sends one page and one group, never the whole list, so it stays quick at 100 accounts and thousands of groups.

const { BTN, PRIMARY, QUIET } = buttons;

type Step = {
  key: string; locationId: string; locationName: string | null; reason: { key: string; label: string }; likelihood: { key: string; label: string }; confidence: number;
  survivorId: string; why: string; obvious: boolean; review: { kind: string; at: string | null; keepContactId: string | null } | null; until: string | null;
  watchingSince: string | null; enriched: boolean; people: WithUrl[];
};
type Paged<T> = { rows: T[]; page: number; pages: number; total: number; from: number; to: number };
type Account = { locationId: string; name: string | null; groups: number; contacts: number; extra: number; openDeals: number };
type Data = {
  health: { groups: number; contacts: number; extra: number; listSize: number; shareLabel: string };
  byReason: Record<string, number>; obvious: number; truncated: boolean; multi: boolean; status: "open" | "decided" | "later";
  counts: { open: number; later: number; decided: number }; protection: { allowing: number; names: string[] }; canExport: boolean; mergeSwitchedOff: boolean;
  accounts: Paged<Account>; selection: { total: number; i: number; status: string; q: string; reason: string | null; location: string | null; sort: string };
  list: Paged<Row>; upNext: Row[]; step: Step | null;
};
type ObviousRow = { key: string; locationId: string; locationName: string | null; keep: { name: string; email: string | null; phone: string | null }; remove: Array<{ name: string; email: string | null; phone: string | null }>; tagsAdded: string[] };
type ObviousData = Paged<ObviousRow> & { switchedOff: boolean };

type F = { status: "open" | "decided" | "later"; q: string; reason: string; location: string; sort: string; page: number; i: number; focus: string | null; all: boolean; ap: number; aq: string; accAll: boolean };
const START: F = { status: "open", q: "", reason: "", location: "", sort: "important", page: 0, i: 0, focus: null, all: false, ap: 0, aq: "", accAll: false };

function pathOf(f: F): string {
  const sp = new URLSearchParams({ status: f.status, sort: f.sort, page: String(f.page), size: f.all ? "25" : "5", i: String(f.i), ap: String(f.ap), an: f.accAll ? "10" : "5" });
  if (f.q) sp.set("q", f.q);
  if (f.reason) sp.set("reason", f.reason);
  if (f.location) sp.set("location", f.location);
  if (f.focus) sp.set("focus", f.focus);
  if (f.aq) sp.set("aq", f.aq);
  return `duplicates?${sp.toString()}`;
}

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const selectClass = "min-h-11 rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-10";
const searchClass = "min-h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-10 sm:w-64";

export function DuplicatesView() {
  const api = useApiClient();
  const [f, setF] = useState<F>(START);
  const { data, error, loading, reload } = useData<Data>(pathOf(f));
  const [chosen, setChosen] = useState<{ key: string; id: string } | null>(null);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [obvious, setObvious] = useState(false);
  const [oPage, setOPage] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const obv = useData<ObviousData>(obvious ? `duplicates/obvious?page=${oPage}` : null);

  const patch = useCallback((p: Partial<F>) => setF((x) => ({ ...x, ...p })), []);
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === qInput ? x : { ...x, q: qInput, page: 0, i: 0, focus: null })), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 20_000);
    return () => clearTimeout(t);
  }, [toast]);

  const step = data?.step ?? null;
  const total = data?.selection.total ?? 0;
  const at = data?.selection.i ?? 0;
  const keepId = step ? (chosen && chosen.key === step.key ? chosen.id : step.survivorId) : null;
  const sheetOpen = !!step && sheetKey === step.key;
  const decided = !!step?.review;
  const filtered = !!(f.q || f.reason || f.location || f.status !== "open");

  const go = useCallback((i: number) => { setSheetKey(null); setF((x) => ({ ...x, i, focus: null })); }, []);
  const prev = () => go(at <= 0 ? total - 1 : at - 1);
  const next = () => go(at + 1 >= total ? 0 : at + 1);
  const focusGroup = (r: { locationId: string; key: string }) => { setSheetKey(null); setF((x) => ({ ...x, focus: `${r.locationId}:${r.key}`, i: 0 })); window.scrollTo?.({ top: 0, behavior: "smooth" }); };

  const send = async (path: string, body: unknown, done: string, undo?: { path: string; body: unknown; focus: string }) => {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(path, body);
      setSheetKey(null);
      setToast({
        text: done,
        undo: undo ? async () => { await api.post(undo.path, undo.body); setToast(null); setF((x) => ({ ...x, focus: undo.focus })); } : undefined,
      });
      await reload();
      // The button that was pressed is gone: put focus on the next group so a keyboard or screen reader user is not left behind.
      setTimeout(() => document.querySelector<HTMLElement>("[data-testid='dup-step-count']")?.focus(), 50);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const bodyOf = (s: Step) => ({ locationId: s.locationId, contactIds: s.people.map((p) => p.contactId) });
  const notDuplicate = (s: Step) => send("duplicates/review", { ...bodyOf(s), decision: "not_duplicate" }, "Marked as not a duplicate. It will not be suggested again.", { path: "duplicates/undo", body: { locationId: s.locationId, key: s.key }, focus: `${s.locationId}:${s.key}` });
  const notNow = (s: Step) => send("duplicates/snooze", bodyOf(s), "Set aside for 7 days. It comes back after that.", { path: "duplicates/unsnooze", body: bodyOf(s), focus: `${s.locationId}:${s.key}` });
  const merged = (s: Step) => send("duplicates/review", { ...bodyOf(s), decision: "merged_in_platform", keepContactId: keepId }, "Marked as merged. It leaves the list after SubSync next refreshes from your CRM.", { path: "duplicates/undo", body: { locationId: s.locationId, key: s.key }, focus: `${s.locationId}:${s.key}` });
  const putBack = (s: Step) => (s.review ? send("duplicates/undo", { locationId: s.locationId, key: s.key }, "Put back in the list.") : send("duplicates/unsnooze", bodyOf(s), "Put back in the list."));
  const mergeHere = async (s: Step): Promise<string> => {
    try {
      const r = await api.post<{ message?: string }>("duplicates/merge", { ...bodyOf(s), keepContactId: keepId });
      return r.message ?? "Done.";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setToast({ text: "Copied. Paste it wherever you need it." }); setCopied(null); } catch { setCopied(text); }
  };

  // Keyboard: arrows move between groups; M starts the merge, N says not a duplicate, S skips. Not while typing in a box.
  const keys = useRef({ prev, next, merge: () => {}, not: () => {}, skip: next });
  useEffect(() => {
    keys.current = { prev, next, merge: () => { if (step && !decided) setSheetKey(step.key); }, not: () => { if (step && !decided && !busy) void notDuplicate(step); }, skip: next };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const k = keys.current;
      if (e.key === "ArrowLeft") { e.preventDefault(); k.prev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); k.next(); }
      // Single-letter keys only act while focus is inside the group on screen (WCAG 2.1.4), so they can never fire by accident elsewhere on the page.
      else if (!t?.closest("[data-testid='dup-step']")) return;
      else if (e.key === "m" || e.key === "M") k.merge();
      else if (e.key === "n" || e.key === "N") k.not();
      else if (e.key === "s" || e.key === "S") k.skip();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!data && loading) return <Page title="Duplicate contacts"><SkeletonCards cards={3} label="Looking for duplicate contacts..." /></Page>;
  if (!data) return <Page title="Duplicate contacts">{error ? <ErrorState error={error} onRetry={reload} /> : null}</Page>;
  const h = data.health;
  const clearFilters = () => { setQInput(""); setF({ ...START, all: f.all }); };

  const summary = [
    `Duplicate contacts: ${plural(h.groups, "group", "groups")} to fix, ${plural(h.extra, "extra contact", "extra contacts")}${h.shareLabel ? ` (${h.shareLabel})` : ""}.`,
    ...data.accounts.rows.map((a) => `- ${a.name ?? "Unnamed account"}: ${plural(a.groups, "group", "groups")}, ${plural(a.extra, "extra contact", "extra contacts")}`),
  ].join("\n");

  const menu = [
    { key: "copy", label: "Copy a summary", onSelect: () => void copy(summary) },
    ...(data.canExport ? [{ key: "csv", label: "Download the list (CSV)", onSelect: () => void api.download("export/duplicates", "subsync-duplicates.csv") }] : []),
  ];
  const filterWords = [
    f.status === "later" ? "groups set aside" : f.status === "decided" ? "groups already decided" : null,
    f.location ? (data.accounts.rows.find((a) => a.locationId === f.location)?.name ?? step?.locationName ?? "one client account") : null,
    f.reason ? REASON_LABELS[f.reason as keyof typeof REASON_LABELS] : null,
    f.q ? `"${f.q}"` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Page
      title="Duplicate contacts"
      subtitle="Contacts that look like the same person, one group at a time."
      actions={<PopMenu label="More" items={menu} testId="dup-more" triggerClassName={`${BTN} px-3`}><span>More</span></PopMenu>}
    >
      <HowTo id="duplicates-review" title="How this works">
        Each screen is one group of contacts that look like the same person. The best record to keep is already picked. Press Merge, finish in your CRM with one click, then say you did. Arrow keys move between groups.
      </HowTo>

      {error && <div className="mb-4"><ErrorState error={error} onRetry={reload} /></div>}
      {problem && <div className="mb-4"><InlineAlert tone="danger" onDismiss={() => setProblem(null)}>{problem}</InlineAlert></div>}
      {data.truncated && <div className="mb-4"><InlineAlert tone="warning">This list is capped for speed, so the biggest groups are shown first. Merge some and the rest appear.</InlineAlert></div>}

      <section className="mb-6" data-testid="dup-health" aria-label="Duplicates at a glance">
        <p className="text-3xl font-semibold tracking-tight" data-testid="dup-headline">
          {h.groups === 0 ? "No duplicates to merge" : `${plural(h.groups, "duplicate group", "duplicate groups")} to fix`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="dup-health-line">
          {h.groups === 0
            ? `We compared ${fmtInt(h.listSize)} contacts and none look like the same person.`
            : <>{plural(h.extra, "extra contact", "extra contacts")} to remove{h.shareLabel ? `, ${h.shareLabel}` : ""}. About 3 clicks each.</>}
          {data.counts.later > 0 && <> {plural(data.counts.later, "group", "groups")} set aside.</>}
        </p>
        {data.obvious > 0 && (
          <button type="button" className={`${BTN} mt-3`} aria-expanded={obvious} onClick={() => { setObvious(!obvious); setOPage(0); }} data-testid="dup-obvious-btn">
            Merge all the obvious ones ({fmtInt(data.obvious)})
          </button>
        )}
      </section>

      {obvious && (
        <section className="mb-8 border-y py-4" data-testid="dup-obvious-panel" aria-label="The obvious duplicates">
          <h2 className="text-base font-semibold">{plural(data.obvious, "obvious group", "obvious groups")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Same email and same phone number, nothing to warn about. This is a preview: merging many at once from here is switched off, so nothing is changed.</p>
          {obv.loading && !obv.data ? <p className="mt-3 text-sm text-muted-foreground">Loading...</p> : obv.error ? <div className="mt-3"><ErrorState error={obv.error} onRetry={obv.reload} /></div> : (
            <>
              <ul className="mt-2">
                {(obv.data?.rows ?? []).map((r) => (
                  <li key={r.locationId + r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5" data-testid="dup-obvious-row">
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium">Keep {r.keep.name}{r.keep.email ? `, ${r.keep.email}` : ""}</p>
                      <p className="truncate text-xs text-muted-foreground">Remove {r.remove.map((x) => x.name).join(", ")}{r.tagsAdded.length ? ` · adds tags ${r.tagsAdded.join(", ")}` : ""}{data.multi && r.locationName ? ` · ${r.locationName}` : ""}</p>
                    </div>
                    <RowButton onClick={() => { setObvious(false); focusGroup(r); }} label="Review" sr={`${r.keep.name}`} />
                  </li>
                ))}
              </ul>
              {(obv.data?.pages ?? 1) > 1 && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-xs text-muted-foreground">Showing {obv.data?.from} to {obv.data?.to} of {fmtInt(obv.data?.total ?? 0)}</span>
                  <span className="flex gap-2"><button type="button" className={BTN} disabled={oPage === 0} onClick={() => setOPage(oPage - 1)}>Previous</button><button type="button" className={BTN} disabled={oPage >= (obv.data?.pages ?? 1) - 1} onClick={() => setOPage(oPage + 1)}>Next</button></span>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {filtered && (
        <p className="mb-3 text-sm" data-testid="dup-filter-note">
          <span className="text-muted-foreground">Showing </span>{filterWords || "a filtered list"}
          <button type="button" className={`${QUIET} ml-1`} onClick={clearFilters} data-testid="dup-clear-filters">Show all</button>
        </p>
      )}

      {step && keepId ? (
        <section aria-label="The group to review" data-testid="dup-step" tabIndex={-1} className={`outline-none ${loading ? "opacity-70 transition-opacity" : "transition-opacity"}`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold outline-none" tabIndex={-1} data-testid="dup-step-count" aria-live="polite">Group {fmtInt(at + 1)} of {fmtInt(total)}</p>
              <p className="text-sm text-muted-foreground" data-testid="dup-reason">{step.reason.label}{data.multi && step.locationName ? ` · ${step.locationName}` : ""} · {step.likelihood.label}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={`${BTN} px-3`} onClick={prev} disabled={total < 2} aria-label="Previous group" aria-keyshortcuts="ArrowLeft" data-testid="dup-prev"><ChevronLeft aria-hidden className="size-5" /></button>
              <button type="button" className={`${BTN} px-3`} onClick={next} disabled={total < 2} aria-label="Next group" aria-keyshortcuts="ArrowRight" data-testid="dup-next"><ChevronRight aria-hidden className="size-5" /></button>
            </div>
          </div>

          {step.review && (
            <div className="mb-4"><InlineAlert tone="info" action={<button type="button" className={QUIET} disabled={busy} onClick={() => void putBack(step)} data-testid="dup-undo-decision">Undo</button>}>
              {step.review.kind === "not_duplicate" ? "You marked this as not a duplicate." : step.review.kind === "merged_in_platform" ? "You said this was merged in your CRM." : "You decided about this group."}
            </InlineAlert></div>
          )}
          {step.until && !step.review && (
            <div className="mb-4"><InlineAlert tone="info" action={<button type="button" className={QUIET} disabled={busy} onClick={() => void putBack(step)} data-testid="dup-unsnooze">Put back</button>}>
              Set aside until {new Date(step.until).toLocaleDateString("en-US", { day: "numeric", month: "short" })}.
            </InlineAlert></div>
          )}

          <ul className={`grid gap-x-6 gap-y-4 ${step.people.length >= 3 ? "md:grid-cols-3" : step.people.length === 2 ? "md:grid-cols-2" : ""}`} data-testid="dup-records">
            {step.people.map((p, i) => (
              <RecordCard key={p.contactId} p={p} i={i} keep={p.contactId === keepId} best={p.contactId === step.survivorId} locked={decided} onKeep={() => setChosen({ key: step.key, id: p.contactId })} />
            ))}
          </ul>

          <p className="mt-3 text-sm" data-testid="dup-why">
            {keepId === step.survivorId
              ? <><span className="font-medium">Best match picked: {step.people.find((p) => p.contactId === step.survivorId)?.name}.</span> <span className="text-muted-foreground">{step.why}.</span></>
              : <span className="text-muted-foreground">You chose {step.people.find((p) => p.contactId === keepId)?.name} instead of our pick ({step.people.find((p) => p.contactId === step.survivorId)?.name}).</span>}
          </p>
          {guardrails(step.people, keepId).length > 0 && !sheetOpen && !decided && <p className="mt-1 text-sm text-warning" data-testid="dup-careful">There is something to check before merging this one. You will see it next.</p>}

          {!decided && !sheetOpen && (
            <div className="mt-6" data-testid="dup-actions">
              <button type="button" className={PRIMARY} onClick={() => setSheetKey(step.key)} aria-keyshortcuts="m" data-testid="dup-merge">Merge these {step.people.length} contacts</button>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                <button type="button" className={QUIET} disabled={busy} onClick={() => void notDuplicate(step)} aria-keyshortcuts="n" data-testid="dup-not-dup">Not a duplicate</button>
                <button type="button" className={QUIET} disabled={busy} onClick={() => void notNow(step)} data-testid="dup-not-now">Not now</button>
                <button type="button" className={QUIET} disabled={total < 2} onClick={next} aria-keyshortcuts="s" data-testid="dup-skip">Skip</button>
              </div>
              <p className="mt-2 hidden text-xs text-muted-foreground md:block">Keys: the left and right arrows move between groups. With the group selected, M merges, N says not a duplicate and S skips.</p>
            </div>
          )}

          {sheetOpen && (
            <MergeSheet
              key={step.key + keepId}
              accountName={step.locationName} people={step.people} keepId={keepId} why={step.why} switchedOff={data.mergeSwitchedOff}
              onClose={() => setSheetKey(null)} onMerged={() => merged(step)} onMergeHere={() => mergeHere(step)} copy={copy}
            />
          )}
          <Compare people={step.people} watchingSince={step.watchingSince} />
          {copied && <textarea readOnly className="mt-3 h-40 w-full rounded-lg border bg-card p-2 font-mono text-xs" value={copied} aria-label="Summary to copy" onFocus={(e) => e.currentTarget.select()} />}
        </section>
      ) : (
        <EmptyState
          title={filtered ? "Nothing matches" : data.counts.later > 0 ? "Nothing left to review right now" : "No duplicates to merge"}
          body={filtered ? "No group fits what you picked." : data.counts.later > 0 ? "The groups you set aside come back after 7 days." : "No two contacts in your accounts look like the same person."}
          action={filtered ? <button type="button" className={BTN} onClick={clearFilters}>Show all groups</button> : undefined}
        />
      )}

      {data.upNext.length > 0 && !f.all && (
        <Section title="Up next" hint="The next groups, most important first." id="dup-next" className="mt-10">
          <ul data-testid="dup-up-next">{data.upNext.map((r) => <GroupRow key={r.locationId + r.key} row={r} multi={data.multi} onOpen={() => focusGroup(r)} />)}</ul>
        </Section>
      )}

      {(data.counts.open > 0 || data.counts.later > 0 || data.counts.decided > 0) && (
        <Section title="All groups" hint="Search, sort and open any group." id="dup-all" className={data.upNext.length > 0 && !f.all ? "mt-2" : "mt-10"}>
          {!f.all ? (
            <button type="button" className={BTN} onClick={() => patch({ all: true, page: 0 })} data-testid="dup-see-all">See all {fmtInt(data.selection.total)} {data.selection.total === 1 ? "group" : "groups"}</button>
          ) : (
            <div data-testid="dup-all-panel">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input type="search" className={searchClass} placeholder="Search a name, email or phone" aria-label="Search groups" value={qInput} onChange={(e) => setQInput(e.target.value)} data-testid="dup-search" />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Sort
                  <select className={selectClass} value={f.sort} onChange={(e) => patch({ sort: e.target.value, page: 0, i: 0, focus: null })} aria-label="Sort groups">
                    {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Kind
                  <select className={selectClass} value={f.reason} onChange={(e) => patch({ reason: e.target.value, page: 0, i: 0, focus: null })} aria-label="Kind of match">
                    <option value="">All ({fmtInt(data.counts.open)})</option>
                    {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v} ({fmtInt(data.byReason[k] ?? 0)})</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Show
                  <select className={selectClass} value={f.status} onChange={(e) => patch({ status: e.target.value as F["status"], page: 0, i: 0, focus: null })} aria-label="Which groups">
                    <option value="open">To do ({fmtInt(data.counts.open)})</option>
                    <option value="later">Set aside ({fmtInt(data.counts.later)})</option>
                    <option value="decided">Done ({fmtInt(data.counts.decided)})</option>
                  </select>
                </label>
              </div>
              {data.list.rows.length === 0 ? <p className="border-y py-6 text-center text-sm text-muted-foreground">No group fits that.</p> : (
                <ul data-testid="dup-list">{data.list.rows.map((r) => <GroupRow key={r.locationId + r.key} row={r} multi={data.multi} onOpen={() => focusGroup(r)} />)}</ul>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-xs text-muted-foreground" data-testid="dup-list-range">{data.list.total === 0 ? "" : `Showing ${fmtInt(data.list.from)} to ${fmtInt(data.list.to)} of ${fmtInt(data.list.total)}`}</span>
                <span className="flex gap-2">
                  <button type="button" className={BTN} disabled={data.list.page === 0} onClick={() => patch({ page: data.list.page - 1 })}>Previous</button>
                  <button type="button" className={BTN} disabled={data.list.page >= data.list.pages - 1} onClick={() => patch({ page: data.list.page + 1 })}>Next</button>
                  <button type="button" className={QUIET} onClick={() => patch({ all: false, page: 0 })}>Hide the list</button>
                </span>
              </div>
            </div>
          )}
        </Section>
      )}

      {data.multi && data.accounts.total > 1 && (
        <Section title="Clients with duplicates" hint="Pick one client to review only theirs." id="dup-clients" className="mt-8">
          {f.accAll && (
            <input type="search" className={`${searchClass} mb-2`} placeholder="Find a client" aria-label="Find a client" value={f.aq} onChange={(e) => patch({ aq: e.target.value, ap: 0 })} data-testid="dup-client-search" />
          )}
          <ul data-testid="dup-clients">
            {data.accounts.rows.map((a) => (
              <li key={a.locationId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{a.name ?? "Unnamed account"}</p><p className="truncate text-xs text-muted-foreground">{plural(a.groups, "group", "groups")} · {plural(a.extra, "extra contact", "extra contacts")}{a.openDeals > 0 ? ` · ${plural(a.openDeals, "open deal", "open deals")}` : ""}</p></div>
                <RowButton onClick={() => { setSheetKey(null); setQInput(""); setF({ ...START, location: a.locationId, all: f.all }); window.scrollTo?.({ top: 0, behavior: "smooth" }); }} label="Review" sr={`${a.name ?? "this client"}'s duplicates`} />
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            {!f.accAll
              ? <button type="button" className={BTN} onClick={() => patch({ accAll: true, ap: 0 })} data-testid="dup-clients-all">See all {fmtInt(data.accounts.total)} clients</button>
              : <><span className="text-xs text-muted-foreground">Showing {fmtInt(data.accounts.from)} to {fmtInt(data.accounts.to)} of {fmtInt(data.accounts.total)}</span>
                <span className="flex gap-2"><button type="button" className={BTN} disabled={data.accounts.page === 0} onClick={() => patch({ ap: data.accounts.page - 1 })}>Previous</button><button type="button" className={BTN} disabled={data.accounts.page >= data.accounts.pages - 1} onClick={() => patch({ ap: data.accounts.page + 1 })}>Next</button><button type="button" className={QUIET} onClick={() => patch({ accAll: false, ap: 0, aq: "" })}>Show fewer</button></span></>}
          </div>
        </Section>
      )}

      {data.protection.allowing > 0 && (
        <Section title="Stop new duplicates" id="dup-protect" className="mt-8" hint={`${plural(data.protection.allowing, "client account still lets", "client accounts still let")} duplicates be created.`}>
          <p className="text-sm text-muted-foreground">{data.protection.names.join(", ")}{data.protection.allowing > data.protection.names.length ? ` and ${data.protection.allowing - data.protection.names.length} more` : ""}. In your CRM, open the client account, go to Settings, Business Profile, and switch off &quot;Allow Duplicate Contact&quot;. Old duplicates stay until merged.</p>
        </Section>
      )}

      {toast && (
        <div role="status" data-testid="dup-toast" className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-[var(--shadow-lift)] sm:left-auto sm:max-w-sm">
          <span>{toast.text}</span>
          <span className="flex shrink-0 gap-1">
            {toast.undo && <button type="button" className={`${QUIET} font-medium text-foreground`} onClick={() => void toast.undo!().catch((e: Error) => setProblem(e.message))} data-testid="dup-undo">Undo</button>}
            <button type="button" className={QUIET} onClick={() => setToast(null)} aria-label="Close this message">Close</button>
          </span>
        </div>
      )}
    </Page>
  );
}
