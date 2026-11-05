import { sql } from "../db";
import { classify, type GrowthContact } from "../analytics/growth";
import { json, type AuthContext } from "./auth";
import { accountsOf, loadContacts, loadRules, type GrowthDeps } from "./growth-api";

// Email leads: the list under the Growth tab, and its download. One person once per client (the Growth rules), newest first, with a search and a client filter.
// Only the clients the caller may read are ever loaded: a forged `client=` matches nothing. `format=csv` returns what the same filters show, without anyone marked do not
// contact or unsubscribed, and writes one line to the audit log (counts only, never an address).

type Ctx = AuthContext & { request: Request };
const PAGE = 50;
const CSV_CAP = 50_000;
/** A cell that starts with = + - or @ would run as a formula in a spreadsheet, so it is made plain text. */
const cell = (v: string) => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function growthEmails(ctx: Ctx, deps: GrowthDeps): Promise<Response> {
  const url = new URL(ctx.request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const client = url.searchParams.get("client") ?? "";
  const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1));
  const csv = url.searchParams.get("format") === "csv";
  const permits = await deps.permits(ctx);
  const accounts = await accountsOf(ctx.installationId, permits, await deps.accountUrl(ctx));
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const { rules } = await loadRules(ctx.installationId);
  const { contacts } = await loadContacts(ctx.installationId, accounts.map((a) => a.id), await deps.contactUrl(ctx));
  const verdicts = classify(contacts, rules);
  const all = contacts.filter((c) => verdicts.get(c.id) === "counted" && (!client || c.locationId === client)
    && (!q || `${c.email ?? ""} ${c.name} ${names.get(c.locationId) ?? ""} ${c.source ?? ""}`.toLowerCase().includes(q)));
  all.sort((a, b) => (b.at as number) - (a.at as number));
  const toRow = (c: GrowthContact) => ({ id: c.id, locationId: c.locationId, client: names.get(c.locationId) ?? "Client", name: c.name, email: c.email ?? "", source: c.source, at: c.at as number, dnd: c.dnd === true, url: c.url ?? "" });
  if (csv) {
    const sendable = all.filter((c) => !c.dnd).slice(0, CSV_CAP);
    const lines = ["Email,Name,Client,Source,Date added"];
    for (const c of sendable) lines.push([cell(c.email ?? ""), cell(c.name), cell(names.get(c.locationId) ?? ""), cell(c.source ?? ""), new Date(c.at as number).toISOString().slice(0, 10)].join(","));
    await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'growth.emails_downloaded',
      ${sql().json({ rows: sendable.length, leftOutDoNotContact: all.length - all.filter((c) => !c.dnd).length, clients: new Set(sendable.map((c) => c.locationId)).size, searched: q !== "", oneClient: client !== "" } as never)})`;
    return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="email-leads.csv"', "Cache-Control": "no-store" } });
  }
  const start = (page - 1) * PAGE;
  return json({ total: all.length, doNotContact: all.filter((c) => c.dnd).length, page, pageSize: PAGE, rows: all.slice(start, start + PAGE).map(toRow), clients: accounts.map((a) => ({ id: a.id, name: a.name })) });
}
