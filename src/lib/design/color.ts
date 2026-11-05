// Colour maths for the design tokens (stage D0): parse a token value, compute WCAG contrast, and make an agency's accent colour readable on
// the current theme. Pure, no browser needed, so the same code serves the shell and the unit tests that guard the tokens.

export type Rgb = { r: number; g: number; b: number }; // 0..255, in sRGB

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const toHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

// oklch(L C H) or oklch(L C H / A), the notation older tokens used. Converted to sRGB with the standard OKLab matrices.
export function parseOklch(value: string): Rgb | null {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i.exec(value.trim());
  if (!m) return null;
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055);
  const [r, g, bl] = lin.map((x) => clamp(gamma(x)) * 255);
  return { r, g, b: bl };
}

export function parseColour(value: string): Rgb | null {
  return parseHex(value) ?? parseOklch(value);
}

export function luminance({ r, g, b }: Rgb): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// WCAG 2.x contrast ratio, 1 to 21.
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const INK: Rgb = { r: 0, g: 12, b: 37 }; // the darkest navy, #000C25

// Text that reads on a fill of this colour: white or navy, whichever has the higher contrast.
export function onColour(hex: string): string {
  const c = parseHex(hex);
  if (!c) return "#ffffff";
  return contrast(c, WHITE) >= contrast(c, INK) ? "#ffffff" : "#000c25";
}

export type Theme = "light" | "dark";
// The surfaces an accent has to read on, per theme (the card colour in each theme's tokens).
export const SURFACE: Record<Theme, string> = { light: "#ffffff", dark: "#1b263b" };

// An agency's chosen colour, made safe to use. A fill (button, active menu mark) keeps the agency's exact colour when a white or navy label can read on it, and is nudged only when neither can.
// Text and links in that colour must reach 4.5:1 on the page's surface: when the exact colour does not, it is moved toward white (dark theme) or
// navy (light theme) as little as possible, so the brand stays recognisable and nothing is unreadable. Returns null for an invalid colour.
export type AccentTokens = { fill: string; onFill: string; text: string; adjusted: boolean; fillAdjusted: boolean };

// A mid-tone colour can have no label colour that reaches 4.5:1 (neither white nor navy). Then the fill is nudged, as little as possible, toward the
// side that is cheaper to fix: darker (white label) or lighter (navy label). A colour that already works is returned untouched.
function readableFill(c: Rgb, min: number): { fill: Rgb; adjusted: boolean } {
  const best = (fill: Rgb) => Math.max(contrast(fill, WHITE), contrast(fill, INK));
  if (best(c) >= min) return { fill: c, adjusted: false };
  for (let t = 0.02; t <= 1; t += 0.02) {
    const darker = mix(c, INK, t);
    const lighter = mix(c, WHITE, t);
    if (best(darker) >= min) return { fill: darker, adjusted: true };
    if (best(lighter) >= min) return { fill: lighter, adjusted: true };
  }
  return { fill: c, adjusted: false };
}

export function accentTokens(hex: string, theme: Theme, min = 4.5): AccentTokens | null {
  const c = parseHex(hex);
  if (!c) return null;
  const surface = parseHex(SURFACE[theme])!;
  const target = theme === "dark" ? WHITE : INK;
  let text = c;
  let t = 0;
  while (contrast(text, surface) < min && t < 1) { t = Math.min(1, t + 0.02); text = mix(c, target, t); }
  const fill = readableFill(c, min);
  const fillHex = toHex(fill.fill);
  return { fill: fillHex, onFill: onColour(fillHex), text: toHex(text), adjusted: t > 0, fillAdjusted: fill.adjusted };
}
