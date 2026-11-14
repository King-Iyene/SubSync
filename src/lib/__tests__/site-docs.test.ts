import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GUIDES } from "../guides.ts";
import { CONCEPT_GUIDES } from "../concept-guides.ts";
import { GUIDE_DOC as APP_MAP } from "../site/doc-map.ts";
import { DOC_PAGES, GLOSSARY, GUIDE_DOC, pageBySlug, searchIndex, viewOf } from "../site/docs.ts";
import { HIDDEN_ROUTES, publicRoutes, STATIC_ROUTES } from "../site/routes.ts";
import { crmTarget, readLanding, signLanding } from "../install-landing.ts";
import { PRICING, INSTALL_HREF } from "../site/config.ts";

const ROOT = process.cwd();
const VENDOR = /gohighlevel|highlevel|\bghl\b|leadconnector/i;

test("every in-app guide maps to a /support page that exists, and the app and the site share one map", () => {
  for (const g of GUIDES) {
    const slug = APP_MAP[g.id];
    assert.ok(slug, `guide ${g.id} has a support page`);
    assert.ok(pageBySlug(slug), `page ${slug} exists for guide ${g.id}`);
    assert.ok(pageBySlug(slug)!.guideIds.includes(g.id), `page ${slug} is built from guide ${g.id}`);
    assert.equal(GUIDE_DOC[g.id], slug, `site and app agree for ${g.id}`);
  }
  for (const id of Object.keys(APP_MAP)) assert.ok(GUIDES.some((g) => g.id === id), `map entry ${id} is a real guide`);
});

test("every guide has bullets, and the new concept and settings guides have 4 to 8 plain bullets and a Try it now page", () => {
  for (const g of GUIDES) assert.ok(g.read.length >= 1 && g.shows && g.next, `${g.id} is complete`);
  for (const g of CONCEPT_GUIDES) {
    assert.ok(g.read.length >= 4 && g.read.length <= 8, `${g.id} has ${g.read.length} bullets`);
    assert.ok(g.tryView, `${g.id} has a Try it now page`);
  }
  assert.equal(new Set(GUIDES.map((g) => g.id)).size, GUIDES.length, "guide ids are unique");
});

test("the feature index covers the A to Z list, every page renders from the shared data, slugs are unique and links between pages resolve", () => {
  const slugs = DOC_PAGES.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, "unique slugs");
  for (const must of ["account-audit", "alerts", "appointments", "billing-and-plans", "calendars", "clean-up", "clients", "connections", "data-health", "email-sender-health", "feedback", "find-a-lead", "funnel-and-pipeline", "getting-started", "meeting-notes", "money-and-wallet", "reports-and-sharing", "roles", "safety-and-sending", "settings", "speed-to-lead", "team", "today", "workflows", "whats-new"]) assert.ok(slugs.includes(must), `page ${must}`);
  for (const p of DOC_PAGES) {
    const v = viewOf(p);
    assert.ok(v.summary.length > 10, `${p.slug} has a summary`);
    assert.ok(v.sees.some((s) => s.bullets.length > 0), `${p.slug} has what you will see`);
    assert.ok(v.steps.length > 0, `${p.slug} has steps`);
    assert.ok(v.reads && v.changes, `${p.slug} says what it reads and changes`);
    for (const r of v.related) assert.ok(pageBySlug(r), `${p.slug} links to ${r}`);
  }
  assert.ok(GLOSSARY.length >= 15);
});

test("the workflow page names the real call queue tag and not an invented one", () => {
  const wf = JSON.stringify(viewOf(pageBySlug("call-queue-tags")!));
  assert.match(wf, /call-now/);
  assert.match(wf, /Manual Action/);
});

test("the search index builds and finds a page by a plain word", () => {
  const idx = searchIndex();
  assert.equal(idx.length, DOC_PAGES.length);
  assert.ok(idx.some((e) => e.slug === "appointments" && e.text.includes("no-show")));
});

