import { sql } from "../db";
import { encryptSecret } from "../crypto";
import { DAY } from "./fill-core";

// Demo fill, part 5: the call queue workflow ("set up" in every account), the Workflows gaps record, and the sample AI connection. Demo installation only, nothing is sent anywhere.
// The AI card is a SAMPLE: the demo company has a fixed connection with a made-up key and the model "demo-sample-model"; no AI provider is ever called in the demo (the 7 am brief shows one
// fixed, labelled sample of the wording, see DEMO_BRIEF_NOTE in api/ai-routes.ts). Added once per table.

export async function fillWorkflowsAndAi(inst: string): Promise<void> {
  const db = sql();
  const now = Date.now();
  const locs = (await db`select location_id, name from locations where installation_id = ${inst} and not ignored order by name`) as unknown as Array<{ location_id: string; name: string }>;

  // The call queue workflow is "set up" in every client account, and the queue ran a few minutes ago.
  const [cq] = await db`select count(*)::int n from call_queue_settings where installation_id = ${inst}`;
  if (Number(cq?.n) === 0) {
    const ids = locs.map((l) => l.location_id);
    await db`insert into call_queue_settings (installation_id, location_id, route, tag, workflow_id, auto_on, paused, lists, max_per_run, max_per_day, window_start, window_end, last_run_at, last_added, workflow_marked_at)
      select ${inst}, l.id, 'workflow', 'call-now', 'demo-call-queue-workflow', l.n % 7 <> 6, false, array['new_no_touch', 'noshow_recent'], 25, 100, 9, 18, now() - ((4 + l.n * 3) * interval '1 minute'), (3 + (l.n % 7))::int, now()
      from unnest(${ids}::text[]) with ordinality l(id, n) on conflict do nothing`;
    await db`insert into workflow_setup (installation_id, location_id, template_key, workflow_id, template_version, status, created_at, updated_at, checked_at)
      select ${inst}, l, 'call_queue', 'demo-call-queue-workflow', 1, 'active', now() - interval '20 days', now(), now() from unnest(${ids}::text[]) l on conflict do nothing`.catch(() => undefined);
    await db`insert into workflow_setup_settings (installation_id, location_id, folder_name, auto_setup, assign_mode, auto_publish) select ${inst}, l, 'Lead Response Automations', true, 'round_robin', true from unnest(${ids}::text[]) l on conflict do nothing`.catch(() => undefined);
    // A few leads that were added to the queue (and one taken out), so the queue log has history.
    const added = await db`select location_id, contact_id from cached_contacts where installation_id = ${inst} and contact_id ~ '-c[0-9]+$' and not dnd order by location_id, substring(contact_id from '[0-9]+$')::int limit 40`;
    const log = added.map((r, k) => ({ loc: r.location_id, c: r.contact_id, a: k % 9 === 8 ? "remove" : "add", at: new Date(now - (k * 17 + 5) * 60_000).toISOString() }));
    if (log.length) await db`insert into call_queue_log (installation_id, location_id, contact_id, action, source, status, at) select ${inst}, x.loc, x.c, x.a, 'auto', 'saved', x.at::timestamptz from jsonb_to_recordset(${db.json(log as never)}) as x(loc text, c text, a text, at text)`.catch(() => undefined);
  }

  // The Workflows "Gaps" record: one row per account per day for 30 days (leads nobody touched, missed calls without a text back, no-shows not recovered, appointments with no reminder).
  const [wf] = await db`select count(*)::int n from wf_outcome_daily where installation_id = ${inst}`;
  if (Number(wf?.n) === 0) {
    const rows: Record<string, unknown>[] = [];
    for (const [i, l] of locs.entries()) for (let d = 29; d >= 0; d--) {
      const h = (d * 11 + i * 7) % 13, leads = 2 + ((d + i * 3) % 6), noTouch = h < 3 ? 1 + (h % 2) : 0;
      rows.push({
        location_id: l.location_id, day: new Date(now - d * DAY + 3_600_000).toISOString().slice(0, 10), new_leads: leads, no_touch: noTouch, missed_calls: (d + i) % 5 === 0 ? 2 : (d + i) % 3 === 0 ? 1 : 0, no_textback: (d + i) % 9 === 0 ? 1 : 0,
        noshows: (d * 3 + i) % 7 === 0 ? 2 : (d + i) % 4 === 0 ? 1 : 0, noshow_open: (d * 3 + i) % 7 === 0 ? 1 : 0, upcoming: 2 + ((d + i) % 5), no_reminder: (d + i) % 11 === 0 ? 1 : 0, at_risk_value: noTouch * (180 + i * 60),
      });
    }
    await db`insert into wf_outcome_daily (installation_id, location_id, day, new_leads, no_touch, missed_calls, no_textback, noshows, noshow_open, upcoming, no_reminder, at_risk_value)
      select ${inst}, x.location_id, x.day::date, x.new_leads, x.no_touch, x.missed_calls, x.no_textback, x.noshows, x.noshow_open, x.upcoming, x.no_reminder, x.at_risk_value
      from jsonb_to_recordset(${db.json(rows as never)}) as x(location_id text, day text, new_leads int, no_touch int, missed_calls int, no_textback int, noshows int, noshow_open int, upcoming int, no_reminder int, at_risk_value numeric) on conflict do nothing`;
  }

  // The AI card, connected (a sample, see the note at the top). Skipped quietly when the AI tables are not in this database yet.
  try {
    const [ai] = await db`select count(*)::int n from ai_connections where installation_id = ${inst}`;
    if (Number(ai?.n) === 0) {
      await db`insert into ai_connections (installation_id, location_id, provider, method, key_enc, key_last4, model, status, monthly_cap_usd, paused, share_names, jobs, created_by)
        values (${inst}, '', 'anthropic', 'key', ${encryptSecret("sk-demo-sample-not-a-real-key-0000")}, '0000', 'demo-sample-model', 'connected', 5, false, false, ${db.json({ brief: true } as never)}, 'demo')`;
      for (let d = 0; d < 11; d++) {
        await db`insert into ai_runs (installation_id, location_id, user_key, job, trigger, provider, method, model, idempotency_key, input_hash, tokens_in, tokens_out, est_cost_usd, status, sent_fields, includes_names, created_at)
          values (${inst}, '', 'demo-user', 'brief', ${d === 0 ? "view" : "schedule"}, 'anthropic', 'key', 'demo-sample-model', ${"demo-run-" + d}, ${"demo-hash-" + d}, ${820 + d * 14}, ${140 + d * 3}, ${0.0021 + d * 0.0001}, 'ok', ${["counts", "dollars", "account names"]}, false, ${new Date(now - d * DAY)})`;
      }
    }
  } catch (e) { console.error("[demo fill] ai sample skipped:", e instanceof Error ? e.message : String(e)); }
}
