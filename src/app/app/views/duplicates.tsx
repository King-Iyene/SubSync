"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { diffFields, guardrails, REASON_LABELS, SORT_LABELS } from "@/lib/analytics/dedupe-review";
import type { FieldPick } from "@/lib/analytics/cleanup-rules";
import { EmptyState, ErrorState, HowTo, InlineAlert, Page, PopMenu, RowButton, Section, SkeletonCards } from "../ds";
import { ArrivalsCard, MatchWhy, PersonCard, type Pair, type Workflow } from "./duplicates-extra";
import { MatchMeter, ProgressBar } from "./cleanup-parts";
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
  rules: { preset: string; sentence: string; source: string }; reasons: string[]; pairs: Pair[]; picks: FieldPick[]; workflow: Workflow;
};
type Paged<T> = { rows: T[]; page: number; pages: number; total: number; from: number; to: number };
type Account = { locationId: string; name: string | null; groups: number; contacts: number; extra: number; openDeals: number };
type Data = {
  sure: number;
  health: { groups: number; contacts: number; extra: number; listSize: number; shareLabel: string };
  byReason: Record<string, number>; obvious: number; truncated: boolean; multi: boolean; status: "open" | "decided" | "later";
  counts: { open: number; maybe: number; later: number; decided: number }; protection: { allowing: number; names: string[] }; canExport: boolean; mergeSwitchedOff: boolean;
  accounts: Paged<Account>; selection: { total: number; i: number; status: string; q: string; reason: string | null; location: string | null; sort: string };
  list: Paged<Row>; upNext: Row[]; step: Step | null;
};
type ObviousRow = { key: string; locationId: string; locationName: string | null; keep: { name: string; email: string | null; phone: string | null }; remove: Array<{ name: string; email: string | null; phone: string | null }>; tagsAdded: string[] };
type ObviousData = Paged<ObviousRow> & { switchedOff: boolean };

type F = { status: "open" | "decided" | "later" | "maybe"; q: string; reason: string; location: string; sort: string; page: number; i: number; focus: string | null; all: boolean; ap: number; aq: string; accAll: boolean };
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

