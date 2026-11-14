import { describe, expect, it } from "vitest";
import { freezeReport } from "@/lib/report-share";
import { proofDoc, todayDoc, weeklyDoc } from "@/app/app/ds/report-docs";
import type { QueueRow } from "@/lib/analytics/today-queue";

// What each report screen hands to "Share report", and what a shared link then holds: by default no contact name, phone, email or client account name.
const now = new Date("2026-11-13T10:00:00Z");
const row = (name: string, text: string): QueueRow => ({ key: name, kind: "waiting" as never, locationId: "loc", accountName: name, text, count: 14, dollars: null, estimate: 4200, since: now.getTime() - 3 * 3_600_000, ageMinutes: 180, severity: "high" as never, url: "https://crm.example/x", itemIds: ["c1"], partial: false });

describe("shared report documents", () => {
  it("Today: client account names are replaced by default and the amounts, words and links to the app are handled safely", () => {
    const doc = todayDoc({ brandName: null, who: "Acme Roofing, Beta Dental", generatedAt: "Friday 13 November 2026, 11:00", headline: "14 leads are waiting", breakdown: null, rows: [row("Acme Roofing", "14 leads waiting"), row("Beta Dental", "3 no-shows")], insights: ["Replies are slower on Fridays"], forecast: null, proof: "We caught 9 things", setAside: 2 }, now.getTime());
    const hidden = freezeReport(doc, "today", false, now);
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    const text = JSON.stringify(hidden.report);
    for (const secret of ["Acme", "Beta", "Roofing", "Dental", "crm.example", "c1"]) expect(text, secret).not.toContain(secret);
    expect(text).toContain("Client account 1");
    expect(text).toContain("about $4,200, estimated");
    expect(text).toContain("3 h");
    const shown = freezeReport(doc, "today", true, now);
    expect(shown.ok && JSON.stringify(shown.report)).toContain("Acme Roofing");
  });

  it("Weekly client report: one row per client, names hidden by default", () => {
    const doc = weeklyDoc([{ name: "Gamma Spa", headline: "12 leads came in", lines: [{ label: "Leads", value: "12" }, { label: "Answered", value: "9" }] }, { name: "Delta Gym", headline: "4 leads came in", lines: [{ label: "Leads", value: "4" }] }], "Studio");
    const r = freezeReport(doc, "clients", false, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = JSON.stringify(r.report);
    expect(text).not.toMatch(/Gamma|Delta/);
    expect(r.report.sections[0].table!.columns).toEqual(["Client account", "Leads", "Answered"]);
    expect(r.report.sections[0].table!.rows).toEqual([["Client account 1", "12", "9"], ["Client account 2", "4", ""]]);
  });

  it("Weekly proof: the owner's per-client table is hidden by default and left out for a person who may not see accounts", () => {
    const p = { weekStart: "2026-11-02", accountName: null, lines: ["9 found, 7 fixed"], clientLines: [], total: { found: 9, cleared: 7, stillOpen: 2, medianFixMinutes: 30, enough: true }, byKind: [{ label: "No reply", found: 9, cleared: 7, stillOpen: 2 }], rows: [{ name: "Epsilon Auto", found: 9, cleared: 7, stillOpen: 2 }] };
    const withAccounts = freezeReport(proofDoc(p, null, true), "weekly", false, now);
    expect(withAccounts.ok && JSON.stringify(withAccounts.report)).not.toContain("Epsilon");
    const without = freezeReport(proofDoc(p, null, false), "weekly", false, now);
    expect(without.ok && without.report.sections.map((s) => s.heading)).not.toContain("By client account");
  });
});
