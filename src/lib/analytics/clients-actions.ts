// Clients module, slice CB: the weekly receipt for one client, the mute and target rules, and the reconnect words. Pure functions (no database), so every rule is unit tested.
// Real counts only: nothing here is scored or predicted. A share is shown only with enough leads behind it; otherwise "not enough yet".

export const MIN_LEADS_FOR_SHARE = 5;
export const MUTE_KINDS = ["all", "replies", "noshows", "stale", "renewal"] as const;
export type MuteKind = (typeof MUTE_KINDS)[number];
export const MUTE_DAYS = [7, 14, 30, 90] as const;
const DAY = 86_400_000;

export const MUTE_WORDS: Record<MuteKind, string> = {
  all: "Everything about this client", replies: "Waiting replies", noshows: "No-shows", stale: "Quiet deals", renewal: "Renewal reminder",
};

export type ReceiptFacts = {
  locationId: string; name: string;
  newContacts: number;
  leads: number; answered: number; answeredInTarget: number; targetMinutes: number;
  appointments: { held: number; showed: number; noShow: number; unmarked: number };
  deals: { started: number; startedValue: number; won: number; wonValue: number; lost: number };
};
export type ReceiptLine = { id: string; label: string; value: string; note: string | null };
export type Receipt = { locationId: string; name: string; from: string; to: string; lines: ReceiptLine[]; headline: string; empty: boolean };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The last 7 days ending now. Real timestamps, no calendar-week guessing. */
export function weekWindow(now: number): { from: number; to: number } {
  return { from: now - 7 * DAY, to: now };
}

/** One plain line per thing the client cares about. Each is a count from the synced data; nothing is invented. */
export function receiptOf(f: ReceiptFacts, now: number): Receipt {
  const w = weekWindow(now);
  const lines: ReceiptLine[] = [];
  lines.push({ id: "contacts", label: "New leads", value: String(f.newContacts), note: null });
  if (f.leads >= MIN_LEADS_FOR_SHARE) {
    const share = Math.round((f.answeredInTarget / f.leads) * 100);
    lines.push({ id: "replies", label: "Answered in time", value: `${share}%`, note: `${f.answeredInTarget} of ${f.leads} new leads got a reply within ${f.targetMinutes} minutes.` });
  } else {
    lines.push({ id: "replies", label: "Answered in time", value: "Not enough yet", note: f.leads === 0 ? "No new leads were tracked this week." : `Only ${plural(f.leads, "lead")} were tracked; a share needs at least ${MIN_LEADS_FOR_SHARE}.` });
  }
  const a = f.appointments;
  lines.push({ id: "appointments", label: "Appointments held", value: String(a.held), note: a.held === 0 ? null : `${a.showed} showed, ${a.noShow} did not show${a.unmarked > 0 ? `, ${a.unmarked} not marked yet` : ""}.` });
  lines.push({ id: "deals", label: "Deals started", value: String(f.deals.started), note: f.deals.started > 0 && f.deals.startedValue > 0 ? `${money(f.deals.startedValue)} in value (as entered in the CRM).` : null });
  lines.push({ id: "won", label: "Deals won", value: String(f.deals.won), note: f.deals.won > 0 && f.deals.wonValue > 0 ? `${money(f.deals.wonValue)} in value.` : f.deals.lost > 0 ? `${plural(f.deals.lost, "deal")} marked lost.` : null });
  const empty = f.newContacts === 0 && f.leads === 0 && a.held === 0 && f.deals.started === 0 && f.deals.won === 0;
  const headline = empty
    ? `Nothing was recorded for ${f.name} in the last 7 days.`
    : `${f.name}: ${plural(f.newContacts, "new lead")}, ${plural(a.held, "appointment")} held, ${plural(f.deals.won, "deal")} won in the last 7 days.`;
  return { locationId: f.locationId, name: f.name, from: day(w.from), to: day(w.to), lines, headline, empty };
}

