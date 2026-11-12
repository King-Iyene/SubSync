"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { UNSEEN, LABEL_PRIMARY, LABEL_SECONDARY, MAKE_PRIMARY, TICK_WORDS, consequence, consequenceText, diffRows, fieldRows, type DetailPerson } from "@/lib/dq/dupe-impact";
import { protectChips } from "@/lib/dq/dupe-copies";
import { CANNOT_SEE, pickMaster, type MasterPick } from "@/lib/dq/master-rank";
import { sampleOn, useDq, type DupeDetail, type GroupRow } from "./dq-data";

// The merge comparison, in the CRM's own words: one CARD per copy (everything about it, readable at 390 wide) and a compact side-by-side of only the facts that DIFFER (first column sticks).
// Names and values are shown exactly as stored. A fact SubSync cannot read says so and links to the CRM: never blank, never zero. Which copy is primary is never guessed: see master-rank.ts.

/** The detail of one group, loaded when the panel opens, plus the master ranking worked out from it. */
export function useGroupDetail(g: GroupRow) {
  const ids = g.people.map((p) => p.contactId);
  const d = useDq<DupeDetail>(sampleOn() ? null : `dq/dupe?account=${g.locationId}&ids=${ids.join(",")}`, () => ({
    locationId: g.locationId, locationName: g.locationName, key: g.key, keepId: ids[0], different: false, guard: [], picks: [], workflow: { set: false, optedIn: false, canAsk: true, blockers: [], goneName: g.people[1]?.name ?? null, survivorId: ids[0], switchOn: false },
    people: g.people.map((p, i) => ({ contactId: p.contactId, name: p.name, email: p.email, phone: p.phone, tags: i ? ["new"] : ["vip"], createdAt: p.createdAt, source: p.source, ownerName: p.owner, openDeals: p.openDeals, openValue: p.openDeals ? 1200 : 0, wonDeals: 0, hasConversation: i === 1, appointments: 0, dnd: p.dnd, url: p.url, protectWords: p.protectWords })),
  }));
  const people = (d.data?.people ?? []) as Array<DetailPerson & { url: string }>;
  const pick: MasterPick | null = people.length ? pickMaster(people) : null;
  return { ...d, people, pick };
}

const BADGE = "inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs";

