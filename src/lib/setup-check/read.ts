import { GHL_API } from "../ghl/client.ts";
import { ghlFetch } from "../ghl/http.ts";
import { ALSO_ACCEPTED, classifyStatus, lastFour, SCOPE_OF, type Capped, type Read, type Reads } from "./model.ts";

// Account setup, live reads (docs/features/ACCOUNT_SETUP.md). READ ONLY: every call is a GET, except two that the platform defines as POST searches (open tasks, records of a custom object);
// both only read. Each answer is reduced to COUNTS inside this file. No name, text, number or id leaves it, except the last four digits of a phone number.
// A refusal for a missing permission is "permission", never an empty list. A whole check stops at MAX_REQUESTS so it can never become a flood.
//
// VERIFIED against the platform's published API description (apps/*.json): paths, query names, Version header and the permission each call needs.
// NOT VERIFIED LIVE (no real account was read for this): the exact shape of the email design list (the description shows one record, not a list; parsed several ways),
// the meaning of `originId` for templates (the account id is used), and the `type` value for files ("file"). If the platform answers differently the row says
// "Could not read just now" instead of a wrong number.

export const MAX_REQUESTS = 60;
const PAGE = 100;

export type ReadCtx = { token: string; locationId: string; granted: readonly string[] | null; now: number; fetchImpl?: typeof fetch };

type Budget = { left: number };
type Raw = { state: "ok"; body: unknown } | { state: "permission" } | { state: "unavailable" } | { state: "error" };

async function call(c: ReadCtx, b: Budget, scope: string, version: string, path: string, body?: unknown): Promise<Raw> {
  const have = c.granted;
  const granted = have === null ? null : [scope, ...(ALSO_ACCEPTED[scope] ?? [])].some((s) => have.includes(s));
  if (granted === false) return { state: "permission" };
  if (b.left <= 0) return { state: "error" };
  b.left--;
  try {
    const res = await ghlFetch(`${GHL_API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${c.token}`, Version: version, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    }, c.fetchImpl ? { fetchImpl: c.fetchImpl, sleep: async () => {} } : {});
    const kind = classifyStatus(res.status, granted);
    if (kind !== "ok") return { state: kind };
    return { state: "ok", body: await res.json().catch(() => null) };
  } catch { return { state: "error" }; }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const num = (v: unknown): number | null => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null; };
const seg = encodeURIComponent;

/** The list inside an answer, found under any of the usual names, or the answer itself when it is a list. */
export function listIn(body: unknown, keys: string[]): unknown[] | null {
  const direct = arr(body);
  if (direct) return direct;
  const o = obj(body);
  if (!o) return null;
  for (const k of keys) { const l = arr(o[k]); if (l) return l; }
  return null;
}
/** A total the platform sends: a number, a numeric string, `{ total: n }`, or a list holding one of those. */
export function totalIn(body: unknown, keys: string[]): number | null {
  const o = obj(body);
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    const direct = num(v);
    if (direct !== null) return direct;
    const first = arr(v)?.[0];
    const fromFirst = num(first) ?? num(obj(first)?.total) ?? num(obj(first)?.count);
    if (fromFirst !== null) return fromFirst;
    const nested = num(obj(v)?.total);
    if (nested !== null) return nested;
  }
  return null;
}

export const parsePipelines = (body: unknown): { pipelines: number; stages: number; thin: number } | null => {
  const list = listIn(body, ["pipelines"]);
  if (!list) return null;
  let stages = 0, thin = 0;
  for (const p of list) {
    const n = arr(obj(p)?.stages)?.length ?? 0;
    stages += n;
    if (n < 2) thin++;
  }
  return { pipelines: list.length, stages, thin };
};

