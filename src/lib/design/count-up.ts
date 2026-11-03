// The pure part of the count-up: which figures may count up, and what the text is at a point of the way (0 to 1). Only a plain number counts up:
// an optional "$", digits with thousands commas, an optional decimal and an optional "%". Everything else ("24 min", "58 of 298", "n/a") is left alone.
const PLAIN = /^(\$?)(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?(%?)$/;

export function countUpParts(text: string): { at: (progress: number) => string } | null {
  const m = PLAIN.exec(text.trim());
  if (!m) return null;
  const [, dollar, whole, decimals = "", percent] = m;
  const target = Number(whole.replace(/,/g, "") + decimals);
  if (!Number.isFinite(target) || target < 10) return null; // a 3 or a 7 does not need to count
  const places = decimals ? decimals.length - 1 : 0;
  const commas = whole.includes(",");
  return {
    at(progress: number) {
      const p = Math.min(1, Math.max(0, progress));
      if (p >= 1) return text.trim();
      const v = target * p;
      const body = places > 0 ? v.toFixed(places) : String(Math.round(v));
      const [w, d] = body.split(".");
      return `${dollar}${commas ? Number(w).toLocaleString("en-US") : w}${d ? `.${d}` : ""}${percent}`;
    },
  };
}
