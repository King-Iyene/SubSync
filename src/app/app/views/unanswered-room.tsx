"use client";

import { CheckCircle2, ChevronDown, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { shortWords, summaryText } from "@/lib/analytics/unanswered-v2";
import { useApiClient, useData } from "../session";
import type { GoFn } from "../nav";
import { EmptyState, ErrorState, InlineAlert, PopMenu, SkeletonRows, type MenuItem } from "../ds";
import "./today-theme.css";
import { CountUp, Q } from "./speed6-base";
import { TipHost } from "./speed-popup";
import { FindBox } from "./unanswered-find";
import { UnansweredList, type AccountChoice, type OwnerChoice } from "./unanswered-list";
import { ReplayCard, WaitColumns, WhereChart, type OwnerRank, type Paged, type Rank } from "./unanswered-charts";
import { usePersonActions, type WaitRow } from "./unanswered-rows";
import { CARD_SLOTS, RoomProvider, Slot, hasUnansweredSlot, useSlotsVersion, type Flags, type SlotName, type UiRow } from "./unanswered-slots";
import { DEFAULT_CHOICES, isNarrowed, useChoices, type Choices } from "./unanswered-state";
import "./speed6.css";
import "./unanswered-ui.css";
import "./unanswered-slots-mount";

// Unanswered messages, control-room style (the Speed to lead standard): one question ("who do I answer first?"), the numbers that open exactly their people, a fold of three
// cards with the rest behind More, and a list that is searched, filtered and paged on the database. Behind the flag inbox_control_room; the older screen is untouched. Other slices
// mount their pieces through the slots of unanswered-slots.tsx. SubSync shows who is waiting and never sends a reply.

export type UiPayload = { flags: Flags; seePeople: boolean; kind: string; me: string | null };
type Bucket = { key: string; label: string; count: number };
type Home = {
  now: number; slaHours: number; windowDays: number; multi: boolean; accountCount: number; seePeople: boolean; kind: string; canRecordOutcome: boolean;
  waiting: {
    people: number; clients: Array<{ locationId: string; name: string; count: number }>; money: { line: string; dollars: number }; conversations: number; accounts: number; oldestHours: number | null; noOwner: number; newLeads: number; over24: number; breach: string | null;
    headline: { parts: Array<{ t: string; strong?: boolean }>; text: string; allClear: boolean }; meaning: string; rows: WaitRow[]; cost: { line: string | null; formula: string; amount: number | null };
  };
  today?: { count: number; people: number; newLeadsOnly: number; newLeadsAmongThem: number; partial: boolean } | null;
  buckets: Bucket[]; mine: number; next: { key: string; text: string }; readLimit: string | null; truncated: boolean; conversationsRead: number;
  accounts: { total: number; rows: Array<{ id: string; name: string; count: number; oldestHours: number }> } | null;
};

/** The sub-sections of the tab inside Speed to lead: one queue, and the rest one tap away with room each. */
type Section = "queue" | "them" | "trends" | "people" | "proof" | "rules";
const SECTION_LABEL: Record<Section, string> = { queue: "Queue", them: "Waiting on them", trends: "Trends", people: "People", proof: "Proof", rules: "Rules" };
const SECTION_TIP: Record<Section, string> = {
  queue: "Everyone waiting for a reply, longest wait first. Press a person to open them.", them: "People you wrote to who have gone quiet.", trends: "How long people wait, where, and how the waiting built up.",
  people: "Who has the waiting people, and how each team member is doing.", proof: "What was caught and answered: receipts, the verified page and how you compare.", rules: "The reply target and what is left out of this list.",
};
const PROOF_SLOTS: readonly SlotName[] = ["ReceiptCard", "VerifiedPageCard", "BenchmarkCard"];

const person = (c: number) => (c === 1 ? "person" : "people");

/** `embedded` is the tab inside Speed to lead: no page heading (the page has one), the Everyone | New leads | Existing customers switch, the scope line, and "Open Race" in place of a link to the page it is already in. */
export type Embedded = { onRace: () => void };

export function UnansweredRoom({ go, ui, embedded }: { go: GoFn; ui: UiPayload; embedded?: Embedded }) {
  const api = useApiClient();
  const { data, error, reload } = useData<Home>("inbox?part=home");
  const choiceState = useChoices(ui.seePeople, ui.flags.inbox_filters === true || ui.flags.inbox_views === true);
  const { choices, page, setPage, set, reset } = choiceState;
  const [tabs, setTabs] = useState<{ us: number; them: number } | null>(null);
  const [more, setMore] = useState(false);
  const [section, setSection] = useState<Section>("queue");
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useSlotsVersion();

  const multi = data?.multi ?? false;
  const seePeople = ui.seePeople;
  // clients (for an agency) and owners (for staff who may see colleagues): the busiest 100, for the filter and the chart; one read each, only the one that is needed
  const ranksAccount = useData<Paged<Rank & OwnerRank>>(multi ? "inbox?part=ranks&by=account&size=100" : null);
  const ranksOwner = useData<Paged<Rank & OwnerRank>>(seePeople ? "inbox?part=ranks&by=owner&size=100" : null);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector("[role=dialog]")) reload(); }, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const heroRows = (data?.waiting.rows ?? []) as UiRow[];
  const heroActions = usePersonActions(heroRows, data?.canRecordOutcome === true);
  const onTabs = useCallback((t: { us: number; them: number } | null) => setTabs(t), []);
  const onRows = useCallback(() => undefined, []);

  if (error) return <div data-testid="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div data-testid="page" className="s6 ur"><SkeletonRows rows={6} label="Reading your conversations..." /></div>;

  const d = data;
  const w = d.waiting;
  const none = d.conversationsRead === 0;
  const oldest = heroRows[0];
  const accounts: AccountChoice[] = (ranksAccount.data?.rows ?? []).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  const owners: OwnerChoice[] = (ranksOwner.data?.rows ?? []).filter((r) => r.key !== "none").map((r) => ({ key: r.key, label: r.label })).sort((a, b) => a.label.localeCompare(b.label));

  /** Opens exactly these people in the list: every other choice is cleared first, so the count on the heading is the number that was pressed. */
  const openList = (patch: Partial<Choices>) => {
    if (embedded) setSection("queue");
    set({ ...DEFAULT_CHOICES, size: choices.size, ...patch });
    setTimeout(() => { heading.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); heading.current?.focus({ preventScroll: true }); }, 80);
  };
  const open = (title: string, params: Record<string, string>) => { void title; openList(params as Partial<Choices>); };

  const copy = async () => {
    const text = summaryText({
      who: multi ? "All client accounts" : "Your account", headline: w.headline.text, cost: w.cost.line,
      waiting: heroRows.map((x) => ({ name: x.name, account: multi ? x.locationName : null, waited: shortWords(x.hours), channel: x.call ? "call" : x.channel.toLowerCase(), owner: x.owner ? `owner ${x.owner.label}` : "no owner" })),
      accounts: (d.accounts?.rows ?? []).slice(0, 3).map((a) => ({ name: a.name, count: a.count })),
    });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };
  const menu: MenuItem[] = [
    { key: "copy", label: copied ? "Copied to your clipboard" : "Copy a summary", onSelect: () => void copy() },
    { key: "print", label: "Print", onSelect: () => window.print() },
    ...(d.kind !== "client" ? [
      { key: "csv", label: "Download the list (CSV)", onSelect: () => void api.download("export/inbox", "subsync-unanswered-messages.csv") },
      { key: "settings", label: "Change the reply target", onSelect: () => go("settings") },
    ] : []),
    { key: "help", label: "How to use this page", onSelect: () => go("help") },
  ];

  const quietOn = ui.flags.inbox_quiet === true;
  const clear = w.people === 0 && choices.tab === "us" && !isNarrowed(choices);
  const hot = w.over24 > 0;

  // ---- the cards: a fold of three, the rest behind More ----
  const listCard = (
    <Q key="list" q="Who should I answer first?" sub={choices.tab === "us" ? "Longest wait first. Press a person to open them." : "People you wrote to who have not answered."} tip="A person is counted once, however many conversations they have. Only people past your reply target are listed. SubSync never sends a reply." span glow={hot && choices.tab === "us" ? "urgent" : "active"} testId="reply-now" sticky>
      {quietOn && !embedded && (
        <div className="ur-tabs" role="tablist" aria-label="Which people">
          <button type="button" role="tab" aria-selected={choices.tab === "us"} className="ur-tab" onClick={() => set({ tab: "us", sort: "wait" })} data-testid="tab-us">Waiting for us <span className="tnum" data-testid="tab-us-n">{(tabs?.us ?? w.people).toLocaleString("en-US")}</span></button>
          <button type="button" role="tab" aria-selected={choices.tab === "them"} className="ur-tab" onClick={() => set({ tab: "them", sort: "wait", bucket: null })} data-testid="tab-them" data-tip="Conversations where we wrote last and the person has gone quiet. An automatic message counts as ours.">Waiting on them <span className="tnum" data-testid="tab-them-n">{tabs ? tabs.them.toLocaleString("en-US") : "·"}</span></button>
        </div>
      )}
      {clear ? <AllClear text={d.next.text} go={go} embedded={embedded} /> : (
        <UnansweredList choices={choices} set={set} page={page} setPage={setPage} reset={reset} multi={multi} accounts={accounts} owners={owners} slaHours={d.slaHours} headingRef={heading} onTabs={onTabs} onRows={onRows} segments={embedded !== undefined} />
      )}
    </Q>
  );
  const bucketsShown = d.buckets;
  const waitedCard = w.people > 0 && (
    <Q key="waited" q="How long have people waited?" sub={`Only people past your ${d.slaHours}-hour reply target.`} tip="Each column is the people who have waited that long. Press a column to see them." testId="wait-picture">
      <WaitColumns buckets={bucketsShown} onPick={(key) => openList({ bucket: key as Choices["bucket"] })} />
    </Q>
  );
  const whereCard = w.people > 0 && (multi || seePeople) && (
    <Q key="where" q={multi ? "Where are people waiting?" : "Who has them?"} sub={multi ? "Clients with the most people waiting." : "The team member each customer is assigned to."} tip="Press a column to open exactly those people. 200 clients fit: the columns get narrower." testId="wait-where">
      <WhereChart by={multi ? "account" : "owner"} data={multi ? ranksAccount.data : ranksOwner.data} error={(multi ? ranksAccount.error : ranksOwner.error) as Error | null} reload={multi ? ranksAccount.reload : ranksOwner.reload}
        onAccount={(id) => openList({ account: id })} onOwner={(key) => openList({ owner: key === "none" ? "none" : key })} />
    </Q>
  );
  const replayCard = w.people > 0 && (
    <Q key="replay" q="How did the waiting build up?" sub="Customers write on the left and wait along the line." tip="A picture of the people waiting now, by how long. Press a label to open those people." testId="replay-card">
      <ReplayCard buckets={bucketsShown} onPick={(key) => openList({ bucket: key as Choices["bucket"] })} />
    </Q>
  );
  const moneyCard = w.people > 0 && (
    <Q key="money" q="What is the waiting costing?" sub="An estimate, not a promise." tip={w.cost.formula} testId="wait-money-block">
      <p className="text-[0.95rem] font-medium" data-testid="wait-money">{w.money.line}</p>
      {w.cost.line && <p className="s6-sub mt-2" data-testid="wait-cost">{w.cost.line}</p>}
      {w.cost.line && <details className="mt-1"><summary className="ur-link" data-testid="cost-formula-toggle">How this is worked out</summary><p className="s6-sub mt-1" data-testid="cost-formula">{w.cost.formula}</p></details>}
    </Q>
  );
  const slotCards = CARD_SLOTS.filter((s) => hasUnansweredSlot(s, ui.flags)).map((s) => (
    <div key={s} className="ur-slot" data-slot={s}><Slot name={s} flags={ui.flags} multi={multi} showPeople={seePeople} open={open} go={(v) => go(v as Parameters<GoFn>[0])} /></div>
  ));
  const cards = [listCard, waitedCard, whereCard, replayCard, moneyCard, ...slotCards].filter(Boolean) as React.ReactNode[];
  // Inside Speed to lead: ONE queue and the rest in sub-sections, each with room (nothing congested). The list is searched, filtered and paged on the server whatever its size.
  const slotOf = (s: SlotName) => (hasUnansweredSlot(s, ui.flags) ? <div key={s} className="ur-slot" data-slot={s}><Slot name={s} flags={ui.flags} multi={multi} showPeople={seePeople} open={open} go={(v) => go(v as Parameters<GoFn>[0])} /></div> : null);
  const ownerWhere = seePeople && w.people > 0 ? (
    <Q key="owners" q="Who has them?" sub="The team member each customer is assigned to." tip="Press a column to open exactly those people." testId="wait-owners">
      <WhereChart by="owner" data={ranksOwner.data} error={ranksOwner.error as Error | null} reload={ranksOwner.reload} onAccount={(id) => openList({ account: id })} onOwner={(key) => openList({ owner: key === "none" ? "none" : key })} />
    </Q>
  ) : null;
  const rulesCard = (
    <Q key="rules" q="What counts as waiting?" sub={`A customer wrote last and has had no reply for more than ${d.slaHours} hours, in the last ${d.windowDays} days.`} tip="Change the reply target in Settings. An automatic message counts as ours." testId="rules-card">
      <p className="s6-sub">People set aside, marked not a lead, on your own team or automatic are left out unless you ask for them under More filters.</p>
      {d.kind !== "client" ? <button type="button" onClick={() => go("settings")} className="s6-btn" data-testid="rules-settings">Change the reply target</button> : <p className="s6-sub">Ask the person who manages your account to change the reply target.</p>}
    </Q>
  );
  const sections: Section[] = ["queue", ...(quietOn ? (["them"] as const) : []), "trends", ...(seePeople ? (["people"] as const) : []), ...(PROOF_SLOTS.some((s) => hasUnansweredSlot(s, ui.flags)) ? (["proof"] as const) : []), "rules"];
  const active: Section = sections.includes(section) ? section : "queue";
  const goSection = (s: Section) => { setSection(s); if (s === "queue") set({ tab: "us", sort: "wait", bucket: null }); if (s === "them") set({ tab: "them", sort: "wait", bucket: null }); };
  const bySection: Record<Section, React.ReactNode[]> = {
    queue: [listCard], them: [listCard],
    trends: [waitedCard, multi ? whereCard : null, replayCard, moneyCard, slotOf("CurveCard")],
    people: [ownerWhere, slotOf("ScorecardCard")], proof: PROOF_SLOTS.map(slotOf), rules: [rulesCard],
  };
  const shown = embedded ? (bySection[active].filter(Boolean) as React.ReactNode[]) : more ? cards : cards.slice(0, 3);

  return (
    <RoomProvider value={{ flags: ui.flags, seePeople, kind: d.kind, me: ui.me }}>
      <div data-testid={embedded ? "unanswered-tab" : "page"} className="ds-enter s6 ur" data-room="control">
        {!embedded && <TipHost />}
        <header className="ur-head print:hidden">
          <div className="min-w-0 flex-1">
            {embedded ? <h2 className="sr-only">Unanswered messages</h2> : <h1 className="ur-title">Unanswered messages</h1>}
            {embedded ? <p className="sr-only" data-testid="unanswered-subtitle">Everyone who wrote and is waiting for a reply right now, new leads and existing customers. SubSync shows who; it never sends a reply.</p>
              : <p className="s6-sub !mb-0" data-testid="page-subtitle">Customers who wrote and are still waiting. SubSync shows who; it never sends a reply.</p>}
          </div>
          {ui.flags.inbox_search === true && <FindBox multi={multi} />}
          <PopMenu label="More" items={menu} testId="inbox-more" triggerClassName="s6-btn">More<ChevronDown aria-hidden className="size-3.5" /></PopMenu>
        </header>

        {none ? (
          <EmptyState title="Waiting for the first sync" body="Conversations appear here once SubSync has read your accounts. This usually takes a few minutes after you connect; check back soon."
            action={<button type="button" onClick={() => go("help")} className="s6-btn">Open Getting started</button>} />
        ) : (
          <>
            <section className="ur-hero s6-card" data-glow={w.people === 0 ? undefined : hot ? "urgent" : "active"} aria-label="Right now" data-testid="wait-headline">
              <div className="ur-hero-top">
                <span className="ur-live" data-testid="live-chip"><Radio aria-hidden className="size-3.5" /><i className="ur-pulse" aria-hidden />Live</span>
                <span className="s6-label">Updates every minute</span>
              </div>
              <p className="ur-sentence" data-testid="wait-sentence">{w.headline.parts.map((p, i) => p.strong ? <strong key={i} className="ur-strong">{p.t}</strong> : <span key={i}>{p.t}</span>)}</p>
              {w.breach && <p className="ur-breach" data-testid="wait-breach">{w.breach}</p>}
              <div className="ur-kpis" role="group" aria-label="The numbers">
                <Kpi label="Waiting now" tone={w.people > 0 ? (hot ? "red" : "cyan") : "green"} value={w.people} disabled={w.people === 0} onOpen={() => openList({})} tip="People who wrote last and are past your reply target. Press to see them." testId="kpi-waiting" />
                <Kpi label="No owner" tone={w.noOwner > 0 ? "amber" : "green"} value={w.noOwner} disabled={w.noOwner === 0} onOpen={() => openList({ owner: "none" })} tip="Nobody is assigned to them in your CRM, so nobody is looking." testId="kpi-none" />
                {ui.me && <Kpi label="Mine" tone="cyan" value={d.mine} disabled={d.mine === 0} onOpen={() => openList({ owner: "me" })} tip="People assigned to you." testId="kpi-mine" />}
                {quietOn && !embedded && <Kpi label="Gone quiet on us" tone="violet" value={tabs?.them ?? 0} disabled={!tabs || tabs.them === 0} onOpen={() => openList({ tab: "them" })} tip="You wrote last and they have not answered for a day or more." testId="kpi-quiet" />}
              </div>
              {embedded && (
                <p className="ur-scope" data-testid="unanswered-scope" data-tip="Race and Pace time how fast NEW leads get a first reply. This tab lists everyone waiting now, new leads and existing customers, up to 30 days back. The date range on Race and Pace does not change this list; the client filter above does.">
                  Everyone waiting right now, up to {d.windowDays} days back.{d.today && d.today.newLeadsOnly > 0 ? <> Speed to lead also counts {d.today.newLeadsOnly.toLocaleString("en-US")} new {d.today.newLeadsOnly === 1 ? "lead" : "leads"} who {d.today.newLeadsOnly === 1 ? "has" : "have"} not written yet, so they are not listed here. <button type="button" className="ur-link" onClick={embedded.onRace} data-testid="scope-race">Open Race</button></> : null}
                </p>
              )}
              <div className="ur-hero-act">
                {oldest && <button type="button" className="s6-btn" data-kind="primary" onClick={() => heroActions.show(oldest)} data-testid="wait-primary">{w.people > 1 ? `Open the oldest of the ${w.people.toLocaleString("en-US")} people waiting` : "Open the person waiting"}</button>}
                {oldest && <span className="s6-label">Longest wait: {shortWords(oldest.hours)}{d.multi ? ` · ${oldest.locationName}` : ""}</span>}
              </div>
              {heroActions.drawer}
            </section>

            {d.truncated && <InlineAlert tone="warning" className="mb-4">SubSync reads the 20,000 conversations that have waited longest. There are more, so the numbers here are for what was read.</InlineAlert>}

            {embedded && (
              <div className="ur-sub" role="tablist" aria-label="Unanswered sections" data-testid="ur-sections">
                {sections.map((s) => <button key={s} type="button" role="tab" aria-selected={active === s} className="ur-subtab" onClick={() => goSection(s)} data-tip={SECTION_TIP[s]} data-testid={`sub-${s}`}>{SECTION_LABEL[s]}{s === "queue" ? <span className="tnum ur-subn"> {w.people.toLocaleString("en-US")}</span> : s === "them" && tabs ? <span className="tnum ur-subn"> {tabs.them.toLocaleString("en-US")}</span> : null}</button>)}
              </div>
            )}
            <div className="ur-grid" data-testid="ur-cards" data-section={embedded ? active : undefined}>{shown}</div>
            {!embedded && cards.length > 3 && (
              <div className="ur-morerow">
                <button type="button" className="s6-btn" aria-expanded={more} onClick={() => setMore(!more)} data-testid="s6-more">{more ? "Fewer cards" : `More (${cards.length - 3})`}<ChevronDown aria-hidden className={`size-4 transition-transform ${more ? "rotate-180" : ""}`} /></button>
              </div>
            )}

            <p className="ur-fine s6-label" data-testid="wait-notes">
              SubSync keeps only who wrote, when and on which channel; it never copies message text. Owner is the team member assigned in your CRM. Conversations waiting more than {d.windowDays} days are not counted.{" "}
              {d.kind !== "client" ? <button type="button" onClick={() => go("settings")} className="ur-link" data-testid="wait-settings-link">Change the reply target</button> : "Ask the person who manages your account to change the reply target."}
              {d.readLimit ? ` ${d.readLimit}` : ""}
            </p>
          </>
        )}
      </div>
    </RoomProvider>
  );
}

