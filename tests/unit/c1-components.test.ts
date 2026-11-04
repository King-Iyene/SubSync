import { readdirSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart } from "@/app/app/ds";
import { ApiProvider, type Api } from "@/app/app/session";
import { ClientsView } from "@/app/app/views/clients";
import { ClientCard } from "@/app/app/views/clients/onboarding-tab";
import { ReviewsTab } from "@/app/app/views/clients/reviews";
import { bandGroups, healthBars } from "@/lib/analytics/client-success";
import { buildOnboardingItems } from "@/lib/analytics/client-success";

// Component tests for the Clients module (stage C1). Rendered on the server to markup (no browser, no database): what each piece says, what it offers,
// and that it keeps the plain look. Anything that needs a loaded page (the tabs fetching their data) is in tests/e2e/c1.spec.ts, written in this stage
// and run by the lead engineer.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const noDecoration = (markup: string) => { expect(markup).not.toMatch(/rounded-full|bg-gradient|blur|ring-1/); };
const noop = () => undefined;
const api: Api = { demo: true, get: (async () => ({})) as Api["get"], filtered: () => api, post: (async () => ({})) as Api["post"], put: (async () => ({})) as Api["put"], del: (async () => ({})) as Api["del"], download: async () => undefined };
const withApi = (node: ReturnType<typeof h>) => el(ApiProvider, { value: api }, node);

const days = (n: number, from = "2026-10-01") => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe("the line chart", () => {
  const series = [{ label: "Health", tone: 1 as const, points: days(10).map((day, i) => ({ day, value: 50 + i * 3 })) }, { label: "Average", tone: "muted" as const, dashed: true, points: days(10).map((day, i) => ({ day, value: 60 + i })) }];

  it("draws two labelled axes, a legend with the latest value, and a table for screen readers", () => {
    const m = html(el(LineChart, { title: "Health score", series, ceiling: 100, axisLabel: "0 to 100" }));
    const t = text(m);
    for (const tick of ["0", "25", "50", "75", "100"]) expect(t).toContain(tick);
    expect(t).toContain("1 Oct");
    expect(t).toContain("10 Oct");
    expect(t).toContain("0 to 100");
    expect(t).toMatch(/Health now 77/);
    expect(t).toMatch(/Average now 69/);
    expect(m).toContain("<caption>Health score</caption>");
    expect(m).toContain('role="group"');
    expect(m).toContain("left and right arrow keys");
    expect((m.match(/<polyline/g) ?? []).length, "one line per series").toBe(2);
    expect(m).toContain("stroke-dasharray");
    noDecoration(m);
    expect(m).not.toContain("tel:");
  });

  it("a gap in the data is a gap in the line, not a value", () => {
    const gappy = [{ label: "Health", points: days(8).map((day, i) => ({ day, value: i === 3 || i === 4 ? null : 40 + i })) }];
    const m = html(el(LineChart, { title: "Health", series: gappy }));
    expect((m.match(/<polyline/g) ?? []).length, "two pieces, not one joined line").toBe(2);
    // The screen-reader table lists only days that have a value: the two empty days are not read out as if they had one.
    expect(text(m)).toContain("3 Oct 2026");
    expect(text(m)).not.toContain("4 Oct 2026");
    expect(text(m)).not.toContain("5 Oct 2026");
  });

  it("under the minimum number of days it says what will appear and when, and draws nothing", () => {
    const m = html(el(LineChart, { title: "Health score", series: [{ label: "Health", points: days(2).map((day) => ({ day, value: 50 })) }] }));
    expect(m).toContain('data-testid="chart-placeholder"');
    expect(text(m)).toMatch(/Health score appears once there are at least 3 days of history/);
    expect(m).not.toContain("<polyline");
  });
});

describe("the Clients by health chart", () => {
  const rows = [
    { name: "A", band: "at_risk" as const }, { name: "B", band: "watch" as const }, { name: "C", band: "healthy" as const },
    { name: "D", band: "healthy" as const }, { name: "E", band: "thriving" as const }, { name: "F", band: "healthy" as const },
  ];
  it("the count on every bar is exactly the clients in the list behind it, and together they are every client once", () => {
    const groups = bandGroups(rows);
    const bars = healthBars(groups);
    expect(bars.map((b) => [b.label, b.value, b.count])).toEqual([["At risk", 1, 1], ["Watch", 1, 1], ["Healthy", 3, 3], ["Thriving", 1, 1]]);
    bars.forEach((b, i) => expect(b.count, b.label).toBe(groups[i].rows.length));
    expect(bars.reduce((s, b) => s + b.count, 0)).toBe(rows.length);
    expect(bars.map((b) => b.tone)).toEqual(["bad", "warn", "good", "good"]);
    expect(bars[2].detail).toBe("C, D, F");
  });
});

