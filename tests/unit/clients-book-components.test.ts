import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiProvider, type Api } from "@/app/app/session";
import { BookHead, ClientRows, HealthWord, InlineEditor, RenewalRows, wordOf } from "@/app/app/views/clients/book-rows";
import type { BookRowOut } from "@/app/app/views/clients/types";

// Component tests for the rebuilt Clients rows, rendered on the server to markup (no browser, no database): what each row says and offers, the honest labels, and that it keeps
// the plain look (no pill, dot, gradient). Anything that needs a loaded page is in tests/e2e/clients-v2.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const noop = () => undefined;
const api: Api = { demo: true, get: (async () => ({})) as Api["get"], filtered: () => api, post: (async () => ({})) as Api["post"], put: (async () => ({})) as Api["put"], del: (async () => ({})) as Api["del"], download: async () => undefined };
const withApi = (node: ReturnType<typeof h>) => el(ApiProvider, { value: api }, node);

const row = (o: Partial<BookRowOut> & { id: string; name: string }): BookRowOut => ({
  level: "healthy", label: "Healthy", line: "Nothing needs attention.", reasons: [], needs: null, renewal: null, context: [], score: 80, fee: null, industry: null, lastSpokenDays: null, daysSinceAdded: 100, url: "https://crm.acme.example/v2/location/x/dashboard", ...o,
});
const atRisk = row({ id: "L1", name: "Summit HVAC", level: "at_risk", label: "At risk", line: "Nothing has happened in the account for 73 days. And 3 more things.", needs: { kind: "risk", label: "At risk" }, fee: 2000, renewal: { date: "2026-12-07", dateText: "7 Dec", daysLeft: 33, bucket: "60", words: "Renews in 33 days", due: false } });
const watch = row({ id: "L2", name: "Oak Bistro", level: "watch", label: "Watch", line: "None of the last 23 new leads got a reply in time.", needs: { kind: "risk", label: "Watch" }, fee: 900, renewal: { date: "2026-10-29", dateText: "29 Oct", daysLeft: -6, bucket: "overdue", words: "Renewal was 6 days ago", due: true } });
const dueHealthy = row({ id: "L3", name: "Alpha Dental", needs: { kind: "renewal", label: "Renewal due" }, fee: 2500, renewal: { date: "2026-11-14", dateText: "14 Nov", daysLeft: 9, bucket: "30", words: "Renews in 9 days", due: true } });
const blank = row({ id: "L4", name: "Beta Realty" });
const rows = [atRisk, watch, dueHealthy, blank];
const props = { rows, choices: ["Real estate"], inNeeds: true, editing: null, setEditing: noop, onChanged: noop, onOpen: noop, onCopy: noop };

