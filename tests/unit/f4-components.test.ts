import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueueChoices, SavedViews, WaitChips } from "@/app/app/views/inbox-controls";
import { chipCounts, DEFAULT_QUEUE, NAME_MISSING, NO_OWNER, type QueueFilter, type QueueRow } from "@/lib/analytics/waiting-view";

// Component tests for the Unanswered messages controls (stage F4). Rendered on the server to markup (no browser, no database): what each control says, what
// it offers, and that it keeps to the plain look (no dot, no pill, no glow). The behaviour in the browser is in tests/e2e/f4.spec.ts (written, not run in the stage).
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const noDecoration = (markup: string) => { expect(markup).not.toMatch(/rounded-full|bg-gradient|shadow-|blur|ring-1/); };
const noop = () => undefined;

let n = 0;
function row(p: Partial<QueueRow> & { waiting?: number | null }): QueueRow {
  n += 1;
  const waiting = p.waiting ?? null;
  return {
    conversationId: `c${n}`, locationId: "L1", locationName: "Alpha Plumbing", contactId: `k${n}`, contactName: `Customer ${n}`, channel: "WhatsApp", lastMessageType: "TYPE_WHATSAPP",
    lastMessageDirection: waiting === null ? "outbound" : "inbound", lastMessageAt: "2026-11-01T10:00:00Z", unreadCount: 0, overSla: waiting !== null, waitingHours: waiting,
    ageHours: waiting ?? 2, assignedTo: null, assignee: NO_OWNER, url: "https://crm.example.com/x", ...p,
  };
}
const rows: QueueRow[] = [
  row({ waiting: 5, channel: "Text message", assignedTo: "U-ME", assignee: "Maya" }),
  row({ waiting: 30, unreadCount: 2, assignedTo: "U-SAM", assignee: "Sam" }),
  row({ waiting: 60, locationId: "L2", locationName: "Beta Dental", channel: "Email" }),
  row({ waiting: 400, locationId: "L2", locationName: "Beta Dental", assignedTo: "U-X", assignee: NAME_MISSING }),
];

describe("wait chips", () => {
  it("name every wait, show how many each leaves, and mark the one in use", () => {
    const m = html(el(WaitChips, { filter: { ...DEFAULT_QUEUE, wait: "24h" } as QueueFilter, counts: chipCounts(rows, DEFAULT_QUEUE, "U-ME"), onChange: noop }));
    const text = m.replace(/<[^>]+>/g, "");
    for (const label of ["Any wait (4)", "Over 4 hours (4)", "Over 24 hours (3)", "Over 48 hours (2)", "Over 7 days (older) (1)"]) expect(text).toContain(label);
    expect(m).toContain('aria-pressed="true"');
    expect((m.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(m).toContain('data-testid="chip-24h"');
    noDecoration(m);
  });
});

describe("the choices", () => {
  const filter = DEFAULT_QUEUE;
  const m = html(el(QueueChoices, { rows, filter, me: "U-ME", onChange: noop }));
  const text = m.replace(/<[^>]+>/g, "");

  it("list the channels, the client accounts and the people by name, each with its count, and 'Assigned to me' first", () => {
    expect(text).toContain("WhatsApp (2)");
    expect(text).toContain("Email (1)");
    expect(text).toContain("Alpha Plumbing (2)");
    expect(text).toContain("Beta Dental (2)");
    expect(text).toContain("Assigned to me (1)");
    expect(text).toContain("Sam (1)");
    expect(text).toContain("No owner (1)");
    expect(text).toContain(`Team member (name not available) (1)`);
    expect(text.indexOf("Assigned to me")).toBeLessThan(text.indexOf("Sam (1)"));
  });

  it("never show a raw id", () => {
    for (const id of ["U-SAM", "U-ME", "U-X"]) expect(text.replace(/value="[^"]*"/g, "")).not.toContain(id);
  });

  it("offer the order, and a way back when choices narrow the list", () => {
    expect(text).toContain("Longest wait first");
    expect(text).toContain("Newest first");
    expect(text).not.toContain("Clear these choices");
    const narrowed = html(el(QueueChoices, { rows, filter: { ...DEFAULT_QUEUE, channel: "Email" }, me: null, onChange: noop }));
    expect(narrowed).toContain("Clear these choices");
    noDecoration(m);
  });

  it("leave out a control that has nothing to choose between (one account, one channel, one person)", () => {
    const one = [row({ waiting: 5 }), row({ waiting: 7 })];
    const t = html(el(QueueChoices, { rows: one, filter, me: null, onChange: noop }));
    expect(t).not.toContain('aria-label="Channel"');
    expect(t).not.toContain('aria-label="Client account"');
    expect(t).not.toContain('aria-label="Assigned to"');
    expect(t).toContain('aria-label="Order"');
  });
});

describe("saved views", () => {
  it("lists the person's views with a way to use and to remove each, and how many of the limit are used", () => {
    const m = html(el(SavedViews, {
      filter: DEFAULT_QUEUE, max: 10, onApply: noop, onSave: async () => undefined, onRemove: async () => undefined, message: null,
      views: [{ id: "v1", name: "Over a day", filters: { ...DEFAULT_QUEUE, wait: "24h" } }, { id: "v2", name: "Mine", filters: { ...DEFAULT_QUEUE, user: "me" } }],
    }));
    expect(m).toContain("Saved views (2)");
    expect(m).toContain("Use the saved view Over a day");
    expect(m).toContain("Remove the saved view Mine");
    expect(m.replace(/<[^>]+>/g, "")).toContain("2 of 10");
    expect(m).toContain("Save this view");
    noDecoration(m);
  });

  it("explains itself when there are none, and says only the person sees their own", () => {
    const m = html(el(SavedViews, { filter: DEFAULT_QUEUE, max: 10, views: [], onApply: noop, onSave: async () => undefined, onRemove: async () => undefined, message: null }));
    expect(m).toContain("Saved views (0)");
    expect(m).toContain("Only you see your saved views");
  });
});