function Kpi({ label, value, tone, onOpen, disabled, tip, testId }: { label: string; value: number; tone: string; onOpen: () => void; disabled?: boolean; tip: string; testId: string }) {
  return (
    <button type="button" className="ur-kpi" data-tone={tone} onClick={onOpen} disabled={disabled} data-tip={tip} data-testid={testId} aria-label={`${label}: ${value} ${person(value)}${disabled ? "" : ". Open them."}`}>
      <span className="ur-kpi-n"><CountUp value={value} /></span>
      <span className="ur-kpi-l">{label}</span>
    </button>
  );
}

function AllClear({ text, go, embedded }: { text: string; go: GoFn; embedded?: Embedded }) {
  return (
    <div className="ur-clear" data-testid="wait-next">
      <CheckCircle2 aria-hidden className="ur-clear-ic" />
      <p className="ur-clear-h">Everyone who wrote has a reply.</p>
      <p className="s6-sub !mb-3"><span className="font-medium">Next best step.</span> {text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {embedded ? <button type="button" onClick={embedded.onRace} className="s6-btn">Open Race</button> : <button type="button" onClick={() => go("speed")} className="s6-btn">Open Speed to lead</button>}
        <button type="button" onClick={() => go("appointments")} className="s6-btn">Open Appointments</button>
      </div>
    </div>
  );
}
