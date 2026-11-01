import { sql } from "../db";
import { GHL_API } from "./client";
import { getCompanyAccessToken } from "./installations";
import { ghlFetch } from "./http";
import { GHL_SCOPES } from "./scopes";
import { locationAccessToken } from "../sync/engine";
import { CAPABILITY_PROBES, classifyProbe, dig, fieldReport, type Cause } from "./capabilities";

// The live capability check (stage F1, docs/CAPABILITIES.md). For each real install it asks the platform, through the app's own token service,
// whether each kind of data is really there. Only GET requests, one record at a time, a handful per install, a pause between calls. The answer
// holds field NAMES, counts and statuses, never a value, a token or any customer data, and nothing is written.
//
// It needs the production token key, which exists only where the app runs. On a machine without it, the token cannot be opened and each install
// says so ("tokens_not_readable"): that is a statement of what was not verified, not a failure of the app.

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(token: string, version: string, path: string) {
  const res = await ghlFetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" }, cache: "no-store" });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* an empty or non-JSON answer */ }
  return { status: res.status, body };
}

export type ProbeRow = {
  key: string; label: string; scope: string | null; requestedByApp: boolean | null; grantedByThisInstall: boolean | null; status: number | null; cause: Cause; words: string;
  returned?: number; platformTotal?: number; fieldsPresent?: string[]; fieldsMissing?: string[]; fieldsFilled?: Record<string, number>; sampleSize?: number; messageTypes?: Record<string, number>;
  callMessageFields?: { keys: string[]; meta: string[]; callMeta: string[] };
};
export type CountRow = { account: string; contacts: { app: number; platform: number | string }; deals: { app: number; platform: number | string }; openDeals: { app: number; platform: number | string }; conversations: { app: number; platform: number | string } };
export type InstallReport = {
  install: "agency" | "business"; scopesGranted: string[]; tokensReadable: boolean; note?: string;
  access: Array<{ account: string; appointments: string | null; users: string | null; speed: string | null }>;
  storedConversationTypes: string[]; webhookTypes: string[];
  probes: ProbeRow[]; counts: CountRow[];
};

