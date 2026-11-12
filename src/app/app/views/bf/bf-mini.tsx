"use client";

import { useMemo } from "react";
import { useData } from "../../session";
import type { GoFn } from "../../nav";
import { BookingLadder } from "./bf-ladder";
import { SAMPLE, bffxOn, type SummaryRes } from "./bf-data";
import "./bf.css";

// A small booking funnel for Today > Numbers: the one sentence and the compact ladder. It asks the same API as the Appointments tab and shows nothing at all when the funnel is not
// switched on for this account (the server answers "not found"), so a switched-off feature never leaves an empty box. Click it to open the full tab.
export function BfMini({ location, from, to, go }: { location: string; from: string; to: string; go: GoFn }) {
  const fx = bffxOn();
  const key = useMemo(() => {
    const p = new URLSearchParams({ part: "summary", mini: "1", from, to });
    if (location) p.set("location", location);
    return `appointments/funnel?${p}`;
  }, [location, from, to]);
  const r = useData<SummaryRes>(fx ? null : key);
  const d = fx ? SAMPLE.summary() : r.data;
  if (!d || d.steps[0].count === 0) return null;
  return (
    <section className="bf bf-card" aria-label="Booking funnel" data-testid="bf-mini">
      <h3 className="bf-h">Booking funnel</h3>
      <p className="bf-sentence" style={{ fontSize: "1rem" }}>{d.headline}</p>
      <BookingLadder steps={d.steps} biggest={d.leak?.key ?? null} compact testId="bf-mini-ladder" />
      <button type="button" className="bf-link" onClick={() => go("appointments" as never)} data-testid="bf-mini-open">Open the booking funnel</button>
    </section>
  );
}
