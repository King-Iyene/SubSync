import { PROTECT_WORDS, protectedReason, type ProtectReason } from "../cleanup/cu-core.ts";

// The "Show copies" panel and the "Protected" explainer on the Duplicates list. Pure words and rules, so the screen and the tests read the same thing.

export const PROTECTED_EXPLAINER = "Protected means one of these copies has Do Not Disturb, an open deal, or a coming appointment. Merge all certain matches skips protected people and SubSync never deletes them, so nobody loses consent or a live sale. You can still use Merge this person for protected people one at a time, after checking.";
export const DELETE_BLOCKED_WHY = "Everyone else here is protected";

export type CopyChip = { reason: ProtectReason; text: string; title: string };
export type CopyFacts = { dnd?: boolean | null; openDeals?: number | null; openValue?: number | null; appointments?: number | null; nextAppointmentAt?: string | null };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Every reason one copy is protected, in the order the rules use. Each chip carries the plain-words rule (PROTECT_WORDS) as its hover text. */
export function protectChips(p: CopyFacts): CopyChip[] {
  const out: CopyChip[] = [];
  if (p.dnd === true) out.push({ reason: "dnd", text: "Do Not Disturb", title: PROTECT_WORDS.dnd });
  if ((p.openDeals ?? 0) > 0) out.push({ reason: "open_deal", text: (p.openValue ?? 0) > 0 ? `Open deal ${money(p.openValue ?? 0)}` : "Open deal", title: PROTECT_WORDS.open_deal });
  if (p.nextAppointmentAt) out.push({ reason: "appointment", text: `Appointment on ${day(p.nextAppointmentAt)}`, title: PROTECT_WORDS.appointment });
  return out;
}

/** The first reason (the one the list shows) always comes from the shared rule. */
export const firstReason = (p: CopyFacts): ProtectReason | null => protectedReason({ dnd: p.dnd, openDeals: p.openDeals, upcomingAppointments: p.nextAppointmentAt ? 1 : 0 });
