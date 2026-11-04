import { sql } from "../db";
import { HISTORY_ACTIONS, kindOf as kindFor, matchesKind, newestUndo, sentence, undoOf, type AuditLine, type HistoryRow, type Kind } from "./history-intel";

// The Clean-up history: every decision, set-aside, "merged in the CRM", clean-up run, rule change, switch and "WOULD WRITE" line, with who and when (stage CLEANUP).
// Read from the audit log, limited to the client accounts the caller may see. A line about no account (a bulk decision, a change of company-wide rules) is shown to an
// agency only. Contact names come from the snapshot stored with each decision, never from a second read of the CRM.

const PAGE = 25;

export async function historyPage(
  installationId: string, allowed: string[] | null, o: { kind: Kind | null; location: string | null; page: number; q: string },
): Promise<{ rows: HistoryRow[]; page: number; pages: number; total: number; counts: Record<Kind, number> }> {
  const db = sql();
  const actions = [...HISTORY_ACTIONS] as string[];
  const loc = (db`coalesce(detail->>'locationId', detail->'ids'->>'locationId')`);
  const scoped = allowed ? db`and ${loc} = any(${allowed}::text[])` : db``;
  const one = o.location ? db`and ${loc} = ${o.location}` : db``;
  const dryOnly = db`and (action <> 'dry_run.would_write' or detail->>'what' like 'crm.%')`;
  const base = db`installation_id = ${installationId} and action = any(${actions}::text[]) ${dryOnly} ${scoped} ${one}`;

  const all = await db`select action, count(*)::int n from audit_log where ${base} group by action`;
  const counts: Record<Kind, number> = { decision: 0, merge: 0, fix: 0, rules: 0, write: 0, scan: 0 };
  for (const r of all) counts[kindFor(r.action as string)] += r.n as number;
  const wanted = o.kind ? actions.filter((a) => matchesKind(a, o.kind)) : actions;
  const total = all.filter((r) => wanted.includes(r.action as string)).reduce((s, r) => s + (r.n as number), 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.min(Math.max(0, Math.floor(o.page) || 0), pages - 1);

  const rows = await db`
    select id, at, actor, action, detail from audit_log
    where ${base} and action = any(${wanted}::text[])
    order by at desc, id desc limit ${PAGE} offset ${page * PAGE}`;
  const lines: AuditLine[] = rows.map((r) => ({ id: Number(r.id), at: (r.at as Date).toISOString(), actor: (r.actor as string | null) ?? null, action: r.action as string, detail: (r.detail ?? {}) as Record<string, unknown> }));

  const locIds = [...new Set(lines.map((l) => locOf(l)).filter((x): x is string => !!x))];
  const keys = lines.map((l) => ({ loc: locOf(l), key: typeof l.detail.key === "string" ? l.detail.key : null })).filter((x): x is { loc: string; key: string } => !!x.loc && !!x.key);
  const [names, reviews, snoozes, snaps] = await Promise.all([
    locIds.length ? db`select location_id, name from locations where installation_id = ${installationId} and location_id = any(${locIds}::text[])` : Promise.resolve([]),
    keys.length ? db`select location_id, group_key from duplicate_reviews where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and group_key = any(${keys.map((k) => k.key)}::text[])` : Promise.resolve([]),
    keys.length ? db`select location_id, group_key from duplicate_snoozes where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and group_key = any(${keys.map((k) => k.key)}::text[]) and until > now()` : Promise.resolve([]),
    keys.length ? db`select location_id, group_key, snapshot from duplicate_reviews where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and group_key = any(${keys.map((k) => k.key)}::text[])` : Promise.resolve([]),
  ]);
  const nameOf = new Map(names.map((n) => [n.location_id as string, (n.name as string | null) ?? null]));
  const state = { reviews: new Set(reviews.map((r) => `${r.location_id}:${r.group_key}`)), snoozes: new Set(snoozes.map((r) => `${r.location_id}:${r.group_key}`)) };
  const contactNames = new Map<string, string[]>();
  for (const s of snaps) {
    const list = ((s.snapshot as { contacts?: Array<{ full_name?: string | null; email?: string | null }> } | null)?.contacts ?? []).map((c) => (c.full_name ?? "").trim() || c.email || "a contact").slice(0, 4);
    contactNames.set(`${s.location_id}:${s.group_key}`, list);
  }

  const out: HistoryRow[] = lines.map((l) => {
    const lo = locOf(l);
    const key = typeof l.detail.key === "string" ? l.detail.key : null;
    const names2 = lo && key ? contactNames.get(`${lo}:${key}`) ?? [] : [];
    const account = lo ? nameOf.get(lo) ?? null : null;
    return {
      id: l.id, at: l.at, who: l.actor ?? (l.action === "dry_run.would_write" ? "SubSync" : "Someone"), kind: kindFor(l.action), text: sentence(l, names2, account),
      locationId: lo, locationName: account, names: names2, undo: undoOf(l, state), dryRun: l.action === "dry_run.would_write",
    };
  });
  return { rows: newestUndo(out), page, pages, total, counts };
}

function locOf(l: AuditLine): string | null {
  const direct = l.detail.locationId;
  if (typeof direct === "string") return direct;
  const ids = l.detail.ids as Record<string, unknown> | undefined;
  return ids && typeof ids.locationId === "string" ? ids.locationId : null;
}

