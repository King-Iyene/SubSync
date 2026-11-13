// FUNNEL EFFECTS: the pure rules behind the funnel's motion and its plain-words text. Unit-tested. The screen only draws what this says.
// Rule of thumb for every effect: it may decorate a number, never replace or hide one.

/** Most flow dots on screen at once, over every band. Keeps the picture light at any size of pipeline. */
export const MAX_PARTICLES = 60;

export type Flow = { count: number; dur: number; size: number };
/** How many glowing dots travel along each band and how fast. A thicker band (more deals or money) gets more dots and they move faster (shorter trip time). Never more than `cap` in total; every band with volume gets at least one dot while there is room. */
export function particlePlan(thicks: number[], cap = MAX_PARTICLES): Flow[] {
  const max = Math.max(0, ...thicks);
  if (!(max > 0)) return thicks.map(() => ({ count: 0, dur: 0, size: 0 }));
  const plan = thicks.map((t) => {
    if (!(t > 0)) return { count: 0, dur: 0, size: 0 };
    const share = t / max;
    return { count: Math.max(1, Math.round(share * 8)), dur: Math.round((9 - 5 * share) * 100) / 100, size: Math.round((1.6 + 2.2 * share) * 10) / 10 };
  });
  const total = () => plan.reduce((a, b) => a + b.count, 0);
  while (total() > cap) {
    let i = 0; plan.forEach((p, j) => { if (p.count > plan[i].count) i = j; });
    if (plan[i].count <= 0) break;
    if (plan[i].count === 1) { // out of room even at one each: drop the thinnest band's dot
      let j = -1; plan.forEach((p, k) => { if (p.count > 0 && (j < 0 || thicks[k] < thicks[j])) j = k; });
      plan[j].count = 0; continue;
    }
    plan[i].count--;
  }
  return plan;
}

/** Where a dot starts along its band's trip (0 to 1), spread evenly so the stream looks steady. */
export const dotOffset = (i: number, count: number): number => (count > 0 ? i / count : 0);

/** Two-letter chip text for a person's name: "Ada Obi" gives AO, "Tunde (sample)" gives T. */
export function initials(name: string): string {
  const parts = name.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 1) : parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

const nf = (v: number) => v.toLocaleString("en-US");
/** The one sentence a band says, in plain words: "53 of 57 moved on (93%) | $412k". Used by the tooltip AND the screen-reader label so they always match. */
export function bandText(o: { toN: number; fromN: number; pct: string | null; moneyText?: string | null }): string {
  if (!(o.fromN > 0)) return "Nobody got here in these dates";
  return `${nf(o.toN)} of ${nf(o.fromN)} moved on${o.pct ? ` (${o.pct})` : ""}${o.moneyText ? ` | ${o.moneyText}` : ""}`;
}

/** The plain line under the funnel that says what the biggest leak is. */
export const LEAK_LINE = "Biggest leak = the step where the most deals were marked Lost while they sat in it, and what % of deals that got that far.";
/** Why the leak may be missing: said out loud, never hidden. */
export const LEAK_NEEDS = (closed: number, min: number) => `The biggest leak shows once ${min} deals are closed (won or lost). You have ${closed} so far.`;

/** The "How to read this" strip: one plain line per colour. Always visible. `kind` picks the swatch. */
export const HOW_TO_READ: ReadonlyArray<{ kind: "moved" | "lost" | "won" | "stuck" | "waiting"; label: string; line: string }> = [
  { kind: "moved", label: "Moved on", line: "The wide band is deals that moved on to the next step. The thicker it is, the more deals (or money) it carries." },
  { kind: "lost", label: "Lost here", line: "The red band leaving upward is deals marked Lost while they sat in that step." },
  { kind: "won", label: "Won", line: "The gold end is deals that were won." },
  { kind: "stuck", label: "Stuck too long", line: "Striped orange means waiting longer than is normal for that step." },
  { kind: "waiting", label: "Still waiting", line: "Grey at the bottom of a step is open deals still sitting there." },
];
