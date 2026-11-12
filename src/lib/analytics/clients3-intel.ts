import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
import type { Cl3Account, Cl3Level, Cl3Reason, Cl3ReasonCount, Cl3Today, Delta, Rate } from "./clients3-types";

// Pure rules behind the Clients screens (no database, unit tested). Definitions: docs/METRICS.md "Clients 3".
export const DAY = 86_400_000;
export const MIN_TREND_BASE = 10; // a drop in new leads counts only when the earlier period had at least this many
export const LEADS_DOWN_PCT = 40; // ... and fell by at least this much
export const MIN_SHARE = 20; // data-quality shares need at least this many contacts
export const WAIT_OLD_HOURS = 24; // a waiting reply is "old" past this
export const WAIT_OLD_ACT = 5; // this many old waiting replies makes an account "act"
export const STALE_DEAL_DAYS = 30; // open deal with no stage change this long
export const STALE_SHARE_PCT = 50; // stale share that raises a flag, with at least MIN_DEALS open deals
export const MIN_DEALS = 5;
export const QUIET_DAYS = 7; // a staff member with no messages sent this long is quiet
export const SYNC_OLD_HOURS = 24;
export const SYNC_ACT_HOURS = 72;
export const NO_OWNER_PCT = 30;
export const NO_PHONE_PCT = 30;
export const UNMARKED_FLAG = 3;
export const NOSHOW_FLAG = 3;

export const rate = (n: number, of: number, min = MIN_SHARE): Rate => ({ value: of >= min && of > 0 ? n / of : null, n, of, enough: of >= min });
export const delta = (current: number, previous: number, min = MIN_TREND_BASE): Delta => ({ current, previous, enough: previous >= min, change: previous >= min ? (current - previous) / previous : null });

export function parseWindow(from: string | null | undefined, to: string | null | undefined, now: number): { from: Date; to: Date; days: number; problem: string | null } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const f = from && iso.test(from) ? Date.parse(from) : NaN;
  const t = to && iso.test(to) ? Date.parse(to) : NaN;
  const end = Number.isFinite(t) ? t + DAY : Math.floor(now / DAY) * DAY + DAY;
  const start = Number.isFinite(f) ? f : end - 30 * DAY;
  if (end <= start) return { from: new Date(end - 30 * DAY), to: new Date(end), days: 30, problem: "The start date was after the end date, so the last 30 days are shown." };
  const days = Math.round((end - start) / DAY);
  if (days > MAX_RANGE_DAYS) return { from: new Date(end - MAX_RANGE_DAYS * DAY), to: new Date(end), days: MAX_RANGE_DAYS, problem: `Periods are limited to ${MAX_RANGE_DAYS} days.` };
  return { from: new Date(start), to: new Date(end), days, problem: null };
}
export const clampSize = (n: number): 20 | 50 | 100 => (n >= 100 ? 100 : n >= 50 ? 50 : 20);
export const mondayOf = (ms: number) => {
  const d = Math.floor(ms / DAY) * DAY;
  return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY;
};

export const REASON_TEXT: Record<Cl3Reason, { label: (n: number) => string; why: string }> = {
  leads_down: { label: () => "New leads are down", why: "Fewer enquiries are coming in than in the period before." },
  waiting: { label: (n) => `${n} ${n === 1 ? "reply is" : "replies are"} waiting`, why: "A customer wrote last and nobody has answered yet." },
  waiting_old: { label: (n) => `${n} waiting over a day`, why: "These customers have waited more than 24 hours for an answer." },
  unmarked: { label: (n) => `${n} booking${n === 1 ? "" : "s"} with no outcome`, why: "The time has passed and nobody marked it showed or no-show." },
  noshows: { label: (n) => `${n} no-show${n === 1 ? "" : "s"}`, why: "People who booked and did not come." },
  stale_deals: { label: (n) => `${n} deal${n === 1 ? "" : "s"} gone quiet`, why: `Open deals with no movement for ${STALE_DEAL_DAYS} days.` },
  no_owner: { label: () => "Many contacts have no owner", why: "Nobody is responsible for these contacts." },
  no_phone: { label: () => "Many contacts have no phone number", why: "These contacts cannot be called or texted." },
  staff_quiet: { label: (n) => `${n} team member${n === 1 ? "" : "s"} quiet`, why: `They have sent no messages in ${QUIET_DAYS} days.` },
  sync_old: { label: () => "Data is out of date", why: "We have not been able to refresh this account recently." },
  needs_permission: { label: () => "Needs permission: reconnect", why: "Reconnect so we can read this part of the account." },
};

