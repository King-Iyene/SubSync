"use client";

import { useEffect, useRef, useState } from "react";
import { contrast, parseColour } from "@/lib/design/color";
import { Section } from "../app/ds";
import { TODAY_FONTS } from "../app/views/today-fonts";
import "../app/views/today-theme.css";

// Today's two palette options side by side, light and dark, each drawn by the real Today tokens (src/app/app/views/today-theme.css). A is the default. Nothing here is a screenshot:
// every swatch reads the same CSS variables the page reads, so a change to the token block shows here at once. The contrast figures are computed from the swatch's own colours.
const SWATCHES: Array<{ name: string; token: string; onToken?: string; asText?: boolean }> = [
  { name: "Ground", token: "--t-ground", onToken: "--t-ink" },
  { name: "Raised", token: "--t-raise", onToken: "--t-ink" },
  { name: "Accent", token: "--t-accent", onToken: "--t-on-accent" },
  { name: "Urgent", token: "--t-bad", asText: true },
  { name: "Soon", token: "--t-warn", asText: true },
  { name: "Fine", token: "--t-ok", asText: true },
];
const CHART = ["--t-c1", "--t-c2", "--t-c3", "--t-c4"];

/** The contrast ratio of two colours that were read from the panel's own computed style, so it cannot drift from the token block. */
function Ratio({ fg, bg }: { fg: string; bg: string }) {
  if (!fg || !bg) return null;
  const f = parseColour(fg), b = parseColour(bg);
  if (!f || !b) return null;
  const r = contrast(f, b);
  return <span className="t-num">{r.toFixed(1)}:1 {r >= 4.5 ? "AA" : r >= 3 ? "large only" : "fails"}</span>;
}

function Panel({ palette, mode, title }: { palette: "a" | "b"; mode: "light" | "dark"; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = ref.current ? getComputedStyle(ref.current) : null;
    if (cs) setHex(Object.fromEntries(["--t-ground", "--t-raise", "--t-ink", "--t-ink2", "--t-accent", "--t-on-accent", "--t-bad", "--t-warn", "--t-ok"].map((k) => [k, cs.getPropertyValue(k).trim()])));
  }, [palette, mode]);
  return (
    <div ref={ref} className={`today ${TODAY_FONTS} bg-background text-foreground rounded-[6px] border border-[var(--t-rule)] p-5`} data-palette={palette} data-theme={mode} data-testid={`palette-${palette}-${mode}`}>
      <div className="t-root">
        <p className="t-label">{title}</p>
        <h3 className="t-display mt-3 !text-[1.6rem]"><span className="text-primary">78</span> people are waiting for a reply across <span className="text-primary">13</span> clients.</h3>
        <p className="t-small t-quiet mt-2">Body text in the quiet ink, with a hairline between rows.</p>
        <div className="t-surface mt-4 divide-y divide-[var(--t-rule)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-l-2 border-destructive px-4 py-2.5"><span className="font-semibold">Bright Smile Dental</span><span className="t-num">$1,004,011</span><span className="t-small" style={{ color: "var(--t-bad)" }}>Urgent</span></div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="font-semibold">Harbor Law Group</span><span className="t-num">$17,353</span><span className="t-small" style={{ color: "var(--t-warn)" }}>Soon</span></div>
        </div>
        <button type="button" className="mt-4 inline-flex h-10 items-center rounded-[4px] bg-primary px-4 text-[0.9375rem] font-medium text-primary-foreground">Open Bright Smile Dental</button>
        <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {SWATCHES.map((s) => (
            <li key={s.name} className="min-w-0">
              <span className="block h-10 rounded-[4px] border border-[var(--t-rule)]" style={{ background: `var(${s.token})` }} />
              <span className="t-small mt-1 block font-medium">{s.name}</span>
              <span className="t-small t-quiet block">{s.asText ? <Ratio fg={hex[s.token]} bg={hex["--t-raise"]} /> : s.onToken ? <Ratio fg={hex[s.onToken]} bg={hex[s.token]} /> : null}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-1" aria-label="Chart colours">{CHART.map((c) => <span key={c} className="h-3 flex-1 rounded-[3px]" style={{ background: `var(${c})` }} />)}</div>
        <p className="t-small t-quiet mt-2">Quiet text on this ground: <Ratio fg={hex["--t-ink2"]} bg={hex["--t-ground"]} />. Accent text: <Ratio fg={hex["--t-accent"]} bg={hex["--t-ground"]} /></p>
      </div>
    </div>
  );
}

export function TodayPalettes() {
  return (
    <Section title="Today: palette A and palette B" hint="Both are non-blue. A (graphite and berry) is the default. B (pine and jade) is one attribute away: data-palette=&quot;b&quot;. Each tile reads the real Today tokens; the figures are contrast ratios of the colours shown, 4.5:1 or more passes for text.">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="today-palettes">
        <Panel palette="a" mode="light" title="Palette A, light: warm stone, graphite ink, berry" />
        <Panel palette="a" mode="dark" title="Palette A, dark: warm graphite, layered by lightness" />
        <Panel palette="b" mode="light" title="Palette B, light: green-grey, pine ink, jade" />
        <Panel palette="b" mode="dark" title="Palette B, dark: green-black, layered by lightness" />
      </div>
    </Section>
  );
}
