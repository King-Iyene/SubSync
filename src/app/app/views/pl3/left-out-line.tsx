"use client";

import { leftOutParts, type LeftOutCounts, type LeftOutReasonKey } from "./pipe-list";

// "Left out of the money: 17 deals without a value, 19 deals without an owner." Every reason is a button that opens exactly those deals (the same buckets the counts come from), so the numbers
// add up to the rows a click shows. Nothing left out: one short sentence, never a blank.
export const LEFT_OUT_TITLE: Record<LeftOutReasonKey, string> = { no_value: "Deals without a value", no_owner: "Deals without an owner", test: "Deals with a test name", outlier: "Big deals shown apart" };

export function LeftOutLine({ x, onPick, testId = "pl-leftout" }: { x: LeftOutCounts; onPick?: (key: LeftOutReasonKey, count: number) => void; testId?: string }) {
  const parts = leftOutParts(x);
  if (!parts.length) return <p className="ap-fine" data-testid={testId}>Nothing is left out of the money here.</p>;
  return (
    <p className="ap-fine" data-testid={testId}>
      Left out of the money:{" "}
      {parts.map((p, i) => (
        <span key={p.key}>{i > 0 && ", "}{onPick ? <button type="button" className="ap-link" onClick={() => onPick(p.key, p.count)} data-testid={`${testId}-${p.key}`}>{p.text}</button> : p.text}</span>
      ))}.
    </p>
  );
}
