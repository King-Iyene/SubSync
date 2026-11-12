// What a printed page looks like (stage F6, N85). Pure, so it is unit tested without a browser.
//
// A screen can be dark; a sheet of paper is not. Chrome drops background colours when printing but keeps text colours, so a dark theme would print as
// pale text on white paper. For print, the colours the app's pages use are therefore set to the light theme's own values, and the sender's own colour
// (when they have set one) replaces the accent, nudged only as far as it needs to be to read on white. A test holds these values equal to the light
// tokens in globals.css, so they cannot drift apart.
import { accentTokens, parseHex } from "./color";

export const PRINT_LIGHT_TOKENS = {
  "--background": "#f8f7f6", "--foreground": "#141311", "--card": "#ffffff", "--card-foreground": "#141311", "--muted": "#f4f2ef", "--muted-foreground": "#5f5b54",
  "--border": "#e3dfd8", "--primary": "#504c45", "--destructive": "#9d3a34", "--success": "#2c5c4b", "--warning": "#685023", "--accent": "#ebe9e4",
} as const;

/** The sender's colour as it prints on white (readable text, 4.5 to 1), or null when they have not set a valid one. */
export function printAccent(brandColor: string | null | undefined): string | null {
  if (!brandColor || !parseHex(brandColor)) return null;
  return accentTokens(brandColor, "light")?.text ?? null;
}

/**
 * The print stylesheet of an app page: A4 or Letter margins, the light colours on the dark shell and on the page's own wrapper, the sender's colour as the
 * accent, and nothing split across two sheets.
 */
export function printCss(brandColor: string | null | undefined, wrapper = ".audit-print"): string {
  const vars = Object.entries({ ...PRINT_LIGHT_TOKENS, "--primary": printAccent(brandColor) ?? PRINT_LIGHT_TOKENS["--primary"] }).map(([k, v]) => `${k}: ${v};`).join(" ");
  return `@page { margin: 14mm; } @media print { .dark, ${wrapper} { ${vars} } ${wrapper} { background: #ffffff; color: ${PRINT_LIGHT_TOKENS["--foreground"]}; } ${wrapper} li, ${wrapper} section { break-inside: avoid; } }`;
}
