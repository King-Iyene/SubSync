import type { MasterPerson } from "./master-rank.ts";
import { CANNOT_SEE } from "./master-rank.ts";

// What a merge or a delete does to EACH copy, in plain words, before anyone confirms. Mirrors the server rule for delete (dq/delete): Do Not Disturb, an open deal, a coming appointment,
// a conversation or a won deal all stop a delete. Nothing here is a guess: what SubSync cannot read is said, never treated as "none".

export type ImpactPerson = MasterPerson & { dnd?: boolean; openValue?: number; source?: string | null };
export type CopyImpact = { contactId: string; role: "keep" | "merge" | "choose"; moves: string[]; lost: string[]; cannotDelete: string[]; canDelete: boolean };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Why this copy can NEVER be deleted by SubSync, one plain sentence each. Empty means it can be. */
export function cannotDeleteReasons(p: ImpactPerson): string[] {
  const out: string[] = [];
  if (p.dnd === true) out.push("Do Not Disturb: we never delete this person so consent is not lost.");
  if (p.openDeals > 0) out.push(`Has an open deal${(p.openValue ?? 0) > 0 ? ` ${money(p.openValue ?? 0)}` : ""}.`);
  if (p.nextAppointmentAt) out.push(`Has a coming appointment on ${day(p.nextAppointmentAt)}.`);
  if (p.wonDeals > 0) out.push(`Has ${plural(p.wonDeals, "won deal", "won deals")}: deleting would lose that history.`);
  if (p.hasConversation) out.push("Has conversations: deleting would lose them. Merge instead so they are kept.");
  return out;
}

export function copyImpacts(people: readonly ImpactPerson[], keepId: string | null): CopyImpact[] {
  const keep = people.find((p) => p.contactId === keepId) ?? null;
  const have = new Set((keep?.tags ?? []).map(norm));
  return people.map((p) => {
    if (!keep) return { contactId: p.contactId, role: "choose" as const, moves: [], lost: [], cannotDelete: cannotDeleteReasons(p), canDelete: false };
    if (p.contactId === keep.contactId) return { contactId: p.contactId, role: "keep" as const, moves: [], lost: [], cannotDelete: [], canDelete: false };
    const tags = new Set(p.tags.map(norm).filter((t) => t && !have.has(t))).size;
    const moves = [tags && plural(tags, "tag", "tags"), p.openDeals + p.wonDeals > 0 && plural(p.openDeals + p.wonDeals, "deal", "deals"), (p.appointments ?? 0) > 0 && plural(p.appointments ?? 0, "appointment", "appointments"), p.hasConversation && "its conversation", "notes, tasks and custom fields"].filter(Boolean) as string[];
    const lost: string[] = [];
    for (const [label, a, b] of [["Name", keep.name, p.name], ["Email", keep.email, p.email], ["Phone", keep.phone, p.phone], ["Owner", keep.ownerName, p.ownerName], ["Source", keep.source, p.source]] as const) {
      if (norm(a) && norm(b) && norm(a) !== norm(b)) lost.push(`${label} "${b}" is replaced by the kept copy's "${a}"`);
    }
    const cannotDelete = cannotDeleteReasons(p);
    return { contactId: p.contactId, role: "merge" as const, moves, lost, cannotDelete, canDelete: cannotDelete.length === 0 };
  });
}

export const UNREADABLE_LINE = CANNOT_SEE;
export const NOTHING_DELETED = "Nothing will be deleted: everyone else here is protected or has history. You can still merge them one at a time.";

// ------------------------------------------------------------------------------------------------ the merge comparison, one row per fact
export const UNSEEN = "We cannot see this yet (needs permission)";
export const LABEL_PRIMARY = "Primary contact (kept)";
export const LABEL_SECONDARY = "Secondary contact (will be merged into the primary and removed)";
export const MAKE_PRIMARY = "Make this the primary contact";
export const TICK_WORDS = "I checked the secondary contacts' payments, bookings and automations";