export type AccountSignals = {
  newLeads: Delta; waiting: number; waitingOld: number; unmarked: number; noshows: number;
  staleDeals: number; openDeals: number; noOwner: Rate; noPhone: Rate; staffQuiet: number;
  syncAgeHours: number | null; needsPermission: string[]; hasAnyData: boolean;
};

/** Quiet marks (set in Reports and Needs attention, slice CB): what one mark hides from the ranking. Counts on the account stay real; only the reasons, level and summary change.
 *  "all" hides every client-attention reason but never a connection problem (needs_permission, sync_old), because those make every other number untrustworthy. */
export function applyQuiet(s: AccountSignals, kinds: readonly string[] | undefined): AccountSignals {
  if (!kinds || kinds.length === 0) return s;
  const all = kinds.includes("all"), out: AccountSignals = { ...s };
  if (all || kinds.includes("replies")) { out.waiting = 0; out.waitingOld = 0; }
  if (all || kinds.includes("noshows")) { out.noshows = 0; out.unmarked = 0; }
  if (all || kinds.includes("stale")) out.staleDeals = 0;
  if (all) { out.newLeads = { ...s.newLeads, change: null, enough: false }; out.staffQuiet = 0; out.noOwner = { ...s.noOwner, value: null, enough: false }; out.noPhone = { ...s.noPhone, value: null, enough: false }; }
  return out;
}

/** The reasons an account is flagged, each a count that opens its rows. Order = importance. */
export function reasonsOf(s: AccountSignals): Cl3ReasonCount[] {
  const out: Cl3ReasonCount[] = [];
  const add = (reason: Cl3Reason, count: number) => out.push({ reason, count, label: REASON_TEXT[reason].label(count), why: REASON_TEXT[reason].why });
  if (s.needsPermission.length) add("needs_permission", s.needsPermission.length);
  if (s.syncAgeHours === null || s.syncAgeHours > SYNC_OLD_HOURS) add("sync_old", 1);
  if (s.newLeads.enough && s.newLeads.change !== null && s.newLeads.change <= -LEADS_DOWN_PCT / 100) add("leads_down", Math.max(0, s.newLeads.previous - s.newLeads.current));
  if (s.waitingOld > 0) add("waiting_old", s.waitingOld);
  else if (s.waiting > 0) add("waiting", s.waiting);
  if (s.unmarked >= UNMARKED_FLAG) add("unmarked", s.unmarked);
  if (s.noshows >= NOSHOW_FLAG) add("noshows", s.noshows);
  if (s.openDeals >= MIN_DEALS && s.staleDeals / s.openDeals >= STALE_SHARE_PCT / 100) add("stale_deals", s.staleDeals);
  if (s.staffQuiet > 0) add("staff_quiet", s.staffQuiet);
  if (s.noOwner.enough && (s.noOwner.value ?? 0) * 100 >= NO_OWNER_PCT) add("no_owner", s.noOwner.n);
  if (s.noPhone.enough && (s.noPhone.value ?? 0) * 100 >= NO_PHONE_PCT) add("no_phone", s.noPhone.n);
  return out;
}

