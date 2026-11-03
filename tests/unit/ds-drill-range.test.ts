import { readdirSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AccountScope, BarChart, CardRange, DataList, Distribution, DrillPanel, HowTo, LeadDrawer,
} from "@/app/app/ds";
import { ApiProvider } from "@/app/app/session";
import { EMPTY_FILTER } from "@/lib/design/filters";
import { weekBars } from "@/lib/design/trend-bars";
import { sampleApi, SAMPLE_LEADS, SAMPLE_OPTIONS, SAMPLE_TREND } from "@/app/design/sample";

// Component tests for the clickable charts (KF-6), the range of one card (KF-4), the account list of the filter bar (KF-2), the how-to note and list copy
// (KF-5), and "calls go through the CRM" (KF-3). Rendered on the server to markup; the browser behaviour is in tests/e2e/d0.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);

type Member = (typeof SAMPLE_TREND)[number]["members"][number];
const cols = [{ key: "n", header: "Lead", primary: true, cell: (m: Member) => m.name }];
const drillState = (selected: number | null, open = true) => ({ selected, open, select: () => undefined, close: () => undefined, reopen: () => undefined, clear: () => undefined });
const panel = (selected: number | null, count: number, rows: Member[], open = true) =>
  html(el(DrillPanel, { drill: drillState(selected, open), title: "Week", count, noun: "leads", rows, columns: cols, rowKey: (r: Member) => r.contactId, toLead: () => ({}) }));

describe("click a chart, see the list (KF-6)", () => {
  it("a bar with leads behind it says it can be opened, in its spoken label and its pressed state; a bar with nothing behind it does not", () => {
    const bars = [{ label: "7 Sep", value: 50, count: 12 }, { label: "14 Sep", value: 0, count: 0 }];
    const m = html(el(BarChart, { title: "By week", bars, sample: 12, min: 5, noun: "leads", onSelect: () => undefined, selected: 0 }));
    expect(m).toContain("7 Sep: 50, 12 leads, open the list");
    expect(m).toContain('aria-pressed="true"');
    expect(m).toContain('aria-pressed="false"');
    expect(m.match(/open the list/g)).toHaveLength(1);
    const plain = html(el(BarChart, { title: "By week", bars, sample: 12, min: 5 }));
    expect(plain).not.toContain("open the list");
    expect(plain).not.toContain("aria-pressed");
  });

  it("ranked rows become buttons only when the chart is clickable", () => {
    const rows = [{ label: "4 to 24 hours", value: 9, count: 9 }, { label: "Older", value: 0, count: 0 }];
    expect(html(el(Distribution, { title: "Waiting", rows, noun: "conversations", onSelect: () => undefined }))).toContain("4 to 24 hours: 9, 9 conversations, open the list");
    expect(html(el(Distribution, { title: "Waiting", rows }))).not.toContain("<button");
  });

  it("for every week of the sample trend the number on the bar, the number in the list heading and the rows of the list are the same", () => {
    const bars = weekBars(SAMPLE_TREND);
    SAMPLE_TREND.forEach((week, k) => {
      const m = panel(k, bars[k].count, week.members);
      expect(m, `week ${k}`).toContain(`data-testid="drill-count">${bars[k].count}<`);
      expect(m.match(/data-row-primary/g)?.length ?? 0, `week ${k}: rows shown`).toBe(Math.min(10, week.members.length));
      expect(m).toContain(`Showing ${Math.min(10, week.members.length)} of ${bars[k].count}`);
      expect(bars[k].count, `week ${k}: bar count equals the rows behind it`).toBe(week.members.length);
    });
  });

  it("a capped list says how many were not sent; Back keeps the mark and offers the list again; nothing chosen draws nothing", () => {
    const rows = SAMPLE_TREND[0].members;
    const capped = panel(0, rows.length + 40, rows);
    expect(capped).toContain(`Only the first ${rows.length} of ${rows.length + 40} are loaded here`);
    expect(capped).toContain("Back to the chart");
    const closed = panel(0, 7, rows, false);
    expect(closed).toContain("Show the list");
    expect(closed).not.toContain('data-testid="drill-panel"');
    expect(panel(null, 0, [])).toBe("");
  });
});

