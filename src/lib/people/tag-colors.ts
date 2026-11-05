// A stable colour for every tag name: the same name always gets the same colour, in every account and on every screen, so a person learns them by sight.
// Ten bright but mature hues. Each has a tinted background with strong text, in a light and a dark version; every pair is checked for contrast (>= 4.5:1) by a test.
// Pure: no browser, no storage.

export const HUES = [212, 174, 142, 38, 22, 350, 322, 268, 244, 195] as const;
export type TagColor = { index: number; light: { bg: string; fg: string; dot: string }; dark: { bg: string; fg: string; dot: string } };

const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;

/** FNV-1a over the lower-cased, trimmed name: tiny, stable, spreads short names well. */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.trim().toLowerCase()) { h ^= ch.codePointAt(0) ?? 0; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function tagColor(name: string): TagColor {
  const index = hashName(name) % HUES.length;
  const h = HUES[index];
  return {
    index,
    light: { bg: hsl(h, 85, 92), fg: hsl(h, 75, 22), dot: hsl(h, 85, 30) },
    dark: { bg: hsl(h, 45, 24), fg: hsl(h, 90, 86), dot: hsl(h, 90, 74) },
  };
}

/** Parses "hsl(H S% L%)" into 0-255 rgb. */
export function hslToRgb(css: string): [number, number, number] {
  const m = css.match(/hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)/);
  if (!m) throw new Error("not an hsl colour: " + css);
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

const lum = ([r, g, b]: [number, number, number]) => {
  const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** WCAG contrast ratio between two hsl() colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(hslToRgb(a)), lum(hslToRgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