test("the route list builds, the sitemap source and hidden routes are consistent, and every route has a page file", () => {
  const routes = publicRoutes();
  assert.equal(new Set(routes).size, routes.length);
  for (const r of STATIC_ROUTES) {
    const file = r === "/" ? "src/app/page.tsx" : `src/app${r}/page.tsx`;
    assert.ok(existsSync(join(ROOT, file)), `${r} has ${file}`);
  }
  assert.ok(existsSync(join(ROOT, "src/app/support/[slug]/page.tsx")));
  for (const h of HIDDEN_ROUTES) assert.ok(!routes.includes(h));
  assert.ok(existsSync(join(ROOT, "src/app/sitemap.ts")) && existsSync(join(ROOT, "src/app/robots.ts")) && existsSync(join(ROOT, "src/app/manifest.ts")));
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) sourceFiles(p, out); else if (/\.(ts|tsx|css)$/.test(p)) out.push(p); }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

test("internal links on the public pages resolve to a real route", () => {
  const known = new Set<string>([...publicRoutes(), "/installed", "/installed/error", "/install", "/api/oauth/install", "/api/open-crm"]);
  const files = [...sourceFiles(join(ROOT, "src/app/support")), ...sourceFiles(join(ROOT, "src/components/site")), ...sourceFiles(join(ROOT, "src/lib/site")), ...["page.tsx", "trust/page.tsx", "privacy/page.tsx", "terms/page.tsx", "installed/page.tsx", "installed/error/page.tsx"].map((f) => join(ROOT, "src/app", f))];
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:href=|href: |Link href=)\{?["'`](\/[^"'`#?{$]*)/g)) { const path = m[1].replace(/\/$/, "") || "/"; if (!known.has(path) && !path.startsWith("/support/")) bad.push(`${f}: ${m[1]}`); }
  }
  assert.deepEqual(bad, []);
});

test("no vendor name or logo, and no sub-account, anywhere on the public site: sources, metadata, image names, video files", () => {
  const dirs = ["src/app/pricing", "src/app/install", "src/app/support", "src/components/site", "src/lib/site", "src/app/installed", "src/app/trust", "src/app/privacy", "src/app/terms", "src/app/api/open-crm"];
  const files = [...dirs.flatMap((d) => sourceFiles(join(ROOT, d))), ...["src/app/page.tsx", "src/app/layout.tsx", "src/app/sitemap.ts", "src/app/robots.ts", "src/app/manifest.ts", "src/app/pricing/page.tsx", "src/app/install/route.ts", "src/lib/install-redirect.ts", "src/lib/concept-guides.ts", "src/lib/site/config.ts"].map((f) => join(ROOT, f))];
  const hits: string[] = [];
  for (const f of files) {
    const text = stripComments(readFileSync(f, "utf8")).replace(/^import .*$/gm, "").replace(/process.env.[A-Z_]+/g, "");
    // Machine words that never reach a person: the open-crm route names no host (the link helper does), and nothing here may either.
    if (VENDOR.test(text)) hits.push(`${f}: vendor name`);
    if (/sub-?accounts?/i.test(text)) hits.push(`${f}: sub-account`);
  }
  for (const d of ["public/site", "public/brand", "public/video"]) for (const n of readdirSync(join(ROOT, d))) if (VENDOR.test(n) || /sub-?account/i.test(n)) hits.push(`${d}/${n}: file name`);
  for (const f of ["public/video/subsync-tour.en.vtt"]) if (VENDOR.test(readFileSync(join(ROOT, f), "utf8"))) hits.push(`${f}: captions`);
  assert.deepEqual(hits, []);
});

test("if the site has been built, no built page, metadata file or sitemap holds a vendor name", () => {
  const dir = join(ROOT, ".next", "server", "app");
  if (!existsSync(dir)) return; // the build check runs in CI after `next build`; this test is skipped on a fresh checkout
  const pages = ["index", "support", "trust", "privacy", "terms", "support/glossary", "support/changelog", "sitemap.xml", "robots.txt", "manifest.webmanifest"];
  const hits: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (/^(app|api|design|r|proof|audit|reply-proof)$/.test(n) && d === dir) continue; walk(p); } else if (/\.(html|xml|txt|webmanifest|body)$/.test(n)) { const t = readFileSync(p, "utf8"); if (VENDOR.test(t)) hits.push(p); if (/sub-?accounts?/i.test(t)) hits.push(`${p}: sub-account`); } } };
  walk(dir);
  assert.ok(pages.length > 0);
  assert.deepEqual(hits, []);
});

