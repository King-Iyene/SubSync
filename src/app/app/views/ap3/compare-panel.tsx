"use client";

import { X } from "lucide-react";
import type { Appt3Compare, Appt3CompareSide } from "@/lib/analytics/appointments3-types";
import { compareRows } from "@/lib/design/appt-compare";
import { useData } from "../../session";
import { queryOf, type ApFilters } from "./data";
import type { FlowPick } from "./flow-tree";

// Two people side by side, from real fields only (status counts, deals won through the contact, calendar, source, weekday). Every count opens exactly those appointments.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export { compareRows };

function Split({ title, keys, sides, get, onOpen }: { title: string; keys: string[]; sides: Appt3CompareSide[]; get: (s: Appt3CompareSide, k: string) => { booked: number; showed: number; noshow: number } | undefined; onOpen: (p: FlowPick) => void }) {
  if (!keys.length) return null;
  return (
    <div className="mt-3"><h4 className="text-sm font-semibold">{title}</h4>
      <table className="ap-compare"><thead><tr><th><span className="sr-only">{title}</span></th>{sides.map((s) => <th key={s.userId}>{s.name}</th>)}</tr></thead><tbody>
        {keys.slice(0, 12).map((k) => <tr key={k}><td>{k}</td>{sides.map((s) => { const e = get(s, k); return <td key={s.userId}>{e ? <>{e.booked} booked, {e.showed} showed, {e.noshow} no-show</> : "-"}</td>; })}</tr>)}
      </tbody></table></div>
  );
}

export function ComparePanel({ filters, ids, role, onClear, onOpen }: { filters: ApFilters; ids: string[]; role: "booker" | "owner"; onClear: () => void; onOpen: (p: FlowPick) => void }) {
  const q = ids.length === 2 ? `${queryOf("compare" as never, filters)}&ids=${ids.join(",")}&by=${role}` : null;
  const res = useData<Appt3Compare>(q);
  const sides = res.data?.sides ?? [];
  const param = (id: string) => (role === "booker" ? { booker: id } : { owner: id });
  return (
    <div className="s6-card mt-4" data-testid="ap-compare" role="region" aria-label="Side by side">
      <div className="flex items-center gap-3"><h3 className="s6-q">Side by side</h3><button type="button" className="s6-btn ml-auto" onClick={onClear} data-testid="ap-compare-clear"><X aria-hidden className="size-4" />Clear</button></div>
      {ids.length < 2 ? <p className="ap-fine">Pick one more person with the Compare button.</p> : res.error ? <p className="ap-fine">Could not load the comparison. Try again.</p> : !res.data ? <p className="ap-fine" role="status">Loading...</p> : sides.length < 2 ? <p className="ap-fine">No appointments for these people in these dates.</p> : (
        <>
          <table className="ap-compare"><thead><tr><th><span className="sr-only">Measure</span></th>{sides.map((s) => <th key={s.userId}>{s.name}</th>)}</tr></thead><tbody>
            {compareRows(sides).map((r) => (
              <tr key={r.label}><td>{r.label}</td>{r.cells.map((c, i) => (
                <td key={sides[i].userId} data-win={r.better === i ? "1" : undefined}>{r.counts[i] && r.counts[i]!.n > 0 ? <button type="button" className="ap-link tnum" onClick={() => onOpen({ title: `${sides[i].name}: ${r.label.toLowerCase()}`, count: r.counts[i]!.n, params: { ...param(sides[i].userId), outcome: r.counts[i]!.outcome } })}>{c}</button> : c}</td>
              ))}</tr>
            ))}
          </tbody></table>
          <Split title="By calendar" keys={[...new Set(sides.flatMap((s) => s.byCalendar.map((c) => c.name)))]} sides={sides} get={(s, k) => s.byCalendar.find((c) => c.name === k)} onOpen={onOpen} />
          <Split title="By source" keys={[...new Set(sides.flatMap((s) => s.bySource.map((c) => c.source)))]} sides={sides} get={(s, k) => s.bySource.find((c) => c.source === k)} onOpen={onOpen} />
          <Split title="By weekday" keys={DAYS.filter((_, d) => sides.some((s) => s.byWeekday.some((w) => w.weekday === d)))} sides={sides} get={(s, k) => s.byWeekday.find((w) => DAYS[w.weekday] === k)} onOpen={onOpen} />
          <p className="ap-fine mt-2">Show rate counts appointments someone marked, plus past ones nobody marked. Deals won are matched through the contact.</p>
        </>
      )}
    </div>
  );
}
