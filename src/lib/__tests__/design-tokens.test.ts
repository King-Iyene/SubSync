import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { KIND_CHART } from "../analytics/today-queue.ts";
import { accentTokens, contrast, mix, onColour, parseColour, parseHex, SURFACE, type Rgb } from "../design/color.ts";

// D0 acceptance: the colour tokens are readable in BOTH themes. This reads the real src/app/globals.css (not a copy), so a token changed there is
// checked here. Text pairs need 4.5:1 (WCAG AA); marks, focus rings and the like need 3:1.
const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} block exists`);
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = block(":root");
const dark = { ...light, ...block(".dark") };
const themes = { light, dark } as const;

const colour = (tokens: Record<string, string>, name: string): Rgb => {
  const c = parseColour(tokens[name] ?? "");
  assert.ok(c, `token --${name} is a colour the test can read (found "${tokens[name]}")`);
  return c;
};

const TEXT_PAIRS: Array<[string, string]> = [
  ["foreground", "background"], ["foreground", "card"], ["card-foreground", "card"], ["popover-foreground", "popover"],
  ["muted-foreground", "background"], ["muted-foreground", "card"], ["muted-foreground", "muted"], ["foreground", "muted"],
  ["primary-foreground", "primary"], ["accent-foreground", "accent"], ["secondary-foreground", "secondary"],
  ["primary", "background"], ["primary", "card"], // links and the accent used as text
  ["destructive", "background"], ["destructive", "card"], ["success", "background"], ["success", "card"], ["warning", "background"], ["warning", "card"],
  ["gold-foreground", "gold"],
  ["sidebar-foreground", "sidebar"], ["sidebar-accent-foreground", "sidebar-accent"], ["sidebar-primary", "sidebar"], ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-foreground", "sidebar-accent"], ["sidebar-primary", "sidebar-accent"],
];

for (const theme of ["light", "dark"] as const) {
  const t = themes[theme];
  test(`${theme} theme: every text pair has at least 4.5:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(colour(t, fg), colour(t, bg));
      assert.ok(ratio >= 4.5, `${theme}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  });

  test(`${theme} theme: focus ring, chart colours and the gold highlight have at least 3:1 against the surfaces`, () => {
    for (const surface of ["background", "card"]) {
      const s = colour(t, surface);
      assert.ok(contrast(colour(t, "ring"), s) >= 3, `${theme}: --ring on --${surface}`);
      for (let i = 1; i <= 5; i++) assert.ok(contrast(colour(t, `chart-${i}`), s) >= 3, `${theme}: --chart-${i} on --${surface} is ${contrast(colour(t, `chart-${i}`), s).toFixed(2)}:1`);
    }
    if (theme === "dark") assert.ok(contrast(colour(t, "gold"), colour(t, "background")) >= 3, "dark: gold on the page");
  });

  // Today's charts: the four kinds of thing keep one chart colour each (chart-1 to chart-4, see KIND_CHART) and are drawn on the page surface with a ring in the page colour
  // between slices; the "raised" bars are the foreground at 70% and the "cleared" bars and the reply-speed line are the accent. Every mark needs 3:1 on the page and card.
  test(`${theme} theme: Today's marks (one colour per kind, raised bars, cleared bars, the sparkline) have at least 3:1 on the page and the card`, () => {
    for (const surface of ["background", "card"]) {
      const s = colour(t, surface);
      for (const kind of Object.keys(KIND_CHART) as Array<keyof typeof KIND_CHART>) {
        const c = colour(t, `chart-${KIND_CHART[kind]}`);
        assert.ok(contrast(c, s) >= 3, `${theme}: the ${kind} colour on --${surface} is ${contrast(c, s).toFixed(2)}:1`);
      }
      assert.ok(contrast(mix(s, colour(t, "foreground"), 0.7), s) >= 3, `${theme}: raised bars on --${surface}`);
      assert.ok(contrast(colour(t, "primary"), s) >= 3, `${theme}: cleared bars and the sparkline on --${surface}`);
    }
    assert.equal(new Set(Object.values(KIND_CHART)).size, 4, "four kinds, four different colours");
  });

  // The menu writes its text at reduced strength (text-sidebar-foreground/75 for items, /70 for group labels). Blend and check the real result.
  test(`${theme} theme: the side menu text at its reduced strengths is still readable`, () => {
    const bg = colour(t, "sidebar");
    const fg = colour(t, "sidebar-foreground");
    for (const alpha of [0.75, 0.7]) assert.ok(contrast(mix(bg, fg, alpha), bg) >= 4.5, `${theme}: menu text at ${alpha}`);
  });
}

