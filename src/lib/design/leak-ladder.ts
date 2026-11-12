// The maths behind the booking "leak ladder" (pure). Each step is a row: leads left, the share that got through, how many were lost here, and one plain thing to do.
// The counts come from the server's own step rows; nothing is re-counted here, so a row's number and the list it opens are always the same number.
import { deltaTone, SCALES, toneOf, type Scale, type Tone } from "./status-tone.ts";

export type LadderStep = { key: string; label: string; count: number; passPct: number | null; lost: number; dropPct: number | null; enough: boolean };
export type LadderRow = {
  key: string; label: string; count: number; widthPct: number; pass: number | null; tone: Tone; lost: number; lostTone: Tone; dropPct: number | null;
  todo: string; biggest: boolean; deltaPoints: number | null; deltaTone: Tone; first: boolean; enough: boolean;
};
export const STEP_SCALE: Record<string, Scale> = { answered: SCALES.reply, booked: SCALES.booked, showed: SCALES.show, deal: SCALES.deal, won: SCALES.won };
const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) => (v === 1 ? one : many);

/** The one thing to do about the leads lost at a step, in plain words, from the real count. */
export function todoFor(key: string, lost: number): string {
  if (lost <= 0) return "Nothing lost here.";
  const who = `${n(lost)} ${plural(lost, "lead", "leads")}`;
  switch (key) {
    case "answered": return `${who} never got a first reply: open the list and reply today.`;
    case "booked": return `${who} got a reply but never booked: open the list and offer a time.`;
    case "showed": return `${who} booked but did not show: open the list and call to rebook.`;
    case "deal": return `${who} showed up but no deal was opened: open the list and add the deal.`;
    case "won": return `${who} have a deal that is not won yet: open the list and follow up.`;
    default: return `${who} stopped here: open the list.`;
  }
}

export function ladderRows(steps: readonly LadderStep[], biggest: string | null, prev: readonly LadderStep[] | null): LadderRow[] {
  const top = steps[0]?.count || 0;
  return steps.map((s, i) => {
    const scale = STEP_SCALE[s.key];
    const pass = s.passPct === null ? null : s.passPct / 100;
    const before = prev?.find((p) => p.key === s.key);
    const prevPass = before && before.passPct !== null && before.enough ? before.passPct / 100 : null;
    const delta = pass !== null && prevPass !== null && s.enough ? pass - prevPass : null;
    const tone: Tone = i === 0 || !scale || !s.enough ? "neutral" : toneOf(pass, scale);
    // The "lost here" chip: red when the step is in its bad band, amber in its watch band (and for a good step with losses), grey when there is too little data to say.
    return {
      key: s.key, label: s.label, count: s.count, widthPct: top > 0 ? Math.max(s.count > 0 ? 1.5 : 0, (s.count / top) * 100) : 0, pass, tone, lost: s.lost, lostTone: s.lost > 0 ? (tone === "neutral" ? "neutral" : tone === "good" ? "caution" : tone) : "neutral",
      dropPct: s.dropPct, todo: i === 0 ? "Every lead that came in during these dates." : todoFor(s.key, s.lost), biggest: biggest === s.key, deltaPoints: delta === null ? null : Math.round(delta * 100),
      deltaTone: delta === null ? "neutral" : deltaTone(delta, true), first: i === 0, enough: s.enough,
    };
  });
}
export const countsMatch = (rows: readonly LadderRow[], steps: readonly LadderStep[]) => rows.length === steps.length && rows.every((r, i) => r.count === steps[i].count && r.lost === steps[i].lost);
