import { readdirSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NAV_FOR } from "@/lib/access";
import { SUBTITLE_MAX } from "@/app/app/ds/template";
import {
  BarChart, ChartPlaceholder, DataList, DefinitionTip, Distribution, EmptyState, ErrorState, InlineAlert, LeadDrawer, ModuleTabs, MyDayView, Page, ScopeFilterBar, Skeleton, SkeletonCards, SkeletonRows, Sparkline,
} from "@/app/app/ds";
import { ApiError, ApiProvider } from "@/app/app/session";
import { Badge, Stat } from "@/app/app/ui";
import { NAV } from "@/app/app/nav";
import { EMPTY_FILTER } from "@/lib/design/filters";
import { sampleApi, SAMPLE_LEADS, SAMPLE_OPTIONS } from "@/app/design/sample";

// Component tests (stage D0). Each shared component is rendered on the server to markup (no browser) and checked for what it must say, which roles it
// carries, and what it must NOT carry (the plain look King approved: no dots, pills, tinted boxes, glows). The browser behaviour at three widths is
// in tests/e2e/d0.spec.ts.
// createElement with loose types, so each call reads like the markup it makes.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const noDecoration = (markup: string) => { expect(markup).not.toMatch(/rounded-full|bg-gradient|shadow-|blur|ring-1/); };

describe("status words and notices are plain", () => {
  it("a badge is text with a thin left rule: no dot, no pill, no tinted fill", () => {
    for (const tone of ["good", "warn", "bad", "info", "neutral"] as const) {
      const m = html(el(Badge, { tone }, "never answered"));
      expect(m).toContain("never answered");
      expect(m).toContain("border-l-2");
      expect(m).toContain(`data-tone="${tone}"`);
      noDecoration(m);
      expect(m).not.toMatch(/bg-[a-z]+-\d|\/1\d\b|<svg/); // no tinted background, no icon
    }
  });

  it("a notice is a single row with a thin rule, a role, no icon and no box; danger is an alert", () => {
    const info = html(el(InlineAlert, { tone: "info", title: "Heads up" }, "This list shows the first 50."));
    expect(info).toContain('role="status"');
    expect(info).toContain("border-l-2");
    expect(info).toContain("Heads up");
    expect(info).not.toContain("<svg");
    noDecoration(info);
    expect(info).not.toMatch(/\bbg-/);
    expect(html(el(InlineAlert, { tone: "danger" }, "Refresh failed"))).toContain('role="alert"');
    expect(html(el(InlineAlert, { tone: "warning", onDismiss: () => undefined }, "x"))).toContain('aria-label="Dismiss"');
  });

  it("an error says what went wrong in words, shows the server's error ID, and offers a retry", () => {
    const m = html(el(ErrorState, { error: new ApiError(504, { error: "Request failed (504)", errorId: "E-ABC123" }), onRetry: () => undefined }));
    expect(m).toContain("Something went wrong");
    expect(m).toContain("Request failed (504)");
    expect(m).toContain("E-ABC123");
    expect(m).toContain("Try again");
    expect(m).toContain('role="alert"');
    noDecoration(m);
    expect(m.slice(0, m.indexOf(">")), "the box itself has no fill").not.toMatch(/\bbg-/);
  });

  it("an error with no server ID makes one in the browser (never while the page is prepared), and an upgrade notice has no ID", () => {
    const m = html(el(ErrorState, { error: new Error("boom") }));
    expect(m).not.toContain('data-testid="error-id"'); // made after the page is up
    const up = html(el(ErrorState, { error: new ApiError(402, { error: "Part of Pro" }) }));
    expect(up).toContain("part of the paid plan");
    expect(up).not.toContain("Error ID");
  });
});

