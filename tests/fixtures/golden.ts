// The golden dataset: small, hand-built, and every answer is known and written next to the data.
// Tests assert these exact answers, so a change in any definition fails loudly instead of drifting.
import type { TouchRow } from "@/lib/analytics/speed-intel";

export const GOLDEN_NOW = Date.parse("2026-10-31T12:00:00Z");
const MIN = 60_000, DAY = 86_400_000;

const lead = (id: string, ageMs: number, replyAfterMs: number | null, userId: string | null = "u1", source: string | null = "Website form"): TouchRow => ({
  locationId: "L1", contactId: id, leadAt: GOLDEN_NOW - ageMs, touchAt: replyAfterMs === null ? null : GOLDEN_NOW - ageMs + replyAfterMs, userId, source,
});

// Account target: 15 minutes. Ten leads:
//   g01 answered by a person after 10 minutes            -> inside the target
//   g02 arrived 5 minutes ago, not answered yet           -> still inside the window, so not judged
//   g03 to g10 never answered, 4 to 11 days old           -> eight leads that were missed
export const GOLDEN_LEADS: TouchRow[] = [
  lead("g01", 2 * 3_600_000, 10 * MIN),
  lead("g02", 5 * MIN, null, null),
  ...[4, 5, 6, 7, 8, 9, 10, 11].map((d, i) => lead(`g${String(i + 3).padStart(2, "0")}`, d * DAY, null, null)),
];

export const GOLDEN_ANSWERS = {
  targetMinutes: 15,
  total: 10,
  /** Leads judged against the target (the 5-minute-old one is not judged yet). */
  judged: 9,
  withinTarget: 1,
  answeredLate: 0,
  stillWaiting: 8,
  /** All eight are older than three days. */
  neverAnswered: 8,
  /** One of nine judged is a hit; nine is above the minimum of five, so a rate is shown. */
  hitRate: 1 / 9,
  /** Only one reply, below the minimum of five replies for a typical time. */
  medianSeconds: null,
};