/** act: something is losing money now (old waiting replies, leads falling, missing permission, data stale 3 days). watch: any other reason. unknown: nothing to judge. */
export function levelOf(s: AccountSignals, reasons: Cl3ReasonCount[]): Cl3Level {
  if (!s.hasAnyData && s.syncAgeHours === null) return "unknown";
  const has = (r: Cl3Reason) => reasons.some((x) => x.reason === r);
  if (s.needsPermission.length || s.waitingOld >= WAIT_OLD_ACT || has("leads_down") || (s.syncAgeHours !== null && s.syncAgeHours > SYNC_ACT_HOURS)) return "act";
  return reasons.length ? "watch" : "ok";
}

export const summaryOf = (reasons: Cl3ReasonCount[]): string | null => (reasons.length ? reasons.slice(0, 3).map((r) => r.label).join(", ") : null);
export const LEVEL_RANK: Record<Cl3Level, number> = { act: 0, watch: 1, unknown: 2, ok: 3 };
export const byAttention = (a: Cl3Account, b: Cl3Account) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.reasons.length - a.reasons.length || b.waitingOld - a.waitingOld || a.name.localeCompare(b.name);

const BUTTON: Record<Cl3Reason, string> = {
  needs_permission: "Reconnect accounts", waiting_old: "Reply to waiting customers", unmarked: "Mark appointment outcomes", leads_down: "See where leads dropped", noshows: "Follow up no-shows",
  waiting: "Reply to waiting customers", stale_deals: "Wake up quiet deals", staff_quiet: "See who is quiet", sync_old: "Check data freshness", no_owner: "Assign owners", no_phone: "Fix missing phones",
};

/** The one plain thing to do today: the biggest money problem first (old waiting replies), then missing outcomes, then the rest. */
export function todayOf(accounts: Cl3Account[]): Cl3Today {
  const order: Cl3Reason[] = ["needs_permission", "waiting_old", "unmarked", "leads_down", "noshows", "waiting", "stale_deals", "staff_quiet", "sync_old"];
  for (const reason of order) {
    const hit = accounts.filter((a) => a.reasons.some((r) => r.reason === reason));
    if (!hit.length) continue;
    const count = hit.reduce((n, a) => n + (a.reasons.find((r) => r.reason === reason)?.count ?? 0), 0);
    const one = hit.length === 1 ? hit[0] : null;
    const where = one ? `in ${one.name}` : `across ${hit.length} accounts`;
    return { headline: `${REASON_TEXT[reason].label(count)} ${where}.`, button: { label: BUTTON[reason], reason, locationId: one ? one.locationId : null, count } };
  }
  return { headline: accounts.length ? "Every client account looks healthy." : "No client accounts yet.", button: null };
}

export function fmtMinutes(m: number): string {
  return m < 1 ? "under a minute" : m < 60 ? `${Math.round(m)} minutes` : m < 1440 ? `${Math.round(m / 6) / 10} hours` : `${Math.round(m / 144) / 10} days`;
}

export function receiptLines(r: { cameIn: number; cameInPrev: number; answered: number; stillWaiting: number; medianReplyMinutes: number | null; booked: number; showed: number; noshow: number; won: number; wonValue: number }): string[] {
  const out: string[] = [];
  out.push(`${r.cameIn} new ${r.cameIn === 1 ? "enquiry" : "enquiries"} came in${r.cameInPrev > 0 ? ` (${r.cameInPrev} the week before)` : ""}.`);
  if (r.answered > 0) out.push(`${r.answered} ${r.answered === 1 ? "was" : "were"} answered by the team${r.medianReplyMinutes !== null ? `, usually within ${fmtMinutes(r.medianReplyMinutes)}` : ""}.`);
  if (r.stillWaiting > 0) out.push(`${r.stillWaiting} ${r.stillWaiting === 1 ? "is" : "are"} still waiting for a reply.`);
  if (r.booked > 0) out.push(`${r.booked} appointment${r.booked === 1 ? "" : "s"} booked${r.showed + r.noshow > 0 ? `, ${r.showed} came and ${r.noshow} did not` : ""}.`);
  if (r.won > 0) out.push(`${r.won} deal${r.won === 1 ? "" : "s"} won, worth ${Math.round(r.wonValue).toLocaleString("en-US")}.`);
  return out;
}
