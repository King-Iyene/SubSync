import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// N74: "one source of truth for freshness ... a test that every page shows the same freshness value." The values are the same because there is only
// one place that makes them and one place that shows them. This test pins that down in the source, and the integration check
// (scripts/check-sync.ts) and the browser test (tests/e2e/freshness.spec.ts) prove it on real answers and real pages.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk("src");
const read = (p: string) => readFileSync(p, "utf8");
const slash = (p: string) => p.replace(/\\/g, "/");

describe("freshness has one source and one place on screen", () => {
  it("no file words freshness on its own: the old vague and contradicting phrases are gone everywhere", () => {
    const banned = [/under an hour old/i, /Data is \$\{hours\}/, /hours old: some of this/i, /Last synced/, /Last completed/, /A sync is still running/i, /Still syncing your accounts/i, /Your first sync is running\. Client accounts/, /refreshes automatically about once a day/i];
    const hits: string[] = [];
    for (const f of files) { const t = read(f); for (const b of banned) if (b.test(t)) hits.push(`${slash(f)}: ${b}`); }
    expect(hits).toEqual([]);
  });

  it("only the freshness module writes 'Updated ... ago'", () => {
    const hits = files.filter((f) => /Updated \$\{|"Updated |`Updated /.test(read(f)) && !slash(f).endsWith("src/lib/sync/freshness.ts")).map(slash);
    expect(hits).toEqual([]);
  });

  it("no screen reads a sync time of its own", () => {
    const hits = files.filter((f) => slash(f).startsWith("src/app/") && /lastFinishedAt|lastSyncAt|lastSyncedAt|conversationsSyncedAt|opportunitiesSyncedAt/.test(read(f))).map(slash);
    expect(hits).toEqual([]);
  });

  it("every answer that carries freshness gets it from freshnessFor", () => {
    const router = read("src/lib/api/router.ts");
    const digest = read("src/lib/analytics/digest-service.ts");
    expect(router.match(/freshnessFor\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(digest).toMatch(/freshnessFor\(installationId/);
    expect(digest).not.toMatch(/\bfreshness\(/);
    expect(router).not.toMatch(/lastFinishedAt\b.*(text|label)/);
  });

  it("the strip is drawn once, above every page, outside the page switch", () => {
    const dash = read("src/app/app/dashboard.tsx");
    // D0 renamed it for the shell: StatusLine is the same FreshnessStrip (src/app/app/ds/index.ts), still drawn exactly once, above the page.
    expect(dash).toMatch(/import \{ FreshnessStrip as StatusLine \} from "\.\/views\/sync-status"/);
    expect(dash.match(/<StatusLine/g)).toHaveLength(1);
    expect(dash).not.toMatch(/<FreshnessStrip/);
    // Built once; on Today it sits in the top row next to search and the bell, on every other page it is drawn above the page.
    expect(dash).toMatch(/const strip = <StatusLine inline=\{view\.id === "today"\} \/>;/);
    expect(dash).toMatch(/\{view\.id !== "today" && strip\}<BackProvider value=\{back\}>\{content\}<\/BackProvider>/);
    expect(dash).toMatch(/\{view\.id === "today" && strip\}/);
    expect(read("src/app/app/ds/index.ts")).toMatch(/FreshnessStrip as StatusLine/);
    // No other view asks for the freshness data.
    const askers = files.filter((f) => slash(f).startsWith("src/app/") && /useData<[^>]*>\("(freshness|sync-status)"\)|useData\("(freshness|sync-status)"\)/.test(read(f))).map(slash);
    expect(askers).toEqual(["src/app/app/views/sync-status.tsx"]);
  });

  it("the old per-page badge, banner and cards are gone, and Settings has one Sync status panel", () => {
    const settings = read("src/app/app/views/settings.tsx");
    expect(settings).toMatch(/<SyncStatusPanel \/>/);
    expect(settings).not.toMatch(/Connection health|title="Data sync"|HealthCard/);
    expect(read("src/app/app/views/today.tsx")).not.toMatch(/freshness/);
    expect(read("src/app/app/views/overview.tsx")).not.toMatch(/Data sync|Still syncing|first sync is running/i);
  });

  it("the webhook route turns the real INSTALL and UNINSTALL names into the documented ones before it decides", () => {
    const route = read("src/app/api/webhooks/ghl/route.ts");
    expect(route.indexOf("canonicalType(event.type)")).toBeGreaterThan(0);
    expect(route.indexOf("canonicalType(event.type)")).toBeLessThan(route.indexOf("actionFor(event.type)"));
  });
});
