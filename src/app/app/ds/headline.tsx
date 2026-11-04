"use client";

import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Headline, HeadlineAction } from "@/lib/analytics/today-queue";
import { CountUp } from "./count-up";

// The one big sentence at the top of Today: "4 clients need you today. $48,200 is at risk." The numbers are large, tabular and in the accent colour; the words
// are plain. Every number is a button: press it and the records behind it open ("13 clients" lists the 13 client accounts, "$1,397,934" lists the stale deals it adds up).
// With nothing to do it says so plainly, with a check mark and the word "caught up", never colour alone. `children` holds the supporting line.
export function HeadlineBlock({ headline, children, onPart, action }: { headline: Headline; children?: ReactNode; onPart?: (a: HeadlineAction) => void; /** THE one primary button of the page (a filled button), drawn right under the sentence. */ action?: ReactNode }) {
  return (
    <section className="mb-7" aria-label="What needs you today" data-testid="today-headline-block">
      <h2 className="max-w-4xl text-[clamp(1.6rem,3.3vw,2.6rem)] font-semibold leading-[1.06] tracking-tight" data-testid="today-headline" data-clear={headline.allClear}>
        {headline.allClear && <CircleCheck aria-hidden className="mr-3 inline-block size-[0.8em] -translate-y-[0.05em] text-success" />}
        {headline.parts.map((p, n) => {
          if (!p.strong) return <span key={n}>{p.t}</span>;
          const num = <span className="tnum text-primary"><CountUp value={p.t} /></span>;
          return onPart && p.action
            ? <button key={n} type="button" onClick={() => onPart(p.action as HeadlineAction)} data-testid={`headline-${p.action}`} title="Show what this number is made of"
                className="ds-press cursor-pointer rounded-md underline decoration-primary/40 decoration-2 underline-offset-[0.14em] hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{num}</button>
            : <span key={n}>{num}</span>;
        })}
      </h2>
      {headline.breakdown && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="today-breakdown">{headline.breakdown}</p>}
      {action && <div className="mt-4" data-testid="today-primary">{action}</div>}
      {children}
    </section>
  );
}
