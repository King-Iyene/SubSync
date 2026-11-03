"use client";

import { Badge, Card, fmtMoney } from "../ui";

// The forecast with its method on show (N37): a range with a stated confidence (or the owner's own assumptions, labelled as that), timing taken
// from the real sales cycle, and a "How this is calculated" drawer that lists the formula, the inputs, and what was included or left out.
export type ForecastData = {
  method: "history" | "owner" | "none";
  openValue: number; openDeals: number;
  winRate: number | null; winRateRange: { low: number; high: number } | null;
  closedDeals: number; closedNeeded: number;
  range: { low: number; likely: number; high: number } | null;
  ownerRange: { low: number; likely: number; high: number } | null;
  ownerUnsetDeals: number;
  horizons: Array<{ days: number; low: number; likely: number; high: number }> | null;
  untimedDeals: number; cycleSample: number;
  basis: string;
  explain: { formula: string; inputs: Array<{ label: string; value: string }>; included: string; excluded: string[]; caveats: string[] };
};

export function ForecastCard({ f }: { f: ForecastData }) {
  return (
    <Card title="Revenue forecast" className="lg:col-span-2" action={f.method === "none" ? undefined : <Badge tone="info">{f.method === "history" ? "From your closed deals" : "Your own assumptions"}</Badge>}>
      {f.range === null ? (
        <p className="text-sm text-muted-foreground" data-testid="forecast-none">{f.basis}</p>
      ) : (
        <div data-testid="forecast-range">
          <p className="text-2xl font-semibold tabular-nums">{fmtMoney(f.range.low)} to {fmtMoney(f.range.high)}</p>
          <p className="mt-1 text-sm text-muted-foreground">Most likely {fmtMoney(f.range.likely)}, from {f.openDeals} open {f.openDeals === 1 ? "deal" : "deals"} worth {fmtMoney(f.openValue)}.</p>
          <p className="mt-2 text-xs text-muted-foreground">{f.basis}</p>
          {f.method === "history" && f.ownerRange && (
            <p className="mt-2 text-xs text-muted-foreground">Your own stage probabilities give {fmtMoney(f.ownerRange.likely)} (a band of {fmtMoney(f.ownerRange.low)} to {fmtMoney(f.ownerRange.high)}){f.ownerUnsetDeals > 0 ? `; ${f.ownerUnsetDeals} ${f.ownerUnsetDeals === 1 ? "deal is" : "deals are"} in a stage with no probability and left out of that figure` : ""}.</p>
          )}
          {f.method === "owner" && f.ownerUnsetDeals > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">{f.ownerUnsetDeals} open {f.ownerUnsetDeals === 1 ? "deal is" : "deals are"} in a stage with no probability and left out. Set one under Stages and pipelines.</p>
          )}
          {f.horizons ? (
            <div className="mt-4">
              <p className="text-sm font-medium">When it is expected to close</p>
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {f.horizons.map((h) => <li key={h.days}>Within {h.days} days: {fmtMoney(h.low)} to {fmtMoney(h.high)} (most likely {fmtMoney(h.likely)})</li>)}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">Taken from how long your won deals really took in each pipeline ({f.cycleSample} won deals).{f.untimedDeals > 0 ? ` ${f.untimedDeals} open ${f.untimedDeals === 1 ? "deal is" : "deals are"} not placed in time.` : ""}</p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">No timing is shown: it needs at least 10 won deals with dates in the same pipeline.</p>
          )}
        </div>
      )}
      <details className="mt-4 text-sm" data-testid="forecast-how">
        <summary className="cursor-pointer select-none font-medium underline">How this is calculated</summary>
        <div className="mt-2 space-y-3 text-xs text-muted-foreground">
          <p>{f.explain.formula}</p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {f.explain.inputs.map((i) => <div key={i.label} className="flex justify-between gap-3"><dt>{i.label}</dt><dd className="font-medium text-foreground">{i.value}</dd></div>)}
          </dl>
          <div><p className="font-medium text-foreground">Included</p><p>{f.explain.included}</p></div>
          <div><p className="font-medium text-foreground">Left out</p><ul className="list-disc pl-5">{f.explain.excluded.map((e) => <li key={e}>{e}</li>)}</ul></div>
          <div><p className="font-medium text-foreground">Things to keep in mind</p><ul className="list-disc pl-5">{f.explain.caveats.map((e) => <li key={e}>{e}</li>)}</ul></div>
        </div>
      </details>
    </Card>
  );
}