describe("empty, loading and tips", () => {
  it("empty state is words between two rules, with an optional action", () => {
    const m = html(el(EmptyState, { title: "Nothing is waiting", body: "New leads appear here.", action: el("button", null, "Sync") }));
    expect(m).toContain("Nothing is waiting");
    expect(m).toContain("New leads appear here.");
    expect(m).toContain("<button>Sync</button>");
    expect(m).not.toContain("<svg");
    noDecoration(m);
  });
  it("skeletons announce that they are loading and are hidden from the accessibility tree", () => {
    expect(html(el(SkeletonRows, { rows: 3, label: "Loading list" }))).toMatch(/aria-busy="true"[\s\S]*Loading list/);
    expect(html(el(SkeletonCards, { cards: 2 }))).toContain('data-testid="skeleton-cards"');
    expect(html(el(Skeleton, { className: "h-4" }))).toContain('aria-hidden="true"');
  });
  it("a definition sits behind a labelled button and is closed until asked", () => {
    const m = html(el(DefinitionTip, { term: "Typical first reply" }, "The middle of all reply times."));
    expect(m).toContain("Typical first reply");
    expect(m).toContain('aria-label="What does this mean?"');
    expect(m).toContain('aria-expanded="false"');
    expect(m).not.toContain("The middle of all reply times.");
  });
});

describe("page template and tabs", () => {
  it("the page has one h1, a clamped subtitle and its actions", () => {
    const m = html(el(Page, { title: "Speed to lead", subtitle: "How fast.", actions: el("button", null, "Go") }, el("p", null, "body")));
    expect(m.match(/<h1/g)).toHaveLength(1);
    expect(m).toContain("line-clamp-2");
    expect(m).toContain("<button>Go</button>");
    expect(m).toContain("body");
  });
  it("every subtitle in the M1 pages is short enough to read (UX-10)", () => {
    for (const f of ["today", "speed", "appointments", "audit", "overview"]) {
      const src = readFileSync(`src/app/app/views/${f}.tsx`, "utf8");
      for (const m of src.matchAll(/subtitle="([^"]+)"/g)) expect(m[1].length, `${f}: ${m[1]}`).toBeLessThanOrEqual(SUBTITLE_MAX);
    }
  });
  it("tabs are a tablist with the first tab selected and only its panel drawn", () => {
    const m = html(el(ModuleTabs, { tabs: [{ label: "To do", node: el("p", null, "first") }, { label: "Insights", node: el("p", null, "second") }], label: "Appointments" }));
    expect(m).toContain('role="tablist"');
    expect(m).toContain('aria-label="Appointments"');
    expect(m.match(/role="tab"/g)).toHaveLength(2);
    expect(m).toMatch(/aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/);
    expect(m).toContain("first");
    expect(m).not.toContain("second");
    expect(html(el(ModuleTabs, { start: 1, tabs: [{ label: "A", node: "a-panel" }, { label: "B", node: "b-panel" }] }))).toContain("b-panel");
  });
});

describe("the list: ten rows and View all", () => {
  const rows = SAMPLE_LEADS.slice(0, 25);
  const columns = [{ key: "n", header: "Lead", primary: true, cell: (r: (typeof rows)[number]) => r.name }, { key: "a", header: "Client account", cell: (r: (typeof rows)[number]) => r.locationName }];
  it("shows ten rows and says how many there are", () => {
    const m = html(el(DataList, { rows, columns, rowKey: (r: (typeof rows)[number]) => r.contactId, title: "Leads" }));
    expect(m.match(/<li /g)).toHaveLength(10);
    expect(m).toContain("Showing 10 of 25");
    expect(m).toContain("View all 25");
    expect(m).toContain('data-mode="preview"');
  });
  it("a short list has no View all, and an empty list says so", () => {
    const short = html(el(DataList, { rows: rows.slice(0, 4), columns, rowKey: (r: (typeof rows)[number]) => r.contactId }));
    expect(short.match(/<li /g)).toHaveLength(4);
    expect(short).not.toContain("View all");
    expect(html(el(DataList, { rows: [], columns, rowKey: () => "x", empty: "No leads yet." }))).toContain("No leads yet.");
  });
  it("a list that the server cut short says how much it left out", () => {
    const m = html(el(DataList, { rows: rows.slice(0, 5), total: 3000, columns, rowKey: (r: (typeof rows)[number]) => r.contactId }));
    expect(m).toContain("Showing 5 of 3000");
    expect(m).toContain("Only the first 5 of 3000 are loaded here");
  });
  it("on a phone a row wraps, on a wide screen it is a grid: no sideways scroll either way", () => {
    const m = html(el(DataList, { rows: rows.slice(0, 2), columns, rowKey: (r: (typeof rows)[number]) => r.contactId }));
    expect(m).toContain("flex-wrap");
    expect(m).toContain("@3xl:grid");
    expect(m).toContain("@container");
    expect(m).not.toContain("overflow-x-auto");
  });
  it("the name opens the row when the list can open rows", () => {
    expect(html(el(DataList, { rows: rows.slice(0, 2), columns, rowKey: (r: (typeof rows)[number]) => r.contactId, onOpen: () => undefined }))).toContain("<button");
    expect(html(el(DataList, { rows: rows.slice(0, 2), columns, rowKey: (r: (typeof rows)[number]) => r.contactId }))).not.toContain("<button");
  });
});

