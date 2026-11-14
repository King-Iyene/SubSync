import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CODE_LIKE, visibleText } from "../../../tests/fixtures/visible-text.ts";
import { FEATURES } from "../entitlements.ts";
import { DEFAULT_OFF, resolveFeatures } from "../flags-core.ts";

// King's launch decision of 8 Nov 2026: Zoom and Google Meet stay hidden behind "zoom_meet", off by default; the Meetings module is on for pilot testing.
// Nothing a person can read may name Zoom or Google Meet while that integration is off. The code, app registration, and callback address stay in place.
// Three layers: this test (the switch's default state, and every place in the code that can show the words), the integration check
// scripts/check-flags.ts (the API answers with the switch really off), and tests/e2e/zoom-hidden.spec.ts (the real screens at the default state).
const ROOT = join(process.cwd(), "src");
const NAMED = /zoom|google meet|\bmeet\b/i;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") files(p, out); } else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// Where the words may appear in text a person can read, and how many times. Each place is one of:
//   gated    the text is only produced while the switch is on (the API leaves the card out, or the page checks the flag first)
//   plumbing code that only runs after a Zoom sign-in or a Zoom notification, neither of which can start while the switch is off
//   notes    our own documentation of a route, never shown on a screen
// A new mention anywhere else fails this test, and so does a changed count in a gated file, so each one is looked at on purpose.
const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/app/app/views/connections.tsx": { count: 3, why: "gated: the Zoom card (its name and its sentence) is drawn only when the API lists Zoom, and an older shared Zoom connection is listed only when the API sends it; the API leaves both out while the switch is off" },
  "src/app/app/views/meetings.tsx": { count: 2, why: "gated: each mention is behind moreTools, which is the switch" },
  "src/lib/getting-started.ts": { count: 1, why: "gated: the meeting step picks its words from the switch (the facts say whether Zoom is on)" },
  "src/app/api/hooks/zoom/route.ts": { count: 1, why: "plumbing: a log line when a Zoom notification fails" },
  "src/lib/api/connections-api.ts": { count: 1, why: "gated: the card list adds Zoom only when zoomOn(ctx), the switch" },
  "src/lib/connections/personal-flow.ts": { count: 4, why: "plumbing: the provider's name in messages that follow a personal Zoom sign-in, which cannot start while the switch is off (the start route answers 404)" },
  "src/lib/connections/flow.ts": { count: 1, why: "plumbing: the provider's name for messages that follow a Zoom sign-in" },
  "src/lib/connections/oauth.ts": { count: 4, why: "plumbing: errors from Zoom's own sign-in and API calls" },
  "src/lib/route-guards.ts": { count: 2, why: "notes: the guard table (the Zoom notification route, and the privacy page that reads the switch)" },
};

test("Zoom and Google Meet stay off by default while the Meetings module is available", () => {
  assert.ok((FEATURES as readonly string[]).includes("zoom_meet"));
  assert.ok(DEFAULT_OFF.has("zoom_meet"), "zoom_meet is in the default-off list");
  assert.ok(!DEFAULT_OFF.has("meetings"), "the Meeting notes module is available for launch testing");
  const off = resolveFeatures(FEATURES, {}, false);
  assert.equal(off.zoom_meet, false, "off by default");
  assert.equal(off.meetings, true);
  assert.equal(off.connections, true, "Connections itself stays on: Slack and Fathom are not hidden");
  assert.equal(resolveFeatures(FEATURES, {}, true).zoom_meet, true, "the test servers set FLAGS_ALL_ON, which turns every default on");
  assert.equal(resolveFeatures(FEATURES, { zoom_meet: true }, false).zoom_meet, true, "a database row turns it on without a deploy");
  assert.equal(resolveFeatures(FEATURES, { zoom_meet: false }, true).zoom_meet, false, "and a row turning it off beats the all-on test setting: this is how the flag-off state is tested on a server that has everything on");
});

test("no text a person can read names Zoom or Google Meet outside the places listed, and each listed place stays gated", () => {
  const found = new Map<string, number>();
  const stray: string[] = [];
  for (const file of files(ROOT)) {
    const rel = file.slice(file.indexOf("src")).split("\\").join("/");
    for (const t of visibleText(readFileSync(file, "utf8"), file)) {
      const text = t.text.trim();
      if (!NAMED.test(text) || CODE_LIKE.test(text)) continue; // a lowercase key such as "zoom" or "connections.zoom_connected" is code, not text
      if (!ALLOWED[rel]) stray.push(`${rel}:${t.line}: ${text.slice(0, 80)}`);
      else found.set(rel, (found.get(rel) ?? 0) + 1);
    }
  }
  assert.deepEqual(stray, [], "Zoom text outside the listed places. Gate it on the switch (or on the API leaving it out) and add it to ALLOWED with the reason.");
  for (const [rel, { count }] of Object.entries(ALLOWED)) assert.equal(found.get(rel) ?? 0, count, `${rel}: the number of Zoom mentions changed (${ALLOWED[rel].why}). Check that each is still gated, then update this count.`);
});

test("the Zoom sign-in return address and notification address are still in place (the app registration points at them)", () => {
  const callback = readFileSync(join(ROOT, "app/api/integrations/[provider]/callback/route.ts"), "utf8");
  assert.ok(callback.includes("isProvider"), "the return address still handles every provider, Zoom included");
  assert.ok(!/zoom_meet|featureOn\("zoom/.test(callback), "and does not check the Zoom switch, so it keeps answering");
  assert.ok(readFileSync(join(ROOT, "app/api/hooks/zoom/route.ts"), "utf8").includes("endpoint.url_validation"), "the notification address still answers Zoom's address check");
});

test("the listing copy in the docs names neither Zoom nor Google Meet, and does not advertise Slack until its connect flow is proven", () => {
  const section = (file: string, from: string) => {
    const text = readFileSync(join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
    const start = text.indexOf(from);
    assert.ok(start >= 0, `${file} has the section "${from}"`);
    const end = text.indexOf("\n## ", start + from.length);
    return text.slice(start, end < 0 ? undefined : end);
  };
  for (const [file, from] of [["docs/features/Z2.md", "## 3. Corrected listing copy"], ["docs/GHL_PORTAL_CHECKLIST.md", "## 2. Listing copy"]] as const) {
    const copy = section(file, from);
    assert.ok(!NAMED.test(copy), `${file}: the listing copy must not name Zoom or Google Meet`);
    assert.ok(!/slack/i.test(copy), `${file}: the listing copy must not advertise Slack until its connect flow is proven`);
  }
});
