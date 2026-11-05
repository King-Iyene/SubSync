// Lead flow: where the leads of a chosen stretch of time went. Pure functions, unit tested on fixtures (src/lib/__tests__/lead-flow.test.ts). Definition: docs/METRICS.md, "Lead flow".
//
// A lead is a contact CREATED in the stretch (each client's own midnight to midnight), followed to where it is now. Four steps, each from data SubSync already holds:
//   replied   a person (not an automatic message) has answered the lead. Known only for leads SubSync has checked (the last 14 days of conversations).
//   booked    the lead has an appointment that is not cancelled or invalid.
//   outcome   of the booked leads: showed up, no-show, or no outcome yet (still to come, or nobody marked it).
//   won       the lead has a deal marked won (shown beside the flow, not as a step).

export type Reply = "replied" | "never" | "unknown";
export type Outcome = "showed" | "noshow" | "waiting";
export type FlowLead = {
  id: string; locationId: string; accountName: string; name: string; at: number;
  reply: Reply; booked: boolean; outcome: Outcome | null; won: boolean; url: string;
};

/** Under this many leads the flow shows the counts but no percentages: a share of a handful is noise. */
export const MIN_LEADS = 10;

export type NodeId = "new" | "replied" | "never" | "unknown" | "booked" | "nobook" | "showed" | "noshow" | "waiting";
export const NODE_LABEL: Record<NodeId, string> = {
  new: "New leads", replied: "Replied to", never: "Never answered", unknown: "Not checked", booked: "Booked an appointment", nobook: "No appointment",
  showed: "Showed up", noshow: "No-show", waiting: "No outcome yet",
};
export const NODE_COL: Record<NodeId, number> = { new: 0, replied: 1, never: 1, unknown: 1, booked: 2, nobook: 2, showed: 3, noshow: 3, waiting: 3 };
export const NODE_ORDER: NodeId[] = ["new", "replied", "never", "unknown", "booked", "nobook", "showed", "noshow", "waiting"];
/** Plain one-line meaning of each step, shown on hover and in the lists. */
export const NODE_INFO: Record<NodeId, string> = {
  new: "People added as a contact in the dates you picked.",
  replied: "A person on your team answered them (not an automatic message).",
  never: "Nobody has answered them yet.",
  unknown: "Too old for SubSync to have checked whether anyone answered, or reading conversations is not approved yet.",
  booked: "They have an appointment that was not cancelled.",
  nobook: "They have no appointment.",
  showed: "Their appointment was marked as showed up.",
  noshow: "Their appointment was marked as a no-show.",
  waiting: "Their appointment is still to come, or nobody marked what happened.",
};

export type FlowNode = { id: NodeId; label: string; col: number; count: number; /** Share of its parent step, null when there are too few leads. */ pct: number | null; of: string };
export type FlowLink = { from: NodeId; to: NodeId; count: number };
export type Flow = { total: number; enough: boolean; nodes: FlowNode[]; links: FlowLink[]; won: number; unknown: number };

const inNode = (l: FlowLead, id: NodeId): boolean => {
  switch (id) {
    case "new": return true;
    case "replied": case "never": case "unknown": return l.reply === id;
    case "booked": return l.booked;
    case "nobook": return !l.booked;
    case "showed": case "noshow": case "waiting": return l.booked && l.outcome === id;
  }
};
const LINKS: Array<[NodeId, NodeId]> = [
  ["new", "replied"], ["new", "never"], ["new", "unknown"],
  ["replied", "booked"], ["replied", "nobook"], ["never", "booked"], ["never", "nobook"], ["unknown", "booked"], ["unknown", "nobook"],
  ["booked", "showed"], ["booked", "noshow"], ["booked", "waiting"],
];
const inLink = (l: FlowLead, from: NodeId, to: NodeId): boolean => (from === "new" ? l.reply === to : from === "booked" ? l.booked && l.outcome === to : l.reply === from && l.booked === (to === "booked"));

export const leadsOfNode = (leads: FlowLead[], id: NodeId) => leads.filter((l) => inNode(l, id));
export const leadsOfLink = (leads: FlowLead[], from: NodeId, to: NodeId) => leads.filter((l) => inLink(l, from, to));

export function buildFlow(leads: FlowLead[], minLeads = MIN_LEADS): Flow {
  const total = leads.length;
  const enough = total >= minLeads;
  const count = (id: NodeId) => leads.filter((l) => inNode(l, id)).length;
  const bookedN = count("booked");
  const nodes: FlowNode[] = NODE_ORDER.map((id) => {
    const n = count(id);
    const parentN = id === "new" ? total : NODE_COL[id] === 3 ? bookedN : total;
    return { id, label: NODE_LABEL[id], col: NODE_COL[id], count: n, pct: enough && parentN > 0 && id !== "new" ? Math.round((n / parentN) * 100) : null, of: id === "new" ? "" : NODE_COL[id] === 3 ? "of booked" : "of new leads" };
  });
  const links = LINKS.map(([from, to]) => ({ from, to, count: leads.filter((l) => inLink(l, from, to)).length }));
  return { total, enough, nodes, links, won: leads.filter((l) => l.won).length, unknown: count("unknown") };
}

// ---------- the date choices ----------

export type FlowPreset = "7d" | "30d" | "this-month" | "last-month" | "custom";
export const FLOW_PRESETS: Array<{ key: FlowPreset; label: string }> = [
  { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" }, { key: "this-month", label: "This month" }, { key: "last-month", label: "Last month" }, { key: "custom", label: "Custom dates" },
];
const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isIsoDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toIso(toMs(s)) === s;
export const MAX_FLOW_DAYS = 366;

/** The first and last day (inclusive, "YYYY-MM-DD") of a choice, given today's date. A bad custom choice gives a plain problem and the last 7 days. */
export function resolveFlowRange(preset: FlowPreset, today: string, from?: string, to?: string): { from: string; to: string; label: string; problem: string | null } {
  const last7 = { from: toIso(toMs(today) - 6 * DAY), to: today };
  if (preset === "7d") return { ...last7, label: "Last 7 days", problem: null };
  if (preset === "30d") return { from: toIso(toMs(today) - 29 * DAY), to: today, label: "Last 30 days", problem: null };
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (preset === "this-month") return { from: toIso(Date.UTC(y, m - 1, 1)), to: today, label: "This month", problem: null };
  if (preset === "last-month") return { from: toIso(Date.UTC(y, m - 2, 1)), to: toIso(Date.UTC(y, m - 1, 0)), label: "Last month", problem: null };
  if (!isIsoDay(from) || !isIsoDay(to)) return { ...last7, label: "Last 7 days", problem: "Pick a start and an end date." };
  if (from > to) return { ...last7, label: "Last 7 days", problem: "The end date is before the start date." };
  if (to > today) return { ...last7, label: "Last 7 days", problem: "The end date is in the future." };
  if ((toMs(to) - toMs(from)) / DAY + 1 > MAX_FLOW_DAYS) return { ...last7, label: "Last 7 days", problem: `A custom range can be at most ${MAX_FLOW_DAYS} days.` };
  return { from, to, label: `${from} to ${to}`, problem: null };
}
