import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterHelp, ScopeFilterBar } from "@/app/app/ds";
import { ApiProvider, type Api } from "@/app/app/session";
import { TodayView } from "@/app/app/views/today";
import { WatchingPanel } from "@/app/app/views/watching-panel";
import { CAUSE_LABEL, NOT_YET, WATCHING } from "@/lib/analytics/coverage";
import { routeAllowed } from "@/lib/access";
import { EMPTY_FILTER } from "@/lib/design/filters";
import { SAMPLE_OPTIONS } from "@/app/design/sample";

// Stage F5 component and structure tests. Rendered on the server to markup (no browser, no database); the browser behaviour is in tests/e2e/f5-today.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const read = (p: string) => readFileSync(p, "utf8");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

describe("What SubSync watches", () => {
  it("has a Watching column and a Not yet column with the real lists, counted", () => {
    const m = html(el(WatchingPanel));
    expect(m).toContain("What SubSync watches");
    expect(m).toContain(`Watching (${WATCHING.length})`);
    expect(m).toContain(`Not yet (${NOT_YET.length})`);
    for (const w of WATCHING) expect(m, w.id).toContain(esc(w.what));
    for (const n of NOT_YET) expect(m, n.id).toContain(esc(n.what));
    expect(m).toContain('data-testid="watching-column"');
    expect(m).toContain('data-testid="not-yet-column"');
  });
  it("says which of the three causes holds for each thing not watched yet", () => {
    const m = html(el(WatchingPanel));
    for (const c of new Set(NOT_YET.map((n) => n.cause))) expect(m, c).toContain(CAUSE_LABEL[c]);
  });
  it("an item that ships moves across: an empty Not yet column says so", () => {
    const m = html(el(WatchingPanel, { watching: WATCHING, notYet: [] }));
    expect(m).toContain("Not yet (0)");
    expect(m).toContain("Everything on the list is being watched.");
  });
  it("is a plain section, not a card, and draws no data of its own", () => {
    const src = read("src/app/app/views/watching-panel.tsx");
    expect(src).not.toMatch(/useData|useApiClient|<Card/);
    expect(html(el(WatchingPanel))).not.toMatch(/rounded-lg border bg-card/);
  });
  it("is mounted in Settings, and no longer on Today", () => {
    expect(read("src/app/app/views/settings.tsx")).toMatch(/<WatchingPanel \/>/);
    const today = read("src/app/app/views/today.tsx");
    for (const gone of ["When this is sent", "Not watched yet", "notWatched", "We list these so you never assume", "Daily brief: on", "Slack webhook", "Email delivery needs an email service"]) expect(today, gone).not.toContain(gone);
  });
});

describe("the filter explains itself (N1)", () => {
  const bar = (kind: "agency" | "client", options = SAMPLE_OPTIONS) => html(el(ScopeFilterBar, { kind, options, value: EMPTY_FILTER, onChange: () => undefined }));
  it("says where the kind of business comes from, what the number in brackets counts, and what a test account is", () => {
    const m = bar("agency");
    expect(m).toContain('data-testid="filter-help"');
    expect(m).toContain("Kind of business is the industry you typed for each client");
    expect(m).toContain("does not read it from your CRM");
    expect(m).toContain("The number in brackets is how many client accounts have that kind");
    expect(m).toContain("contains test, demo, sample, sandbox or dummy");
    expect(m).toContain("Owners can change which accounts count as test accounts in Settings");
  });
  it("explains only the controls that are drawn: nothing for a client's staff, nothing for a control with one choice", () => {
    expect(bar("client")).not.toContain("filter-help");
    expect(html(el(FilterHelp, { controls: ["accounts"] }))).toBe("");
    const m = html(el(FilterHelp, { controls: ["industry"] }));
    expect(m).toContain("Kind of business");
    expect(m).not.toContain("test account");
  });
});

