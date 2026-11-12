"use client";

import { useData } from "../../session";
import type { GoFn } from "../../nav";
import "./fn.css";
import type { FnHeadline, FnOptions } from "./types";

// Today's money line (stage FN, flag fn_today): the one "what to do today" sentence from Finance, shown to the owner and administrators only. Renders nothing while the flag is off, for anyone without
// manager rights, or when there is nothing money-related to do. It never repeats the numbers: it names the one thing and opens it.
export function FinanceTodayCard({ go }: { go: GoFn }) {
  const o = useData<FnOptions>("finance?part=options");
  const on = o.data?.flags?.fn_today === true && o.data.manager === true;
  const r = useData<FnHeadline>(on ? "finance?part=headline" : null);
  const d = r.data;
  if (!on || !d || d.target === null) return null;
  return (
    <section className="fn-card" aria-label="Money today" data-testid="fn-today-card">
      <h2 className="fn-h">Money today</h2>
      <p className="fn-sentence" data-testid="fn-today-line">{d.today}</p>
      <p className="ap-fine">{d.line}</p>
      <button type="button" className="s6-btn" data-kind="primary" style={{ marginTop: 8 }} onClick={() => go("finance")} data-testid="fn-today-go">Open Finance</button>
    </section>
  );
}