test("the web video script, captions, poster and logo files exist and the video is not the 62 MB master", () => {
  assert.ok(existsSync(join(ROOT, "scripts/make-web-video.mjs")));
  assert.match(readFileSync(join(ROOT, "scripts/make-web-video.mjs"), "utf8"), /movflags", "\+faststart"/);
  for (const f of ["public/video/subsync-tour-720.mp4", "public/video/subsync-tour-poster.jpg", "public/video/subsync-tour.en.vtt", "public/brand/subsync-logo.png", "public/og.png", "public/apple-touch-icon.png", "src/app/favicon.ico"]) assert.ok(existsSync(join(ROOT, f)), f);
  assert.ok(statSync(join(ROOT, "public/video/subsync-tour-720.mp4")).size < 18 * 1048576, "720p file is under 18 MB");
  assert.match(readFileSync(join(ROOT, "public/video/subsync-tour.en.vtt"), "utf8"), /^WEBVTT/);
});

test("the home page: install is the main call to action, no audit or calculator calls to action remain, the price is read from the pricing source", () => {
  const home = readFileSync(join(ROOT, "src/app/page.tsx"), "utf8");
  assert.match(home, /Install SubSync/);
  assert.match(home, /Watch the 4-minute tour/);
  assert.doesNotMatch(home, /free audit|what you could earn|LeadCostCalculator|ProfitCalculator/i);
  assert.doesNotMatch(home, /11\.50/, "the price is not typed on the page");
  assert.equal(PRICING.price, "$11.50");
  assert.equal(PRICING.trialDays, 14);
  assert.equal(INSTALL_HREF, "/install");
  assert.match(home, /VideoObject/);
});

// ---- the install landing
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

test("the install page link uses the company's own domain, and the default only when none is known", () => {
  const withDomain = crmTarget(readLanding(signLanding({ kind: "company", locationId: null, domain: "app.agency-brand.example" })));
  assert.equal(withDomain.href, "https://app.agency-brand.example/");
  assert.equal(withDomain.auto, true);
  const account = crmTarget(readLanding(signLanding({ kind: "account", locationId: "loc_12345678", domain: "app.agency-brand.example" })));
  assert.equal(account.href, "https://app.agency-brand.example/v2/location/loc_12345678/dashboard");
  const unknown = crmTarget(readLanding(signLanding({ kind: "account", locationId: "loc_12345678", domain: null })));
  assert.match(unknown.href, /^https:\/\/[^/]+\/v2\/location\/loc_12345678\/dashboard$/);
  const none = crmTarget(null);
  assert.equal(none.auto, false, "no details from the install: only the button, never an automatic redirect");
});

test("a forged, edited or expired install token is refused, and no token or secret ever reaches an address", () => {
  const good = signLanding({ kind: "company", locationId: null, domain: "app.agency-brand.example" });
  assert.ok(readLanding(good));
  const [body, sig] = good.split(".");
  const evil = Buffer.from(JSON.stringify({ k: "company", l: null, d: "evil.example", exp: 9999999999 })).toString("base64url");
  assert.equal(readLanding(`${evil}.${sig}`), null, "edited body");
  assert.equal(readLanding(`${body}.AAAA`), null, "bad signature");
  assert.equal(readLanding(good, Date.now() + 2 * 3600 * 1000), null, "expired after an hour");
  assert.equal(readLanding(null), null);
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(payload).sort(), ["d", "exp", "k", "l"], "only the kind, account, domain and expiry are carried");
  const cb = readFileSync(join(ROOT, "src/app/api/oauth/callback/route.ts"), "utf8");
  assert.doesNotMatch(cb.slice(cb.indexOf("signLanding({")), /access_token|refresh_token/);
});

test("the install page renders without details and never holds the CRM address itself", () => {
  const page = readFileSync(join(ROOT, "src/app/installed/page.tsx"), "utf8");
  assert.match(page, /readLanding/);
  assert.match(page, /\/api\/open-crm/);
  assert.match(page, /Stay on this page|AutoRedirect/);
  assert.match(page, /target\.auto && <AutoRedirect/, "auto redirect only when the install gave the details");
  assert.doesNotMatch(stripComments(page), /https:\/\/app\.|\.com\//);
  for (const h of ["Installed", "Open SubSync", "First sync", "Set up (5 min)"]) assert.match(page, new RegExp(h.replace(/[()]/g, "\\$&")));
});
