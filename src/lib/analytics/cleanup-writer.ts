import { sql } from "../db";
import type { ChangeRow, Outcome, Writer } from "./cleanup-platform";

export { platformWriter } from "./cleanup-platform";
export type { ChangeRow, Outcome, Writer } from "./cleanup-platform";

const asString = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

// The demo agency has no real platform behind it, so the same rules run against our own copy. That lets
// the whole preview, confirm, apply and undo flow be tried safely.
export function demoWriter(installationId: string, locationId: string): Writer {
  const db = sql();
  async function current(contactId: string) {
    const [r] = await db`select first_name, last_name, phone, tags from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId}`;
    return r ? { firstName: asString(r.first_name), lastName: asString(r.last_name), phone: asString(r.phone), tags: (r.tags as string[]) ?? [] } : null;
  }
  async function field(change: ChangeRow, expect: string | null, value: string | null): Promise<Outcome> {
    const cur = await current(change.contactId);
    if (!cur) return { result: "skipped", detail: "The contact no longer exists" };
    if ((cur[change.field as "phone" | "firstName" | "lastName"] ?? null) !== expect) return { result: "skipped", detail: "Changed since the preview, so it was left alone" };
    const col = change.field === "firstName" ? "first_name" : change.field === "lastName" ? "last_name" : "phone";
    await db`update cached_contacts set ${db(col)} = ${value} where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${change.contactId}`;
    return { result: "applied" };
  }
  async function tag(change: ChangeRow, want: boolean): Promise<Outcome> {
    const cur = await current(change.contactId);
    if (!cur) return { result: "skipped", detail: "The contact no longer exists" };
    const name = change.tag ?? "";
    const has = cur.tags.some((t) => t.toLowerCase() === name.toLowerCase());
    if (has === want) return { result: "skipped", detail: want ? "Already has the tag" : "Does not have the tag" };
    const next = want ? [...cur.tags, name] : cur.tags.filter((t) => t.toLowerCase() !== name.toLowerCase());
    await db`update cached_contacts set tags = ${next} where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${change.contactId}`;
    return { result: "applied" };
  }
  return {
    apply: (c) => (c.rule === "tag" ? tag(c, c.after === "with") : field(c, c.before, c.after)),
    revert: (c) => (c.rule === "tag" ? tag(c, c.before === "with") : field(c, c.after, c.before)),
  };
}
