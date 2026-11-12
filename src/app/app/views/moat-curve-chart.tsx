"use client";

import { useEffect, useState } from "react";
import type { Curve } from "@/lib/analytics/moat-core";

// D3. The speed-to-outcome chart: one big column per reply-speed band, its height the share of those leads that booked. The columns grow in when the chart appears
// (not with reduced motion), colours come from the theme so light and dark both read, a band with too few leads is drawn as an outline and says so, and every column is a button
// that tells you the numbers. The text under the chart carries the same numbers, so nothing depends on the picture.
export function CurveChart({ curve, onPick }: { curve: Curve; onPick?: (key: string) => void }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const max = Math.max(0.2, ...curve.bands.map((b) => b.bookRate ?? 0));
  const W = 560, H = 240, pad = 28, bw = 70, gap = (W - pad * 2 - bw * curve.bands.length) / Math.max(1, curve.bands.length - 1);
  return (
    <figure className="m-0" data-testid="curve-chart">
      <svg viewBox={`0 0 ${W} ${H + 46}`} role="img" aria-label="Share of leads that booked, by how fast they were answered" className="h-auto w-full">
        <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="currentColor" strokeOpacity="0.25" />
        {curve.bands.map((b, i) => {
          const x = pad + i * (bw + gap);
          const h = b.bookRate === null ? 24 : Math.max(4, (b.bookRate / max) * (H - 50));
          const shown = grown ? h : 0;
          return (
            <g key={b.key} onClick={() => onPick?.(b.key)} style={{ cursor: onPick ? "pointer" : "default" }} data-testid={`curve-band-${b.key}`}>
              <title>{b.enough ? `${b.label}: ${Math.round((b.bookRate ?? 0) * 100)}% booked (${b.booked} of ${b.leads} leads)` : `${b.label}: ${b.leads} leads, too few to show a rate`}</title>
              <rect x={x} y={H - shown} width={bw} height={shown} rx="6"
                fill={b.enough ? "var(--primary, #6986a7)" : "transparent"} fillOpacity={b.key === "never" ? 0.45 : 0.9}
                stroke={b.enough ? "none" : "currentColor"} strokeOpacity="0.4" strokeDasharray={b.enough ? undefined : "4 4"}
                className="motion-reduce:!transition-none" style={{ transition: "height 700ms cubic-bezier(.2,.8,.2,1), y 700ms cubic-bezier(.2,.8,.2,1)", filter: b.enough ? "drop-shadow(0 0 8px color-mix(in srgb, var(--primary, #6986a7) 45%, transparent))" : undefined }} />
              <text x={x + bw / 2} y={H - shown - 8} textAnchor="middle" fontSize="15" fontWeight="600" fill="currentColor">{b.bookRate === null ? "n/a" : `${Math.round(b.bookRate * 100)}%`}</text>
              <text x={x + bw / 2} y={H + 18} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.75">{b.label}</text>
              <text x={x + bw / 2} y={H + 34} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.55">{b.leads} leads</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-sm text-muted-foreground" data-testid="curve-headline">
        {curve.headline ?? (curve.ok ? "Some bands have too few leads to show a rate yet." : `Not enough data yet: ${curve.needMore} more lead${curve.needMore === 1 ? "" : "s"} needed.`)}
      </figcaption>
    </figure>
  );
}
