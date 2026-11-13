import { sql } from "../db";
import { DEFAULT_SETTINGS, hasMarkup, type SendChannel, type SendSettings, type Usage } from "../ghl/send-guard";

// The saved sending rules, the quick templates, the counts behind the limits and the record of every send. Every query names the installation AND the client account.
// Nothing here holds a message's words: a send is stored as ids, the channel, a one-way hash and the result.

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

export function parseSettings(raw: unknown): SendSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const list = typeof o.linkAllowlist === "string" ? o.linkAllowlist : Array.isArray(o.linkAllowlist) ? (o.linkAllowlist as unknown[]).filter((x): x is string => typeof x === "string").join(",") : "";
  return {
    paused: o.paused === true, quietStartHour: clamp(o.quietStartHour, 0, 23, d.quietStartHour), quietEndHour: clamp(o.quietEndHour, 0, 23, d.quietEndHour),
    perPersonHour: clamp(o.perPersonHour, 1, 20, d.perPersonHour), perPersonDay: clamp(o.perPersonDay, 1, 50, d.perPersonDay), accountDay: clamp(o.accountDay, 1, 5000, d.accountDay), dupMinutes: clamp(o.dupMinutes, 1, 1440, d.dupMinutes),
    footerEnabled: o.footerEnabled === true, footerText: (typeof o.footerText === "string" && o.footerText.trim() ? o.footerText.trim() : d.footerText).slice(0, 160),
    linkAllowlist: list.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30), allowAgencySend: o.allowAgencySend !== false,
  };
}

export async function loadSettings(installationId: string, locationId: string): Promise<SendSettings> {
  try {
    const [r] = await sql()`select paused, quiet_start_hour, quiet_end_hour, per_person_hour, per_person_day, account_day, dup_minutes, footer_enabled, footer_text, link_allowlist, allow_agency_send from message_send_settings where installation_id = ${installationId} and location_id = ${locationId}`;
    if (!r) return DEFAULT_SETTINGS;
    return parseSettings({ paused: r.paused, quietStartHour: r.quiet_start_hour, quietEndHour: r.quiet_end_hour, perPersonHour: r.per_person_hour, perPersonDay: r.per_person_day, accountDay: r.account_day, dupMinutes: r.dup_minutes, footerEnabled: r.footer_enabled, footerText: r.footer_text, linkAllowlist: r.link_allowlist, allowAgencySend: r.allow_agency_send });
  } catch { return { ...DEFAULT_SETTINGS, paused: true }; } // an unreadable table means "not ready": nothing is sent
}

export async function saveSettings(installationId: string, locationId: string, s: SendSettings, by: string | null): Promise<void> {
  await sql()`
    insert into message_send_settings (installation_id, location_id, paused, quiet_start_hour, quiet_end_hour, per_person_hour, per_person_day, account_day, dup_minutes, footer_enabled, footer_text, link_allowlist, allow_agency_send, updated_by, updated_at)
    values (${installationId}, ${locationId}, ${s.paused}, ${s.quietStartHour}, ${s.quietEndHour}, ${s.perPersonHour}, ${s.perPersonDay}, ${s.accountDay}, ${s.dupMinutes}, ${s.footerEnabled}, ${s.footerText}, ${s.linkAllowlist.join(",")}, ${s.allowAgencySend}, ${by}, now())
    on conflict (installation_id, location_id) do update set paused = excluded.paused, quiet_start_hour = excluded.quiet_start_hour, quiet_end_hour = excluded.quiet_end_hour, per_person_hour = excluded.per_person_hour, per_person_day = excluded.per_person_day,
      account_day = excluded.account_day, dup_minutes = excluded.dup_minutes, footer_enabled = excluded.footer_enabled, footer_text = excluded.footer_text, link_allowlist = excluded.link_allowlist, allow_agency_send = excluded.allow_agency_send, updated_by = excluded.updated_by, updated_at = now()`;
}

