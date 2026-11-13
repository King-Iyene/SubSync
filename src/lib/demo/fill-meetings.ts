import { sql } from "../db";
import { DAY, TEAM, TEAM_NAMES } from "./fill-core";

// Demo fill, part 4: Meeting notes. A connected Fathom for the demo owner and for three teammates, and their recent calls: tied to a contact and an appointment with a summary and action items,
// saved on the contact, and some waiting in the person's private inbox because no contact could be matched for certain. Fictional calls (summaries are invented, no transcript is stored).
// Only the demo installation. Added once (the marker is the demo's own Fathom connection).

const DEMO_OWNER = "demo-user";
const SUMMARIES = [
  ["Walked through the quote and the install dates. They want the earlier slot and asked for a payment plan.", ["Send the revised quote by Friday", "Hold the earlier install slot for 48 hours", "Check if a 3 part payment plan is allowed"]],
  ["First call. Lead came from a Facebook ad. Interested, but comparing two other companies.", ["Send before and after photos", "Call back Tuesday after they talk to their partner"]],
  ["Follow-up on the proposal. Happy with the price, worried about timing over the holidays.", ["Confirm the holiday schedule in writing", "Book the start date"]],
  ["Discovery call. Their last provider never answered leads fast. Speed to lead is their main worry.", ["Share the reply-time report", "Set up the missed call text back", "Schedule a review in two weeks"]],
  ["Quick check-in after the first month. Bookings are up, they want more weekend slots.", ["Open Saturday slots on the calendar", "Send the monthly report"]],
  ["Customer asked to reschedule and to bring a family member. Agreed on Thursday morning.", ["Move the appointment to Thursday 10am", "Send a reminder the day before"]],
] as const;

type Appt = { location_id: string; appointment_id: string; start_at: Date; status: string; assigned_to: string | null; contact_id: string; email: string; name: string; account: string };

export async function fillMeetings(inst: string): Promise<void> {
  // One transaction, so a failure leaves nothing half written (the marker below would then hide the missing calls).
  await sql().begin((tx) => fill(tx as unknown as ReturnType<typeof sql>, inst));
}

