import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";

// The COUNTED money line on Speed to lead and Unanswered messages (stage SHELL). A fact, not an estimate: the open deals of the people who are waiting, with the one
// "counted deal" rule every dollar figure uses (value above $0, an owner, in a stage that is in play: `countedInScope`, the same SQL as Appointments and the Account
// audit). Each deal is counted once, each person once. The estimate (win rate) stays separate and keeps its own honest "not enough closed deals" rule.

export type CountedDeal = { opportunityId: string; locationId: string; contactId: string; value: number };
export type WaitingMoney = { people: number; peopleWithDeals: number; deals: number; dollars: number; byLocation: Array<{ locationId: string; dollars: number; people: number }> };

/** Pure: sum the counted deals of the waiting people. A deal listed twice counts once; a person with several deals counts once in `peopleWithDeals`. */
export function summariseWaitingMoney(waitingKeys: Iterable<string>, deals: readonly CountedDeal[]): WaitingMoney {
  const waiting = new Set(waitingKeys);
  const seen = new Set<string>();
  const people = new Set<string>();
  const loc = new Map<string, { dollars: number; people: Set<string> }>();
  let dollars = 0;
  for (const d of deals) {
    const key = `${d.locationId}:${d.contactId}`;
    if (!waiting.has(key) || seen.has(`${d.locationId}:${d.opportunityId}`) || !(d.value > 0)) continue;
    seen.add(`${d.locationId}:${d.opportunityId}`);
    people.add(key);
    dollars += d.value;
    const l = loc.get(d.locationId) ?? { dollars: 0, people: new Set<string>() };
    l.dollars += d.value; l.people.add(key); loc.set(d.locationId, l);
  }
  return { people: waiting.size, peopleWithDeals: people.size, deals: seen.size, dollars: Math.round(dollars), byLocation: [...loc].map(([locationId, l]) => ({ locationId, dollars: Math.round(l.dollars), people: l.people.size })).sort((a, b) => b.dollars - a.dollars) };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The line under the headline and the button: facts when there are any, else one plain next best action. */
export function waitingMoneyLine(m: WaitingMoney | null, noMoneyNext: string): string {
  if (m === null) return noMoneyNext;
  if (m.peopleWithDeals === 0) return noMoneyNext;
  return `${m.peopleWithDeals.toLocaleString("en-US")} of these ${m.peopleWithDeals === 1 ? "person has" : "people have"} open ${m.deals === 1 ? "a deal" : "deals"} worth ${money(m.dollars)}.`;
}

/** Counted open deals of the given people (`account:contact` keys), read with the shared counted-deal rule. Read only. */
export async function countedDealsOf(installationId: string, keys: readonly string[]): Promise<CountedDeal[]> {
  const byLoc = new Map<string, string[]>();
  for (const k of new Set(keys)) { const i = k.indexOf(":"); if (i > 0) byLoc.set(k.slice(0, i), [...(byLoc.get(k.slice(0, i)) ?? []), k.slice(i + 1)]); }
  const out: CountedDeal[] = [];
  for (const [locationId, contacts] of byLoc) {
    for (let i = 0; i < contacts.length; i += 5_000) {
      const rows = await sql()`
        select o.opportunity_id, o.location_id, o.contact_id, o.monetary_value::float8 v
        from cached_opportunities o ${dealScopeJoins()}
        where o.installation_id = ${installationId} and o.location_id = ${locationId} and o.status = 'open' and o.contact_id = any(${contacts.slice(i, i + 5_000)}::text[]) and ${countedInScope()}`;
      for (const r of rows) out.push({ opportunityId: r.opportunity_id as string, locationId: r.location_id as string, contactId: r.contact_id as string, value: r.v as number });
    }
  }
  return out;
}

/** The whole read: the waiting people's counted deals, summarised. Null when the read fails (the screen then shows only the next best action). */
export async function waitingMoney(installationId: string, keys: readonly string[]): Promise<WaitingMoney | null> {
  try { return summariseWaitingMoney(keys, await countedDealsOf(installationId, keys)); } catch { return null; }
}
