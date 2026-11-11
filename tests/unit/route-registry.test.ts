import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_GUARDS } from "@/lib/route-guards";

// "No route without a guard": every API route file and every page in the app is listed with the guard that protects it,
// and the same list is written out in docs/TENANCY.md.
function walk(dir: string, file: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, file));
    else if (name === file) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative("src/app", p).split(sep).join("/");

describe("route registry", () => {
  const apiRoutes = walk("src/app/api", "route.ts").map((p) => rel(p).replace(/\/route\.ts$/, ""));
  const pages = walk("src/app", "page.tsx").map((p) => { const r = rel(p).replace(/page\.tsx$/, "").replace(/\/$/, ""); return "/" + r; });
  const found = [...apiRoutes, ...pages.map((p) => (p === "/" ? "/" : p))].sort();
  const registered = ROUTE_GUARDS.map((r) => r.route).sort();

  it("every route and page in the source tree is registered", () => {
    expect(found.filter((r) => !registered.includes(r)), "Routes with no registered guard: add them to src/lib/route-guards.ts and docs/TENANCY.md").toEqual([]);
  });
  it("nothing is registered that does not exist", () => {
    expect(registered.filter((r) => !found.includes(r))).toEqual([]);
  });
  it("every entry names its guard and what it can reach", () => {
    for (const r of ROUTE_GUARDS) {
      expect(r.guard.length, r.route).toBeGreaterThan(10);
      expect(["session", "signature", "secret", "token", "state", "api_key", "redirect_only", "public_by_design", "public_static"], r.route).toContain(r.kind);
    }
  });
  it("docs/TENANCY.md mentions every registered route", () => {
    const doc = readFileSync("docs/TENANCY.md", "utf8");
    expect(ROUTE_GUARDS.filter((r) => !doc.includes("`" + r.route + "`")).map((r) => r.route)).toEqual([]);
  });
  it("the only routes with no secret of any kind are static pages and the public snapshots", () => {
    const open = ROUTE_GUARDS.filter((r) => r.kind === "public_static" || r.kind === "public_by_design").map((r) => r.route).sort();
    expect(open).toEqual(["/", "/app", "/audit/[id]", "/design", "/installed", "/installed/error", "/privacy", "/reply-proof/[id]", "/support", "/terms", "/trust"]);
  });
});
