import { sql } from "../db";
import { DAY, TEAM } from "./fill-core";

// Demo fill, part 2: money. What the fictional agency's client accounts pay it (plan, status, credit balance, the monthly record), the payments of those clients' own customers (failed,
// late, recovered, refunded, disputed) and the agency's own billing notes, ad spend and payouts. Only the demo installation's rows; no CRM; all names and amounts invented.
// Added once per table (the marker is a row with a "demo" key), then left alone. Dates are made from "now" at the time of the run; fill-core's shiftIfStale keeps them current.

type Loc = { location_id: string; name: string };
type Plan = { plan: string; price: number; interval: "month" | "year"; status: string | null; sinceDays: number; wallet: number | null; credits?: number; startedDays: number; endedDays?: number; install?: boolean };

// One row per fictional client, written the way an agency would sell: three plans, a few late payers, one cancelled, one paused, one without a plan yet.
const PLANS: Record<string, Plan> = {
  "Bright Smile Dental": { plan: "Growth", price: 497, interval: "month", status: "active", sinceDays: 80, wallet: 142.5, startedDays: 400 },
  "Peak Fitness Studio": { plan: "Starter", price: 297, interval: "month", status: "active", sinceDays: 60, wallet: 63.2, startedDays: 260 },
  "Harbor Law Group": { plan: "Pro", price: 8600, interval: "year", status: "active", sinceDays: 120, wallet: 220, startedDays: 500 },
  "Sunrise Roofing Co": { plan: "Growth", price: 497, interval: "month", status: "past_due", sinceDays: 9, wallet: 4.1, startedDays: 300 },
  "Green Leaf Landscaping": { plan: "Starter", price: 297, interval: "month", status: "past_due", sinceDays: 23, wallet: 11.8, startedDays: 220 },
  "Metro Auto Repair": { plan: "Growth", price: 497, interval: "month", status: "active", sinceDays: 45, wallet: 18, startedDays: 330 },
  "Blue Door Realty": { plan: "Pro", price: 797, interval: "month", status: "active", sinceDays: 70, wallet: 310, startedDays: 410 },
  "Oak & Ember Bistro": { plan: "Starter", price: 297, interval: "month", status: "canceled", sinceDays: 6, wallet: 0, startedDays: 280, endedDays: 6 },
  "Pure Glow Med Spa": { plan: "Pro", price: 797, interval: "month", status: "active", sinceDays: 90, wallet: 188, startedDays: 350 },
  "Summit HVAC Services": { plan: "Growth", price: 497, interval: "month", status: "paused", sinceDays: 31, wallet: 0, startedDays: 240 },
  "Paws & Claws Vet": { plan: "Starter", price: 297, interval: "month", status: "trialing", sinceDays: 12, wallet: 55, startedDays: 12 },
  "Northside Chiropractic": { plan: "", price: 0, interval: "month", status: null, sinceDays: 9, wallet: 25, startedDays: 9 },
  "Starlight Cleaning": { plan: "Starter", price: 297, interval: "month", status: "active", sinceDays: 50, wallet: 2.5, startedDays: 120 },
};

const lagosDay = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10); // Lagos is UTC+1 all year

const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

