"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { countUpParts } from "@/lib/design/count-up";

// A figure that counts up to its value once, when it first appears (D1, restrained motion). The text in the page is ALWAYS the real value: the
// count only changes the text node in the browser for about 600 ms, so a screen reader, a test, a print and a person who asks their device for
// less motion all get the final number straight away. Anything that is not a plain number ("24 min", "58 of 298") is shown as it is.
export function CountUp({ value }: { value: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);
  const parts = typeof value === "string" || typeof value === "number" ? countUpParts(String(value)) : null;
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!parts || shown.current || !node || node.nodeType !== 3) return;
    shown.current = true;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    let frame = 0;
    const final = String(value);
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 600);
      node.nodeValue = parts.at(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    node.nodeValue = parts.at(0);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); node.nodeValue = final; };
  });
  return <span ref={ref}>{typeof value === "number" ? String(value) : value}</span>;
}
