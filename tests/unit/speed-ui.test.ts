import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { leadColumns, leadSeed, PersonName, type LeadView, type PersonView } from "@/app/app/views/speed-cards";

// Speed to lead, the pieces a person reads (stage F2). Rendered on the server to markup; the browser behaviour is in tests/e2e/speed.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);

const dana: PersonView = { label: "Dana Brooks", state: "named", photoUrl: "https://cdn.example.org/dana.png", initials: "DB" };
const lead = (over: Partial<LeadView> = {}): LeadView => ({
  locationId: "L1", locationName: "Blue Door Realty", contactId: "c1", name: "The Real Estate Blueprint", url: "https://crm.example.com/c1", status: "waiting", neverAnswered: false, minutes: 90,
  source: "Facebook Lead Form", repliedBy: null, owner: dana, unassigned: false, autoSeconds: 8, personSeconds: null, detailed: true, ...over,
});
const cells = (l: LeadView, showAccount = true) => leadColumns(showAccount).map((c) => ({ key: c.key, markup: html(el("div", null, c.cell(l))) }));
const cell = (l: LeadView, key: string, showAccount = true) => cells(l, showAccount).find((c) => c.key === key)?.markup ?? "";

describe("a person on the screen (N21)", () => {
  it("shows the picture and the name when the CRM has them", () => {
    const m = html(el(PersonName, { p: dana }));
    expect(m).toContain("Dana Brooks");
    expect(m).toContain('src="https://cdn.example.org/dana.png"');
    expect(m).toContain('referrerPolicy="no-referrer"');
  });
  it("shows the initials when there is no picture", () => {
    const m = html(el(PersonName, { p: { ...dana, photoUrl: null } }));
    expect(m).toContain("DB");
    expect(m).not.toContain("<img");
  });
  it("says why a name is missing, in words, and never shows an id", () => {
    expect(html(el(PersonName, { p: { label: "Former team member", state: "former", photoUrl: null, initials: "?" } }))).toContain("Former team member");
    const blocked = html(el(PersonName, { p: { label: "Needs permission: reconnect", state: "needs_permission", photoUrl: null, initials: "?" } }));
    expect(blocked).toContain("Needs permission: reconnect");
    expect(blocked).toContain("text-warning");
  });
});

describe("the list of leads (N22, N30, N78, KF-6)", () => {
  it("has the columns a setter needs, and leaves out the client account for a single account", () => {
    expect(leadColumns(true).map((c) => c.key)).toEqual(["name", "account", "source", "what", "who", "open"]);
    expect(leadColumns(false).map((c) => c.key)).toEqual(["name", "source", "what", "who", "open"]);
    expect(leadColumns(true).find((c) => c.primary)?.key).toBe("name");
  });
  it("a waiting lead says how long, whether an automatic message went out, who owns it, and where it came from", () => {
    const l = lead();
    expect(cell(l, "what")).toContain("waiting 2 hours");
    expect(cell(l, "what")).toContain("Automatic message after 8 sec");
    expect(cell(l, "who")).toContain("Owner");
    expect(cell(l, "who")).toContain("Dana Brooks");
    expect(cell(l, "source")).toContain("Facebook Lead Form");
    expect(cell(l, "account")).toContain("Blue Door Realty");
  });
  it("a lead with nobody to answer it says no owner", () => {
    expect(cell(lead({ owner: null, unassigned: true }), "who")).toContain("no owner");
  });
  it("an answered lead says who replied and how fast", () => {
    const l = lead({ status: "within", minutes: 3, repliedBy: dana, autoSeconds: null });
    expect(cell(l, "what")).toContain("replied in 3 min");
    expect(cell(l, "who")).toContain("Replied by");
    expect(cell(l, "who")).toContain("Dana Brooks");
    expect(cell(l, "what")).not.toContain("Automatic message");
  });
  it("a missed lead says never answered, in days, not hours and minutes", () => {
    const m = cell(lead({ neverAnswered: true, minutes: 13 * 24 * 60 }), "what");
    expect(m).toContain("never answered (13 days)");
    expect(m).not.toMatch(/\d+ d \d+ h/);
  });
  it("opens the contact in the CRM through the link the server built", () => {
    expect(cell(lead(), "open")).toContain('href="https://crm.example.com/c1"');
  });
  it("the lead panel gets the same words", () => {
    const seed = leadSeed(lead());
    expect(seed).toMatchObject({ name: "The Real Estate Blueprint", locationName: "Blue Door Realty", url: "https://crm.example.com/c1", owner: "Dana Brooks" });
    expect(seed.note).toContain("Waiting 2 hours.");
    expect(seed.note).toContain("Automatic message after 8 sec.");
    expect(leadSeed(lead({ status: "late", minutes: 90, repliedBy: dana })).note).toContain("Replied by Dana Brooks.");
  });
});

describe("Speed to lead does not use the phone's own dialer (KF-3)", () => {
  it("writes no tel: link in the page or its cards, and nothing places a call itself", () => {
    for (const file of ["src/app/app/views/speed.tsx", "src/app/app/views/speed-cards.tsx", "src/lib/design/speed-text.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/tel:|sms:|href=\{`?tel/i);
    }
  });
});

describe("the page and its cards say the same plain things everywhere", () => {
  it("the page names the measuring sentence and a link to Settings, and says SubSync does not send replies", () => {
    const page = readFileSync("src/app/app/views/speed.tsx", "utf8");
    expect(page).toContain("measuringSentence");
    expect(page).toContain('go("settings")');
    expect(page).toContain("SubSync measures replies and never sends them");
  });
  it("every card has its own range (KF-4) and a list behind its figures (KF-6)", () => {
    const cards = readFileSync("src/app/app/views/speed-cards.tsx", "utf8");
    for (const key of ["speed-summary", "speed-source", "speed-accounts", "speed-people"]) expect(cards).toContain(`useCardRange("${key}"`);
    expect((cards.match(/<CardRange /g) ?? []).length).toBe(4);
    expect((cards.match(/<LeadsPanel /g) ?? []).length).toBe(4);
  });
});
