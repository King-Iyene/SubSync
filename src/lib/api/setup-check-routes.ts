import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";
import { sql } from "../db";
import { demoSetupCheck } from "../setup-check/demo";
import { runSetupCheck } from "../setup-check/run";

// Account setup, /api/app/setup-check (read only). One request returns the account choices and the checklist of one account:
//   GET setup-check                       the first account the signed-in person may open
//   GET setup-check?locationId=<id>       that account, only after ownedLocation (the id belongs to this installation AND to the person's own list)
//   GET setup-check?locationId=<id>&fresh=1  read the platform again (at most every 20 seconds per account)
// Who is asking and which accounts they may open come from the verified session (`ctx`, `h.allowed`), never from the request. A client's own staff have no rule for this address (access.ts).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type H = { allowed: () => Promise<string[] | null> };

export async function handleSetupCheck(ctx: Ctx, h: H): Promise<Response> {
  if (ctx.request.method !== "GET") return json({ error: "Unknown action" }, 405);
  if (ctx.entitlements.features.as_check !== true) return json({ error: "This page is switched off right now." }, 404);
  const allowed = await h.allowed();
  const db = sql();
  const rows = await db`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit 300`;
  const accounts = rows.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" }));
  const asked = ctx.url.searchParams.get("locationId");
  let id: string | null = accounts[0]?.id ?? null;
  if (asked !== null && asked !== "") {
    id = await ownedLocation(ctx.installationId, allowed, asked);
    if (!id) return json({ error: "Client account not found." }, 404);
  }
  if (!id) return json({ accounts, selected: null, result: null });
  const selected = accounts.find((a) => a.id === id) ?? { id, name: "Unnamed account" };
  if (ctx.demo) return json({ accounts, selected, result: demoSetupCheck(accounts.findIndex((a) => a.id === id), Date.now()) });
  const result = await runSetupCheck(ctx.installationId, id, { fresh: ctx.url.searchParams.get("fresh") === "1" });
  return json({ accounts, selected, result });
}
