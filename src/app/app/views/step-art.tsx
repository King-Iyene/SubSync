import type { ArtId } from "@/lib/getting-started";

// A small drawing for each Getting started step: plain inline SVG in the page's own colours, no video and no image files. The highlighted part pulses gently
// (and stops for people who ask for less motion). Decorative: the step's words say everything, so the drawing is hidden from screen readers.
const base = { viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: "size-12 shrink-0 text-muted-foreground" };
const hot = "motion-safe:animate-pulse text-primary";

export function StepArt({ art }: { art: ArtId }) {
  switch (art) {
    case "connect": return <svg {...base}><path d="M18 8v8M30 8v8" /><path d="M13 16h22v6a11 11 0 0 1-22 0z" /><path className={hot} d="M24 33v7" strokeWidth={2.4} /></svg>;
    case "sync": return <svg {...base}><path d="M38 20a14 14 0 0 0-26-4M10 28a14 14 0 0 0 26 4" /><path d="M12 8v8h8M36 40v-8h-8" /><circle className={hot} cx="24" cy="24" r="3" fill="currentColor" /></svg>;
    case "today": return <svg {...base}><rect x="8" y="8" width="32" height="32" rx="3" /><path className={hot} d="M14 16h20" strokeWidth={3} /><path d="M14 24h14M14 32h18" /></svg>;
    case "speed": return <svg {...base}><circle cx="24" cy="26" r="14" /><path d="M20 6h8" /><path className={hot} d="M24 26l7-7" strokeWidth={2.4} /></svg>;
    case "target": return <svg {...base}><circle cx="24" cy="24" r="16" /><circle cx="24" cy="24" r="9" /><circle className={hot} cx="24" cy="24" r="3" fill="currentColor" /></svg>;
    case "bell": return <svg {...base}><path d="M12 34V22a12 12 0 0 1 24 0v12l3 3H9z" /><path className={hot} d="M20 41a4 4 0 0 0 8 0" strokeWidth={2.4} /></svg>;
    case "mail": return <svg {...base}><rect x="6" y="11" width="36" height="26" rx="3" /><path className={hot} d="M7 13l17 13 17-13" strokeWidth={2.2} /></svg>;
    case "test": return <svg {...base}><rect x="6" y="16" width="36" height="16" rx="8" /><circle className={hot} cx="34" cy="24" r="5" fill="currentColor" /></svg>;
    case "share": return <svg {...base}><circle cx="12" cy="24" r="5" /><circle cx="36" cy="12" r="5" /><circle cx="36" cy="36" r="5" /><path className={hot} d="M16.5 21.5l15-7.5M16.5 26.5l15 7.5" strokeWidth={2} /></svg>;
    case "clients": return <svg {...base}><circle cx="17" cy="17" r="6" /><path d="M5 38a12 12 0 0 1 24 0" /><circle className={hot} cx="33" cy="19" r="5" /><path className={hot} d="M31 38a9 9 0 0 1 12-8" /></svg>;
    case "meeting": return <svg {...base}><rect x="18" y="6" width="12" height="22" rx="6" /><path className={hot} d="M12 24a12 12 0 0 0 24 0M24 36v6" strokeWidth={2} /></svg>;
    case "search": return <svg {...base}><circle cx="21" cy="21" r="12" /><path className={hot} d="M30 30l11 11" strokeWidth={2.6} /></svg>;
    case "calendar": return <svg {...base}><rect x="7" y="10" width="34" height="30" rx="3" /><path d="M7 19h34M16 6v8M32 6v8" /><path className={hot} d="M17 30l5 5 9-10" strokeWidth={2.4} /></svg>;
    case "feedback": return <svg {...base}><path d="M8 10h32v22H22l-8 7v-7H8z" /><path className={hot} d="M16 18h16M16 25h10" strokeWidth={2.2} /></svg>;
  }
}
