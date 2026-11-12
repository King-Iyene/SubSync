import { headlineOf, rankItems } from "@/lib/analytics/today3-intel";
import type { Td3List, Td3Numbers, Td3Options, Td3Proof, Td3ProofRow, Td3Row, Td3Settings, Td3Today } from "@/lib/analytics/today3-types";

// SAMPLE DATA ONLY (open Today with ?tdfx=1, ?tdfx=empty or ?tdfx=error). No database, no real clients; the screen says "Sample data" whenever this is used.
// The ranking, labels and sentence come from the same pure rules the server uses (today3-intel), so the sample behaves like the real thing.
export type FxParams = Record<string, string | number | undefined>;
const NAMES = ["Northside Roofing", "Bright Smiles Dental", "Lakeview Realty", "Harbor Med Spa", "Summit Solar", "Cedar Coaching"];
const acc = (i: number, count: number) => ({ locationId: `loc${i}`, name: NAMES[i % NAMES.length], count });
const META = { generatedAt: "2026-11-11T08:00:00.000Z", cached: false, canSee: true, level: "all" as const, problem: null, timezone: "UTC", flags: Object.fromEntries(["td_module", "td_today", "td_proof", "td_numbers", "td_email", "td_record"].map((f) => [f, true])) };

function todaySample(empty: boolean): Td3Today {
  const raw = empty ? [] : [
    { kind: "waiting_old" as const, count: 14, accounts: 4, money: 18400, oldestHours: 52, top: [acc(0, 6), acc(1, 4), acc(3, 3)] },
    { kind: "unmarked" as const, count: 9, accounts: 3, money: null, oldestHours: 70, top: [acc(2, 5), acc(4, 3), acc(5, 1)] },
    { kind: "noshows" as const, count: 4, accounts: 2, money: null, oldestHours: 30, top: [acc(3, 3), acc(0, 1)] },
    { kind: "stale_deals" as const, count: 11, accounts: 2, money: 41000, oldestHours: 900, top: [acc(4, 8), acc(1, 3)] },
  ];
  const items = rankItems(raw), h = headlineOf(items, 20);
  return {
    ...h, items, counts: { unmarked: empty ? 0 : 9, noshows: empty ? 0 : 4 }, snoozed: [], done: empty ? [] : [{ kind: "waiting_old", label: "waited over a day for a reply", cleared: 3, lastAt: "2026-11-11T06:30:00.000Z" }],
    allClear: empty ? { fixedSinceYesterday: 3, lastFixedAt: "2026-11-11T06:00:00.000Z" } : null, accounts: 20, scope: "All 20 client accounts", mine: null, needsPermission: empty ? 0 : 1, historyStarts: "2026-10-28", timezone: "UTC",
  };
}
const rows = (kind: string, n: number): Td3Row[] => Array.from({ length: n }, (_, i) => ({
  locationId: `loc${i % 6}`, accountName: NAMES[i % 6], contactId: `c${i}`, contactName: ["Ava Brown", "Liam Khan", "Noah Silva", "Mia Reed", "Ella Okafor"][i % 5],
  detail: kind.includes("stale") ? "Proposal sent, no movement since 2026-09-30" : kind.includes("waiting") ? `Waiting ${20 + i} hours` : "Booked consultation", at: "2026-11-09T10:00:00.000Z",
  value: kind.includes("stale") || kind === "open_deals" ? 1200 + i * 150 : null, url: "#",
}));
const pageOf = <T,>(all: T[], page: number, size: number) => { const pages = Math.max(1, Math.ceil(all.length / size)), p = Math.min(Math.max(0, page), pages - 1); return { rows: all.slice(p * size, p * size + size), total: all.length, page: p, size, pages, truncated: false }; };