async function fill(db: ReturnType<typeof sql>, inst: string): Promise<void> {
  const [have] = await db`select count(*)::int n from user_connections where installation_id = ${inst} and company_key = 'demo-agency'`;
  if (Number(have?.n) > 0) return;
  const now = Date.now();
  const at = (days: number) => new Date(now - days * DAY);

  // Who is connected: the demo owner and the three people on the team (each connection belongs to its person; nobody sees another's calls).
  const people = [
    { id: DEMO_OWNER, name: "Demo Admin", role: "agency_owner", email: "owner@brightpath-demo.example.com", saved: 9, skipped: 2 },
    ...TEAM.slice(0, 3).map((id, i) => ({ id, name: TEAM_NAMES[id].name, role: i === 2 ? "agency_admin" : "agency_staff", email: TEAM_NAMES[id].email, saved: 6 + i * 3, skipped: i })),
  ];
  const conn = new Map<string, string>();
  for (const p of people) {
    const [c] = await db`
      insert into user_connections (installation_id, company_key, ghl_user_id, person_name, person_role, provider, provider_account_email, status, last_ok_at, last_event_at, saved_count, skipped_count)
      values (${inst}, 'demo-agency', ${p.id}, ${p.name}, ${p.role}, 'fathom', ${p.email}, 'connected', ${at(0.01)}, ${at(0.2)}, ${p.saved}, ${p.skipped}) returning id`;
    conn.set(p.id, c.id as string);
  }

  // Appointments that were held, with a contact that has an email: the calls the matched ones belong to.
  const appts = (await db`
    select a.location_id, a.appointment_id, a.start_at, a.status, a.assigned_to, a.contact_id, c.email, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) name, l.name account
    from cached_appointments a join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
      join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id
    where a.installation_id = ${inst} and a.status in ('showed', 'noshow') and a.start_at < now() - interval '2 hours' and c.email is not null and c.email !~ 'mailinator|-at-example' and not l.ignored
    order by a.start_at desc limit 80`) as unknown as Appt[];
  const used = new Set<string>();
  const pick = (count: number, owner: string | null) => {
    const out = appts.filter((a) => !used.has(a.appointment_id) && (owner === null || (a.assigned_to ?? TEAM[0]) === owner)).slice(0, count);
    out.forEach((a) => used.add(a.appointment_id));
    return out;
  };

  let n = 0;
  const addMatched = async (owner: string, a: Appt, i: number, status: "saved" | "dry_run") => {
    n++;
    const [s, items] = SUMMARIES[(n + i) % SUMMARIES.length];
    const [m] = await db`
      insert into meetings (installation_id, owner_ghl_user_id, connection_id, provider, provider_meeting_id, started_at, title, attendee_emails, summary, action_items, recording_url, status, reason, created_at, duration_minutes, talk_pct, matched_location_id, matched_contact_id, matched_at)
      values (${inst}, ${owner}, ${conn.get(owner) ?? null}, 'fathom', ${"demo-m-" + n}, ${new Date(a.start_at.getTime() + 60_000)}, ${`${a.account}: ${a.name}`}, ${db.json([a.email, "owner@brightpath-demo.example.com"] as never)}, ${s}, ${db.json([...items] as never)},
        ${"https://fathom.video/calls/demo" + n}, ${status}, null, ${a.start_at}, ${22 + ((n * 7) % 31)}, ${38 + ((n * 5) % 25)}, ${a.location_id}, ${a.contact_id}, ${new Date(a.start_at.getTime() + 20 * 60_000)}) returning id`;
    await db`insert into appointment_meeting_links (installation_id, location_id, appointment_id, meeting_id, owner_ghl_user_id, matched_by, suggested_outcome, outcome_confirmed_at, created_at)
      values (${inst}, ${a.location_id}, ${a.appointment_id}, ${m.id}, ${owner}, 'auto', ${a.status}, ${n % 3 === 0 ? null : new Date(a.start_at.getTime() + 3_600_000)}, now()) on conflict do nothing`;
    if (status === "saved") await db`insert into crm_writes (installation_id, meeting_id, location_id, contact_id, kind, ghl_id, authored_by, created_at) values (${inst}, ${m.id}, ${a.location_id}, ${a.contact_id}, 'note', ${"demo-note-" + n}, ${owner}, ${new Date(a.start_at.getTime() + 25 * 60_000)})`.catch(() => undefined);
  };
  // The demo owner: nine calls saved on the contact, one matched but not saved yet.
  for (const [i, a] of pick(10, null).entries()) await addMatched(DEMO_OWNER, a, i, i === 9 ? "dry_run" : "saved");
  // The three teammates: a handful each (the coaching view reads counts and averages only).
  for (const owner of TEAM.slice(0, 3)) for (const [i, a] of pick(4, owner).entries()) await addMatched(owner, a, i, "saved");
  // Waiting in the owner's private inbox: nobody matched, two records with the same email, one that works in two accounts.
  const waiting: Array<[string, string, string[], string, number]> = [
    ["Call with Jenna Cho (no contact yet)", "no_match", ["jenna.cho@cho-family.example.net"], "First call with a new lead from a flyer. Not in the contacts yet.", 1],
    ["Walk-in estimate: M. Alvarez", "no_match", ["m.alvarez@alvarez-build.example.net"], "Quoted a kitchen refit. Wants to think about it.", 2],
    ["Call with Sam Ortiz", "duplicate_contact", ["sam.ortiz@ortiz-co.example.net"], "Two contact records share this email, so SubSync did not guess.", 3],
    ["Intro call: Brandt Realty", "cross_account", ["office@brandt-realty.example.net"], "The same email is a contact in two client accounts, so SubSync did not guess.", 4],
    ["Team sync with the sales team", "no_external_attendee", ["dana@brightpath-demo.example.com"], "Internal call, no client on it.", 5],
  ];
  for (const [i, [title, reason, emails, summary, days]] of waiting.entries()) {
    n++;
    await db`
      insert into meetings (installation_id, owner_ghl_user_id, connection_id, provider, provider_meeting_id, started_at, title, attendee_emails, summary, action_items, recording_url, status, reason, expires_at, created_at, duration_minutes, talk_pct)
      values (${inst}, ${DEMO_OWNER}, ${conn.get(DEMO_OWNER) ?? null}, 'fathom', ${"demo-m-" + n}, ${at(days)}, ${title}, ${db.json(emails as never)}, ${summary}, ${db.json([...SUMMARIES[i % SUMMARIES.length][1]].slice(0, 2) as never)}, ${"https://fathom.video/calls/demo" + n},
        'needs_contact', ${reason}, ${new Date(now + (14 - days) * DAY)}, ${at(days)}, ${25 + i * 6}, ${44 + i * 3})`;
  }
}
