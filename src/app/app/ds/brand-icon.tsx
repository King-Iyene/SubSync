import { BRAND_MARKS, type BrandId } from "@/lib/brand-marks";

// The real logo mark of a connected tool as inline SVG (no image request, no hotlink). It sits on a light tile in light and dark pages alike, so the brand colours are always
// readable and always the right ones. `label` is the alt text; the mark is announced once, so a name written next to it can pass `decorative`.
export function BrandIcon({ id, size = 28, decorative = false, className = "" }: { id: BrandId; size?: number; decorative?: boolean; className?: string }) {
  const m = BRAND_MARKS[id];
  const pad = Math.round(size * 0.22);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white ${className}`} style={{ width: size + pad * 2, height: size + pad * 2 }} data-brand={id}>
      <svg viewBox={m.viewBox} width={size} height={size} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : `${m.name} logo`} aria-hidden={decorative ? true : undefined} focusable="false">
        {m.paths.map((p, i) => <path key={i} d={p.d} fill={p.light} />)}
      </svg>
    </span>
  );
}
