import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// docs/DECISIONS.md "No hidden features": an action or a setting is never behind a collapsed disclosure. A collapsed <details> may hold explanation only.
// A <details> that holds a button, link, form control or submit must either start open (the `open` attribute) or be listed below with the reason it may stay closed.
const ROOT = join(process.cwd(), "src/app/app/views");
const ALLOW: Record<string, string> = {
  // file: reason. A row-level control that opens inside a list row (the row itself is the visible action) may stay a disclosure.
  "views/connections.tsx": "owned by the connections builder; its Fathom notice is explanation",
  "views/settings-hub-parts.tsx": "owned by the connections builder",
};
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });
const ACTION = /<(button|input|select|textarea|form)\b|onClick=|<a\s[^>]*href/;

export function hiddenActions(src: string): number[] {
  const out: number[] = [];
  const re = /<details\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/(^|\s)open(\s|=|$)/.test(m[1]) || m[1].includes("data-allow-collapsed")) continue; // data-allow-collapsed="reason": a popover whose labelled button is always visible
    const end = src.indexOf("</details>", m.index);
    const body = end < 0 ? "" : src.slice(m.index, end);
    // A summary that only explains ("How is this worked out?") is exempt; the body is checked for an action.
    if (ACTION.test(body.replace(/<summary[\s\S]*?<\/summary>/, ""))) out.push(src.slice(0, m.index).split("\n").length);
  }
  return out;
}

test("the checker catches a closed disclosure that hides a button and passes an open one", () => {
  assert.equal(hiddenActions(`<details><summary>x</summary><button>Do</button></details>`).length, 1);
  assert.equal(hiddenActions(`<details open><summary>x</summary><button>Do</button></details>`).length, 0);
  assert.equal(hiddenActions(`<details><summary>How is this worked out?</summary><p>text</p></details>`).length, 0);
});

test("no collapsed <details> in the app views hides an action or a setting", () => {
  const bad: string[] = [];
  for (const f of walk(ROOT)) {
    const rel = "views/" + f.slice(ROOT.length + 1).replace(/\\/g, "/");
    if (ALLOW[rel]) continue;
    for (const line of hiddenActions(readFileSync(f, "utf8"))) bad.push(`${rel}:${line}`);
  }
  assert.deepEqual(bad, [], "Open these disclosures (add `open`) or show the action as a visible button: " + bad.join(", "));
});