export function CopyCards({ people, primaryId, pick, onPick, name }: { people: Array<DetailPerson & { url: string }>; primaryId: string | null; pick: MasterPick | null; onPick: (id: string) => void; name: string }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="dq-cards">
      {people.map((p) => {
        const primary = primaryId === p.contactId;
        const chips = protectChips(p), why = pick?.copies.find((c) => c.contactId === p.contactId);
        return (
          <li key={p.contactId} className={`rounded-lg border bg-card p-3 ${primary ? "border-primary" : ""}`} data-testid="dq-card" data-primary={primary}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name={name} className="mt-0.5 size-4" checked={primary} onChange={() => onPick(p.contactId)} data-testid={`dq-keep-${p.contactId}`} />
              <span><b>{p.name}</b><br /><span className="text-xs text-muted-foreground">{primary ? LABEL_PRIMARY : primaryId ? LABEL_SECONDARY : MAKE_PRIMARY}</span>
                {primary && <><br /><span className="text-xs text-muted-foreground">{MAKE_PRIMARY}</span></>}</span>
            </label>
            <p className="mt-2 flex flex-wrap gap-1.5" data-testid="dq-card-badges">
              {chips.map((c) => <span key={c.reason} className={BADGE} data-reason={c.reason}><ShieldCheck aria-hidden className="size-3" />{c.text}</span>)}
              {p.hasConversation && <span className={BADGE}>Has a conversation</span>}
              {(why?.hints ?? []).map((h) => <span key={h} className={BADGE}>{h}</span>)}
              <span className={BADGE} data-testid="dq-card-unseen">Payments, automations, courses: not visible yet</span>
            </p>
            <p className="mt-2 text-xs" data-testid="dq-why"><b>Why this one:</b> {why?.line ?? "…"}</p>
            <details className="mt-2 text-xs">
              <summary className="min-h-8 cursor-pointer py-1 font-medium">All details</summary>
              <dl className="space-y-1">
                {fieldRows(p).map((r) => (
                  <div key={r.id} className="flex gap-2" data-testid={`dq-row-${r.id}`}>
                    <dt className="w-28 shrink-0 text-muted-foreground">{r.label}</dt>
                    <dd className="min-w-0 break-words">{r.value === null ? <span data-testid="dq-unseen">{UNSEEN}. <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline"><ExternalLink aria-hidden className="mr-0.5 inline size-3" />Open in your CRM</a></span> : r.value}
                      {r.note && <span className="block text-muted-foreground">{r.note}</span>}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** Only the readable facts that differ between the copies. First column is sticky so five copies can scroll sideways without losing the labels. */
export function DiffTable({ people, primaryId }: { people: Array<DetailPerson & { url: string }>; primaryId: string | null }) {
  const rows = diffRows(people);
  if (rows.length === 0) return <p className="text-xs text-muted-foreground" data-testid="dq-diff-none">The readable details are the same on every copy.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="dq-diff">
      <table className="w-full min-w-[28rem] text-sm">
        <thead><tr><th scope="col" className="sticky left-0 z-10 w-32 bg-card px-2 py-1 text-left text-xs font-medium text-muted-foreground">What differs</th>
          {people.map((p) => <th key={p.contactId} scope="col" className="px-2 py-1 text-left align-bottom text-xs font-semibold">{p.name}<br /><span className="font-normal text-muted-foreground">{primaryId === p.contactId ? "Primary (kept)" : primaryId ? "Secondary" : "Not chosen yet"}</span></th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t"><th scope="row" className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">{r.label}</th>{r.values.map((v, i) => <td key={i} className="px-2 py-1.5 align-top break-words">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Why the primary is not pre-selected, or that it was suggested, with the plain "cannot see" line and a link per copy. */
export function PickNote({ pick, people }: { pick: MasterPick | null; people: Array<{ contactId: string; name: string; url: string }> }) {
  if (!pick) return null;
  return (
    <div className="rounded-lg border bg-card p-3 text-sm" role="status" data-testid="dq-pick-note">
      {pick.mustChoose ? <p><b>Choose the primary contact yourself.</b> {pick.why}</p> : <p><b>Suggested primary:</b> the card marked below. You can change it.</p>}
      <p className="mt-1 text-xs text-muted-foreground">{CANNOT_SEE} {people.map((p) => <a key={p.contactId} href={p.url} target="_blank" rel="noopener noreferrer" className="mr-2 underline">Open {p.name} in your CRM</a>)}</p>
    </div>
  );
}

/** Before the final confirm: what will happen, what cannot be moved, and the tick that must be given. */
export function ConsequencePanel({ people, primaryId, ticked, onTick }: { people: DetailPerson[]; primaryId: string | null; ticked: boolean; onTick: (v: boolean) => void }) {
  const c = primaryId ? consequence(people, primaryId) : null;
  if (!c) return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="dq-consequence-wait">Choose the primary contact to see exactly what a merge will do.</p>;
  return (
    <div className="space-y-2" data-testid="dq-consequence">
      <p className="rounded-lg border bg-card p-3 text-sm" data-testid="dq-consequence-text">{consequenceText(c)}</p>
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="dq-risk">
        <p className="font-medium">Check before you merge</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {c.risks.map((r) => <li key={r}>{r}</li>)}
          <li>We cannot see payments, subscriptions, automations or courses, so a secondary contact may have one that is lost or doubled.</li>
        </ul>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={ticked} onChange={(e) => onTick(e.target.checked)} data-testid="dq-tick" />{TICK_WORDS}.</label>
    </div>
  );
}