export function DuplicatesView({ embedded = false }: { embedded?: boolean } = {}) {
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
  // Fast review: yes, no or later with one key (Y, N, L) or one swipe. The count is only for the progress bar of this visit.
  const [fast, setFast] = useState(false);
  const [doneNow, setDoneNow] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
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
      if (!path.includes("undo") && !path.includes("unsnooze")) setDoneNow((n) => n + 1);
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
  // Start the merge through the customer's own merge workflow (the gateway checks the opt-in, the confirm, the guardrails and the master switch).
  const mergeInCrm = async (s: Step): Promise<string> => {
    try {
      const r = await api.post<{ message?: string; requested?: boolean }>("duplicates/merge-workflow", { ...bodyOf(s), keepContactId: keepId, confirm: true });
      if (r.requested) void reload();
      return r.message ?? "Done.";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setToast({ text: "Copied. Paste it wherever you need it." }); setCopied(null); } catch { setCopied(text); }
  };

  // Keyboard: arrows move between groups; M starts the merge, N says not a duplicate, S skips. Not while typing in a box.
  const keys = useRef({ prev, next, merge: () => {}, not: () => {}, skip: next, later: () => {}, fast: false });
  useEffect(() => {
    keys.current = { prev, next, merge: () => { if (step && !decided) setSheetKey(step.key); }, not: () => { if (step && !decided && !busy) void notDuplicate(step); }, skip: next, later: () => { if (step && !decided && !busy) void notNow(step); }, fast };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const k = keys.current;
      if (e.key === "ArrowLeft") { e.preventDefault(); k.prev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); k.next(); }
      // Single-letter keys only act while focus is inside the group on screen (WCAG 2.1.4), so they can never fire by accident elsewhere on the page.
      // Fast review is the person's own choice to use them anywhere (it is a switch they turned on, and it can be turned off).
      else if (!k.fast && !t?.closest("[data-testid='dup-step']")) return;
      else if (k.fast && (e.key === "y" || e.key === "Y")) k.merge();
      else if (k.fast && (e.key === "l" || e.key === "L")) k.later();
      else if (e.key === "m" || e.key === "M") k.merge();
      else if (e.key === "n" || e.key === "N") k.not();
      else if (e.key === "s" || e.key === "S") k.skip();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // A function, not a component: a component defined here would be a new type on every render and would reset everything inside it.
  const shell = (actions: React.ReactNode, children: React.ReactNode) => (embedded
    ? <div data-testid="dup-embedded">{actions && <div className="mb-4 flex justify-end">{actions}</div>}{children}</div>
    : <Page title="Duplicate contacts" subtitle="Contacts that look like the same person, one group at a time." actions={actions}>{children}</Page>);
  if (!data && loading) return shell(null, <SkeletonCards cards={3} label="Looking for duplicate contacts..." />);
  if (!data) return shell(null, error ? <ErrorState error={error} onRetry={reload} /> : null);
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
    f.status === "maybe" ? "maybe the same person" : f.status === "later" ? "groups set aside" : f.status === "decided" ? "groups already decided" : null,
    f.location ? (data.accounts.rows.find((a) => a.locationId === f.location)?.name ?? step?.locationName ?? "one client account") : null,
    f.reason ? REASON_LABELS[f.reason as keyof typeof REASON_LABELS] : null,
    f.q ? `"${f.q}"` : null,
  ].filter(Boolean).join(" · ");

  return shell(
    <PopMenu label="More" items={menu} testId="dup-more" triggerClassName={`${BTN} px-3`}><span>More</span></PopMenu>,
    <>
      <HowTo id="duplicates-review" title="How this works">
        Each screen is one group of contacts that look like the same person. The best record to keep is already picked. Press Merge, finish in your CRM with one click, then say you did. Arrow keys move between groups.
      </HowTo>

      {error && <div className="mb-4"><ErrorState error={error} onRetry={reload} /></div>}
      {problem && <div className="mb-4"><InlineAlert tone="danger" onDismiss={() => setProblem(null)}>{problem}</InlineAlert></div>}
      {data.truncated && <div className="mb-4"><InlineAlert tone="warning">This list is capped for speed, so the biggest groups are shown first. Merge some and the rest appear.</InlineAlert></div>}

      <ArrivalsCard multi={data.multi} />

      <section className="mb-6" data-testid="dup-health" aria-label="Duplicates at a glance">
        <p className="text-3xl font-semibold tracking-tight" data-testid="dup-headline">
          {h.groups === 0 ? "All clean. Nobody appears twice." : `${fmtInt(h.groups)} ${h.groups === 1 ? "person appears" : "people appear"} more than once`}
        </p>
        <p className="mt-1 text-base text-muted-foreground" data-testid="dup-health-line">
          {h.groups === 0
            ? `We compared ${fmtInt(h.listSize)} contacts and no one is there twice.`
            : <>{fmtInt(data.sure)} {data.sure === 1 ? "is a sure match" : "are sure matches"}. Clean them all in about {Math.max(1, Math.ceil(h.groups / 3))} {Math.ceil(h.groups / 3) <= 1 ? "minute" : "minutes"}.</>}
          {data.counts.later > 0 && <> {plural(data.counts.later, "match", "matches")} set aside for later.</>}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {data.obvious > 0 && (
            <button type="button" className={BTN} aria-expanded={obvious} onClick={() => { setObvious(!obvious); setOPage(0); }} data-testid="dup-obvious-btn">
              Combine all the sure ones ({fmtInt(data.obvious)})
            </button>
          )}
          {h.groups > 0 && <button type="button" className={BTN} aria-pressed={fast} onClick={() => setFast(!fast)} data-testid="dup-fast">{fast ? "Fast review is on" : "Fast review"}</button>}
        </div>
        {fast && <p className="mt-2 text-sm text-muted-foreground" data-testid="dup-fast-hint">Press Y for yes, N for no, L for later. On a phone, swipe right for yes, left for no, up for later.</p>}
        {(doneNow > 0 || fast) && h.groups + doneNow > 0 && <div className="mt-3 max-w-md"><ProgressBar done={doneNow} total={doneNow + h.groups} label={`${fmtInt(doneNow)} done, ${fmtInt(h.groups)} to go`} /></div>}
      </section>

      {obvious && (
        <section className="mb-8 border-y py-4" data-testid="dup-obvious-panel" aria-label="The obvious duplicates">
          <h2 className="text-base font-semibold">{plural(data.obvious, "obvious group", "obvious groups")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Same email and same phone number, nothing to warn about. This is a preview: nothing is combined until you say so, one at a time.</p>
          {obv.loading && !obv.data ? <p className="mt-3 text-sm text-muted-foreground">Loading...</p> : obv.error ? <div className="mt-3"><ErrorState error={obv.error} onRetry={obv.reload} /></div> : (
            <>
              <ul className="mt-2">
                {(obv.data?.rows ?? []).map((r) => (
                  <li key={r.locationId + r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5" data-testid="dup-obvious-row">
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium">Keep {r.keep.name}{r.keep.email ? `, ${r.keep.email}` : ""}</p>
                      <p className="truncate text-sm text-muted-foreground">Remove {r.remove.map((x) => x.name).join(", ")}{r.tagsAdded.length ? ` · adds tags ${r.tagsAdded.join(", ")}` : ""}{data.multi && r.locationName ? ` · ${r.locationName}` : ""}</p>
                    </div>
                    <RowButton onClick={() => { setObvious(false); focusGroup(r); }} label="Review" sr={`${r.keep.name}`} />
                  </li>
                ))}
              </ul>
              {(obv.data?.pages ?? 1) > 1 && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-sm text-muted-foreground">Showing {obv.data?.from} to {obv.data?.to} of {fmtInt(obv.data?.total ?? 0)}</span>
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
        <section aria-label="The group to review" data-testid="dup-step" tabIndex={-1} className={`outline-none ${loading ? "opacity-70 transition-opacity" : "transition-opacity"}`}
          onTouchStart={(e) => { if (fast) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            const t0 = touch.current; touch.current = null;
            if (!fast || !t0 || decided || busy) return;
            const dx = e.changedTouches[0].clientX - t0.x; const dy = e.changedTouches[0].clientY - t0.y;
            if (Math.abs(dx) > Math.abs(dy) && dx > 90) setSheetKey(step.key);
            else if (Math.abs(dx) > Math.abs(dy) && dx < -90) void notDuplicate(step);
            else if (dy < -90) void notNow(step);
          }}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight" data-testid="dup-question">Are these the same person?</h2>
              <p className="mt-0.5 text-sm text-muted-foreground outline-none" tabIndex={-1} data-testid="dup-step-count" aria-live="polite">Match {fmtInt(at + 1)} of {fmtInt(total)}{data.multi && step.locationName ? ` · ${step.locationName}` : ""}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={`${BTN} px-3`} onClick={prev} disabled={total < 2} aria-label="Previous match" aria-keyshortcuts="ArrowLeft" data-testid="dup-prev"><ChevronLeft aria-hidden className="size-5" /></button>
              <button type="button" className={`${BTN} px-3`} onClick={next} disabled={total < 2} aria-label="Next match" aria-keyshortcuts="ArrowRight" data-testid="dup-next"><ChevronRight aria-hidden className="size-5" /></button>
            </div>
          </div>

          <MatchMeter confidence={step.confidence} word={step.likelihood.label} reason={step.reason.label} />

          {step.review && (
            <div className="mt-4"><InlineAlert tone="info" action={<button type="button" className={QUIET} disabled={busy} onClick={() => void putBack(step)} data-testid="dup-undo-decision">Undo</button>}>
              {step.review.kind === "not_duplicate" ? "You said these are different people." : step.review.kind === "merged_in_platform" ? "You said these were combined in your CRM." : "You decided about this match."}
            </InlineAlert></div>
          )}
          {step.until && !step.review && (
            <div className="mt-4"><InlineAlert tone="info" action={<button type="button" className={QUIET} disabled={busy} onClick={() => void putBack(step)} data-testid="dup-unsnooze">Put back</button>}>
              Set aside until {new Date(step.until).toLocaleDateString("en-US", { day: "numeric", month: "short" })}.
            </InlineAlert></div>
          )}

          {(() => {
            const d = diffFields(step.people);
            const differ = new Set(d.differ.map((r) => r.id));
            return (
              <>
                <ul className={`mt-4 grid gap-4 ${step.people.length >= 3 ? "md:grid-cols-3" : step.people.length === 2 ? "md:grid-cols-2" : ""}`} data-testid="dup-records">
                  {step.people.map((p, i) => <PersonCard key={p.contactId} p={p} i={i} keep={p.contactId === keepId} best={p.contactId === step.survivorId} locked={decided} differ={differ} onKeep={() => setChosen({ key: step.key, id: p.contactId })} />)}
                </ul>
                {d.same.length > 0 && <p className="mt-2 text-sm text-muted-foreground" data-testid="dup-same-line">The same on both: {d.same.map((r) => r.label.toLowerCase()).join(", ")}.</p>}
              </>
            );
          })()}

          {guardrails(step.people, keepId).length > 0 && !sheetOpen && !decided && <p className="mt-3 text-sm text-warning" data-testid="dup-careful">One thing to check first: {guardrails(step.people, keepId)[0].text}</p>}

          {!decided && !sheetOpen && (
            <div className="mt-5" data-testid="dup-actions">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className={`${PRIMARY} sm:min-w-56`} onClick={() => setSheetKey(step.key)} aria-keyshortcuts="m y" data-testid="dup-merge">Yes, combine them</button>
                <button type="button" className={`${BTN} min-h-12 sm:min-w-48`} disabled={busy} onClick={() => void notDuplicate(step)} aria-keyshortcuts="n" data-testid="dup-not-dup">No, different people</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                <button type="button" className={QUIET} disabled={busy} onClick={() => void notNow(step)} aria-keyshortcuts="l" data-testid="dup-not-now">Decide later</button>
                <button type="button" className={QUIET} disabled={total < 2} onClick={next} aria-keyshortcuts="s" data-testid="dup-skip">Skip</button>
              </div>
            </div>
          )}

          {sheetOpen && (
            <MergeSheet
              key={step.key + keepId}
              accountName={step.locationName} people={step.people} keepId={keepId} why={step.why} switchedOff={data.mergeSwitchedOff}
              onClose={() => setSheetKey(null)} onMerged={() => merged(step)} copy={copy}
              picks={step.picks} workflow={step.workflow} onWorkflowMerge={() => mergeInCrm(step)}
            />
          )}

          <details className="mt-6 border-t pt-3" data-testid="dup-how">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">How we decided</summary>
            <p className="mt-1 text-sm" data-testid="dup-why">
              {keepId === step.survivorId
                ? <><span className="font-medium">Best one to keep: {step.people.find((p) => p.contactId === step.survivorId)?.name}.</span> <span className="text-muted-foreground">{step.why}.</span></>
                : <span className="text-muted-foreground">You chose {step.people.find((p) => p.contactId === keepId)?.name} instead of our pick ({step.people.find((p) => p.contactId === step.survivorId)?.name}).</span>}
            </p>
            <MatchWhy confidence={step.confidence} likelihood={step.likelihood.label} reasons={step.reasons} pairs={step.pairs} people={step.people} rules={step.rules} />
            <Compare people={step.people} watchingSince={step.watchingSince} />
          </details>
          {copied && <textarea readOnly className="mt-3 h-40 w-full rounded-lg border bg-card p-2 font-mono text-sm" value={copied} aria-label="Summary to copy" onFocus={(e) => e.currentTarget.select()} />}
        </section>
      ) : (
        <div className="text-center" data-testid="dup-celebrate">{!filtered && data.counts.later === 0 && <p aria-hidden="true" className="ds-pop mx-auto mb-1 text-5xl text-success">&#10003;</p>}
        <EmptyState
          title={filtered ? "Nothing matches" : data.counts.later > 0 ? "Nothing left to decide right now" : "All clean. Nice work."}
          body={filtered ? "No match fits what you picked." : data.counts.later > 0 ? "The ones you set aside come back in 7 days." : doneNow > 0 ? `You sorted out ${fmtInt(doneNow)} just now. Nobody in your contacts appears twice.` : "Nobody in your contacts appears twice."}
          action={filtered ? <button type="button" className={BTN} onClick={clearFilters}>Show everything</button> : undefined}
        /></div>
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
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">Sort
                  <select className={selectClass} value={f.sort} onChange={(e) => patch({ sort: e.target.value, page: 0, i: 0, focus: null })} aria-label="Sort groups">
                    {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">Kind
                  <select className={selectClass} value={f.reason} onChange={(e) => patch({ reason: e.target.value, page: 0, i: 0, focus: null })} aria-label="Kind of match">
                    <option value="">All ({fmtInt(data.counts.open)})</option>
                    {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v} ({fmtInt(data.byReason[k] ?? 0)})</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">Show
                  <select className={selectClass} value={f.status} onChange={(e) => patch({ status: e.target.value as F["status"], page: 0, i: 0, focus: null })} aria-label="Which groups">
                    <option value="open">To do ({fmtInt(data.counts.open)})</option>
                    <option value="maybe">Maybe the same person ({fmtInt(data.counts.maybe)})</option>
                    <option value="later">Set aside ({fmtInt(data.counts.later)})</option>
                    <option value="decided">Done ({fmtInt(data.counts.decided)})</option>
                  </select>
                </label>
              </div>
              {data.list.rows.length === 0 ? <p className="border-y py-6 text-center text-sm text-muted-foreground">No group fits that.</p> : (
                <ul data-testid="dup-list">{data.list.rows.map((r) => <GroupRow key={r.locationId + r.key} row={r} multi={data.multi} onOpen={() => focusGroup(r)} />)}</ul>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-sm text-muted-foreground" data-testid="dup-list-range">{data.list.total === 0 ? "" : `Showing ${fmtInt(data.list.from)} to ${fmtInt(data.list.to)} of ${fmtInt(data.list.total)}`}</span>
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
                <div className="min-w-0"><p className="truncate text-sm font-medium">{a.name ?? "Unnamed account"}</p><p className="truncate text-sm text-muted-foreground">{plural(a.groups, "group", "groups")} · {plural(a.extra, "extra contact", "extra contacts")}{a.openDeals > 0 ? ` · ${plural(a.openDeals, "open deal", "open deals")}` : ""}</p></div>
                <RowButton onClick={() => { setSheetKey(null); setQInput(""); setF({ ...START, location: a.locationId, all: f.all }); window.scrollTo?.({ top: 0, behavior: "smooth" }); }} label="Review" sr={`${a.name ?? "this client"}'s duplicates`} />
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            {!f.accAll
              ? <button type="button" className={BTN} onClick={() => patch({ accAll: true, ap: 0 })} data-testid="dup-clients-all">See all {fmtInt(data.accounts.total)} clients</button>
              : <><span className="text-sm text-muted-foreground">Showing {fmtInt(data.accounts.from)} to {fmtInt(data.accounts.to)} of {fmtInt(data.accounts.total)}</span>
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
    </>,
  );
}
