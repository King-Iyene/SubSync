import { GHL_API } from "../ghl/client.ts";
import { ghlFetch } from "../ghl/http.ts";

// The only code that changes a client's contacts through the platform. Each method re-reads the contact
// first and only changes it if it still looks the way it did at preview time, so a change a person
// made in the meantime is never overwritten. Kept free of database imports so it can be unit tested.

export type Outcome = { result: "applied" | "skipped" | "permission" | "failed"; detail?: string };

export type ChangeRow = {
  id: number; contactId: string; rule: string; field: string; before: string | null; after: string | null; tag: string | null;
};

export interface Writer {
  apply(change: ChangeRow): Promise<Outcome>;
  revert(change: ChangeRow): Promise<Outcome>;
}

type Current = { firstName: string | null; lastName: string | null; phone: string | null; tags: string[] };

const asString = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export function platformWriter(token: string, fetchImpl: typeof fetch = fetch): Writer {
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
  const call = (path: string, init: RequestInit) => ghlFetch(`${GHL_API}${path}`, { ...init, headers, cache: "no-store" }, { fetchImpl });

  async function read(contactId: string): Promise<{ current: Current } | Outcome> {
    const res = await call(`/contacts/${encodeURIComponent(contactId)}`, { method: "GET" });
    if (res.status === 401 || res.status === 403) return { result: "permission" };
    if (res.status === 404) return { result: "skipped", detail: "The contact no longer exists" };
    if (!res.ok) return { result: "failed", detail: `The platform answered ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { contact?: Record<string, unknown> };
    const c = body.contact ?? {};
    return { current: { firstName: asString(c.firstName), lastName: asString(c.lastName), phone: asString(c.phone), tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [] } };
  }

  const status = (res: Response): Outcome => {
    if (res.status === 401 || res.status === 403) return { result: "permission" };
    if (!res.ok) return { result: "failed", detail: `The platform answered ${res.status}` };
    return { result: "applied" };
  };

  async function setField(change: ChangeRow, expect: string | null, value: string | null, verb: string): Promise<Outcome> {
    const got = await read(change.contactId);
    if ("result" in got) return got;
    const now = got.current[change.field as "phone" | "firstName" | "lastName"] ?? null;
    if (now !== expect) return { result: "skipped", detail: `Changed since the preview, so it was left alone (${verb})` };
    return status(await call(`/contacts/${encodeURIComponent(change.contactId)}`, { method: "PUT", body: JSON.stringify({ [change.field]: value ?? "" }) }));
  }

  async function setTag(change: ChangeRow, wantTag: boolean): Promise<Outcome> {
    const got = await read(change.contactId);
    if ("result" in got) return got;
    const tag = change.tag ?? "";
    const has = got.current.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (has === wantTag) return { result: "skipped", detail: wantTag ? "Already has the tag" : "Does not have the tag" };
    return status(await call(`/contacts/${encodeURIComponent(change.contactId)}/tags`, { method: wantTag ? "POST" : "DELETE", body: JSON.stringify({ tags: [tag] }) }));
  }

  return {
    apply: (c) => (c.rule === "tag" ? setTag(c, c.after === "with") : setField(c, c.before, c.after, "format")),
    revert: (c) => (c.rule === "tag" ? setTag(c, c.before === "with") : setField(c, c.after, c.before, "undo")),
  };
}