/** The words an agency can paste to its client. No fee, no private note, no product name; the brand is the agency's own. */
export function receiptText(r: Receipt, brand: string | null): string {
  const out = [`Weekly report for ${r.name}`, `${r.from} to ${r.to}`, ""];
  for (const l of r.lines) out.push(`${l.label}: ${l.value}${l.note ? ` (${l.note})` : ""}`);
  if (r.empty) out.push("", "No activity was recorded in this period.");
  if (brand) out.push("", `Prepared by ${brand}.`);
  return out.join("\n");
}

type Cell = string | number | null;
/** CSV text with formula injection blocked (a client's name can start with = + - @). */
export function csvOf(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
export function receiptCsv(receipts: Receipt[]): string {
  return csvOf([["Client", "From", "To", "Measure", "Value", "Detail"], ...receipts.flatMap((r) => r.lines.map((l): Cell[] => [r.name, r.from, r.to, l.label, l.value, l.note]))]);
}

// ---- mute and target ----

export type MuteInput = { kind: MuteKind; days: number };
export function parseMute(b: unknown): { ok: true; value: MuteInput } | { ok: false; error: string } {
  const o = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  const kind = MUTE_KINDS.find((k) => k === o.kind);
  if (!kind) return { ok: false, error: "Choose what to quiet." };
  const days = Number(o.days);
  if (!(MUTE_DAYS as readonly number[]).includes(days)) return { ok: false, error: "Choose 7, 14, 30 or 90 days." };
  return { ok: true, value: { kind, days } };
}
export const muteUntil = (now: number, days: number) => new Date(now + days * DAY);
export const muteLine = (kind: MuteKind, untilMs: number, now: number) => `${MUTE_WORDS[kind]} quieted until ${day(untilMs)} (${Math.max(1, Math.ceil((untilMs - now) / DAY))} days). Nothing was changed in your CRM.`;

/** Minutes 1 to 1440, or null to go back to the default. A string of digits is accepted (a form field). */
export function parseTargetMinutes(v: unknown): { ok: true; minutes: number | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, minutes: null };
  const n = typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1440) return { ok: false, error: "Type a whole number of minutes from 1 to 1440." };
  return { ok: true, minutes: n };
}

// ---- setup health: the exact words, never blurred ----

export type SetupFacts = { appointmentsAccess: string | null; usersAccess: string | null; contactsSyncedAt: number | null; appointmentsSyncedAt: number | null };
export type SetupItem = { id: string; ok: boolean; text: string; fix: "reconnect" | "wait" | null };
export function setupItems(f: SetupFacts, now: number): SetupItem[] {
  const out: SetupItem[] = [];
  const age = f.contactsSyncedAt === null ? null : Math.floor((now - f.contactsSyncedAt) / DAY);
  out.push(age === null ? { id: "sync", ok: false, text: "Not read yet. The first read of this client has not finished.", fix: "wait" }
    : age >= 2 ? { id: "sync", ok: false, text: `Last read ${age} days ago, so the numbers may be behind.`, fix: "wait" }
    : { id: "sync", ok: true, text: "Read recently.", fix: null });
  out.push(f.appointmentsAccess === "needs_permission" ? { id: "appointments", ok: false, text: "Needs permission: reconnect so SubSync can read appointments. Show rate stays empty until then.", fix: "reconnect" }
    : f.appointmentsAccess === "ok" ? { id: "appointments", ok: true, text: "Appointments can be read.", fix: null }
    : { id: "appointments", ok: false, text: "Appointments have not been checked yet.", fix: "wait" });
  out.push(f.usersAccess === "needs_permission" ? { id: "users", ok: false, text: "Needs permission: reconnect so SubSync can show staff names. Counts still work; names show as ids.", fix: "reconnect" }
    : f.usersAccess === "ok" ? { id: "users", ok: true, text: "Staff names can be read.", fix: null }
    : { id: "users", ok: false, text: "Staff names have not been checked yet.", fix: "wait" });
  return out;
}
