import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import { outward } from "../live-flags";
import type { ChatLink } from "./handler";

// The database and Slack sides of chat. Every query that finds a tenant starts from the workspace id Slack signed, never from anything a person typed.

export async function findLink(teamId: string, channelId: string): Promise<ChatLink | null> {
  const [r] = await sql()`select id, installation_id, location_id, team_id, channel_id, bot_token_enc, bot_user_id from slack_chat_links
    where team_id = ${teamId} and channel_id = ${channelId} and status = 'connected'
      and exists (select 1 from installations i where i.id = installation_id and i.uninstalled_at is null and not i.is_demo)`.catch(() => []);
  if (!r) return null;
  try {
    return { id: r.id as string, installationId: r.installation_id as string, locationId: (r.location_id as string | null) ?? null, teamId: r.team_id as string, channelId: r.channel_id as string, botToken: decryptSecret(r.bot_token_enc as string), botUserId: (r.bot_user_id as string | null) ?? null };
  } catch { return null; }
}

export async function claimEvent(eventId: string, teamId: string, slackUser: string): Promise<boolean> {
  const db = sql();
  const r = await db`insert into slack_chat_events (event_id, team_id, slack_user) values (${eventId.slice(0, 80)}, ${teamId.slice(0, 40)}, ${slackUser.slice(0, 40)}) on conflict (event_id) do nothing returning event_id`;
  if (r.length && Math.random() < 0.02) await db`delete from slack_chat_events where created_at < now() - interval '2 days'`.catch(() => undefined);
  return r.length > 0;
}

export async function recentCount(teamId: string, slackUser: string, sinceMs: number): Promise<number> {
  const [r] = await sql()`select count(*)::int n from slack_chat_events where team_id = ${teamId} and slack_user = ${slackUser} and created_at > ${new Date(sinceMs)}`;
  return Number(r?.n ?? 0);
}

/**
 * Remember which company (or single client account) a workspace belongs to. A workspace can belong to ONE company: if it is already linked to a different one, nothing
 * changes and false is returned. `channels` are the channel ids that map too ('' is the workspace default, used for direct messages).
 */
export async function saveLink(p: { installationId: string; locationId: string | null; teamId: string; channelId: string | null; botToken: string; botUserId: string | null; actor: string | null }): Promise<boolean> {
  const db = sql();
  const [other] = await db`select 1 from slack_chat_links where team_id = ${p.teamId} and status = 'connected' and (installation_id <> ${p.installationId} or location_id is distinct from ${p.locationId}) limit 1`;
  if (other) return false;
  const token = encryptSecret(p.botToken);
  for (const channel of ["", ...(p.channelId ? [p.channelId] : [])]) {
    await db`insert into slack_chat_links (installation_id, location_id, team_id, channel_id, bot_token_enc, bot_user_id, linked_by)
      values (${p.installationId}, ${p.locationId}, ${p.teamId}, ${channel}, ${token}, ${p.botUserId}, ${p.actor})
      on conflict (team_id, channel_id) do update set bot_token_enc = excluded.bot_token_enc, bot_user_id = excluded.bot_user_id, status = 'connected', updated_at = now()
      where slack_chat_links.installation_id = excluded.installation_id`;
  }
  await db`insert into audit_log (installation_id, actor, action, detail) values (${p.installationId}, ${p.actor}, 'slack_chat.linked', ${db.json({ team: p.teamId, account: p.locationId } as never)})`.catch(() => undefined);
  return true;
}

/** Post a reply with the workspace's own bot token. Goes through the outward gate: with SEND_SLACK_LIVE off it is only recorded as a "WOULD SEND" line. */
export async function postReply(link: ChatLink, channel: string, threadTs: string | null, text: string, f: typeof fetch = fetch): Promise<void> {
  await outward({ flag: "SEND_SLACK_LIVE", verb: "SEND", what: "slack.chat.reply", installationId: link.installationId, ids: { team: link.teamId, channel } }, async () => {
    const r = await f("https://slack.com/api/chat.postMessage", {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${link.botToken}` },
      body: JSON.stringify({ channel, text: text.slice(0, 3500), ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false, unfurl_media: false }), signal: AbortSignal.timeout(8000),
    });
    await r.text().catch(() => "");
  });
}
