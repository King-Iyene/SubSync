"use client";

import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Headline } from "@/lib/analytics/today-queue";
import { CountUp } from "./count-up";

// The one big sentence at the top of Today: "4 clients need you today. $48,200 is at risk." The numbers are large, tabular and in the accent colour; the words
// are plain. With nothing to do it says so plainly, with a check mark and the word "caught up", never colour alone. `children` holds the supporting line
// (what is behind the numbers, or the last 7 days of proof).
export function HeadlineBlock({ headline, children }: { headline: Headline; children?: ReactNode }) {
  return (
    <section className="mb-8 border-b pb-6" aria-label="What needs you today" data-testid="today-headline-block">
      <h2 className="max-w-4xl text-[clamp(1.75rem,3.3vw,2.85rem)] font-semibold leading-[1.06] tracking-tight" data-testid="today-headline" data-clear={headline.allClear}>
        {headline.allClear && <CircleCheck aria-hidden className="mr-3 inline-block size-[0.8em] -translate-y-[0.05em] text-success" />}
        {headline.parts.map((p, n) => (p.strong ? <span key={n} className="tnum text-primary"><CountUp value={p.t} /></span> : <span key={n}>{p.t}</span>))}
      </h2>
      {headline.breakdown && <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground" data-testid="today-breakdown">{headline.breakdown}</p>}
      {children}
    </section>
  );
}
