"use client";

import { ChevronDown, Gauge, Inbox, UserX, MessageSquareWarning, PhoneCall, PhoneMissed, ScrollText, SlidersHorizontal, Users, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { summaryText } from "@/lib/analytics/speed-v2";
import { measuringSentence } from "@/lib/design/speed-text";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { EmptyState, ErrorState, HeadlineBlock, HowTo, InlineAlert, ModuleTabs, ActionRow, SkeletonRows, useCardRange, type MenuItem } from "../ds";
import { focusClient } from "../ds/global-filter";
import "./today-theme.css";
import { CaptureTab, PaceTab, PeopleTab } from "./speed-insights";
import { PrimaryButton } from "./today-chrome";
import { SourceCard } from "./speed-cards";
import { BookingCard } from "./speed5-ui";
import { LeadList } from "./speed-all";
import { FastSection, SlowSection, type CompareAccountRow, type ComparePersonRow, type OpenList, type PictureData } from "./speed-picture";
import { LeadRows, useLeadActions, waitWords, type LeadRow } from "./speed-rows";
import { FilterProvider } from "./speed-filter";
import { RaceTab } from "./speed-race";
import { CoverageTab, JourneyCard, RulesTab } from "./speed-coverage";
import { IgnoredTab } from "./speed-ignored";
import { DialMode } from "./dial-mode";
import { ColdCard } from "./ai-lead-cards";
import { InboxView } from "./inbox";
import { SidePopup, TipHost } from "./speed-popup";
import { Fold } from "./speed6-base";
import { Guide, GuideButton, PaceTab6, PeopleTab6, Tour } from "./speed6-ui";
import "./speed-ui.css";

// Speed to lead, rebuilt (docs/SPEED_REVIEW.md). One question: "who is waiting for a first reply, and what do I do first?". Top to bottom: one sentence, one button
// ("Reply to the oldest waiting lead"), a short list of the five leads to reply to now (See all opens the whole list, searched and paged on the server), how fast
// replies come, who is slow, and the rest behind "More detail". The leads waiting are the same people Today counts as new leads; every number opens exactly the
// leads it counts. SubSync measures replies and never sends one.

const CALL_SEEN = "subsync.speed.callSeen";
const ic = (I: typeof Zap) => <I aria-hidden className="size-4" />;

type Home = PictureData & {
  now: number; seePeople: boolean;
  access: { ok: number; needsPermission: Array<{ locationId: string; name: string }>; total: number };
  waiting: {
    waiting: number; clients: Array<{ locationId: string; name: string; count: number }>; money: { line: string; dollars: number; peopleWithDeals: number; deals: number }; never: number; noOwner: number; accountsWithWaiting: number; oldestMinutes: number | null;
    headline: { parts: Array<{ t: string; strong?: boolean }>; text: string; allClear: boolean };
    rows: LeadRow[]; cost: { line: string | null; formula: string; amount: number | null; leftOutAccounts: number };
  };
  compareAccounts: { total: number; rows: CompareAccountRow[] };
  comparePeople: { total: number; rows: ComparePersonRow[] };
  noSource: { n: number; total: number; share: number | null; actionable: boolean };
  leftOut: Array<{ reason: string; label: string; n: number }>;
  next: { key: string; text: string };
  measuring: { targetMinutes: number; countAutomated: boolean; businessHours: boolean; canChange: boolean };
  ignoredOn?: boolean;
  truncated: boolean;
};
type ListSpec = { title: string; params: Record<string, string>; noun?: string };

const MORE_TRIGGER = "ds-press inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";

/** The tabs the lead filters can change (Race, Pace, Coverage, People). Call mode, Capture, Rules and Log do not use them, so the control is not shown there. */
const FILTER_TABS = new Set(["race", "pace", "coverage", "people", "ignored"]);

export type SpeedTabId = "race" | "pace" | "coverage" | "ignored" | "unanswered" | "call" | "people" | "capture" | "rules" | "log";
/** The Unanswered tab: who is waiting right now. Race and Pace time how fast NEW leads get a first reply; this tab lists everyone waiting, so it sits next to Coverage (the other "who is not being answered" tab). */
const UNANSWERED_TIP = "Race and Pace measure how fast NEW leads get a first reply. This tab lists everyone who is waiting for a reply right now: new leads and existing customers.";

/** `unanswered` adds the Unanswered tab (the inbox feature is on and allowed for this person); `start` opens a tab first (the old Unanswered messages address). Without them the page is exactly as before. */
export function SpeedView({ go, unanswered = false, start }: { go: GoFn; unanswered?: boolean; start?: SpeedTabId }) {
  const range = useCardRange("speed", { preset: "30d", compare: "none" });
  const r = range.resolved;
  const path = r ? `speed?${new URLSearchParams({ part: "home", from: r.current.from, to: r.current.to, ...(r.compare ? { cmpFrom: r.compare.from, cmpTo: r.compare.to } : {}) })}` : null;
  const { data, error, loading, reload } = useData<Home>(path);
  const [list, setList] = useState<ListSpec | null>(null);
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);
  const [guide, setGuide] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const rows = data?.waiting.rows ?? [];
  const actions = useLeadActions(rows);
  const [tabId, setTabId] = useState<SpeedTabId>(() => { if (start === "unanswered" && !unanswered) return "race"; if (start) return start; try { return typeof window !== "undefined" && /[?&]tab=ignored(&|$)/.test(window.location.hash) ? "ignored" : "race"; } catch { return "race"; } });
  const [seenCall, setSeenCall] = useState(() => { try { return typeof window === "undefined" || window.localStorage.getItem(CALL_SEEN) === "1"; } catch { return true; } }); // until Call mode is opened once, its tab carries a "New" badge (remembered in this browser)
  const goTab = (id: SpeedTabId) => { setTabId(id); try { const h = window.location.hash; const [head, q = ""] = h.split("?"); const p = new URLSearchParams(q); if (id === "unanswered" || id === "ignored") p.set("tab", id); else p.delete("tab"); const s = p.toString(); window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${head || "#speed"}${s ? `?${s}` : ""}`); } catch { /* the address is a convenience */ } if (id === "call" && !seenCall) { setSeenCall(true); try { window.localStorage.setItem(CALL_SEEN, "1"); } catch { /* not remembered */ } } };

  if (error) return <div data-testid="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data || !r) return <div data-testid="page"><SkeletonRows rows={6} label="Timing first replies..." /></div>;

  const order: SpeedTabId[] = ["race", "pace", "coverage", ...(data.ignoredOn ? (["ignored"] as const) : []), ...(unanswered ? (["unanswered"] as const) : []), "call", "people", "capture", "rules", "log"];
  const d = data;
  const w = d.waiting;
  const multi = d.access.total > 1;
  const none = d.access.total > 0 && d.access.ok === 0;
  const empty = d.summary.judged === 0 && w.waiting === 0;
  const stale = loading && !(d.window.from === r.current.from && d.window.to === r.current.to);
  const open: OpenList = (spec) => setList(spec);
  const waitingList: ListSpec = { title: "Waiting for a reply", params: { status: "waiting" } };
  const oldest = rows[0];
  const slow = { people: d.comparePeople.rows, accounts: d.compareAccounts.rows, seePeople: d.seePeople, win: { from: d.window.from, to: d.window.to } };

  const copy = async () => {
    const text = summaryText({
      who: multi ? "All client accounts" : d.accounts[0]?.name ?? "Your account", headline: w.headline.text, typical: d.summary.typicalLine, cost: w.cost.line,
      waiting: rows.map((x) => ({ name: x.name, account: multi ? x.locationName : null, waited: waitWords(x).replace(/^Waiting /, ""), owner: x.owner ? `owner ${x.owner.label}` : "no owner" })),
      slow: d.compareAccounts.rows.filter((a) => a.ranked && a.hitRate !== null).slice(0, 3).map((a) => ({ name: a.name, line: `${Math.round((a.hitRate as number) * 100)}% answered in time, ${a.judged} leads` })),
    });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };
  const menu: MenuItem[] = [
    { key: "copy", label: copied ? "Copied to your clipboard" : "Copy a summary", onSelect: () => void copy() },
    { key: "print", label: "Print", onSelect: () => window.print() },
    ...(d.measuring.canChange ? [{ key: "settings", label: "Change the default reply target", onSelect: () => go("settings") }] : []),
    { key: "help", label: "How to use this page", onSelect: () => go("help") },
  ];

  return (
    <div data-testid="page" className="ds-enter s6" ref={top}>
      <Tour />{guide && <Guide onClose={() => setGuide(false)} />}
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 print:hidden">
        <div className="mr-auto min-w-0">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">Speed to lead</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground" data-testid="page-subtitle">How long new leads wait for a first reply. SubSync measures this; it never sends a reply.</p>
        </div>
        {d.measuring.canChange && <button type="button" className="ds-press inline-flex h-9 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4" onClick={() => goTab("rules")} data-testid="speed-reply-target">Reply target</button>}
        <GuideButton onClick={() => setGuide(true)} />
        <ActionRow items={menu} testId="speed-more" />
      </header>

      {d.access.needsPermission.length > 0 && (
        <InlineAlert tone="warning" className="mb-4">
          Needs permission: reconnect. {d.access.needsPermission.length === d.access.total ? "No account has" : `${d.access.needsPermission.length} of ${d.access.total} ${d.access.needsPermission.length === 1 ? "account has" : "accounts have"} not`} approved reading conversations
          ({d.access.needsPermission.slice(0, 3).map((a) => a.name).join(", ")}{d.access.needsPermission.length > 3 ? " and more" : ""}), so they are left out.
        </InlineAlert>
      )}

      {none || empty ? (
        <EmptyState title={none ? "Waiting for permission" : "No new leads yet"} body={none ? "Approve the new permission when SubSync asks, then run a sync. First replies appear here after that." : "A lead appears here once a new contact has a conversation. Check back after the next sync."}
          action={<button type="button" onClick={() => go("help")} className="ds-press h-10 rounded-lg border bg-card px-4 text-sm font-medium hover:border-primary/40">Open Getting started</button>} />
      ) : (
        <FilterProvider range={r ? { from: r.current.from, to: r.current.to, label: r.current.label, sentence: r.sentence } : null}>{(bar) => (<>{FILTER_TABS.has(tabId) && bar}<TipHost /><ModuleTabs pill label="Speed to lead sections" value={Math.max(0, order.indexOf(tabId))} onChange={(n) => goTab(order[n])} tabs={[
          { label: "Race", icon: ic(Zap), node: <RaceTab multi={multi} onCall={() => goTab("call")} /> },
          { label: "Pace", icon: ic(Gauge), node: <PaceTab6 multi={multi} slow={slow} old={<><SourceCard showAccount={multi} /><JourneyCard multi={multi} /><BookingCard /><PaceTab multi={multi} /></>} /> },
          { label: "Coverage", icon: ic(PhoneMissed), node: <Fold keep={3} testId="coverage-fold"><CoverageTab multi={multi} /></Fold> },
          ...(d.ignoredOn ? [{ label: "Waiting on the client", tip: "Client accounts that are not answering the leads sent to them: leads nobody answered, customers who got no reply, and missed calls nobody returned.", icon: ic(UserX), node: <IgnoredTab multi={multi} /> }] : []),
          ...(unanswered ? [{ label: "Unanswered", tip: UNANSWERED_TIP, icon: ic(MessageSquareWarning), node: <InboxView go={go} embedded={{ onRace: () => goTab("race") }} /> }] : []),
          { label: "Call mode", icon: ic(PhoneCall), badge: seenCall ? undefined : <span className="spd-new rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold uppercase leading-none tracking-wide" data-testid="call-new">New</span>, node: <DialMode /> },
          ...(d.seePeople ? [{ label: "People", icon: ic(Users), node: <PeopleTab6 multi={multi} slow={slow} old={<PeopleTab multi={multi} />} /> }] : [{ label: "Owners", icon: ic(Users), node: <PeopleTab6 multi={multi} slow={slow} old={<PeopleTab multi={multi} />} /> }]),
          { label: "Capture", icon: ic(Inbox), node: <Fold keep={3} testId="capture-fold"><CaptureTab /></Fold> },
          { label: "Rules", icon: ic(SlidersHorizontal), node: <RulesTab who={multi ? "All client accounts" : d.accounts[0]?.name ?? "Your account"} waiting={w.waiting} dollars={w.money.dollars || null} typical={d.summary.typicalLine} canChange={d.measuring.canChange} targetMinutes={d.measuring.targetMinutes} go={go} multi={multi} seePeople={d.seePeople} accounts={d.compareAccounts.rows.map((a) => ({ id: a.id, name: a.name }))} /> },
          { label: "Log", icon: ic(ScrollText), node: (
        <Fold keep={3} testId="log-fold">
          <HowTo id="speed2" title="How to use this page">Reply to the lead at the top, then the next. Every number opens the leads behind it, and a lead&apos;s three dots call or email it through your CRM.</HowTo>

          <HeadlineBlock headline={{ ...w.headline, breakdown: null, accounts: w.accountsWithWaiting, dollars: w.cost.amount ?? 0 } as never}
            action={oldest ? <PrimaryButton p={{ label: "Reply to the oldest waiting lead", sr: `${oldest.name}, the longest wait`, onClick: () => actions.reply(oldest) }} /> : undefined}>
            {w.waiting > 0 && (
              <div className="mt-3 max-w-3xl space-y-2" data-testid="speed-money-block">
                <p className="text-[0.95rem] font-medium" data-testid="speed-money">{w.money.line}</p>
                {w.clients.length > 1 && (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-testid="speed-clients">
                    <span>Clients with people waiting:</span>
                    {w.clients.slice(0, 8).map((c) => <button key={c.locationId} type="button" onClick={() => focusClient(c.locationId)} className="min-h-9 rounded-md border bg-card px-2.5 text-foreground hover:border-primary/40" aria-label={`Only ${c.name}, ${c.count} waiting`}>{c.name} ({c.count})</button>)}
                    {w.clients.length > 8 && <span>and {w.clients.length - 8} more: pick them in the filter above.</span>}
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="speed-proof">
              {d.summary.typicalLine}{w.cost.line ? <> <span className="font-medium text-foreground" data-testid="speed-cost">{w.cost.line}</span></> : null}
              {w.cost.line && <details className="mt-1 inline-block align-top"><summary className="ds-press min-h-9 cursor-pointer list-none px-1 font-medium text-primary underline underline-offset-4" data-testid="cost-formula-toggle">How this is worked out</summary><span className="block max-w-xl pt-1" data-testid="cost-formula">{w.cost.formula}</span></details>}
            </div>
            {w.waiting === 0 && <p className="mt-2 text-sm" data-testid="speed-next"><span className="font-medium">Next best step.</span> {d.next.text}</p>}
          </HeadlineBlock>

          <div className={stale ? "opacity-70" : ""} aria-busy={stale}>
            {list && (
              <SidePopup label={list.title} onClose={() => setList(null)}>
                <LeadList key={JSON.stringify(list.params)} title={list.title} params={list.params} showAccount={multi} canMine noun={list.noun} onBack={() => setList(null)} backLabel="Close" />
              </SidePopup>
            )}
            {w.waiting > 0 && (
              <section className="mb-10" aria-label="Reply now" data-testid="reply-now">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight">Reply now</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground" data-testid="reply-summary">Longest wait first.{w.noOwner > 0 ? ` ${w.noOwner.toLocaleString("en-US")} ${w.noOwner === 1 ? "has" : "have"} no owner.` : ""}</p>
                  </div>
                  {w.waiting > rows.length && <button type="button" onClick={() => open(waitingList)} className="ds-press min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline sm:min-h-9" data-testid="reply-all">See all {w.waiting.toLocaleString("en-US")}</button>}
                </div>
                <LeadRows rows={rows} showAccount={multi} actions={actions} testId="reply-rows" />
                {actions.drawer}
              </section>
            )}

            <FastSection d={d} range={range} open={open} showAccount={multi} reload={reload} />
            <SlowSection d={d} accounts={d.compareAccounts} people={d.comparePeople} seePeople={d.seePeople} multi={multi} open={open} reload={reload} />
            <ColdCard />
          </div>

          <section className="mb-4 border-t pt-4 print:hidden" aria-label="More detail" data-testid="speed-more-detail">
            <button type="button" onClick={() => setMore(!more)} aria-expanded={more} data-testid="speed-more-toggle"
              className="ds-press inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
              More detail<ChevronDown aria-hidden className={`size-4 transition-transform ${more ? "rotate-180" : ""}`} />
            </button>
            {more && (
              <div className="mt-3">
                {d.leftOut.length > 0 && <p className="mt-4 text-xs text-muted-foreground" data-testid="left-out">{d.leftOut.reduce((s, x) => s + x.n, 0).toLocaleString("en-US")} new contacts in this range were not counted as leads: {d.leftOut.map((x) => `${x.n.toLocaleString("en-US")} ${x.label}`).join(", ")}.</p>}
              </div>
            )}
          </section>

          <p className="mb-2 text-xs text-muted-foreground" data-testid="measuring">
            {measuringSentence(d.measuring)} A lead is a new contact with a conversation. The clock starts when the contact is created or the first message arrives, and stops at the first message or call a person placed from your CRM.{" "}
            {d.measuring.canChange ? <button type="button" onClick={() => go("settings")} className="font-medium text-primary underline" data-testid="speed-settings-link">Change the reply target, or switch on &quot;Count automatic messages as a reply&quot;, in Settings</button> : "Ask the person who manages your account to change these."}
            {d.truncated ? " This range holds more leads than SubSync reads at once; the newest 20,000 are used." : ""}
          </p>
        </Fold>
          ) },
        ]} /></>)}</FilterProvider>
      )}
    </div>
  );
}