function proofSample(empty: boolean): Td3Proof {
  const all: Td3ProofRow[] = NAMES.map((name, i) => ({ locationId: `loc${i}`, name, found: empty ? 0 : 9 - i, cleared: empty ? 0 : 7 - i, stillOpen: empty ? 0 : 2, medianFixMinutes: empty ? null : 120 + i * 20, fixes: 5 }));
  const total = empty ? { found: 0, cleared: 0, stillOpen: 0, medianFixMinutes: null, fixes: 0, enough: false } : { found: 31, cleared: 24, stillOpen: 7, medianFixMinutes: 180, fixes: 24, enough: true };
  return {
    weekStart: "2026-11-02", weekEnd: "2026-11-08", weeks: ["2026-11-09", "2026-11-02", "2026-10-26"], total,
    byKind: empty ? [] : [{ kind: "waiting_old", label: "people waited over a day for a reply", found: 14, cleared: 11 }, { kind: "unmarked", label: "appointments with no outcome", found: 9, cleared: 7 }],
    rows: pageOf(all, 0, 20),
    lines: empty ? ["We started keeping this record on 2026-11-10, so there is not a full week to report yet."] : ["This week we found 31 problems in your client accounts.", "24 were fixed, usually within 3 hours.", "7 are still open."],
    clientLines: [], historyStarts: "2026-10-28", accountName: null,
  };
}
function numbersSample(): Td3Numbers {
  return {
    days: 30, historyStarts: "2026-10-28", testDealsLeftOut: 12,
    tiles: [
      { id: "reply", label: "Typical first reply", value: "9 min", enough: true, caption: null, formula: "The middle first-reply time of the leads answered in the last 30 days, across 20 accounts. Needs 5 answered leads.", change: "-12%", estimate: false, opens: { module: "speed" }, count: 412 },
      { id: "waiting", label: "Waiting for a reply", value: "27", enough: true, caption: null, formula: "People whose last message is from the customer and nobody has answered, in the last 30 days.", change: null, estimate: false, opens: { list: "all_waiting" }, count: 27 },
      { id: "showrate", label: "Show rate", value: "71%", enough: true, caption: null, formula: "People who came as a share of appointments marked came or no-show in the last 30 days. Needs 20 marked outcomes; unmarked appointments are not counted.", change: "+4%", estimate: false, opens: { list: "all_noshows" }, count: 38 },
      { id: "open_deals", label: "Open deals", value: "184 worth $412,300", enough: true, caption: null, formula: "Open deals counted by Pipeline's rule, leaving out deals with no value and deals with no owner (usually test or junk). The dollar figure is the deals' own value, not a forecast.", change: null, estimate: true, opens: { list: "open_deals" }, count: 184 },
      { id: "stale", label: "Deals gone quiet", value: "41", enough: true, caption: null, formula: "Open deals with no movement for 30 days, by Pipeline's counted-deal rule.", change: null, estimate: false, opens: { list: "all_stale" }, count: 41 },
      { id: "attention", label: "Accounts needing a look", value: "5 of 20", enough: true, caption: null, formula: "Client accounts Clients marks Act now or Keep an eye.", change: null, estimate: false, opens: { module: "clients" }, count: 5 },
    ],
  };
}

export function sample(part: string, p: FxParams, empty: boolean): object {
  switch (part) {
    case "today": return { ...todaySample(empty), ...META };
    case "list": { const kind = String(p.kind ?? "waiting_old"); const l: Td3List = { ...pageOf(empty ? [] : rows(kind, 40), Number(p.page ?? 0), Number(p.size ?? 20)), kind: kind as never, label: kind.replace(/_/g, " ") }; return { ...l, ...META }; }
    case "proof": return { ...proofSample(empty), ...META };
    case "numbers": return { ...numbersSample(), ...META };
    case "settings": { const s: Td3Settings = { emailOn: false, emailHour: 7, quietDays: [0, 6], recipients: [], timezone: "UTC", canEdit: true, sendingNote: null }; return { ...s, ...META }; }
    case "options": { const o: Td3Options = { accounts: NAMES.map((name, i) => ({ locationId: `loc${i}`, name })) }; return { ...o, ...META }; }
  }
  return { ...META };
}
