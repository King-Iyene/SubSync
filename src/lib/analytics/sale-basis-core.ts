// How SubSync counts a sale, and who is credited. Pure: no imports from the server, safe for tests and the browser.
// One choice per company (Settings, "How do we count a sale?"). Every figure that says "Sold" reads it through this file, so two screens never count differently.

export const SALE_BASES = ["deal_won", "payment", "assigned_closer"] as const;
export type SaleBasis = (typeof SALE_BASES)[number];
export type SaleSettings = { basis: SaleBasis; /** Count a sale even when no dollar value is on the deal. Off = a sale needs a value above zero. */ countWithoutValue: boolean };
export const DEFAULT_SALE_SETTINGS: SaleSettings = { basis: "deal_won", countWithoutValue: true };

export const isSaleBasis = (v: unknown): v is SaleBasis => typeof v === "string" && (SALE_BASES as readonly string[]).includes(v);
export function cleanSaleSettings(raw: { basis?: unknown; countWithoutValue?: unknown } | null | undefined): SaleSettings {
  return { basis: isSaleBasis(raw?.basis) ? raw.basis : DEFAULT_SALE_SETTINGS.basis, countWithoutValue: typeof raw?.countWithoutValue === "boolean" ? raw.countWithoutValue : DEFAULT_SALE_SETTINGS.countWithoutValue };
}

export const BASIS_TITLE: Record<SaleBasis, string> = { deal_won: "From deals marked won", payment: "From payments received", assigned_closer: "From the assigned person" };
export const BASIS_HELP: Record<SaleBasis, string> = {
  deal_won: "A sale is a deal marked won. The closer is the person the meeting was assigned to.",
  payment: "A sale is a payment received from the lead. Needs the payments permission.",
  assigned_closer: "A sale is a lead who became a customer (paid, or deal won) while assigned to a closer. The closer is the lead's assigned person, so no dollar value is needed.",
};
/** The short label that sits next to every sold figure. */
export const BASIS_PHRASE: Record<SaleBasis, string> = { deal_won: "counted from deals won", payment: "counted from payments received", assigned_closer: "counted from the assigned closer" };
export const CREDIT_RULE: Record<SaleBasis, string> = {
  deal_won: "Closer: whoever the meeting was assigned to. Setter: whoever booked it.",
  payment: "Closer: whoever the meeting was assigned to. Setter: whoever booked it.",
  assigned_closer: "Closer: the person the deal (else the lead) is assigned to, when they are a closer. Setter: whoever booked the meeting.",
};
export const NOT_READABLE = "Not available (needs permission)";

/** One appointment's sale facts, as grouped by the server. */
export type SaleFact = {
  locationId: string; owner: string | null; booker: string | null; /** The deal's assigned person, else the lead's. */ assignee: string | null;
  dealWon: boolean; dealHasValue: boolean; paid: boolean; paidHasValue: boolean; dealValue: number; paidAmount: number; n: number;
};
export type Credit = { sold: boolean; closer: string | null; value: number };

/** Is this appointment a sale, who is the closer, and what is it worth, under the chosen basis? `isCloser` decides whether a person is a closer in that account. */
export function creditSale(f: Omit<SaleFact, "n" | "dealValue" | "paidAmount"> & { dealValue?: number; paidAmount?: number }, s: SaleSettings, isCloser: (userId: string, locationId: string) => boolean, paymentsReadable: boolean): Credit {
  const no: Credit = { sold: false, closer: null, value: 0 };
  const dv = f.dealValue ?? 0, pv = f.paidAmount ?? 0;
  if (s.basis === "deal_won") {
    if (!f.dealWon || (!s.countWithoutValue && !f.dealHasValue)) return no;
    return { sold: true, closer: f.owner, value: dv };
  }
  if (s.basis === "payment") {
    if (!paymentsReadable || !f.paid || (!s.countWithoutValue && !f.paidHasValue)) return no;
    return { sold: true, closer: f.owner, value: pv };
  }
  // assigned_closer: the lead became a customer (paid, or deal won) and the assigned person is a closer.
  const customer = f.dealWon || (paymentsReadable && f.paid);
  if (!customer || !f.assignee || !isCloser(f.assignee, f.locationId)) return no;
  const value = paymentsReadable && f.paid && pv > 0 ? pv : dv;
  if (!s.countWithoutValue && !(value > 0)) return no;
  return { sold: true, closer: f.assignee, value };
}

export type SaleTally = { byCloser: Map<string, { count: number; value: number }>; byBooker: Map<string, { count: number; value: number }>; total: { count: number; value: number } };
/** Add up the grouped facts into sales per closer and per booker (the setter's "from their bookings"). */
export function tallySales(facts: readonly SaleFact[], s: SaleSettings, isCloser: (userId: string, locationId: string) => boolean, paymentsReadable: boolean): SaleTally {
  const out: SaleTally = { byCloser: new Map(), byBooker: new Map(), total: { count: 0, value: 0 } };
  const add = (m: Map<string, { count: number; value: number }>, k: string, n: number, v: number) => { const e = m.get(k) ?? { count: 0, value: 0 }; e.count += n; e.value += v; m.set(k, e); };
  for (const f of facts) {
    const c = creditSale(f, s, isCloser, paymentsReadable);
    if (!c.sold) continue;
    const v = c.value * f.n;
    out.total.count += f.n; out.total.value += v;
    if (c.closer) add(out.byCloser, c.closer, f.n, v);
    if (f.booker) add(out.byBooker, f.booker, f.n, v);
  }
  return out;
}

/** The three sections of the people table. */
export type ShareSection = "active" | "oncal" | "off";
export const SECTION_LABEL: Record<ShareSection, string> = { active: "Booking and selling", oncal: "On a calendar, no bookings yet", off: "Not on any calendar" };
export const SECTION_FIX: Record<ShareSection, string> = { active: "", oncal: "They can be booked, but nobody has booked them in these dates.", off: "Add them to a calendar so they can be booked." };
export const isSection = (v: unknown): v is ShareSection => v === "active" || v === "oncal" || v === "off";

/** Which section a person belongs to: any booking or sale first, then whether they are on a calendar. */
export function sectionOf(p: { booked: number; owned: number; sold: number; calendars: number }): ShareSection {
  if (p.booked + p.owned + p.sold > 0) return "active";
  return p.calendars > 0 ? "oncal" : "off";
}
export type Rankable = { name: string; booked: number; owned: number; sold: number; soldValue: number };
/** Ranked by sales, then sales value, then bookings, then name. */
export function rankActive<T extends Rankable>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.sold - a.sold || b.soldValue - a.soldValue || (b.booked + b.owned) - (a.booked + a.owned) || a.name.localeCompare(b.name));
}
/** Share of meetings taken that ended in a sale. Null under `min` meetings: not enough to say. */
export function soldRate(sold: number, showed: number, min = 5): number | null { return showed >= min ? Math.min(1, sold / showed) : null; }