test("the two themes really differ, and use the KD Squares palette", () => {
  assert.notEqual(light.background, dark.background);
  assert.equal(dark.background, "#141d2f", "dark page is the soft deep blue-grey (stage SHELL lifted it from near-black navy)");
  assert.equal(light.primary, "#0a658b", "light buttons use the brand teal");
  assert.equal(light.gold, "#d4ad58");
  assert.equal(dark.gold, "#d4ad58");
  assert.equal(SURFACE.dark, dark.card, "accentTokens checks the dark theme against the real dark card colour");
  assert.equal(SURFACE.light, light.card, "accentTokens checks the light theme against the real light card colour");
});

test("every colour token that exists in light also exists in dark (no token is missing from a theme)", () => {
  for (const name of Object.keys(light)) if (/^(background|foreground|card|popover|primary|secondary|muted|accent|destructive|success|warning|gold|border|input|ring)/.test(name)) assert.ok(name in dark, `--${name}`);
});

// ---- an agency's own colour, applied on top of the tokens ----
test("accentTokens: a readable colour is kept exactly; an unreadable one is nudged until it reads, and the fill keeps the exact colour", () => {
  const teal = accentTokens("#0a658b", "light")!;
  assert.equal(teal.text, "#0a658b");
  assert.equal(teal.adjusted, false);

  // A dark brand colour on the dark theme: the fill stays exact, the text version is lightened to at least 4.5:1.
  const navy = accentTokens("#02244f", "dark")!;
  assert.equal(navy.fill, "#02244f");
  assert.equal(navy.adjusted, true);
  assert.ok(contrast(parseHex(navy.text)!, parseHex(SURFACE.dark)!) >= 4.5);

  // A pale colour on the light theme is darkened.
  const pale = accentTokens("#ffe08a", "light")!;
  assert.equal(pale.adjusted, true);
  assert.ok(contrast(parseHex(pale.text)!, parseHex(SURFACE.light)!) >= 4.5);
});

test("accentTokens: every swatch of a spread of brand colours reads in both themes, and the label on the fill reads too", () => {
  const colours = ["#e11d48", "#f97316", "#facc15", "#22c55e", "#0ea5e9", "#6366f1", "#a855f7", "#111111", "#ffffff", "#808080", "#0a658b", "#d4ad58"];
  for (const c of colours) for (const theme of ["light", "dark"] as const) {
    const a = accentTokens(c, theme)!;
    assert.ok(contrast(parseHex(a.text)!, parseHex(SURFACE[theme])!) >= 4.5, `${c} as text on ${theme}`);
    assert.ok(contrast(parseHex(a.onFill)!, parseHex(a.fill)!) >= 4.5, `label on ${c}`);
  }
});

test("accentTokens: a value that is not a colour is refused, so a bad setting can never reach the page styles", () => {
  for (const bad of ["red", "javascript:1", "#12", "#gggggg", "", "url(x)", "#12345678"]) assert.equal(accentTokens(bad, "dark"), null, bad);
});

test("onColour picks the label colour with the higher contrast", () => {
  assert.equal(onColour("#ffffff"), "#000c25");
  assert.equal(onColour("#000c25"), "#ffffff");
  assert.equal(onColour("#0a658b"), "#ffffff");
  assert.equal(onColour("#d4ad58"), "#000c25");
});

test("colour maths: black on white is 21:1, and oklch converts to the right sRGB", () => {
  assert.ok(Math.abs(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 1e-9);
  const white = parseColour("oklch(1 0 0)")!;
  assert.ok(white.r > 254 && white.g > 254 && white.b > 254);
  const black = parseColour("oklch(0 0 0)")!;
  assert.ok(black.r < 1 && black.g < 1 && black.b < 1);
});
