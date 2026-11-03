import { GHL_API } from "./client.ts";
import { ghlFetch } from "./http.ts";

// The contact fields an account already has (so an admin can pick which one SubSync fills, INTEGRATIONS_SPEC section 8.1). A READ only: it needs the
// optional permission to read field definitions (`locations/customFields.readonly`) and writes nothing. NOT VERIFIED LIVE: the answer's shape follows the
// documented list-custom-fields call (id, name, fieldKey, dataType, model); the exact data type names are a CHECK on a real account.

export type FieldDefinition = { id: string; name: string; dataType: string };

export type DefinitionsResult = { ok: true; fields: FieldDefinition[] } | { ok: false; reason: "needs_permission" | "unavailable" };

export async function listContactFieldDefinitions(a: { locationId: string; token: () => Promise<string>; fetchImpl?: typeof fetch }): Promise<DefinitionsResult> {
  try {
    const res = await ghlFetch(`${GHL_API}/locations/${encodeURIComponent(a.locationId)}/customFields?model=contact`, {
      method: "GET",
      headers: { Authorization: `Bearer ${await a.token()}`, Version: "2021-07-28", Accept: "application/json" },
      cache: "no-store",
    }, a.fetchImpl ? { fetchImpl: a.fetchImpl } : {});
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json().catch(() => ({}))) as { customFields?: unknown };
    const list = Array.isArray(body.customFields) ? body.customFields : [];
    const fields: FieldDefinition[] = [];
    for (const raw of list.slice(0, 500)) {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const model = typeof o.model === "string" ? o.model.toLowerCase() : "contact";
      if (model !== "contact") continue;
      if (typeof o.id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(o.id) && typeof o.name === "string") fields.push({ id: o.id, name: o.name.slice(0, 120), dataType: typeof o.dataType === "string" ? o.dataType : "" });
    }
    return { ok: true, fields };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
