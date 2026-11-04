"use client";

import { useState } from "react";
import { accountBars, accountsNeedingYou, barsTitle, donutTitle, headlineOf, KIND_LABEL, replyWords, slicesOf, staleUsual, type Kind } from "@/lib/analytics/today-queue";
import {
  AccountBars, ComingBlock, DonutChart, FixFirstQueue, HeadlineBlock, InsightStrip, LocalAccountPicker, ProofStrip, PulseSpark, PulseTile, RaisedClearedStrip, RecordsPanel, RowsPanel, Section, ShowingChip, SinceStrip,
} from "../app/ds";
import { itemsSpec } from "@/lib/analytics/today-records";
import { forecastOf, type Insight, type SinceVisit } from "@/lib/analytics/today-smart";
import { SAMPLE_PICKER_ACCOUNTS, SAMPLE_PROOF, SAMPLE_REPLY_POINTS, SAMPLE_TODAY_ITEMS, SAMPLE_TODAY_QUEUE, SAMPLE_TODAY_TOTALS } from "./sample-today";

// Today's building blocks, each one the real component running on made-up data, so the next modules reuse them instead of rebuilding them. Clicking works:
// a slice or a legend row narrows the queue and opens the list behind it, a bar picks an account, a day opens that day's alerts.
const SAMPLE_INSIGHTS: Insight[] = [
  { key: "idle_owner", text: "Marcus has 11 leads with no reply for 3 days or more.", sample: 11, sampleLabel: "11 leads", estimate: false, title: "Marcus", subtitle: "Sample.", itemIds: [] },
  { key: "slow_after_hours", text: "Replies are 2.4x slower than usual for leads that arrive after 6 pm: 31 min against 13 min in the day.", sample: 31, sampleLabel: "31 leads", estimate: true, title: "After hours", subtitle: "Sample.", itemIds: [] },
  { key: "slow_source", text: "Facebook leads wait 3x longer than Google leads for a first reply (24 min against 8 min).", sample: 24, sampleLabel: "24 leads", estimate: true, title: "Facebook", subtitle: "Sample.", itemIds: [] },
];
const SAMPLE_SINCE: SinceVisit = { since: Date.parse("2026-11-03T09:30:00Z"), newLeads: Array.from({ length: 6 }, () => null as never), breached: Array.from({ length: 2 }, () => null as never), answered: Array.from({ length: 4 }, () => null as never), clearedAlerts: [] };
const SAMPLE_FORECAST = forecastOf(
  [{ id: "c1", kind: "leads", locationId: "x", accountName: "Maple Dental", name: "Ada Okafor", at: Date.now() + 7 * 60_000 + 42_000, startedAt: Date.now() - 7 * 60_000, value: null, contactId: "c", url: "#" }],
  [{ id: "d1", kind: "stale", locationId: "x", accountName: "Harbor Realty", name: "Kitchen remodel", at: Date.now() + 3_600_000, value: 2400, contactId: null, url: "#" }], []);

