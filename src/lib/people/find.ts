import { csvRow } from "../analytics/people-actions.ts";

// Find a lead (docs/features/FINDLEAD_BRIEF.md). The pure rules: the keyset cursor (the next page starts AFTER the last row seen, so page 5,000 costs the same as page 2), the limits of a
// bulk change, the plain-words preview line, and the export file. No database here; the reads are in analytics/people-list-queries.ts and the routes in api/people-find-routes.ts.

export const BULK_MAX = 50;
export const EXPORT_MAX = 5000;
export const EXPORT_PAGE = 500;
export const FIND_PAGE = 50;

/** Where the last page ended: the match rank, the two dates (as the database printed them, so no precision is lost), the account and the contact. */
export type Cursor = { rk: number; ra: string; rd: string; loc: string; id: string };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
// A timestamp as Postgres prints it (2026-11-10 09:30:00.123456+00), or -infinity for "never". Nothing else is accepted, so nothing odd reaches the query.
const TS = /^(-infinity|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?)$/;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.rk, c.ra, c.rd, c.loc, c.id]), "utf8").toString("base64url");
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const a = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(a) || a.length !== 5) return null;
    const [rk, ra, rd, loc, id] = a as unknown[];
    if (!Number.isInteger(rk) || (rk as number) < 0 || (rk as number) > 3) return null;
    if (typeof ra !== "string" || !TS.test(ra) || typeof rd !== "string" || !TS.test(rd)) return null;
    if (typeof loc !== "string" || !ID.test(loc) || typeof id !== "string" || !ID.test(id)) return null;
    return { rk: rk as number, ra, rd, loc, id };
  } catch { return null; }
}

// ---------------- bulk changes ----------------

export type BulkTarget = { locationId: string; contactId: string };
export type BulkInput = { action: "tag"; tag: string; targets: BulkTarget[] } | { action: "note"; text: string; targets: BulkTarget[] };

export function parseBulk(raw: unknown, clean: { tag: (v: unknown) => string | null; noteMax: number }): { ok: true; input: BulkInput } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.targets) ? o.targets : [];
  if (list.length === 0) return { ok: false, error: "Choose at least one person" };
  if (list.length > BULK_MAX) return { ok: false, error: `Choose up to ${BULK_MAX} people at a time` };
  const seen = new Set<string>();
  const targets: BulkTarget[] = [];
  for (const t of list) {
    const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (typeof x.locationId !== "string" || typeof x.contactId !== "string" || !ID.test(x.locationId) || !ID.test(x.contactId)) return { ok: false, error: "One of the people is not valid" };
    const k = `${x.locationId}|${x.contactId}`;
    if (!seen.has(k)) { seen.add(k); targets.push({ locationId: x.locationId, contactId: x.contactId }); }
  }
  if (o.action === "tag") {
    const tag = clean.tag(o.tag);
    return tag ? { ok: true, input: { action: "tag", tag, targets } } : { ok: false, error: "Type a tag of up to 60 characters, without commas" };
  }
  if (o.action === "note") {
    const text = typeof o.text === "string" ? o.text.trim() : "";
    return text && text.length <= clean.noteMax ? { ok: true, input: { action: "note", text, targets } } : { ok: false, error: `Type a note of up to ${clean.noteMax} characters` };
  }
  return { ok: false, error: "Choose what to do: add a tag or add a note" };
}

export type BulkPlan = { will: number; already: number; notFound: number; dnd: number; names: string[] };

/** One plain sentence for the preview. Nobody is messaged; a tag or note is a record in the CRM. */
export function bulkLine(action: "tag" | "note", p: BulkPlan, tag?: string): string {
  const what = action === "tag" ? `add the tag ‘${tag ?? ""}’ to` : "add your note to";
  const parts = [`SubSync will ${what} ${p.will} ${p.will === 1 ? "person" : "people"}.`];
  if (p.already > 0) parts.push(`${p.already} already ${p.already === 1 ? "has" : "have"} it and will be skipped.`);
  if (p.notFound > 0) parts.push(`${p.notFound} could not be found and will be skipped.`);
  if (p.dnd > 0) parts.push(`${p.dnd} asked not to be contacted: this is only a record in your CRM, nobody is messaged.`);
  return parts.join(" ");
}

// ---------------- export ----------------

export type ExportRow = {
  name: string; email: string | null; phone: string | null; accountName: string | null; ownerName: string | null; source: string | null; tags: string[]; dnd: boolean;
  dateAdded: string | null; lastActivityAt: string | null;
};
export const EXPORT_HEAD = ["Name", "Email", "Phone", "Client account", "Owner", "Source", "Tags", "Do not disturb", "Added", "Last activity"] as const;

const day = (v: string | null) => (v ? v.slice(0, 10) : "");

/** The file: a header and one line per person, every cell safe to open in a spreadsheet (a name that starts with = + - or @ is not run as a formula). */
export function exportCsv(rows: readonly ExportRow[]): string {
  const out = [csvRow(EXPORT_HEAD)];
  for (const r of rows.slice(0, EXPORT_MAX)) out.push(csvRow([r.name, r.email, r.phone, r.accountName, r.ownerName, r.source, r.tags.join("; "), r.dnd ? "yes" : "no", day(r.dateAdded), day(r.lastActivityAt)]));
  return out.join("\r\n") + "\r\n";
}

/** Why a person cannot be messaged, in one line (shown on the row and in the preview). Null when nothing stands in the way. */
export const protectedReason = (r: { dnd: boolean; phone: string | null; email: string | null }): string | null =>
  r.dnd ? "Asked not to be contacted" : !r.phone && !r.email ? "No phone number or email on file" : null;