describe("the filter bar fits the person", () => {
  const bar = (kind: "agency" | "client", options = SAMPLE_OPTIONS, singleAccount = false) => html(el(ScopeFilterBar, { kind, options, value: EMPTY_FILTER, onChange: () => undefined, singleAccount }));
  it("an agency gets the client-account picker and the test switch", () => {
    const m = bar("agency");
    expect(m).toContain("Client accounts");
    expect(m).toContain("Hide 1 test account");
    expect(m).toContain("Kind of business");
  });
  it("a client's staff get no account picker, industry, owner or test switch, but their own people, calendars and sources", () => {
    const m = bar("client");
    for (const absent of ["Client accounts", "Kind of business", "Account owner", "test account"]) expect(m, absent).not.toContain(absent);
    for (const present of ["Person", "Calendar", "Pipeline", "Where the lead came from", "Time"]) expect(m, present).toContain(present);
  });
  it("a page about one account has no account controls, and nothing to choose draws nothing at all", () => {
    expect(bar("agency", SAMPLE_OPTIONS, true)).not.toContain("Client accounts");
    expect(bar("agency", { accounts: [{ id: "abc123", name: "One" }] } as never)).toBe("");
  });
});

describe("charts", () => {
  it("a bar chart has a scale from zero, a tooltip target for every bar and a table for screen readers", () => {
    const m = html(el(BarChart, { title: "By week", unit: "%", bars: [{ label: "Oct 5", value: 40 }, { label: "Oct 12", value: 80 }], sample: 20, min: 5 }));
    expect(m).toContain("By week");
    expect(m).toMatch(/>0<\/span>/);
    expect(m).toContain(">20<"); // ticks are round steps up to the biggest value (80)
    expect(m).toContain(">80<");
    expect(m).toContain("height:100%"); // the biggest bar reaches the top of the scale
    expect(m.match(/<button/g)).toHaveLength(2);
    expect(m).toContain('aria-label="Oct 12: 80 %"');
    expect(m).toContain('class="sr-only"');
  });
  it("under the minimum sample the chart is one placeholder that says what will appear and how many there are so far", () => {
    const m = html(el(BarChart, { title: "Replies by week", bars: [{ label: "a", value: 1 }], sample: 2, min: 5, need: "replies" }));
    expect(m).toContain('data-testid="chart-placeholder"');
    expect(m).toContain("at least 5 replies");
    expect(m).toContain("2 so far");
    expect(m).not.toContain("<button");
    expect(html(el(ChartPlaceholder, { need: 5, have: 0 }))).toContain("None so far.");
  });
  it("a week with too few leads is a dashed gap, not a zero bar", () => {
    const m = html(el(BarChart, { title: "By week", bars: [{ label: "a", value: null }, { label: "b", value: 50 }], sample: 20, min: 5 }));
    expect(m).toContain("too few to show");
    expect(m).toContain("border-dashed");
  });
  it("a distribution has a labelled scale, and a sparkline says where it started, where it is and its range", () => {
    const d = html(el(Distribution, { title: "Waiting", rows: [{ label: "Under 4 hours", value: 14 }, { label: "Older", value: 6 }] }));
    expect(d).toContain("Under 4 hours");
    expect(d).toContain(">14<");
    const s = html(el(Sparkline, { label: "Pipeline", values: [3, 5, 4, 9] }));
    expect(s).toContain("Start 3");
    expect(s).toContain("Range 3 to 9");
    expect(s).toContain("lowest 3, highest 9");
    expect(html(el(Sparkline, { label: "Pipeline", values: [3, 5] }))).toContain("Needs at least 3 days of history (2 so far)");
  });
});

