// Clients coming and going: clients added and removed per week. Pure, unit tested (src/lib/__tests__/clients-flow.test.ts). Definition: docs/METRICS.md.
// Arrivals come from when SubSync first saw a client; departures only from the day SubSync began recording them, so earlier departures are not in the numbers.

export type ClientEvent = { locationId: string; name: string; kind: "added" | "removed"; at: number };
export type WeekBar = { start: string; label: string; added: number; removed: number; startMs: number; endMs: number };
const DAY = 86_400_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday (UTC, 00:00) of the week a moment falls in. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday is 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/** The last `n` weeks (oldest first, the current week last, still running) with how many clients were added and removed in each. */
export function weeksOf(events: ClientEvent[], now: number, n = 12): WeekBar[] {
  const last = weekStart(now);
  const bars: WeekBar[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = last - i * 7 * DAY;
    const d = new Date(s);
    bars.push({ start: iso(s), label: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`, added: 0, removed: 0, startMs: s, endMs: s + 7 * DAY });
  }
  for (const e of events) {
    const b = bars.find((x) => e.at >= x.startMs && e.at < x.endMs);
    if (b) b[e.kind]++;
  }
  return bars;
}

export const eventsInWeek = (events: ClientEvent[], bar: WeekBar, kind?: "added" | "removed") => events.filter((e) => e.at >= bar.startMs && e.at < bar.endMs && (!kind || e.kind === kind));