export function TodayBlocks() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [day, setDay] = useState<number | null>(null);
  const [usedBars, setUsedBars] = useState(false);
  const scoped = picked.length ? SAMPLE_TODAY_QUEUE.filter((r) => picked.includes(r.locationId)) : SAMPLE_TODAY_QUEUE;
  const slices = slicesOf(SAMPLE_TODAY_TOTALS);
  const bars = accountBars(scoped);
  const headline = headlineOf({ scope: "all", rows: SAMPLE_TODAY_QUEUE, totals: SAMPLE_TODAY_TOTALS });
  const items = kind ? SAMPLE_TODAY_ITEMS.filter((i) => i.kind === kind) : [];
  const facts = new Map(SAMPLE_PICKER_ACCOUNTS.map((a) => [a.id, { id: a.id, name: a.name, followUpEstimate: null, url: "https://example.com/open" }]));
  const needing = accountsNeedingYou(SAMPLE_TODAY_QUEUE, facts, 3);
  return (
    <>
      <Section title="Today: headline and figures" hint="One big sentence made from the existing figures, then figures against the account's own usual. A comparison shows only above the minimum sample; below it the tile says so.">
        <HeadlineBlock headline={headline} />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
          <PulseTile testId="design-pulse" label="Typical first reply" value="22 min" usual={{ verdict: "better", text: "Better than your usual (41 min)." }} sub="Last 7 days, from 31 replies."
            spark={<PulseSpark points={SAMPLE_REPLY_POINTS} label="Typical first reply, last 7 days" format={replyWords} />} />
          <PulseTile label="Open pipeline at risk" value="$21,000" usual={staleUsual({ today: 6, usual: 3.5, samples: 7, unusual: "up" })} sub="6 open deals have not moved in 30+ days." />
          <PulseTile label="Appointments to mark" value="4" usual={{ verdict: "not_enough", text: "Not enough history yet to compare with your usual." }} sub="The oldest started 5 days ago." />
        </div>
      </Section>

      <Section title="Today: Fix first queue and account selector" hint="Ranked by money at stake, then by how long it has been wrong, then urgency. j and k move, Enter opens in the CRM. The selector belongs to one page and is hidden under two accounts.">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <LocalAccountPicker accounts={SAMPLE_PICKER_ACCOUNTS} picked={picked} onChange={setPicked} />
          {picked.length > 0 && <ShowingChip label={picked.length === 1 ? SAMPLE_PICKER_ACCOUNTS.find((a) => a.id === picked[0])?.name ?? "1 account" : `${picked.length} client accounts`} onClear={() => setPicked([])} />}
        </div>
        <FixFirstQueue rows={kind ? scoped.filter((r) => r.kind === kind) : scoped} max={4} onShow={(r) => setKind(r.kind)} empty="Nothing needs fixing right now." />
        <ul className="mt-2 divide-y border-y text-sm" data-testid="design-needing">{needing.rows.map((a) => <li key={a.locationId} className="flex flex-wrap gap-x-4 py-2"><span className="font-medium">{a.name}</span><span className="text-muted-foreground">{a.state}: {a.reason}</span></li>)}</ul>
      </Section>

      <Section title="Today: clickable charts" hint="A slice, a legend row or a bar is a button. After a click a chip says what is shown, with the way back; the count on a slice is the number of rows in its list.">
        <div className="grid grid-cols-1 gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <DonutChart title={donutTitle(SAMPLE_TODAY_TOTALS)} slices={slices} selected={kind} onSelect={(k) => setKind(kind === k ? null : k)} used={kind !== null} />
          <AccountBars title={barsTitle(bars)} bars={bars.bars} rows={scoped} selected={picked.length === 1 ? picked[0] : null} onSelect={(id) => { setUsedBars(true); setPicked(picked.length === 1 && picked[0] === id ? [] : [id]); }} used={usedBars} />
        </div>
        {kind && (
          <div className="mt-5">
            <div className="mb-2"><ShowingChip label={KIND_LABEL[kind]} onClear={() => setKind(null)} /></div>
            <RowsPanel title={KIND_LABEL[kind]} count={SAMPLE_TODAY_TOTALS[kind].count} noun="items" items={items} onClose={() => setKind(null)} />
          </div>
        )}
      </Section>

      <Section title="Today: what SubSync caught" hint="Raised above the line, cleared below it. The word is cleared: SubSync can see a problem went away, not whether a person fixed it.">
        <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <ProofStrip proof={SAMPLE_PROOF} />
          <RaisedClearedStrip proof={SAMPLE_PROOF} selected={day} onSelect={setDay} />
        </div>
      </Section>

      <Section title="Today: records panel" hint="Every number on Today opens this: a large panel over a dimmed page with the actual records. Title and a sentence, editable filter chips, + Filter, search, typed columns, a header that stays put, 50 rows a page, OPEN on a row, Open in the CRM, Maximise, Export CSV and the footer. Esc or the cross closes it.">
        <button type="button" onClick={() => setPanelOpen(true)} className="inline-flex min-h-10 items-center rounded-lg border bg-card px-4 text-sm font-medium hover:border-primary/40" data-testid="design-open-panel">Open the records panel</button>
        {panelOpen && <RecordsPanel spec={itemsSpec(SAMPLE_TODAY_ITEMS, Date.now(), { key: "design", title: "Leads and deals, all client accounts", subtitle: "Made-up records for the style guide.", noun: "things", count: SAMPLE_TODAY_ITEMS.length })} now={Date.now()} onClose={() => setPanelOpen(false)} />}
      </Section>

      <Section title="Today: smart blocks" hint="Spotted today (at most three cards, each with the sample size and the word estimate when it is one), since your last visit, and what happens if nobody acts, with a ring that counts down to the next lead passing its reply target.">
        <SinceStrip since={SAMPLE_SINCE} showAlerts={false} onOpen={() => undefined} />
        <InsightStrip insights={SAMPLE_INSIGHTS} onOpen={() => undefined} />
        <ComingBlock forecast={SAMPLE_FORECAST} targetMinutes={15} onOpen={() => undefined} />
      </Section>
    </>
  );
}