describe("the lead drawer and My day (read from sample data, never signed in)", () => {
  const seeds = SAMPLE_LEADS.slice(0, 3).map((l) => ({ contactId: l.contactId, locationId: l.locationId, name: l.name, locationName: l.locationName }));
  const wrap = (child: ReturnType<typeof h>) => el(ApiProvider, { value: sampleApi() }, child);
  it("is nothing when closed, a dialog with its position and a quiet CRM link when open", () => {
    expect(html(wrap(el(LeadDrawer, { leads: seeds, index: null, onIndex: () => undefined, onClose: () => undefined })))).toBe("");
    const m = html(wrap(el(LeadDrawer, { leads: seeds, index: 0, onIndex: () => undefined, onClose: () => undefined })));
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain(seeds[0].name);
    expect(m).toContain("1 of 3");
    expect(m).toContain("aria-label=\"Previous lead\" disabled=\"\""); // first lead: no previous
    expect(m).not.toContain("aria-label=\"Next lead\" disabled=\"\"");
    expect(m).toContain('aria-label="Close"');
  });
  it("the last lead has no next, and My day starts as a loading list for a phone", () => {
    expect(html(wrap(el(LeadDrawer, { leads: seeds, index: 2, onIndex: () => undefined, onClose: () => undefined })))).toContain("aria-label=\"Next lead\" disabled=\"\"");
    const m = html(wrap(el(MyDayView, { go: () => undefined })));
    expect(m).toContain("My day");
    expect(m).toContain("aria-busy");
  });
});

describe("the menu structure", () => {
  const groups = [...new Set(NAV.filter((n) => !n.parent).map((n) => n.group))];
  it("uses plain group names and none of the old ones", () => {
    expect(groups).toEqual(["", "Daily work", "Clients and people", "More", "Settings and help"]);
    expect(JSON.stringify(NAV)).not.toMatch(/Tidy up|Inbox & SLA|SLA/);
  });
  it("the pilot menu is on top, in order", () => {
    const top = NAV.filter((n) => !n.parent && n.group !== "More").map((n) => n.label);
    expect(top).toEqual(["Today", "My day", "Speed to lead", "Appointments", "Unanswered messages", "Account audit", "Clients", "People", "Settings", "Getting started", "What's new"]);
  });
  it("nothing that was visible has gone: every page is still in the menu, under More, or a tab of its parent", () => {
    for (const id of ["overview", "accounts", "team", "pipeline", "onboarding", "duplicates", "cleanup", "meetings"]) expect(NAV.find((n) => n.id === id)?.group, id).toBe("More");
    for (const id of ["search", "leads", "calls"]) expect(NAV.find((n) => n.id === id)?.parent, id).toBe("people");
    for (const n of NAV) if (n.parent) expect(NAV.some((p) => p.id === n.parent), n.id).toBe(true);
    for (const id of NAV.map((n) => n.id)) if (id !== "myday") expect(NAV_FOR.agency.has(id), `agency sees ${id}`).toBe(true);
  });
  it("My day is for a client's staff and a business, not for an agency; a client does not get Today", () => {
    expect(NAV_FOR.client.has("myday")).toBe(true);
    expect(NAV_FOR.business.has("myday")).toBe(true);
    expect(NAV_FOR.agency.has("myday")).toBe(false);
    expect(NAV_FOR.client.has("today")).toBe(false);
  });
});

describe("the whole kit stays plain", () => {
  it("no shared component uses a pill, dot, tinted box, gradient, glow or decorative emoji", () => {
    const dir = "src/app/app/ds";
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      expect(src, `${f}: gradient`).not.toMatch(/bg-gradient|text-transparent|bg-clip-text/);
      expect(src, `${f}: emoji`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(src, `${f}: rounded-2xl card`).not.toContain("rounded-2xl");
    }
    const ui = readFileSync("src/app/app/ui.tsx", "utf8");
    expect(ui).not.toMatch(/dotClass|ring-1 ring-inset/);
  });
  it("a stat tile is a plain rule-and-number box", () => {
    const m = html(el(Stat, { label: "Waiting", value: "12", tone: "bad" }));
    expect(m).toContain("Waiting");
    noDecoration(m);
  });
});
