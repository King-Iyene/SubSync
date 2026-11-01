import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiProvider } from "@/app/app/session";
import { ApptListPanel, CountTile, Explainer, StatusBadge, TargetEditor, apptColumns, type ApptRow } from "@/app/app/views/appointment-parts";
import { BUCKETS } from "@/lib/analytics/appointment-f3";
import { EXPLAINED } from "@/lib/design/appt-ui";
import { sampleApi } from "@/app/design/sample";

// Component tests for the Appointments page pieces (stage F3), rendered on the server to markup. The browser behaviour is in tests/e2e/appointments.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const NOW = Date.parse("2026-11-01T12:00:00Z");

const row = (i: number, o: Partial<ApptRow> = {}): ApptRow => ({
  id: `a${i}`, locationId: "L1", locationName: "Acme", contactId: `c${i}`, name: `Person ${i}`, calendarId: "c1", calendar: "Consult", at: NOW - i * 3_600_000, status: "confirmed",
  assigned: "Dana Brooks", assignedKey: "u1", source: "Facebook", phone: "5550100", url: `https://crm.example.test/contact/${i}`, noOutcome: true, ...o,
});

describe("the list behind a number", () => {
  it("the number in the heading is the number given, and a long list shows ten rows with View all", () => {
    const rows = [...Array(12)].map((_, i) => row(i));
    const m = html(el(ApptListPanel, { title: "Record the outcome", count: 12, rows, showAccount: false, onBack: () => undefined }));
    expect(m).toContain('data-testid="appt-list-count">12<');
    expect(m.match(/data-row-primary/g)?.length).toBe(10);
    expect(m).toContain("View all");
    expect(m).toContain("Close the list");
  });

  it("when fewer rows were sent than the count, it says how many were left out and keeps the true count", () => {
    const m = html(el(ApptListPanel, { title: "Booked", count: 640, rows: [...Array(500)].map((_, i) => row(i)), showAccount: false }));
    expect(m).toContain('data-testid="appt-list-count">640<');
    expect(m).toContain("Showing the first 500 of 640");
  });

  it("an empty list says so in words, never a blank", () => {
    expect(html(el(ApptListPanel, { title: "No-shows to rebook", count: 0, rows: [], showAccount: false, empty: "No recent no-shows are waiting to be rebooked." }))).toContain("No recent no-shows are waiting to be rebooked.");
  });

  it("the call action opens the contact in the CRM (no tel: link), and the account column appears only with several accounts", () => {
    const rows = [row(1), row(2, { phone: null })];
    const m = html(el(ApptListPanel, { title: "x", count: 2, rows, showAccount: false }));
    expect(m).not.toContain("tel:");
    expect(m).toContain("Call in your CRM");
    expect(m).toContain("Open contact");
    expect(m).toContain('href="https://crm.example.test/contact/1"');
    expect(apptColumns(false).some((c) => c.key === "account")).toBe(false);
    expect(apptColumns(true).some((c) => c.key === "account")).toBe(true);
  });

  it("a past appointment with no outcome says so; a status is plain text, not a pill", () => {
    expect(html(el(StatusBadge, { row: { status: "confirmed", noOutcome: true } }))).toContain("Confirmed, no outcome recorded");
    const showed = html(el(StatusBadge, { row: { status: "showed", noOutcome: false } }));
    expect(showed).toContain("Showed");
    expect(showed).not.toContain("rounded-full");
    expect(html(el(StatusBadge, { row: { status: "rescheduled", noOutcome: false } }))).toContain("Other status");
  });
});

describe("tiles, explanations and the target", () => {
  it("a tile that opens a list is a button with a spoken label, and one that does not is plain", () => {
    const open = html(el(CountTile, { label: "Booked", value: "29", hint: "Booked in these dates: 29. Press to see the list", onOpen: () => undefined, open: false }));
    expect(open).toContain("<button");
    expect(open).toContain('aria-label="Booked in these dates: 29. Press to see the list"');
    expect(html(el(CountTile, { label: "Booked", value: "29", hint: "x" }))).not.toContain("<button");
  });

  it("every explained chart renders its three lines", () => {
    for (const id of EXPLAINED) {
      const m = html(el(Explainer, { id }));
      expect(m, id).toContain("What this shows");
      expect(m, id).toContain("How to read it");
      expect(m, id).toContain("What to do");
    }
  });

  it("the status chart's buckets are the six statuses plus an honest 'other'", () => {
    expect(BUCKETS.map((b) => b.label)).toEqual(["Booked", "Confirmed", "Showed", "No-show", "Cancelled", "Invalid", "Other status"]);
  });

  it("the target is a form for people who may change it and a sentence for those who may not, and it says who sets it", () => {
    const wrap = (child: ReturnType<typeof h>) => el(ApiProvider, { value: sampleApi() }, child);
    const edit = html(wrap(el(TargetEditor, { value: 75, isDefault: true, canEdit: true, onSaved: () => undefined })));
    expect(edit).toContain("Show-rate target");
    expect(edit).toContain("You set this; SubSync does not read it from your CRM.");
    expect(edit).toContain("<form");
    const view = html(wrap(el(TargetEditor, { value: 75, isDefault: true, canEdit: false, onSaved: () => undefined })));
    expect(view).not.toContain("<form");
    expect(view).toContain("Show-rate target: 75%");
  });
});