describe("Today", () => {
  const fake = (): Api => {
    const api: Api = { get: () => new Promise(() => undefined), post: () => new Promise(() => undefined), put: () => new Promise(() => undefined), del: () => new Promise(() => undefined), download: async () => undefined, demo: true, filtered: () => api };
    return api;
  };
  const go = () => undefined;
  it("the first screen, before any data arrives, already says what the screen is for and that it is checking for leads", () => {
    const m = html(el(ApiProvider, { value: fake() }, el(TodayView, { go })));
    expect(m).toContain("<h1");
    expect(m).toContain("Today");
    expect(m).toContain("Every client account, checked for leads waiting, missed appointments and stalled deals. Start at the top.");
    expect(m).toContain('data-testid="front-door"');
    expect(m).toContain('data-testid="leads-headline"');
    expect(m).toContain("Checking for leads waiting for a reply...");
    expect(m).toContain("What needs you right now");
  });
  it("reads only data the signed-in person may see: the same reads as the pages whose numbers it repeats, never an id of its own", () => {
    const src = read("src/app/app/views/today.tsx");
    const paths = [...src.matchAll(/useData<[^>]*>\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, " "));
    expect([...paths].sort()).toEqual(['"appointments"', '"audit?lists=0"', '"daily"', '"overview"', '"speed"', "r ? `daily/changes?from=${r.current.from}&to=${r.current.to}` : null"].sort());
  });
  it("notices use the plain notice, not cards; nothing on the page is a content card", () => {
    const src = read("src/app/app/views/today.tsx");
    expect(src).not.toMatch(/<Card[ >]|import \{[^}]*\bCard\b/);
    expect(src).toContain("InlineAlert");
  });
  it("no phone link, no platform name, no jargon on the page", () => {
    const src = read("src/app/app/views/today.tsx");
    expect(src).not.toMatch(/tel:/);
    expect(src).not.toMatch(/\bSLA\b|GoHighLevel|HighLevel|\bGHL\b|sub-?account/i);
  });
  it("every drill-in goes through the shell's go(), which keeps the way back (N7); no raw hash links", () => {
    const src = read("src/app/app/views/today.tsx");
    expect(src).not.toMatch(/href="#/);
    expect(src).not.toMatch(/window\.location/);
  });
  it("the page never works a percentage out for itself: it uses describeRangeChange", () => {
    const src = read("src/app/app/views/today.tsx");
    expect(src).not.toMatch(/vsYesterday|vsAvg|signed\(|percentChange|\.percent\b/);
    expect(src).toContain("describeRangeChange");
  });
  it("the shell opens on the launching account as Today with the filter narrowed to it, and says so with a plain notice (N2)", () => {
    const dash = read("src/app/app/dashboard.tsx");
    expect(dash).toMatch(/accounts: \[auth\.locationId\]/);
    expect(dash).toMatch(/<InlineAlert className="mb-3" action=\{<Btn variant="ghost" onClick=\{\(\) => setFilter\(EMPTY_FILTER\)\}>See all client accounts<\/Btn>\}>/);
    expect(dash).not.toMatch(/rounded-xl border border-primary\/30 bg-primary\/5/);
    // Today for one account from the all-accounts list: go("today", id) narrows the filter and keeps the way back.
    expect(dash).toMatch(/next\.id === "today" && next\.locationId/);
  });
});

describe("who may read the change figures (the route policy)", () => {
  it("an agency and a business may; a client's staff may not (they have My day)", () => {
    expect(routeAllowed("agency", "GET", ["daily", "changes"])).toBe(true);
    expect(routeAllowed("business", "GET", ["daily", "changes"])).toBe(true);
    expect(routeAllowed("client", "GET", ["daily", "changes"])).toBe(false);
    expect(routeAllowed("client", "GET", ["daily"])).toBe(false);
  });
  it("it is read only: nothing can write through it", () => {
    for (const kind of ["business", "client"] as const) expect(routeAllowed(kind, "POST", ["daily", "changes"]), kind).toBe(false);
  });
});