/** `maxRequests` caps the whole run (default 70), so a call can never turn into a flood. */
export async function collectCapabilities(maxRequests = 70): Promise<{ requests: number; installs: InstallReport[] }> {
  const requested = new Set<string>(GHL_SCOPES);
  const installs = await sql()`select id, company_id, mode, scope from installations where not is_demo and uninstalled_at is null and refresh_token_enc is not null order by mode`;
  const reports: InstallReport[] = [];
  let requests = 0;
  for (const inst of installs) {
    const key = inst.company_id as string;
    const granted = new Set(String(inst.scope ?? "").split(/\s+/).filter(Boolean));
    const accounts = await sql()`select l.location_id, l.name, l.appointments_access, l.users_access, l.speed_access,
        (select count(*) from cached_contacts c where c.installation_id = l.installation_id and c.location_id = l.location_id)::int contacts,
        (select count(*) from cached_opportunities o where o.installation_id = l.installation_id and o.location_id = l.location_id)::int deals,
        (select count(*) from cached_opportunities o where o.installation_id = l.installation_id and o.location_id = l.location_id and o.status = 'open')::int open_deals,
        (select count(*) from cached_conversations v where v.installation_id = l.installation_id and v.location_id = l.location_id)::int conversations
      from locations l where l.installation_id = ${inst.id} and not l.ignored order by l.name`;
    const [types, hooks] = await Promise.all([
      sql()`select coalesce(last_message_type, '(none)') t, count(*)::int n from cached_conversations where installation_id = ${inst.id} group by 1 order by n desc`,
      sql()`select event_type, count(*)::int n from webhook_events group by 1 order by n desc`,
    ]);
    const report: InstallReport = {
      install: inst.mode === "business" ? "business" : "agency", scopesGranted: [...granted].sort(), tokensReadable: true,
      access: accounts.map((a) => ({ account: a.name as string, appointments: (a.appointments_access as string | null) ?? null, users: (a.users_access as string | null) ?? null, speed: (a.speed_access as string | null) ?? null })),
      storedConversationTypes: types.map((t) => `${t.t}: ${t.n}`), webhookTypes: hooks.map((h) => `${h.event_type}: ${h.n}`),
      probes: [], counts: [],
    };
    reports.push(report);
    if (accounts.length === 0) continue;
    const tokenFor = async (locationId: string) => (key.startsWith("loc:") ? getCompanyAccessToken(key) : locationAccessToken(key, locationId));
    // The smallest account keeps every probe cheap.
    const smallest = [...accounts].sort((a, b) => (a.contacts as number) - (b.contacts as number))[0];
    let token: string;
    try { token = await tokenFor(smallest.location_id as string); } catch {
      report.tokensReadable = false;
      report.note = "NOT VERIFIED LIVE: the access tokens could not be opened here (the production token key is not on this machine). Run this where the app runs.";
      continue;
    }
    const found = { calendarId: null as string | null, conversationId: null as string | null };
    for (const p of CAPABILITY_PROBES) {
      const path = p.path(smallest.location_id as string, found);
      const base: Pick<ProbeRow, "key" | "label" | "scope" | "requestedByApp" | "grantedByThisInstall"> = {
        key: p.key, label: p.label, scope: p.scope, requestedByApp: p.scope ? requested.has(p.scope) : null, grantedByThisInstall: p.scope ? granted.has(p.scope) : null,
      };
      if (!path || requests >= maxRequests) { report.probes.push({ ...base, status: null, ...classifyProbe({ requestedByApp: base.requestedByApp, grantedByInstall: base.grantedByThisInstall, status: null }) }); continue; }
      await pause(300);
      requests++;
      const r = await get(token, p.version, path);
      const row: ProbeRow = { ...base, status: r.status, cause: "not_verified", words: "" };
      if (r.status === 200) {
        const list = p.list && p.list.length ? dig(r.body, p.list) : r.body;
        const items = (Array.isArray(list) ? list : list && typeof list === "object" ? [list] : []) as Array<Record<string, unknown>>;
        row.returned = items.length;
        const total = p.total ? dig(r.body, p.total) : undefined;
        if (typeof total === "number") row.platformTotal = total;
        if (p.fields && p.fields.length) {
          const fr = fieldReport(items.slice(0, 20), p.fields);
          row.fieldsPresent = fr.fieldsPresent; row.fieldsMissing = items.length ? fr.fieldsMissing : undefined; row.fieldsFilled = fr.filled; row.sampleSize = fr.sample;
        }
        if (p.key === "calendars") found.calendarId = ((items[0] as { id?: string } | undefined)?.id) ?? null;
        if (p.key === "conversations") found.conversationId = ((items[0] as { id?: string } | undefined)?.id) ?? null;
        if (p.key === "messages") {
          const counts = new Map<string, number>();
          for (const m of items) { const t = String(m.messageType ?? m.type ?? "?"); counts.set(t, (counts.get(t) ?? 0) + 1); }
          row.messageTypes = Object.fromEntries(counts);
          const call = items.find((m) => /call/i.test(String(m.messageType ?? m.type ?? "")));
          if (call) {
            const meta = (call.meta ?? {}) as Record<string, unknown>;
            row.callMessageFields = { keys: Object.keys(call).sort(), meta: Object.keys(meta).sort(), callMeta: Object.keys((meta.call ?? {}) as Record<string, unknown>).sort() };
          }
        }
      }
      Object.assign(row, classifyProbe({ requestedByApp: row.requestedByApp, grantedByInstall: row.grantedByThisInstall, status: r.status, fieldsPresent: row.fieldsPresent, fieldsMissing: row.fieldsMissing }));
      report.probes.push(row);
    }
    // Counts: what the app holds against what the platform says, account by account (three reads each, one record each).
    for (const a of accounts) {
      if (requests >= maxRequests) break;
      let t: string;
      try { t = await tokenFor(a.location_id as string); } catch { continue; }
      const total = async (version: string, path: string, where: string[]) => { await pause(300); requests++; const r = await get(t, version, path); const n = dig(r.body, where); return r.status === 200 && typeof n === "number" ? n : `status ${r.status}`; };
      const l = a.location_id as string;
      report.counts.push({
        account: a.name as string,
        contacts: { app: a.contacts as number, platform: await total("2021-07-28", `/contacts/?locationId=${l}&limit=1`, ["meta", "total"]) },
        deals: { app: a.deals as number, platform: await total("2021-07-28", `/opportunities/search?location_id=${l}&status=all&limit=1`, ["meta", "total"]) },
        openDeals: { app: a.open_deals as number, platform: await total("2021-07-28", `/opportunities/search?location_id=${l}&status=open&limit=1`, ["meta", "total"]) },
        conversations: { app: a.conversations as number, platform: await total("2021-04-15", `/conversations/search?locationId=${l}&limit=1&status=all`, ["total"]) },
      });
    }
  }
  return { requests, installs: reports };
}
