// The people (or clients) behind every step and link of Lead flow, and behind every bar of Clients coming and going. Pure: the list you open is built from the same rows
// that were counted, so "the number you pressed equals the rows you are shown" (unit tested in src/lib/__tests__/flow-records.test.ts).

import { trimColumns, type Col, type Rec, type RecordsSpec } from "./today-records.ts";
import { leadsOfLink, leadsOfNode, NODE_INFO, NODE_LABEL, type Flow, type FlowLead, type NodeId } from "./lead-flow.ts";
import { eventsInWeek, type ClientEvent, type WeekBar } from "./clients-flow.ts";

const REPLY_WORD = { replied: "Replied to", never: "Never answered", unknown: "Not checked" } as const;
const OUTCOME_WORD = { showed: "Showed up", noshow: "No-show", waiting: "No outcome yet" } as const;
const LEAD_COLS: Col[] = [
  { key: "who", header: "Person", type: "text", primary: true, w: 13 },
  { key: "account", header: "Client", type: "text", facet: true, w: 12 },
  { key: "added", header: "Added", type: "date", w: 10.5 },
  { key: "reply", header: "Reply", type: "kind", facet: true, w: 10 },
  { key: "appt", header: "Appointment", type: "kind", facet: true, w: 11 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];
const leadRec = (l: FlowLead): Rec => ({
  id: l.id, url: l.url || null,
  cells: { who: l.name, account: l.accountName, added: l.at, reply: REPLY_WORD[l.reply], appt: l.booked ? OUTCOME_WORD[l.outcome ?? "waiting"] : "No appointment", crm: l.url || null },
  lead: { contactId: l.id.slice(l.locationId.length + 1), locationId: l.locationId, name: l.name, account: l.accountName, note: REPLY_WORD[l.reply] },
});

export type FlowSpecInput = { flow: Flow; leads: FlowLead[]; sent: number; partial: boolean; rangeLabel: string };
function leadSpec(i: FlowSpecInput, key: string, title: string, subtitle: string, list: FlowLead[], count: number): RecordsSpec {
  const rows = list.map(leadRec);
  const cut = count > rows.length;
  return {
    key, title, subtitle, noun: count === 1 ? "lead" : "leads", count, cols: trimColumns(LEAD_COLS, rows), rows,
    note: cut ? `SubSync loaded the ${rows.length.toLocaleString("en-US")} newest of ${count.toLocaleString("en-US")}. Pick a shorter stretch of dates to see them all.` : null,
    dateKey: "added", preset: {}, exportName: key,
  };
}

/** One step of the flow. */
export function specFlowNode(i: FlowSpecInput, id: NodeId): RecordsSpec {
  const count = i.flow.nodes.find((n) => n.id === id)?.count ?? 0;
  return leadSpec(i, `flow-node-${id}`, `${NODE_LABEL[id]}, ${i.rangeLabel.toLowerCase()}`, `${NODE_INFO[id]} Leads added ${i.rangeLabel.toLowerCase()}, followed to where they are now.`, leadsOfNode(i.leads, id), count);
}
/** The people who went from one step to the next. */
export function specFlowLink(i: FlowSpecInput, from: NodeId, to: NodeId): RecordsSpec {
  const count = i.flow.links.find((l) => l.from === from && l.to === to)?.count ?? 0;
  return leadSpec(i, `flow-link-${from}-${to}`, `${NODE_LABEL[from]}, then ${NODE_LABEL[to].toLowerCase()}`, `The leads added ${i.rangeLabel.toLowerCase()} that went from "${NODE_LABEL[from]}" to "${NODE_LABEL[to]}".`, leadsOfLink(i.leads, from, to), count);
}

// ---------- Clients coming and going ----------

const CLIENT_COLS: Col[] = [
  { key: "who", header: "Client", type: "text", primary: true, w: 16 },
  { key: "what", header: "What happened", type: "kind", facet: true, w: 12 },
  { key: "when", header: "Date", type: "date", w: 11 },
];
export function specClientsWeek(events: ClientEvent[], bar: WeekBar, kind?: "added" | "removed"): RecordsSpec {
  const list = eventsInWeek(events, bar, kind);
  const rows: Rec[] = list.map((e, n) => ({ id: `${e.locationId}-${e.kind}-${n}`, url: null, cells: { who: e.name, what: e.kind === "added" ? "Added" : "Removed", when: e.at }, lead: null }));
  const word = kind === "added" ? "added" : kind === "removed" ? "removed" : "added or removed";
  return { key: `clients-week-${bar.start}-${kind ?? "all"}`, title: `Clients ${word}, week of ${bar.label}`, subtitle: "Newest first.", noun: rows.length === 1 ? "client" : "clients", count: rows.length, cols: trimColumns(CLIENT_COLS, rows), rows, note: null, dateKey: "when", preset: {}, exportName: `clients-${bar.start}` };
}
export function specClientsAll(events: ClientEvent[], kind: "added" | "removed"): RecordsSpec {
  const list = events.filter((e) => e.kind === kind);
  const rows: Rec[] = list.map((e, n) => ({ id: `${e.locationId}-${e.kind}-${n}`, url: null, cells: { who: e.name, what: kind === "added" ? "Added" : "Removed", when: e.at }, lead: null }));
  return { key: `clients-all-${kind}`, title: kind === "added" ? "Clients added" : "Clients removed", subtitle: "Newest first.", noun: rows.length === 1 ? "client" : "clients", count: rows.length, cols: trimColumns(CLIENT_COLS, rows), rows, note: null, dateKey: "when", preset: {}, exportName: `clients-${kind}` };
}