export async function fillMoney(inst: string): Promise<void> {
  const db = sql();
  const now = Date.now();
  const at = (days: number) => new Date(now - days * DAY);
  const locs = (await db`select location_id, name from locations where installation_id = ${inst} and not ignored order by name`) as unknown as Loc[];
  const byName = new Map(locs.map((l) => [l.name, l.location_id]));

  // ---- the client paid plans (what each client pays the agency), credit balances, and whether SubSync itself is installed ----
  const [bill] = await db`select count(*)::int n from client_billing where installation_id = ${inst}`;
  if (Number(bill?.n) === 0) {
    for (const [name, p] of Object.entries(PLANS)) {
      const loc = byName.get(name);
      if (!loc) continue;
      const noPlan = p.status === null;
      await db`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status, fetched_at, subscription_id, price_amount, price_currency, billing_interval, trial_days, status_since, http_status,
          wallet_balance, wallet_credits, wallet_state, wallet_at)
        values (${inst}, ${loc}, ${noPlan ? "no_plan" : "ok"}, ${noPlan ? null : "plan-" + p.plan.toLowerCase()}, ${noPlan ? null : p.plan}, ${p.status}, now(), ${noPlan ? null : "sub-" + loc}, ${noPlan ? null : p.price}, ${noPlan ? null : "USD"},
          ${noPlan ? null : p.interval}, ${p.status === "trialing" ? 14 : null}, ${at(p.sinceDays)}, 200, ${p.wallet}, ${p.wallet === null ? null : Math.round(p.wallet * 40)}, ${p.wallet === null ? null : "ok"}, now())
        on conflict (installation_id, location_id) do nothing`;
    }
  }
  const [inst3] = await db`select count(*)::int n from cl3_app_installs where installation_id = ${inst}`;
  if (Number(inst3?.n) === 0) {
    for (const l of locs) {
      // SubSync is missing in two client accounts (the "app missing" filter has something to show).
      const missing = l.name === "Green Leaf Landscaping" || l.name === "Starlight Cleaning";
      await db`insert into cl3_app_installs (installation_id, location_id, name, is_installed, version_id, installed_at, seen_at) values (${inst}, ${l.location_id}, ${l.name}, ${!missing}, ${missing ? null : "1.4.0"}, ${missing ? null : at(70)}, now()) on conflict do nothing`;
    }
  }
  const [hist] = await db`select count(*)::int n from cl3_history where installation_id = ${inst}`;
  if (Number(hist?.n) === 0) {
    const ev: Array<[string, string, string | null, string | null, number]> = [
      ["Sunrise Roofing Co", "status", "active", "past_due", 9], ["Green Leaf Landscaping", "status", "active", "past_due", 23], ["Oak & Ember Bistro", "status", "active", "canceled", 6],
      ["Summit HVAC Services", "status", "active", "paused", 31], ["Paws & Claws Vet", "plan", null, "Starter", 12], ["Peak Fitness Studio", "plan", "Starter", "Starter", 60],
      ["Blue Door Realty", "plan", "Growth", "Pro", 70], ["Starlight Cleaning", "wallet_low", null, null, 4], ["Sunrise Roofing Co", "wallet_low", null, null, 2], ["Green Leaf Landscaping", "app_removed", null, null, 15],
      ["Bright Smile Dental", "plan", "Starter", "Growth", 80], ["Pure Glow Med Spa", "status", "past_due", "active", 40],
    ];
    for (const [n, kind, from, to, d] of ev) { const loc = byName.get(n); if (loc) await db`insert into cl3_history (installation_id, location_id, kind, from_value, to_value, at) values (${inst}, ${loc}, ${kind}, ${from}, ${to}, ${at(d)})`; }
  }
  const [pe] = await db`select count(*)::int n from cl2_plan_events where installation_id = ${inst}`;
  if (Number(pe?.n) === 0) {
    for (const [n, p] of Object.entries(PLANS)) { const loc = byName.get(n); if (loc && p.status) await db`insert into cl2_plan_events (installation_id, location_id, from_status, to_status, plan_name, at) values (${inst}, ${loc}, null, ${p.status}, ${p.plan}, ${at(p.sinceDays)})`; }
  }

  // ---- credit balance readings (14 days, falling, with top-ups), so "days left" and spikes have a real record ----
  const [wg] = await db`select count(*)::int n from wg_samples where installation_id = ${inst}`;
  if (Number(wg?.n) === 0) {
    const samples: Array<{ loc: string; at: string; bal: number; cr: number }> = [];
    for (const [name, p] of Object.entries(PLANS)) {
      const loc = byName.get(name);
      if (!loc || p.wallet === null) continue;
      const burn = Math.max(0.6, (p.wallet + 20) / 18);
      for (let d = 14; d >= 0; d--) {
        const topup = d >= 8 && p.wallet > 30 ? 60 : 0;
        const bal = d === 0 ? p.wallet : Math.max(0, Math.round((p.wallet + burn * d - (d >= 8 ? 0 : topup)) * 100) / 100);
        samples.push({ loc, at: at(d).toISOString(), bal, cr: Math.round(bal * 40) });
      }
    }
    if (samples.length) await db`insert into wg_samples (installation_id, location_id, observed_at, balance, credits)
      select ${inst}, x.loc, x.at::timestamptz, x.bal, x.cr from jsonb_to_recordset(${db.json(samples as never)}) as x(loc text, at text, bal numeric, cr numeric)`;
  }

  // ---- the agency's own money notes (Money > Plans and churn, Payouts) ----
  await db`insert into fn_settings (installation_id, payout_basis, currency, deal_window_days, updated_by) values (${inst}, 'won', 'USD', 30, 'demo') on conflict do nothing`;
  const [ms] = await db`select count(*)::int n from fn_mrr_snapshot where installation_id = ${inst} and day < ${lagosDay(now)}::date`;
  if (Number(ms?.n) === 0) {
    const rows: Record<string, unknown>[] = [];
    for (const [name, p] of Object.entries(PLANS)) {
      const loc = byName.get(name);
      if (!loc) continue;
      const monthly = p.status === null ? null : p.interval === "year" ? Math.round((p.price / 12) * 100) / 100 : p.price;
      for (let d = 90; d >= 1; d--) {
        if (d > p.startedDays) continue;
        let pay: string = p.status === null ? "none" : "paid";
        if (p.status === "past_due" && d <= p.sinceDays) pay = "past_due";
        if (p.status === "canceled" && d <= (p.endedDays ?? 0)) pay = "cancelled";
        if (p.status === "paused" && d <= p.sinceDays) pay = "paused";
        rows.push({ location_id: loc, day: lagosDay(now - d * DAY), plan_key: p.status === null ? null : "plan-" + p.plan.toLowerCase(), plan_name: p.status === null ? null : p.plan, pay, monthly, currency: "USD", source: p.status === null ? "none" : "platform" });
      }
    }
    for (const part of chunk(rows, 400)) {
      await db`insert into fn_mrr_snapshot (installation_id, location_id, day, plan_key, plan_name, pay, monthly, currency, source)
        select ${inst}, x.location_id, x.day::date, x.plan_key, x.plan_name, x.pay, x.monthly, x.currency, x.source
        from jsonb_to_recordset(${db.json(part as never)}) as x(location_id text, day text, plan_key text, plan_name text, pay text, monthly numeric, currency text, source text) on conflict do nothing`;
    }
  }
  const [ad] = await db`select count(*)::int n from fn_ad_spend where installation_id = ${inst}`;
  if (Number(ad?.n) === 0) {
    const spend: Array<{ loc: string; month: string; amount: number }> = [];
    for (const [i, l] of locs.entries()) for (let m = 0; m < 3; m++) {
      spend.push({ loc: l.location_id, month: new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - m, 1)).toISOString().slice(0, 10), amount: 600 + ((i * 337 + m * 211) % 2600) });
    }
    await db`insert into fn_ad_spend (installation_id, location_id, month, amount, currency, updated_by)
      select ${inst}, x.loc, x.month::date, x.amount, 'USD', 'demo' from jsonb_to_recordset(${db.json(spend as never)}) as x(loc text, month text, amount numeric) on conflict do nothing`;
  }
  const [ch] = await db`select count(*)::int n from fn_churn_state where installation_id = ${inst}`;
  if (Number(ch?.n) === 0) {
    for (const [n, status, who, note] of [["Sunrise Roofing Co", "working", TEAM[0], "Owner unhappy about slow replies. Call booked Thursday."], ["Oak & Ember Bistro", "lost", TEAM[2], "Contract lapsed. Verbal yes to renew, paperwork pending."], ["Summit HVAC Services", "open", TEAM[1], null], ["Green Leaf Landscaping", "working", TEAM[0], "Card expired. Waiting on a new one."]] as const) {
      const loc = byName.get(n);
      if (loc) await db`insert into fn_churn_state (installation_id, location_id, owner_user_id, status, note, updated_by) values (${inst}, ${loc}, ${who}, ${status}, ${note}, 'demo') on conflict do nothing`;
    }
  }
  const [led] = await db`select count(*)::int n from fn_ledger where installation_id = ${inst}`;
  if (Number(led?.n) === 0) {
    const notes: Array<[string, string, number, number, string, string | null]> = [
      ["Sunrise Roofing Co", "Growth plan, this month", 497, -9, "unpaid", "Card declined twice. Ask for a new card."], ["Green Leaf Landscaping", "Starter plan, this month", 297, -23, "unpaid", null],
      ["Blue Door Realty", "Setup of the Zillow lead flow", 1200, 6, "unpaid", "Invoice sent by email."], ["Bright Smile Dental", "Recall campaign build", 900, -20, "paid", null],
      ["Harbor Law Group", "Annual plan", 8600, 60, "unpaid", "Renews in two months."], ["Pure Glow Med Spa", "Extra landing page", 650, -12, "paid", null],
    ];
    for (const [n, label, amount, due, status, note] of notes) {
      const loc = byName.get(n);
      if (loc) await db`insert into fn_ledger (installation_id, location_id, label, amount, currency, due_on, status, paid_on, remind_on, note, created_by) values (${inst}, ${loc}, ${label}, ${amount}, 'USD', ${lagosDay(now + due * DAY)}::date, ${status}, ${status === "paid" ? lagosDay(now + (due + 2) * DAY) : null}::date, ${status === "unpaid" ? lagosDay(now + (due + 3) * DAY) : null}::date, ${note}, 'demo')`;
    }
  }
  // Commission rates (setters 5 percent of a won deal, closers 8 percent) and one frozen payout period built from last month's won deals.
  await db`insert into fn_pay_rates (installation_id, person_id, location_id, role, pct, flat, updated_by) values (${inst}, '', '', 'setter', 5, 0, 'demo'), (${inst}, '', '', 'closer', 8, 0, 'demo'), (${inst}, ${TEAM[2]}, '', 'closer', 10, 0, 'demo') on conflict do nothing`;
  const from = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 1, 1)), to = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 0));
  const [per] = await db`select id from fn_pay_periods where installation_id = ${inst} limit 1`;
  if (!per) {
    const won = await db`select location_id, opportunity_id, monetary_value::float8 v, assigned_to, last_status_change_at at from cached_opportunities
      where installation_id = ${inst} and status = 'won' and assigned_to is not null and monetary_value > 0 and last_status_change_at >= ${from} and last_status_change_at < ${new Date(to.getTime() + DAY)} order by last_status_change_at limit 60`;
    const fallback = won.length ? won : await db`select location_id, opportunity_id, monetary_value::float8 v, assigned_to, ${from}::timestamptz + (row_number() over ())::int * interval '1 day' at from cached_opportunities
      where installation_id = ${inst} and status = 'won' and assigned_to is not null and monetary_value > 0 order by opportunity_id limit 24`;
    const [p] = await db`insert into fn_pay_periods (installation_id, label, date_from, date_to, basis, currency, line_count, accounts, total, frozen_by)
      values (${inst}, ${from.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}, ${from.toISOString().slice(0, 10)}::date, ${to.toISOString().slice(0, 10)}::date, 'won', 'USD', 0, 0, 0, 'Demo Admin') on conflict do nothing returning id`;
    if (p) {
      let total = 0, n = 0;
      const accounts = new Set<string>();
      const lines: Array<Record<string, unknown>> = [];
      for (const w of fallback) {
        const person = String(w.assigned_to), role = person === TEAM[2] ? "closer" : person === TEAM[1] ? "closer" : "setter", pct = role === "closer" ? (person === TEAM[2] ? 10 : 8) : 5, amount = Math.round(Number(w.v) * pct) / 100;
        lines.push({ key: `won:${w.opportunity_id}:${role}`, loc: w.location_id, person, role, ref: w.opportunity_id, at: new Date(w.at as Date).toISOString(), v: w.v, pct, amount });
        total += amount; n++; accounts.add(String(w.location_id));
      }
      if (lines.length) await db`insert into fn_pay_lines (period_id, installation_id, line_key, location_id, person_id, role, kind, ref_id, at, value, rate_pct, rate_flat, amount)
        select ${p.id}, ${inst}, x.key, x.loc, x.person, x.role, 'won', x.ref, x.at::timestamptz, x.v, x.pct, 0, x.amount
        from jsonb_to_recordset(${db.json(lines as never)}) as x(key text, loc text, person text, role text, ref text, at text, v numeric, pct numeric, amount numeric) on conflict do nothing`;
      await db`update fn_pay_periods set line_count = ${n}, accounts = ${accounts.size}, total = ${Math.round(total * 100) / 100} where id = ${p.id} and installation_id = ${inst}`;
    }
  }
  await payments(inst, locs, byName, now);
  await planItems(inst);
}