describe("a range on one card, the account list, how-to notes, copy (KF-4, KF-2, KF-5)", () => {
  it("a card range has a labelled range and comparison choice, with custom dates, and a single option hides the comparison choice", () => {
    const state = { spec: { preset: "30d", compare: "previous" }, resolved: null, setSpec: () => undefined };
    const m = html(el(CardRange, { state, label: "Replies by week" }));
    expect(m).toContain('aria-label="Replies by week: range"');
    expect(m).toContain('aria-label="Replies by week: compare with"');
    for (const word of ["Last 7 days", "Last 30 days", "Last 90 days", "Custom dates", "Previous period", "Same dates last month", "Same dates last year"]) expect(m, word).toContain(word);
    expect(html(el(CardRange, { state: { ...state, spec: { preset: "custom", from: "2026-10-01", to: "2026-10-30", compare: "none" } }, label: "X" }))).toContain('type="date"');
    expect(html(el(CardRange, { state, label: "X", compares: ["none"] }))).not.toContain("compare with");
  });

  it("the account list names who is in, who is left out and why, and gives each name a remove button", () => {
    const options = { accounts: SAMPLE_OPTIONS.accounts, testAccounts: 1 };
    const m = html(el(AccountScope, { options, value: { ...EMPTY_FILTER, hideTest: true, owner: "Ada Okafor" }, onChange: () => undefined }));
    expect(m).toContain("3 of 6 client accounts");
    expect(m).toContain("Maple Dental, Harbor Realty and Bright Solar");
    expect(m).toContain("Leave out Maple Dental");
    expect(m).toContain("Left out (4)");
    expect(m).toContain("Old Client");
    expect(m).toContain("set to ignore, never counted");
    expect(m).toContain("test account, hidden");
    expect(m).toContain("belongs to another owner");
    expect(html(el(AccountScope, { options, value: EMPTY_FILTER, onChange: () => undefined }))).toContain("All 6 client accounts");
  });

  it("a how-to note is absent on the server's first paint, and a list can be copied and stepped through with the arrow keys", () => {
    expect(html(el(HowTo, { id: "x", title: "How to use this page" }, "text"))).toBe("");
    const base = { rows: SAMPLE_LEADS.slice(0, 3), rowKey: (l: { contactId: string }) => l.contactId, columns: [{ key: "n", header: "Lead", primary: true, cell: (l: { name: string }) => l.name }] };
    const withCopy = html(el(DataList, { ...base, copyText: (l: { name: string }) => l.name, onOpen: () => undefined }));
    expect(withCopy).toContain("Copy list");
    expect(withCopy).toContain("data-row-primary");
    expect(html(el(DataList, base))).not.toContain("Copy list");
  });
});

describe("calls go through the CRM, never the phone's own dialer (KF-3)", () => {
  it("the lead panel shows the number as text and offers a Call button, with no tel: link", () => {
    const seed = { contactId: "c1", locationId: "loc1", name: "Ada", phone: "+15550100", url: "https://crm.example.com/contact/c1" };
    const m = html(el(ApiProvider, { value: sampleApi() }, el(LeadDrawer, { leads: [seed], index: 0, onIndex: () => undefined, onClose: () => undefined })));
    expect(m).not.toContain("tel:");
    // The phone row appears once the contact has loaded in the browser; the seed's own number is the same text, so check the component source too.
    // Since F10 the button is the shared DialButton; its words and the no-tel: default live in src/lib/people/dial.ts (tests/unit/people-f10 and src/lib/__tests__/people-f10.test.ts).
    expect(readFileSync("src/app/app/ds/lead-drawer.tsx", "utf8")).toContain("DialButton");
    expect(readFileSync("src/lib/people/dial.ts", "utf8")).toContain('label: "Call"');
  });

  it("no shared component or M1 page writes a tel: link", () => {
    const hasTel = /href=\{[^}]*tel:/;
    for (const f of readdirSync("src/app/app/ds").filter((n) => n.endsWith(".tsx"))) expect(readFileSync(`src/app/app/ds/${f}`, "utf8"), f).not.toMatch(hasTel);
    for (const f of ["today", "speed", "appointments", "audit", "overview"]) expect(readFileSync(`src/app/app/views/${f}.tsx`, "utf8"), f).not.toMatch(hasTel);
  });
});