/** What SubSync holds about one copy beyond the basics (conversation, deals, bookings). Undefined on a person = not loaded = shown as unreadable, never as none. */
export type DetailFacts = {
  lastConversation: { at: string | null; type: string | null; direction: string | null } | null;
  deals: Array<{ status: "open" | "won"; pipeline: string | null; stage: string | null; value: number; owner: string | null }>;
  calendars: string[]; nextCalendar: string | null;
};
export type DetailPerson = ImpactPerson & { lastActivityAt?: string | null; facts?: DetailFacts };

const CHANNEL: Record<string, string> = { sms: "text message", email: "email", call: "phone call", whatsapp: "WhatsApp", facebook: "Facebook Messenger", instagram: "Instagram", gmb: "Google Business chat", live_chat: "website chat", custom: "a custom channel" };
/** TYPE_SMS, TYPE_EMAIL, ... to plain words. Unknown kinds are shown as they are, never invented. */
export const channelWords = (t: string | null | undefined): string | null => { if (!t) return null; const k = t.replace(/^TYPE_/i, "").toLowerCase(); return CHANNEL[k] ?? k.replace(/_/g, " "); };
const dealLine = (d: DetailFacts["deals"][number]) => `${d.pipeline ?? "A pipeline"} > ${d.stage ?? "a stage"}${d.value > 0 ? `, ${money(d.value)}` : ""}`;
export const lastConversationLine = (c: NonNullable<DetailFacts["lastConversation"]>): string => {
  const who = c.direction === "inbound" ? "the contact wrote last" : c.direction === "outbound" ? "your team wrote last" : "who wrote last is not recorded";
  return [c.at ? day(c.at) : "date not recorded", channelWords(c.type) ?? "channel not recorded", who].join(", ");
};
/** value null = SubSync cannot read it (never blank, never zero). `note` is a smaller second line. */
export type FieldRow = { id: string; label: string; value: string | null; note?: string };

const shortDay = (iso: string | null | undefined) => (iso ? day(iso) : null);
/** Every row for one copy. Names and values are shown exactly as stored (no case changes). */
export function fieldRows(p: DetailPerson): FieldRow[] {
  const f = p.facts, open = f?.deals.filter((d) => d.status === "open") ?? [], won = f?.deals.filter((d) => d.status === "won") ?? [];
  const owners = [...new Set((f?.deals ?? []).map((d) => d.owner).filter((o): o is string => !!o))];
  const deals = p.openDeals > 0 ? `${plural(p.openDeals, "open deal", "open deals")}${(p.openValue ?? 0) > 0 ? `, ${money(p.openValue ?? 0)}` : ""}` : "No open deals";
  return [
    { id: "name", label: "Name", value: p.name },
    { id: "phone", label: "Phone", value: p.phone?.trim() ? p.phone : "No phone on file" },
    { id: "email", label: "Email", value: p.email?.trim() ? p.email : "No email on file" },
    { id: "owner", label: "Owner", value: p.ownerName?.trim() ? p.ownerName : "No owner" },
    { id: "source", label: "Source", value: p.source?.trim() ? p.source : "No source" },
    { id: "tags", label: "Tags", value: p.tags.length ? p.tags.join(", ") : "No tags" },
    { id: "created", label: "Created", value: shortDay(p.createdAt) ?? "Not known" },
    { id: "last", label: "Last activity", value: shortDay(p.lastActivityAt) ?? "No activity recorded" },
    { id: "conv", label: "Last conversation", value: f?.lastConversation ? lastConversationLine(f.lastConversation) : p.hasConversation ? "A conversation is on file" : "No conversation", note: p.hasConversation && !f ? "Date, channel and who wrote last: we cannot see this yet (needs permission)" : undefined },
    { id: "open", label: "Open deals", value: deals, note: open.length ? open.map(dealLine).join("; ") : p.openDeals > 0 && !f ? "Pipeline and stage: open it in your CRM" : undefined },
    { id: "won", label: "Won deals", value: p.wonDeals > 0 ? plural(p.wonDeals, "won deal", "won deals") : "No won deals", note: won.length ? won.map(dealLine).join("; ") : undefined },
    { id: "next", label: "Upcoming appointment", value: p.nextAppointmentAt ? day(p.nextAppointmentAt) : "None coming", note: f?.nextCalendar ? `Calendar: ${f.nextCalendar}` : p.nextAppointmentAt && !f ? "Calendar name: open it in your CRM" : undefined },
    { id: "appts", label: "Appointments booked", value: plural(p.appointments ?? 0, "appointment", "appointments"), note: f?.calendars.length ? `Calendars: ${f.calendars.join(", ")}` : undefined },
    { id: "pay", label: "Ongoing payments and subscriptions", value: null }, { id: "inv", label: "Invoices", value: null },
    { id: "wf", label: "Automations enrolled in", value: null }, { id: "camp", label: "Campaigns", value: null }, { id: "course", label: "Courses, memberships and products", value: null },
    { id: "notes", label: "Notes and tasks", value: null },
    { id: "dnd", label: "Do Not Disturb", value: p.dnd === true ? "On" : "Not on", note: "Per-channel flags: we cannot see this yet (needs permission)" },
    { id: "oppowner", label: "Opportunities owner", value: f ? (owners.length ? owners.join(", ") : "No deals, or no owner on them") : null }, { id: "cf", label: "Custom fields that differ", value: null },
  ];
}