/** The payments of the clients' own customers: failed, late, past due, refunded, recovered, disputed. */
async function payments(inst: string, locs: Loc[], byName: Map<string, string>, now: number): Promise<void> {
  const db = sql();
  const [have] = await db`select count(*)::int n from pm_items where installation_id = ${inst}`;
  if (Number(have?.n) > 0) return;
  const at = (days: number) => new Date(now - days * DAY);
  type Person = { location_id: string; contact_id: string; name: string; email: string | null };
  const people = (await db`
    select location_id, contact_id, trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) name, email from (
      select location_id, contact_id, first_name, last_name, email, row_number() over (partition by location_id order by substring(contact_id from '[0-9]+$')::int) rn
      from cached_contacts where installation_id = ${inst} and email is not null and first_name is not null and last_name is not null and contact_id ~ '-c[0-9]+$' and email !~ 'mailinator|-at-example'
    ) x where rn <= 16`) as unknown as Person[];
  const perLoc = new Map<string, Person[]>();
  for (const p of people) perLoc.set(p.location_id, [...(perLoc.get(p.location_id) ?? []), p]);
  const SRC = ["Stripe", "Square", "PayPal", "Authorize.net"];
  const items: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [];
  const add = (loc: string, p: Person, kind: string, id: string, o: { status: string; problem?: string | null; amount: number; refunded?: number; days: number; resolvedDays?: number; due?: number; plan?: string | null; src?: string }) => {
    const since = at(o.days), resolved = o.resolvedDays !== undefined ? at(o.resolvedDays) : null;
    items.push({
      location_id: loc, kind, item_id: id, status_raw: o.status, status_mapped: resolved ? "paid" : o.status, problem_kind: o.problem ?? null, amount: o.amount, amount_refunded: o.refunded ?? 0, currency: "USD", contact_id: p.contact_id,
      contact_name: p.name, contact_email: p.email, plan_name: o.plan ?? null, source_name: o.src ?? SRC[Math.abs(id.length) % SRC.length], occurred_at: since, problem_since: o.problem ? since : null, resolved_at: resolved,
      due_date: o.due !== undefined ? new Date(now + o.due * DAY).toISOString().slice(0, 10) : null, rank_score: Math.round(o.amount * (1 + o.days / 20)),
    });
    events.push({ location_id: loc, kind, item_id: id, from_status: null, to_status: o.status, amount: o.amount, occurred_at: since.toISOString() });
    if (resolved) events.push({ location_id: loc, kind, item_id: id, from_status: o.status, to_status: "paid", amount: o.amount, occurred_at: resolved.toISOString() });
  };
  const bigNames = ["Bright Smile Dental", "Blue Door Realty", "Pure Glow Med Spa", "Metro Auto Repair", "Peak Fitness Studio", "Harbor Law Group", "Paws & Claws Vet", "Sunrise Roofing Co"];
  for (const [bi, name] of bigNames.entries()) {
    const loc = byName.get(name), ps = loc ? perLoc.get(loc) : undefined;
    if (!loc || !ps || ps.length < 12) continue;
    const base = 80 + bi * 35;
    // failed payments, still open (some a day old, some three weeks)
    add(loc, ps[0], "transaction", `demo-tx-f1-${loc}`, { status: "failed", problem: "failed_payment", amount: base * 3, days: 1 + bi % 3 });
    add(loc, ps[1], "transaction", `demo-tx-f2-${loc}`, { status: "failed", problem: "failed_payment", amount: base * 2 + 40, days: 5 + bi });
    if (bi % 2 === 0) add(loc, ps[2], "transaction", `demo-tx-f3-${loc}`, { status: "failed", problem: "failed_payment", amount: base * 6, days: 19 + bi });
    // a late invoice and a failed repeat payment
    add(loc, ps[3], "invoice", `demo-inv-${loc}`, { status: "overdue", problem: "late_invoice", amount: base * 5, days: 8 + bi, due: -(8 + bi) });
    if (bi % 3 === 0) add(loc, ps[4], "subscription", `demo-sub-${loc}`, { status: "past_due", problem: "failed_subscription", amount: base + 29, days: 4 + bi, plan: "Monthly membership" });
    // recovered (a failed payment that was paid later), refunds, and ordinary paid ones
    add(loc, ps[5], "transaction", `demo-tx-r1-${loc}`, { status: "failed", amount: base * 2, days: 12 + bi, resolvedDays: 9 + bi });
    add(loc, ps[6], "transaction", `demo-tx-r2-${loc}`, { status: "failed", amount: base + 60, days: 20, resolvedDays: 18 });
    add(loc, ps[7], "transaction", `demo-tx-refund-${loc}`, { status: "succeeded", amount: base * 3, refunded: Math.round(base * 1.5), days: 6 + bi * 2 });
    for (let k = 8; k < 12; k++) add(loc, ps[k], "transaction", `demo-tx-ok${k}-${loc}`, { status: "succeeded", amount: base + k * 12, days: 1 + k * 2 + bi });
  }
  // the agency's own clients that are late with their plan
  for (const [name, days, amount] of [["Sunrise Roofing Co", 9, 497], ["Green Leaf Landscaping", 23, 297]] as const) {
    const loc = byName.get(name), ps = loc ? perLoc.get(loc) : undefined;
    if (loc && ps?.length) add(loc, { ...ps[0], name }, "plan", `demo-plan-${loc}`, { status: "past_due", problem: "past_due_plan", amount, days, plan: name === "Sunrise Roofing Co" ? "Growth" : "Starter", src: "Agency plan" });
  }
  for (const part of chunk(items, 200)) {
    await db`insert into pm_items (installation_id, location_id, kind, item_id, status_raw, status_mapped, problem_kind, amount, amount_refunded, currency, unit_check, due_date, contact_id, contact_name, contact_email, plan_name, source_name, live_mode,
        occurred_at, first_seen, last_seen, problem_since, resolved_at, rank_score)
      select ${inst}, x.location_id, x.kind, x.item_id, x.status_raw, x.status_mapped, x.problem_kind, x.amount, x.amount_refunded, 'USD', 'assumed_major', x.due_date::date, x.contact_id, x.contact_name, x.contact_email, x.plan_name, x.source_name, true,
        x.occurred_at::timestamptz, x.occurred_at::timestamptz, now(), x.problem_since::timestamptz, x.resolved_at::timestamptz, x.rank_score
      from jsonb_to_recordset(${db.json(part as never)}) as x(location_id text, kind text, item_id text, status_raw text, status_mapped text, problem_kind text, amount numeric, amount_refunded numeric, due_date text, contact_id text, contact_name text,
        contact_email text, plan_name text, source_name text, occurred_at text, problem_since text, resolved_at text, rank_score numeric) on conflict do nothing`;
  }
  for (const part of chunk(events, 300)) {
    await db`insert into pm_events (installation_id, location_id, kind, item_id, from_status, to_status, amount, currency, occurred_at)
      select ${inst}, x.location_id, x.kind, x.item_id, x.from_status, x.to_status, x.amount, 'USD', x.occurred_at::timestamptz
      from jsonb_to_recordset(${db.json(part as never)}) as x(location_id text, kind text, item_id text, from_status text, to_status text, amount numeric, occurred_at text) on conflict do nothing`;
  }
  // Where each read stands, so the sources line says "ok" and shows when it last ran.
  const sync = locs.flatMap((l) => ["transactions", "subscriptions", "invoices"].map((resource) => ({ loc: l.location_id, resource, rows: 20 + (l.name.length % 30) })));
  await db`insert into pm_sync_state (installation_id, location_id, resource, cursor_at, last_ok_at, last_http, last_error, rows_seen)
    select ${inst}, x.loc, x.resource, now(), now(), 200, null, x.rows from jsonb_to_recordset(${db.json(sync as never)}) as x(loc text, resource text, rows int) on conflict do nothing`;
  // 60 days of totals per account (the history chart, recovered money, repeat payers)
  const days: Record<string, unknown>[] = [];
  for (const [bi, name] of bigNames.entries()) {
    const loc = byName.get(name);
    if (!loc) continue;
    for (let d = 59; d >= 0; d--) {
      const h = (d * 7 + bi * 13) % 11, failed = h < 3 ? 1 + (h % 2) : 0, rec = (d * 5 + bi) % 9 < 2 ? 1 : 0, late = (d + bi) % 13 === 0 ? 1 : 0, ref = (d * 3 + bi) % 17 === 0 ? 1 : 0;
      if (failed + rec + late + ref === 0) continue;
      days.push({ location_id: loc, day: lagosDay(now - d * DAY), failed_count: failed, failed_amount: failed * (90 + bi * 35), late_count: late, late_amount: late * (200 + bi * 40), recovered_count: rec, recovered_amount: rec * (110 + bi * 30), refund_count: ref, refund_amount: ref * (60 + bi * 15) });
    }
  }
  for (const part of chunk(days, 300)) {
    await db`insert into pm_rollup_daily (installation_id, location_id, day, currency, failed_count, failed_amount, late_count, late_amount, recovered_count, recovered_amount, refund_count, refund_amount, tz)
      select ${inst}, x.location_id, x.day::date, 'USD', x.failed_count, x.failed_amount, x.late_count, x.late_amount, x.recovered_count, x.recovered_amount, x.refund_count, x.refund_amount, 'Africa/Lagos'
      from jsonb_to_recordset(${db.json(part as never)}) as x(location_id text, day text, failed_count int, failed_amount numeric, late_count int, late_amount numeric, recovered_count int, recovered_amount numeric, refund_count int, refund_amount numeric) on conflict do nothing`;
  }
  // Disputes the agency logged by hand, and what it already did about two failed payments.
  for (const [name, customer, amount, reason, opened, due, status] of [
    ["Blue Door Realty", "Walker Property Group", 2400, "Service not received", 5, 4, "open"], ["Metro Auto Repair", "Jensen Fleet Services", 880, "Duplicate charge", 12, -2, "evidence_sent"],
    ["Bright Smile Dental", "Marcus Reid", 350, "Fraud claim", 40, -18, "won"],
  ] as const) {
    const loc = byName.get(name);
    if (loc) await db`insert into pm_disputes (installation_id, location_id, customer, amount, currency, reason, opened_on, evidence_due_on, status, created_by_name) values (${inst}, ${loc}, ${customer}, ${amount}, 'USD', ${reason}, ${lagosDay(now - opened * DAY)}::date, ${lagosDay(now + due * DAY)}::date, ${status}, 'Demo Admin')`;
  }
  const noted = items.filter((i) => i.problem_kind === "failed_payment").slice(0, 2);
  for (const i of noted) await db`insert into pm_notes (installation_id, location_id, kind, item_id, action, note, by_name, at) values (${inst}, ${i.location_id as string}, ${i.kind as string}, ${i.item_id as string}, 'contacted', 'Texted the customer a card update link.', 'Dana Brooks', ${at(1)})`;
}