describe("a client row", () => {
  const m = html(withApi(el(ClientRows, props)));
  const t = text(m);

  it("is one line of name and one of reason, with fee and renewal beside them, and ONE button per row", () => {
    expect((m.match(/data-testid="client-row"/g) ?? []).length).toBe(4);
    expect((m.match(/data-testid="open-client"/g) ?? []).length).toBe(4);
    expect(t).toContain("Summit HVAC");
    expect(t).toContain("Nothing has happened in the account for 73 days. And 3 more things.");
    expect(t).toContain("$2,000");
    expect(t).toContain("Renews in 33 days");
    expect(t).toContain("7 Dec");
    expect(t).toContain("Renewal was 6 days ago");
    expect((t.match(/Open account/g) ?? []).length).toBe(4);
  });

  it("with nothing typed it guides instead of showing n/a: Add fee and Add renewal date on the row", () => {
    expect((m.match(/data-testid="add-fee"/g) ?? []).length).toBe(1);
    expect((m.match(/data-testid="add-renewal"/g) ?? []).length).toBe(1);
    expect(t).toContain("Add fee");
    expect(t).toContain("Add renewal date");
    expect(t).not.toMatch(/\bn\/a\b/);
    expect(t).not.toMatch(/\bnot set\b/i);
  });

  it("a value that was typed is a button that says what pressing it does", () => {
    expect(m).toContain('aria-label="$2,000 a month, change the fee of Summit HVAC"');
    expect(m).toMatch(/aria-label="Renews in 33 days, 7 Dec\. Change the renewal date of Summit HVAC"/);
  });

  it("inside the needs list a healthy client with a renewal due wears 'Renewal due', never 'Healthy'", () => {
    expect(wordOf(dueHealthy, true)).toBe("Renewal due");
    expect(wordOf(dueHealthy, false)).toBe("Healthy");
    expect(wordOf(atRisk, true)).toBe("At risk");
    const needsText = text(html(withApi(el(ClientRows, { ...props, rows: [atRisk, watch, dueHealthy] }))));
    expect(needsText).not.toContain("Healthy");
    expect(text(html(el(HealthWord, { r: dueHealthy, inNeeds: true })))).toBe("Renewal due");
  });

  it("is plain: no pill, dot, tint or gradient, no phone link, no platform name", () => {
    expect(m).not.toMatch(/bg-gradient|blur|ring-1|bg-destructive\/|bg-warning\/|bg-success\//);
    expect(m).not.toContain("tel:");
    expect(t).not.toMatch(/gohighlevel|highlevel|\bghl\b|leadconnector|sub-?account|\blocation\b/i);
    // Status is a word and an icon; the stripe is a thin rule on the left of the row.
    expect(m).toMatch(/border-l-\[3px\] [^"]*border-destructive/);
  });

  it("the headings explain every column in two lines, and say who types it", () => {
    const head = html(el(BookHead));
    const t2 = text(head);
    for (const w of ["Client", "Health", "Fee", "Renews"]) expect(t2).toContain(w);
    for (const label of ["What Health means", "What Fee means", "What Renews means"]) expect(head).toContain(`aria-label="${label}"`);
    expect(head).toContain('data-testid="book-header"');
  });
});

describe("the renewals list", () => {
  it("shows what is left, the date, the fee and one button, soonest first as given", () => {
    const t = text(html(el(RenewalRows, { rows: [watch, dueHealthy, atRisk], onOpen: noop })));
    expect(t).toContain("Renewal was 6 days ago (29 Oct), $900 a month");
    expect(t).toContain("Renews in 9 days (14 Nov), $2,500 a month");
    expect((t.match(/Open account/g) ?? []).length).toBe(3);
    expect(t.indexOf("Oak Bistro")).toBeLessThan(t.indexOf("Alpha Dental"));
  });
  it("leaves out a client with no date", () => {
    expect(html(el(RenewalRows, { rows: [blank], onOpen: noop }))).not.toContain('data-testid="renewal-row"');
  });
});

describe("the editor in the row", () => {
  const edit = (field: "fee" | "renewal" | "industry", r = blank) => html(withApi(el(InlineEditor, { r, field, choices: ["Real estate", "Medical and dental"], onDone: noop, onChanged: noop })));
  it("each field is labelled for a screen reader and says that the user types it", () => {
    const fee = edit("fee");
    expect(fee).toContain("What Beta Realty pays you per month, in dollars");
    expect(text(fee)).toContain("You enter this; SubSync does not read it from your CRM.");
    expect(fee).toContain('inputMode="decimal"');
    expect(edit("renewal")).toContain('type="date"');
    const ind = edit("industry");
    expect(ind).toContain("The kind of business Beta Realty runs");
    expect(text(ind)).toContain("Another industry (type it)");
    expect(text(ind)).toContain("Medical and dental");
  });
  it("offers Save and Cancel, and Clear only for a renewal that is set", () => {
    expect(text(edit("fee"))).toMatch(/Save\s+Cancel/);
    expect(text(edit("renewal"))).not.toContain("Clear");
    expect(text(edit("renewal", dueHealthy))).toContain("Clear");
  });
});
