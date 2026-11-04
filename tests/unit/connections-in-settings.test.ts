import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PARENT, visibleNav } from "@/app/app/nav";
import { NAV_FOR, routeAllowed, type AccessKind } from "@/lib/access";
import { parseHash } from "@/lib/design/route";
import { MOVED_INTO_SETTINGS, SECTION_IDS, movedSettingsSection, sectionsFor } from "@/lib/settings-sections";

// Connections left the main menu and became Settings, Integrations (4 Nov 2026). Pure checks: who sees which menu entry, that every old address and
// link still lands somewhere real, and that the access rules did not change. The browser side is tests/e2e/connections-in-settings.spec.ts.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const kinds: AccessKind[] = ["agency", "business", "client"];
const menu = (kind: AccessKind, off: (f: string) => boolean = () => false) => visibleNav(NAV_FOR[kind], { limited: kind !== "agency", off }).map((n) => n.label);

describe("the menu", () => {
  it("has no Connections entry for anyone", () => {
    for (const kind of kinds) expect(menu(kind), `${kind} menu`).not.toContain("Connections");
    expect(NAV.some((n) => n.label === "Connections")).toBe(false);
  });
  it("an agency person and a business owner reach it through Settings, so their menu has Settings and no second entry", () => {
    for (const kind of ["agency", "business"] as const) {
      expect(menu(kind), kind).toContain("Settings");
      expect(menu(kind), kind).not.toContain("Integrations");
    }
  });
  it("a client's staff have no Settings, so they keep ONE entry, Integrations, for their own connections", () => {
    expect(NAV_FOR.client.has("settings")).toBe(false);
    expect(menu("client")).toContain("Integrations");
    expect(menu("client")).not.toContain("Settings");
    expect(sectionsFor("client")).toHaveLength(0);
  });
  it("the entry follows the connections switch: off, nobody sees it", () => {
    expect(menu("client", (f) => f === "connections")).not.toContain("Integrations");
  });
  it("Integrations is a real Settings section for an agency and a business", () => {
    for (const kind of ["agency", "business"] as const) expect(sectionsFor(kind).some((s) => s.id === "integrations"), kind).toBe(true);
  });
  it("the page still exists in the list (its address works) and lives inside Settings", () => {
    const item = NAV.find((n) => n.id === "connections")!;
    expect(item.parent).toBe("settings");
    expect(PARENT.connections).toBe("settings");
    for (const kind of kinds) expect(NAV_FOR[kind].has("connections"), kind).toBe(true);
  });
  it("the Settings menu entry is not moved: Settings, Getting started and What's new stay pinned at the foot", () => {
    const foot = NAV.filter((n) => n.group === "Settings and help" && !n.parent).map((n) => n.label);
    expect(foot).toEqual(["Settings", "Getting started", "What's new"]);
  });
});

describe("old addresses and links", () => {
  it("#connections is still a valid address and opens the connections page id, which the shell turns into Settings, Integrations", () => {
    expect(parseHash("#connections", NAV.map((n) => n.id)).view.id).toBe("connections");
    expect(movedSettingsSection("connections")).toBe("integrations");
    expect(SECTION_IDS).toContain(MOVED_INTO_SETTINGS.connections);
  });
  it("the shell reads the section from that one list, and no other screen sends anyone to a Connections menu entry", () => {
    const shell = read("src/app/app/dashboard.tsx");
    expect(shell).toMatch(/movedSettingsSection\(view\.id\)/);
    expect(shell).toMatch(/visibleNav\(NAV_FOR\[auth\.kind\]/);
    expect(shell).not.toMatch(/ConnectionsPage/);
    for (const f of ["src/app/app/views/settings.tsx", "src/app/app/views/meeting-inbox.tsx"]) expect(read(f), f).not.toMatch(/Open Connections|in the menu \(Settings and help\)|under Connections/);
  });
  it("every Getting started step points at a page that exists", () => {
    const ids = new Set(NAV.map((n) => n.id as string));
    ids.add("account");
    const targets = [...read("src/lib/getting-started.ts").matchAll(/\bview: "([a-z]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(5);
    for (const t of targets) expect(ids.has(t), `Getting started step opens "${t}"`).toBe(true);
  });
});

describe("the access rules did not change", () => {
  it("every kind still reaches its own connections; only a business and an agency reach the Settings answer", () => {
    for (const kind of kinds) {
      expect(routeAllowed(kind, "GET", ["my-connections"]), `${kind} reads its own connections`).toBe(true);
      expect(routeAllowed(kind, "POST", ["my-connections", "fathom", "start"]), `${kind} starts its own connection`).toBe(true);
      expect(routeAllowed(kind, "DELETE", ["my-connections", "x"]), `${kind} removes its own connection`).toBe(true);
    }
    expect(routeAllowed("business", "GET", ["settings"])).toBe(true);
    expect(routeAllowed("client", "GET", ["settings"])).toBe(false);
    expect(routeAllowed("client", "PUT", ["settings"])).toBe(false);
    expect(routeAllowed("client", "POST", ["connections", "slack", "start"]), "the shared Slack sign-in stays closed to a client").toBe(false);
    expect(routeAllowed("client", "GET", ["connections"])).toBe(false);
  });
  it("the team part of the page (names and status of who connected, Slack, the rules) is drawn only when the server says the person is an admin", () => {
    const page = read("src/app/app/views/connections.tsx");
    expect(page).toMatch(/\{my\.data\.canAdmin && <TeamSection level=\{level\} \/>\}/);
  });
});

describe("plain words", () => {
  it("the moved screens never say GoHighLevel, HighLevel or GHL", () => {
    for (const f of ["src/app/app/views/connections.tsx", "src/app/app/views/settings-slot-connections.tsx", "src/app/app/nav.ts", "src/app/app/views/meeting-inbox.tsx"]) {
      expect(read(f).replace(/\/\/.*$/gm, ""), f).not.toMatch(/GoHighLevel|HighLevel|\bGHL\b/i);
    }
  });
});
