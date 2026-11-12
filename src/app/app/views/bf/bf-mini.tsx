"use client";

import { useMemo, useState } from "react";
import { useData } from "../../session";
import type { GoFn } from "../../nav";
import { SidePopup } from "../speed-popup";
import type { ExecScope } from "../ap3/exec/exec-types";
import { BookingLadder, type LadderPick } from "./bf-ladder";
import { DrillList, NO_LOCAL, type Drill } from "./bf-tab";
import { SAMPLE, bffxOn, type SummaryRes } from "./bf-data";
import "./bf.css";

// A small booking funnel for Today > Numbers: the one sentence and the compact ladder. It asks the same API as the Appointments tab and shows nothing at all when the funnel is not
// switched on for this account (the server answers "not found"), so a switched-off feature never leaves an empty box. Every step, basin and ribbon opens the leads behind it in a side panel,
// exactly like the full tab, and the button opens the full tab.
const NO_FLAGS = { cohorts: false, forecast: false, recover: false };
export function BfMini({ location, from, to, go }: { location: string; from: string; to: string; go: GoFn }) {
  const fx = bffxOn();
  const [drill, setDrill] = useState<Drill | null>(null);
  const key = useMemo(() => {
    const p = new URLSearchParams({ part: "summary", mini: "1", from, to });
    if (location) p.set("location", location);
    return `appointments/funnel?${p}`;
  }, [location, from, to]);
  const scope = useMemo<ExecScope>(() => ({ from, to, locationId: location, calendarId: "", userId: "", booker: "", owner: "", source: "", status: "", stage: "" }), [from, to, location]);
  const r = useData<SummaryRes>(fx ? null : key);
  const d = fx ? SAMPLE.summary() : r.data;
  if (!d || d.steps[0].count === 0) return null;
  const pick = (p: LadderPick) => setDrill({ title: p.title, step: p.step, mode: p.mode, extra: {}, count: p.count });
  return (
    <section className="bf bf-card" aria-label="Booking funnel" data-testid="bf-mini">
      <h3 className="bf-h">Booking funnel</h3>
      <p className="bf-sentence" style={{ fontSize: "1rem" }}>{d.headline}</p>
      <BookingLadder steps={d.steps} biggest={d.leak?.key ?? null} compact testId="bf-mini-ladder" onPick={pick} />
      <button type="button" className="bf-link" onClick={() => go("appointments" as never)} data-testid="bf-mini-open">Open the booking funnel</button>
      {drill && <SidePopup label={drill.title} onClose={() => setDrill(null)}><DrillList key={JSON.stringify(drill)} drill={drill} scope={scope} local={NO_LOCAL} flags={NO_FLAGS} onClose={() => setDrill(null)} /></SidePopup>}
    </section>
  );
}