describe("the Onboarding checklist of one client", () => {
  const facts = { website: null, timezone: "Africa/Lagos", address: "1 Main St", appointments: 0, appointmentsAccess: "ok" };
  const built = buildOnboardingItems({
    base: [{ key: "profile", label: "Business profile filled in", status: "todo", auto: true }, { key: "pipeline", label: "At least one pipeline", status: "done", auto: true }, { key: "email_auth", label: "Sending domain authenticated", status: "unknown", auto: true, detail: "Check it" }, { key: "manual:kickoff", label: "Kickoff call completed", status: "todo", auto: false }],
    facts, templateSteps: [{ key: "ab12", label: "Collect brand assets", howto: "Ask for the logo." }], states: [{ stepKey: "manual:kickoff", isCustom: false, label: null, assignee: "Dana", dueOn: "2026-10-20", doneAt: null, doneBy: null }, { stepKey: "step:zz9988", isCustom: true, label: "Order the welcome gift", assignee: null, dueOn: null, doneAt: null, doneBy: null }],
    manualDone: {}, locationId: "L1", links: { whitelabelDomain: "crm.acme-marketing.com" }, nowMs: Date.UTC(2026, 10, 1),
  });
  const c = { locationId: "L1", name: "Alpha Dental", owner: null, url: "https://crm.acme-marketing.com/x", industry: "Dental", template: { id: "t1", name: "Clinic onboarding" }, completionPct: built.completionPct, daysIn: 30, lastProgressAt: null, items: built.items, stuck: true, openCount: 5, overdueCount: 1 };
  const closed = html(withApi(el(ClientCard, { c, open: false, onToggle: noop, reload: noop, go: noop })));
  const open = html(withApi(el(ClientCard, { c, open: true, onToggle: noop, reload: noop, go: noop })));

  it("the card says how far along the client is, that it is stuck, which template it uses, and what is still to do", () => {
    const t = text(closed);
    expect(t).toContain("Alpha Dental");
    expect(t).toContain("Stuck");
    expect(t).toContain("Template: Clinic onboarding");
    expect(t).toContain("added 30 days ago");
    expect(t).toContain("1 overdue");
    expect(t).toMatch(/Still to do: Business profile filled in/);
    expect(closed).toContain('role="progressbar"');
  });

  it("an open checklist gives each unfinished step a Fix it link through the white-label domain, a how-to, a person and a due date", () => {
    const t = text(open);
    expect(open).toContain('href="https://crm.acme-marketing.com/v2/location/L1/settings/company"');
    expect(t).toContain("Fix it in your CRM");
    expect(t).toContain("How to");
    expect(t).toContain("Given to");
    expect(open).toContain('type="date"');
    expect(open).toContain('value="Dana"');
    expect(t).toMatch(/overdue, was due Oct 20/);
    expect(t).toContain("Fix it"); // the email step's fix opens the page inside the app
    expect(t).toContain("Not checked yet.");
    expect(t).toContain("Collect brand assets");
    expect(t).toContain("Order the welcome gift");
    expect(t).toContain("Remove step");
    expect(t).toContain("Add a step for Alpha Dental");
    expect(t).toContain("Show history");
  });

  it("only steps a person does can be ticked; automatic checks show a mark, never a box", () => {
    expect((open.match(/type="checkbox"/g) ?? []).length).toBe(built.items.filter((i) => i.canTick).length);
    expect(open).toContain('aria-label="Kickoff call completed, Alpha Dental"');
    expect(open).not.toContain('aria-label="Business profile filled in, Alpha Dental"');
  });

  it("never names the platform and is plain", () => {
    for (const m of [closed, open]) { expect(text(m)).not.toMatch(/gohighlevel|highlevel|\bghl\b|leadconnector|sub-?account|\blocations?\b/i); noDecoration(m); expect(m).not.toContain("tel:"); }
  });
});

describe("the module", () => {
  const mod = (props: Record<string, unknown>) => html(withApi(el(ClientsView, { go: noop, ...props })));
  it("has five tabs (Clients first) and opens on the one asked for", () => {
    const m = mod({ initialTab: "onboarding" });
    const t = text(m);
    for (const tab of ["Clients", "Onboarding", "Compare", "Reviews (QBR)", "Industries"]) expect(t, tab).toContain(tab);
    expect(m).toMatch(/aria-selected="true"[^>]*>Onboarding</);
    expect(t).toContain("Export CSV");
    expect(t).toContain("Which clients may leave, which renewals are coming, and what each client pays you.");
    expect(t).toContain("fees, renewal dates and industries are typed by you");
  });
  it("leaves out the tabs whose switch is off, and a tab asked for that is off falls back to the first one", () => {
    const f = { health: true, onboarding: true, clients: true, reports: false, setupCompare: true, playbooks: true };
    const t = text(mod({ initialTab: "reviews", features: f }));
    expect(t).not.toContain("Compare");
    expect(t).not.toContain("Reviews (QBR)");
    expect(t).toContain("Industries");
    const onlyOnboarding = mod({ features: { ...f, health: false, clients: false } });
    expect((onlyOnboarding.match(/role="tab"/g) ?? []).length).toBe(1);
    expect(onlyOnboarding).toMatch(/aria-selected="true"[^>]*>Onboarding</);
    // The old address of the fee tab opens the Clients tab.
    expect(mod({ initialTab: "details" })).toMatch(/aria-selected="true"[^>]*>Clients</);
  });
  it("the header is not printed (a review prints alone) and no page-wide print rules hide the review", () => {
    expect(mod({})).toContain("print:hidden");
  });
});

describe("the Reviews tab before a client is chosen", () => {
  it("asks for a client and says what a review is for", () => {
    const t = text(html(withApi(el(ReviewsTab, { accounts: [{ locationId: "L1", name: "Alpha Dental" }] }))));
    expect(t).toContain("Choose a client");
    expect(t).toContain("Alpha Dental");
    expect(t).toContain("Print or save as PDF");
  });
});

describe("the new screens follow the rules of the app", () => {
  const files = [...readdirSync("src/app/app/views/clients").filter((f) => /\.tsx?$/.test(f)).map((f) => `src/app/app/views/clients/${f}`), "src/app/app/ds/line-chart.tsx", "src/app/app/views/setup-compare.tsx"];
  it("no tel: link (calls go through the CRM's own dialer), no hard-coded CRM address, no pill, gradient or emoji", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f}: tel:`).not.toMatch(/["'`]tel:/);
      expect(src, `${f}: CRM address`).not.toMatch(/gohighlevel\.com|leadconnectorhq\.com/);
      expect(src, `${f}: gradient`).not.toMatch(/bg-gradient|text-transparent|bg-clip-text/);
      expect(src, `${f}: emoji`).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});