/** What has really been sent (not dry runs, not failures) to this person and from this account. Null when the log cannot be read (the guard then stops). */
export async function loadUsage(installationId: string, locationId: string, contactId: string, idem: string, dupMinutes: number): Promise<Usage | null> {
  try {
    const [r] = await sql()`
      select
        count(*) filter (where contact_id = ${contactId} and created_at > now() - interval '1 hour')::int person_hour,
        count(*) filter (where contact_id = ${contactId} and created_at > now() - interval '1 day')::int person_day,
        count(*) filter (where created_at > now() - interval '1 day')::int account_day,
        count(*) filter (where contact_id = ${contactId} and idem_key like ${idem.split(":").slice(0, 3).join(":") + ":%"} and created_at > now() - make_interval(mins => ${dupMinutes}))::int dup
      from message_sends where installation_id = ${installationId} and location_id = ${locationId} and result = 'done' and not dry_run and created_at > now() - interval '1 day'`;
    return { personHour: Number(r?.person_hour ?? 0), personDay: Number(r?.person_day ?? 0), accountDay: Number(r?.account_day ?? 0), duplicateRecent: Number(r?.dup ?? 0) > 0 };
  } catch { return null; }
}

export type SendRecord = { installationId: string; locationId: string; contactId: string; channel: SendChannel; actor: string | null; actorName: string | null; textHash: string; segments: number; result: string; dryRun: boolean; idemKey: string; ghlMessageId: string | null };

/** One row per send attempt. A second press of the same send (same key) updates nothing and is not counted twice. */
export async function recordSend(r: SendRecord): Promise<boolean> {
  try {
    const rows = await sql()`
      insert into message_sends (installation_id, location_id, contact_id, channel, actor, actor_name, text_hash, segments, result, dry_run, idem_key, ghl_message_id)
      values (${r.installationId}, ${r.locationId}, ${r.contactId}, ${r.channel}, ${r.actor}, ${r.actorName}, ${r.textHash}, ${r.segments}, ${r.result}, ${r.dryRun}, ${r.idemKey}, ${r.ghlMessageId})
      on conflict (installation_id, idem_key) do update set result = excluded.result, dry_run = excluded.dry_run, ghl_message_id = coalesce(excluded.ghl_message_id, message_sends.ghl_message_id), created_at = case when message_sends.result = 'done' then message_sends.created_at else now() end
      where message_sends.result <> 'done' returning id`;
    return rows.length === 1;
  } catch { return false; }
}

export type Template = { id: string; name: string; channel: SendChannel; subject: string | null; body: string };

export async function listTemplates(installationId: string, locationId: string): Promise<Template[]> {
  try {
    const rows = await sql()`select id, name, channel, subject, body from message_templates where installation_id = ${installationId} and location_id = ${locationId} order by name limit 100`;
    return rows.map((r) => ({ id: r.id as string, name: r.name as string, channel: r.channel as SendChannel, subject: (r.subject as string | null) ?? null, body: r.body as string }));
  } catch { return []; }
}

export function checkTemplate(t: { name: unknown; channel: unknown; subject: unknown; body: unknown }): { ok: true; value: Omit<Template, "id"> } | { ok: false; error: string } {
  const name = typeof t.name === "string" ? t.name.trim() : "", body = typeof t.body === "string" ? t.body.trim() : "";
  const subject = typeof t.subject === "string" && t.subject.trim() ? t.subject.trim() : null;
  if (t.channel !== "SMS" && t.channel !== "Email") return { ok: false, error: "Choose text or email." };
  if (!name || name.length > 60) return { ok: false, error: "Give the template a short name." };
  if (!body || body.length > (t.channel === "Email" ? 10000 : 1000)) return { ok: false, error: "Write the template text (not too long)." };
  if (hasMarkup(body) || (subject && hasMarkup(subject))) return { ok: false, error: "Templates are plain text. Take out any code or tags." };
  if (t.channel === "Email" && !subject) return { ok: false, error: "An email template needs a subject." };
  return { ok: true, value: { name, channel: t.channel, subject, body } };
}

export async function saveTemplate(installationId: string, locationId: string, id: string | null, t: Omit<Template, "id">, by: string | null): Promise<string | null> {
  const db = sql();
  if (id) {
    const rows = await db`update message_templates set name = ${t.name}, channel = ${t.channel}, subject = ${t.subject}, body = ${t.body}, updated_at = now() where installation_id = ${installationId} and location_id = ${locationId} and id = ${id} returning id`;
    return rows[0] ? (rows[0].id as string) : null;
  }
  const rows = await db`insert into message_templates (installation_id, location_id, name, channel, subject, body, created_by) values (${installationId}, ${locationId}, ${t.name}, ${t.channel}, ${t.subject}, ${t.body}, ${by}) returning id`;
  return rows[0].id as string;
}

export async function deleteTemplate(installationId: string, locationId: string, id: string): Promise<boolean> {
  const rows = await sql()`delete from message_templates where installation_id = ${installationId} and location_id = ${locationId} and id = ${id} returning id`;
  return rows.length === 1;
}