/** Readable rows whose values are not the same on every copy (the compact side-by-side). */
export function diffRows(people: readonly DetailPerson[]): Array<{ id: string; label: string; values: string[] }> {
  if (people.length === 0) return [];
  const all = people.map(fieldRows);
  return all[0].flatMap((r, i) => {
    if (r.value === null) return [];
    const values = all.map((a) => a[i].value as string);
    return new Set(values).size > 1 ? [{ id: r.id, label: r.label, values }] : [];
  });
}

export type Consequence = { keep: string; moves: string; remove: string[]; cannotMove: string; risks: string[] };
/** "This will keep X, move N tags... to it, remove A and B. These cannot be moved automatically..." Names are exactly as stored. */
export function consequence(people: readonly DetailPerson[], primaryId: string): Consequence | null {
  const keep = people.find((p) => p.contactId === primaryId);
  if (!keep) return null;
  const others = people.filter((p) => p.contactId !== primaryId);
  const have = new Set(keep.tags.map(norm));
  const tags = new Set(others.flatMap((o) => o.tags.map(norm)).filter((t) => t && !have.has(t))).size;
  const n = (k: (o: DetailPerson) => number) => others.reduce((s, o) => s + k(o), 0);
  const bits = [plural(tags, "tag", "tags"), plural(n((o) => o.openDeals + o.wonDeals), "deal", "deals"), plural(n((o) => (o.hasConversation ? 1 : 0)), "conversation", "conversations"), plural(n((o) => o.appointments ?? 0), "appointment", "appointments")];
  const risks: string[] = [];
  for (const o of others) {
    if (o.nextAppointmentAt) risks.push(`${o.name} has a booking on ${day(o.nextAppointmentAt)}.`);
    if (o.openDeals > 0) risks.push(`${o.name} has ${plural(o.openDeals, "open deal", "open deals")}${(o.openValue ?? 0) > 0 ? ` (${money(o.openValue ?? 0)})` : ""}.`);
    if (o.dnd === true) risks.push(`${o.name} is on Do Not Disturb: check the primary contact keeps it.`);
  }
  return { keep: keep.name, moves: `${bits.join(", ")}, and their notes and tasks`, remove: others.map((o) => o.name), cannotMove: "workflow enrolments, payments and subscriptions, course access", risks };
}
export const consequenceText = (c: Consequence) => `This will: keep ${c.keep}; move ${c.moves} to it; remove ${c.remove.join(", ")}. These cannot be moved automatically: ${c.cannotMove}. Check them in your CRM first.`;
/** Unknown is never none: the tick is always required, and so is a chosen primary and the typed words. */
export const confirmReady = (o: { typedOk: boolean; ticked: boolean; primaryId: string | null; busy: boolean }) => !!o.primaryId && o.typedOk && o.ticked && !o.busy;