type PageGot = { items: number; total: number | null };
/** Count by reading pages until a short page, a known total, or `maxPages`. */
async function countPages(get: (page: number) => Promise<Raw>, parse: (body: unknown) => PageGot | null, maxPages = 5): Promise<Read<Capped>> {
  let count = 0;
  for (let p = 0; p < maxPages; p++) {
    const r = await get(p);
    if (r.state !== "ok") return p === 0 ? r : { state: "ok", value: { count, capped: true } };
    const got = parse(r.body);
    if (!got) return { state: "error" };
    if (got.total !== null && p === 0) return { state: "ok", value: { count: got.total, capped: false } };
    count += got.items;
    if (got.items < PAGE) return { state: "ok", value: { count, capped: false } };
  }
  return { state: "ok", value: { count, capped: true } };
}

const listPage = (keys: string[], totals: string[] = []) => (body: unknown): PageGot | null => {
  const l = listIn(body, keys);
  return l ? { items: l.length, total: totals.length ? totalIn(body, totals) : null } : null;
};

/** A list the platform sends whole (no paging): its length is the count. */
async function readOnePage(pending: Promise<Raw>, keys: string[]): Promise<Read<Capped>> {
  const r = await pending;
  if (r.state !== "ok") return r;
  const l = listIn(r.body, keys);
  return l ? { state: "ok", value: { count: l.length, capped: false } } : { state: "error" };
}

async function readPipelines(c: ReadCtx, b: Budget): Promise<Reads["pipelines"]> {
  const r = await call(c, b, SCOPE_OF.pipelines, "2021-07-28", `/opportunities/pipelines?locationId=${seg(c.locationId)}`);
  if (r.state !== "ok") return r;
  const v = parsePipelines(r.body);
  return v ? { state: "ok", value: v } : { state: "error" };
}

async function readObjects(c: ReadCtx, b: Budget): Promise<{ objects: Reads["objects"]; records: Reads["records"] }> {
  const r = await call(c, b, SCOPE_OF.objects, "2021-07-28", `/objects/?locationId=${seg(c.locationId)}`);
  if (r.state !== "ok") return { objects: r, records: null };
  const list = listIn(r.body, ["objects"]);
  if (!list) return { objects: { state: "error" }, records: null };
  const keys = list.map((o) => obj(o)).filter((o) => o && o.standard !== true && typeof o.key === "string").map((o) => String(o!.key));
  if (keys.length === 0) return { objects: { state: "ok", value: { objects: 0 } }, records: null };
  // Records: one tiny search per custom object (the first 8), reading only the total.
  const capped = keys.length > 8; let total = 0, state: "ok" | "permission" | "unavailable" | "error" = "ok";
  for (const key of keys.slice(0, 8)) {
    const s = await call(c, b, SCOPE_OF.records, "2021-07-28", `/objects/${seg(key)}/records/search`, { locationId: c.locationId, page: 1, pageLimit: 1, query: "", searchAfter: [] });
    if (s.state !== "ok") { state = s.state; break; }
    const t = totalIn(s.body, ["total"]);
    if (t === null) { state = "error"; break; }
    total += t;
  }
  return { objects: { state: "ok", value: { objects: keys.length } }, records: state === "ok" ? { state: "ok", value: { count: total, capped } } : { state } };
}

async function readTasks(c: ReadCtx, b: Budget): Promise<Reads["tasks"]> {
  let open = 0, overdue = 0;
  for (let p = 0; p < 5; p++) {
    const r = await call(c, b, SCOPE_OF.tasks, "2021-07-28", `/locations/${seg(c.locationId)}/tasks/search`, { completed: false, limit: PAGE, skip: p * PAGE });
    if (r.state !== "ok") return p === 0 ? r : { state: "ok", value: { open, overdue, capped: true } };
    const list = listIn(r.body, ["tasks"]);
    if (!list) return { state: "error" };
    for (const t of list) {
      open++;
      const due = obj(t)?.dueDate;
      const ms = typeof due === "string" ? Date.parse(due) : NaN;
      if (Number.isFinite(ms) && ms < c.now) overdue++;
    }
    if (list.length < PAGE) return { state: "ok", value: { open, overdue, capped: false } };
  }
  return { state: "ok", value: { open, overdue, capped: true } };
}

