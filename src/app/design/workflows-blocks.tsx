"use client";

import { useState } from "react";
import { Section } from "../app/ds";
import { WfBars, WfDonut, WfNumber, WfTrend } from "../app/ds/workflow-charts";

// The Workflows charts, each one the real component on made-up data. Every mark is a button: a slice, a legend row, a bar, a point and a number each open the
// list behind them (on the real page that is the records panel of Today). Here the choice is shown under the chart.
const SLICES = [
  { key: "failing", label: "Failing", count: 3, colour: "var(--destructive)" },
  { key: "never_run", label: "Never ran (30 days)", count: 2, colour: "var(--warning)" },
  { key: "running", label: "Running", count: 14, colour: "var(--success)" },
  { key: "draft", label: "Draft", count: 5, colour: "var(--chart-1)" },
];
const DAYS = Array.from({ length: 12 }, (_, i) => ({ day: `2026-10-${String(20 + i).padStart(2, "0")}`, value: i === 5 ? null : [1, 1, 2, 2, 3, 0, 3, 2, 2, 1, 1, 3][i] as number | null }));

export function WorkflowsBlocks() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Section title="Workflows charts" hint="Donut, bars, a thin trend and a big number. Every mark is a button that opens the list behind it.">
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <WfNumber label="In total" value={24} onClick={() => setPicked("total")} />
        <WfNumber label="Failing" value={3} tone="bad" onClick={() => setPicked("failing")} />
        <WfNumber label="Never ran" value={2} tone="warn" hint="Estimate" onClick={() => setPicked("never_run")} />
        <WfNumber label="Drafts" value={5} />
      </div>
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <WfDonut title="What state are they in?" marks={SLICES} selected={picked} onSelect={setPicked} centre="items" />
        <WfBars title="Which client accounts need a look?" rows={[{ key: "a", label: "Maple Dental", value: 9, flag: 3 }, { key: "b", label: "Harbor Realty", value: 7, flag: 1 }, { key: "c", label: "Summit Solar", value: 4 }]} selected={picked} onSelect={setPicked} />
        <WfTrend title="How many were failing, day by day" points={DAYS} unit=" failing" colour="var(--destructive)" onPoint={(d) => setPicked(d)} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">{picked ? `You pressed: ${picked}` : "Press any mark."}</p>
    </Section>
  );
}
