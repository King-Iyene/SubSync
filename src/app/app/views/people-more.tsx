"use client";

import { useState } from "react";
import { changeBetween } from "@/lib/design/range";
import { QUIET_AFTER_DAYS } from "@/lib/analytics/contact-intel";
import { countWords } from "@/lib/people/queue";
import type { PersonRowOut } from "@/lib/people/types";
import { BarChart, CardRange, DialNote, DrillPanel, ErrorState, HowTo, InlineAlert, LeadDrawer, Section, SkeletonRows, useCardRange, useContactActions, useDrill } from "../ds";
import { useData } from "../session";
import { Btn, fmtInt } from "../ui";
import { LeadsView } from "./leads";
import type { Options } from "./people-filters";
import { PersonRows, toSeed, type SeedFrom } from "./people-rows";
import { ColdCard } from "./ai-lead-cards";

// The other three tabs of People: Tags (who has a tag, and how many were tagged each day), Going cold (who talked to you and then went quiet), and Sources. They answer "what is in my
// list", not "who do I call now", so they sit behind the first tab. Every row is the same row as everywhere else in People, and every name opens the same lead panel.

type Page = { total: number; page: number; pageSize: number; rows: PersonRowOut[] };

// ---------------- tags ----------------

function TagPanel({ tag, showAccount, onSeeAll }: { tag: string; showAccount: boolean; onSeeAll: (day: string) => void }) {
  const range = useCardRange("tag-days", { preset: "90d", compare: "none" });
  const cur = range.resolved?.current;
  const cmp = range.resolved?.compare ?? null;
  const path = cur ? `people/tags/${encodeURIComponent(tag)}?from=${cur.from}&to=${cur.to}` : null;
  const { data, error, loading, reload } = useData<{ tagged: number; carrying: number; since: string | null; removedInWindow: number; days: Array<{ day: string; count: number; members: SeedFrom[] }> }>(path);
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
                ...(showAccount ? [{ key: "a", header: "Account", cell: (r: SeedFrom) => r.locationName ?? "Unnamed account" }] : []),
                { key: "o", header: "Owner", cell: (r) => (r.owner ? r.ownerName : "No owner") },
              ]} />
          )}
          {picked && picked.count > 0 && <p className="mt-2 text-xs"><button type="button" className="min-h-9 font-medium text-primary underline" onClick={() => onSeeAll(picked.day)} data-testid="tag-see-all">See all {fmtInt(picked.count)} in Find and call</button></p>}
        </>
      ) : null}
    </section>
  );
}

export function TagsTab({ showAccount, onSeeAll }: { showAccount: boolean; onSeeAll: (tag: string, day: string) => void }) {
  const opts = useData<Options>("people/options");
  const [tag, setTag] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <HowTo id="people-tags" title="How to use this page">Press a tag to see who has it and how many were tagged each day. Press a bar to see the people tagged that day.</HowTo>
      <Section title="Tags" hint="The tags on your contacts, the most used first.">
        {opts.loading && !opts.data ? <SkeletonRows rows={2} label="Loading tags..." /> : opts.data && opts.data.tags.length === 0 ? <p className="text-sm text-muted-foreground">No tags on your contacts yet.</p> : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {(opts.data?.tags ?? []).slice(0, 40).map((t) => (
              <li key={t.tag}><button type="button" onClick={() => setTag(tag === t.tag ? null : t.tag)} aria-pressed={tag === t.tag} className={`min-h-11 border-b-2 px-2 text-sm sm:min-h-9 ${tag === t.tag ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.tag} <span className="tabular-nums text-xs">{fmtInt(t.count)}</span></button></li>
            ))}
          </ul>
        )}
        {tag && <TagPanel key={tag} tag={tag} showAccount={showAccount} onSeeAll={(day) => onSeeAll(tag, day)} />}
      </Section>
    </div>
  );
}

// ---------------- going cold ----------------

const BUCKET_WORDS: Record<string, { title: string; hint: string; empty: string }> = {
  quiet: { title: "Engaged, then quiet", hint: `Working leads who wrote, booked or had a deal, and nothing since ${QUIET_AFTER_DAYS} days. The best people to bring back.`, empty: "Nobody has gone quiet yet." },
  recent: { title: "Seen recently", hint: `Working leads with something seen in the last ${QUIET_AFTER_DAYS} days.`, empty: "Nobody was seen recently." },
  none: { title: "Nothing seen yet", hint: "Working leads with no reply, booking or deal seen. This is not the same as never replying: SubSync reads the newest conversations of each account.", empty: "Nobody here." },
};

export function GoingColdTab({ showAccount }: { showAccount: boolean }) {
  const [bucket, setBucket] = useState("quiet");
  const [pageNo, setPageNo] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const actions = useContactActions();
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
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <div className="space-y-6">
      <HowTo id="people-cold" title="How to use this page">Press a bar to see the people behind it. Start with &quot;Engaged, then quiet&quot;: they have talked to you before. Contacts on a cold list are counted apart, so they never hide the people you are really working.</HowTo>
      <ColdCard />
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
      <Section title={`${info.title}${list.data ? `: ${countWords(list.data.total, false)}` : ""}`} hint={info.hint}>
        {list.loading && !list.data ? <SkeletonRows rows={6} label="Finding people..." /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.data ? (
          <div data-testid="people-list">
            <PersonRows rows={list.data.rows} showAccount={showAccount} actions={actions} onOpen={setOpen} testId="cold-rows" empty={info.empty} />
            {list.data.total > list.data.pageSize && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="people-pager">
                <span>{fmtInt((list.data.page - 1) * list.data.pageSize + 1)} to {fmtInt(Math.min(list.data.total, list.data.page * list.data.pageSize))} of {fmtInt(list.data.total)}</span>
                <span className="flex items-center gap-2">
                  <Btn variant="secondary" disabled={list.data.page <= 1} onClick={() => setPageNo(list.data!.page - 1)}>Previous</Btn>
                  <span aria-live="polite">Page {list.data.page} of {fmtInt(pages)}</span>
                  <Btn variant="secondary" disabled={list.data.page >= pages} onClick={() => setPageNo(list.data!.page + 1)}>Next</Btn>
                </span>
              </div>
            )}
            {list.data.rows.length > 0 && <div className="mt-3"><DialNote className="max-w-md" /></div>}
            <LeadDrawer leads={list.data.rows.map(toSeed)} index={open} onIndex={setOpen} onClose={() => setOpen(null)} showAccount={showAccount} />
          </div>
        ) : null}
      </Section>
      <Section title="Cold lists and lifecycle" hint="Mark a tag as a cold list so it never hides the people you are really working.">
        <LeadsView part="cold" />
      </Section>
    </div>
  );
}

// ---------------- sources ----------------

export function SourcesTab() {
  return (
    <div className="space-y-6">
      <LeadsView part="sources" />
    </div>
  );
}