/** The plans that are paid up (one row per paying client account, monthly price), so "what clients pay each month" has something to add up. Added once. */
export async function planItems(inst: string): Promise<void> {
  const db = sql();
  const [have] = await db`select count(*)::int n from pm_items where installation_id = ${inst} and item_id like 'demo-plan-ok-%'`;
  if (Number(have?.n) > 0) return;
  const locs = (await db`select location_id, name from locations where installation_id = ${inst} and not ignored`) as unknown as Loc[];
  const rows: Array<Record<string, unknown>> = [];
  for (const l of locs) {
    const p = PLANS[l.name];
    if (!p || !(p.status === "active" || p.status === "trialing")) continue;
    rows.push({ loc: l.location_id, id: `demo-plan-ok-${l.location_id}`, amount: p.interval === "year" ? Math.round((p.price / 12) * 100) / 100 : p.price, plan: p.plan, at: new Date(Date.now() - p.sinceDays * DAY).toISOString() });
  }
  if (!rows.length) return;
  await db`insert into pm_items (installation_id, location_id, kind, item_id, status_raw, status_mapped, problem_kind, amount, amount_refunded, currency, unit_check, contact_name, plan_name, source_name, live_mode, occurred_at, first_seen, last_seen, rank_score)
    select ${inst}, x.loc, 'plan', x.id, 'active', 'active', null, x.amount, 0, 'USD', 'assumed_major', x.loc, x.plan, 'Agency plan', true, x.at::timestamptz, x.at::timestamptz, now(), 0
    from jsonb_to_recordset(${db.json(rows as never)}) as x(loc text, id text, amount numeric, plan text, at text) on conflict do nothing`;
}
