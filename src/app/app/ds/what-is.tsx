"use client";

import { Info } from "lucide-react";
import type { TabTag } from "@/lib/analytics/today-tabs";

/** The small "What is this?" mark: hover, focus or tap shows one plain line. Same markup as the one on the figures of "This week". */
export function WhatIs({ text, testId }: { text: string; testId?: string }) {
  return (
    <span tabIndex={0} role="img" aria-label={`What is this? ${text}`} title={`What is this? ${text}`} data-testid={testId ?? "what-is"}
      className="inline-flex cursor-help rounded-full align-middle text-[var(--t-ink3)] hover:text-[var(--t-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><Info aria-hidden className="size-3.5" /></span>
  );
}

/** A quiet tag: "To do" for something you act on, "Report" for something you read. */
export function TagPill({ tag }: { tag: TabTag }) {
  return <span data-testid="tag-pill" data-tag={tag} className="t-label inline-flex h-5 items-center rounded-[3px] border border-[var(--t-rule2)] px-1.5 text-[0.6875rem] font-normal text-[var(--t-ink2)]">{tag}</span>;
}