async function readNumbers(c: ReadCtx, b: Budget): Promise<Reads["numbers"]> {
  const r = await call(c, b, SCOPE_OF.numbers, "2021-07-28", `/phone-system/numbers/location/${seg(c.locationId)}?pageSize=${PAGE}&page=1`);
  if (r.state !== "ok") return r;
  const list = listIn(r.body, ["numbers"]);
  if (!list) return { state: "error" };
  const last4 = list.map((n) => lastFour(obj(n)?.phoneNumber)).filter((d): d is string => d !== null);
  return { state: "ok", value: { count: list.length, capped: list.length >= PAGE, last4 } };
}

async function readPools(c: ReadCtx, b: Budget): Promise<Reads["pools"]> {
  const r = await call(c, b, SCOPE_OF.pools, "2021-07-28", `/phone-system/number-pools?locationId=${seg(c.locationId)}`);
  if (r.state !== "ok") return r;
  const list = listIn(r.body, ["data", "pools"]);
  if (!list) return { state: "error" };
  const inside = list.reduce<number>((n, p) => n + (arr(obj(p)?.numbers)?.length ?? 0), 0);
  return { state: "ok", value: { pools: totalIn(r.body, ["total"]) ?? list.length, numbers: inside } };
}

async function readResources(c: ReadCtx, b: Budget): Promise<Reads["resources"]> {
  const one = async (type: "rooms" | "equipments") => {
    const r = await call(c, b, SCOPE_OF.resources, "2021-04-15", `/calendars/resources/${type}?locationId=${seg(c.locationId)}&limit=${PAGE}&skip=0`);
    if (r.state !== "ok") return r;
    const list = listIn(r.body, ["resources", "data"]);
    return list ? ({ state: "ok", body: list.length } as const) : ({ state: "error" } as const);
  };
  const [rooms, equipment] = await Promise.all([one("rooms"), one("equipments")]);
  if (rooms.state !== "ok") return rooms;
  if (equipment.state !== "ok") return equipment;
  return { state: "ok", value: { rooms: rooms.body, equipment: equipment.body } };
}

/** Everything the checklist needs except our own DNS check, read at the same time (one account's token). */
export async function readAccountSetup(c: ReadCtx): Promise<Omit<Reads, "domains">> {
  const b: Budget = { left: MAX_REQUESTS };
  const id = seg(c.locationId);
  const [pipelines, objectsAndRecords, customValues, templates, tasks, files, emailBuilder, emailSchedule, numbers, pools, resources] = await Promise.all([
    readPipelines(c, b),
    readObjects(c, b),
    readOnePage(call(c, b, SCOPE_OF.customValues, "2021-07-28", `/locations/${id}/customValues`), ["customValues"]),
    countPages((p) => call(c, b, SCOPE_OF.templates, "2021-07-28", `/locations/${id}/templates?originId=${id}&deleted=false&limit=${PAGE}&skip=${p * PAGE}`), listPage(["templates"], ["totalCount"])),
    readTasks(c, b),
    countPages((p) => call(c, b, SCOPE_OF.files, "2021-07-28", `/medias/files?type=file&sortBy=createdAt&sortOrder=desc&limit=${PAGE}&offset=${p * PAGE}&altType=location&altId=${id}`), listPage(["files"])),
    countPages((p) => call(c, b, SCOPE_OF.emailBuilder, "2021-07-28", `/emails/builder?locationId=${id}&limit=${PAGE}&offset=${p * PAGE}&archived=false`), listPage(["builders", "templates", "data", "items"], ["total", "totalCount", "count"])),
    countPages((p) => call(c, b, SCOPE_OF.emailSchedule, "2021-07-28", `/emails/schedule?locationId=${id}&limit=${PAGE}&offset=${p * PAGE}&archived=false`), listPage(["schedules"], ["total"])),
    readNumbers(c, b),
    readPools(c, b),
    readResources(c, b),
  ]);
  return { pipelines, objects: objectsAndRecords.objects, records: objectsAndRecords.records, customValues, templates, tasks, files, emailBuilder, emailSchedule, numbers, pools, resources };
}
