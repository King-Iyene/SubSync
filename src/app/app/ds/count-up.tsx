"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { countUpParts } from "@/lib/design/count-up";

// A figure that counts up to its value when it first appears or changes (D1, restrained motion). The text in the page is ALWAYS the real value: the
// count only changes the text node in the browser for about 600 ms, so a screen reader, a test, a print and a person who asks their device for
// less motion all get the final number straight away. Anything that is not a plain number ("24 min", "58 of 298") is shown as it is.
export function CountUp({ value }: { value: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const final = typeof value === "string" || typeof value === "number" ? String(value) : null;
    const parts = final === null ? null : countUpParts(final);
    const node = ref.current?.firstChild;
    if (!final || !parts || !node || node.nodeType !== 3) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 600);
      node.nodeValue = parts.at(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    node.nodeValue = parts.at(0);
    frame = requestAnimationFrame(tick);
    // When the value changes, React has already written the NEW text by the time this cleanup runs, so restore from the span's own data-final (the value now on screen),
    // never from the old closure: that would put the previous number back on screen and leave it there.
    return () => { cancelAnimationFrame(frame); node.nodeValue = (ref.current?.dataset.final ?? final); };
  }, [value]);
  return <span ref={ref} data-final={typeof value === "string" || typeof value === "number" ? String(value) : undefined}>{typeof value === "number" ? String(value) : value}</span>;
}
