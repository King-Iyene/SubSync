import { sql } from "../db";

// Duplicate contacts in the DEMO company (stage DUP), so the review screen looks like an agency that has years of messy data: exact copies, the same phone
// written differently, the same email in capitals, a Do Not Disturb contact with an open deal and a different owner, a copy with a conversation and a tag,
// and a group of three where one copy has a won deal. Added once per client account (the marker is the contact id "<account>-dm1"), built from fixed
// offsets only (no random numbers) so nothing else in the demo moves, and written with inserts that cannot fail on a second run. Only the demo
// installation ever reaches this function. It writes made-up rows in SubSync's own copy of the demo; it never touches a real CRM.

const ACCOUNTS = ["Bright Smile Dental", "Harbor Law Group", "Blue Door Realty", "Metro Auto Repair", "Pure Glow Med Spa", "Sunrise Roofing Co", "Peak Fitness Studio", "Green Leaf Landscaping"];
const DAY = 86_400_000;

type Src = { contact_id: string; first_name: string | null; last_name: string | null; email: string; phone: string; tags: string[] | null; source: string | null; assigned_to: string | null };

const pretty = (phone: string) => { const d = phone.replace(/\D/g, "").slice(-10); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };

export async function ensureDupesDemo(installationId: string): Promise<void> {
  const db = sql();
  const now = Date.now();
  const at = (days: number) => new Date(now - days * DAY);
  const locs = await db`select location_id, name from locations where installation_id = ${installationId} and name = any(${ACCOUNTS}::text[]) and not ignored`;
  for (const loc of locs) {
    const locationId = loc.location_id as string;
    const [done] = await db`select 1 x from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${locationId + "-dm1"}`;
    if (done) continue;
    const src = (await db`
      select contact_id, first_name, last_name, email, phone, tags, source, assigned_to from cached_contacts
      where installation_id = ${installationId} and location_id = ${locationId} and email is not null and phone is not null and contact_id ~ '-c[0-9]+$'
      order by substring(contact_id from '[0-9]+$')::int desc limit 6`) as unknown as Src[];
    if (src.length < 6) continue;
    const base = (s: Src, id: string, days: number, o: Record<string, unknown> = {}) => ({
      installation_id: installationId, location_id: locationId, contact_id: `${locationId}-${id}`, first_name: s.first_name, last_name: s.last_name, email: s.email, phone: s.phone,
      tags: s.tags ?? [], date_added: at(days), last_activity_at: null, updated_remote_at: at(days), source: s.source, dnd: false, birth_date: null, assigned_to: s.assigned_to, ...o,
    });
    const initial = (n: string | null) => (n ? `${n.slice(0, 1)}.` : n);
    const contacts = [
      base(src[0], "dm1", 6),                                                                                      // an exact copy
      base(src[1], "dm2", 9, { first_name: initial(src[1].first_name), email: null, phone: pretty(src[1].phone) }), // the same phone, written differently, no email
      base(src[2], "dm3", 4, { email: src[2].email.toUpperCase(), phone: null }),                                   // the same email in capitals
      base(src[3], "dm4", 3, { dnd: true, assigned_to: "user-9b2e", last_activity_at: at(1) }),                      // Do Not Disturb, another owner, an open deal
      base(src[4], "dm5", 2, { tags: [...(src[4].tags ?? []), "web lead"], last_activity_at: at(0.5) }),            // a conversation and a tag
      base(src[5], "dm6", 5, { last_activity_at: at(8) }),                                                          // two copies, one with a won deal
      base(src[5], "dm7", 7),
    ];
    await db`insert into cached_contacts ${db(contacts as never)} on conflict do nothing`;

    const name = (s: Src) => `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
    const deal = (id: string, contactId: string, s: Src, status: string, value: number, days: number) => ({
      installation_id: installationId, location_id: locationId, opportunity_id: `${locationId}-${id}`, pipeline_id: `pipe-${locationId}`, stage_id: "s2", contact_id: contactId, contact_name: name(s),
      name: status === "won" ? "Annual contract" : "Consultation", monetary_value: value, status, last_stage_change_at: at(days), last_action_at: at(days), last_status_change_at: at(days),
      created_remote_at: at(days + 20), updated_remote_at: at(days), assigned_to: s.assigned_to, source: s.source,
    });
    await db`insert into cached_opportunities ${db([
      deal("dmo1", `${locationId}-dm4`, src[3], "open", 2400, 4),
      deal("dmo2", `${locationId}-dm6`, src[5], "won", 3800, 30),
      deal("dmo3", src[5].contact_id, src[5], "won", 1200, 60),
    ] as never)} on conflict do nothing`;
    await db`insert into cached_conversations ${db([{
      installation_id: installationId, location_id: locationId, conversation_id: `${locationId}-dmconv1`, contact_id: `${locationId}-dm5`, contact_name: name(src[4]),
      last_message_type: "TYPE_SMS", last_message_direction: "inbound", last_message_at: at(0.5), unread_count: 1, synced_at: new Date(),
    }] as never)} on conflict do nothing`;
    await db`insert into contact_tag_events (installation_id, location_id, contact_id, tag, kind, at) values (${installationId}, ${locationId}, ${locationId + "-dm5"}, 'web lead', 'added', ${at(2)})`;
  }
  await ensureQualityDemo(installationId, locs.map((l) => l.location_id as string));
}

// Clean-up demo data (stage CLEANUP): the kinds of mess the data-quality tab and the matching rules exist for, so the screens look like an agency with years of messy data. Added once per
// client account (the marker is the contact id "<account>-dq1"), fixed values only, inserts that cannot fail on a second run. Demo installation only; made-up people, never a real CRM.
async function ensureQualityDemo(installationId: string, locationIds: string[]): Promise<void> {
  const db = sql();
  const now = Date.now();
  const at = (days: number) => new Date(now - days * DAY);
  for (const locationId of locationIds) {
    const [done] = await db`select 1 x from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${locationId + "-dq1"}`;
    if (done) continue;
    const row = (id: string, first: string | null, last: string | null, email: string | null, phone: string | null, days: number) => ({
      installation_id: installationId, location_id: locationId, contact_id: `${locationId}-${id}`, first_name: first, last_name: last, email, phone, tags: [] as string[],
      date_added: at(days), last_activity_at: null, updated_remote_at: at(days), source: null, dnd: false, birth_date: null, assigned_to: null,
    });
    await db`insert into cached_contacts ${db([
      row("dq1", "Bob", "Hartwell", "bob.hartwell@hartwell-co.example.net", null, 12),          // a nickname pair (Loose finds it)
      row("dq2", "Robert", "Hartwell", "r.hartwell@hartwell-mail.example.net", null, 11),
      row("dq3", "Maya", "Ortiz", "maya@ortiz-studio.example.net", "+15550142030", 20),         // two digits swapped (Loose finds it)
      row("dq4", "Maya", "Ortiz", null, "+15550142003", 19),
      row("dq5", "Ann", "Lee", "ann.lee@leefamily.example.net", "+15550177001", 30),            // a shared household phone: grouped, but "could be"
      row("dq6", "Bob", "Lee", "bob.lee@leefamily.example.net", "+15550177001", 29),
      row("dq7", "Carl", "Wu", "info@wu-supplies.example.net", null, 40),                       // a shared company mailbox
      row("dq8", "Dana", "Fox", "info@wu-supplies.example.net", null, 39),
      row("dq9", "test", "user", "test@example.com", "0000000000", 50),                         // junk
      row("dq10", "Eve", "Stone", "not-an-email", "(555) 010-2030", 45),                        // an email that cannot work, a phone not in international format
      row("dq11", "Frank", "Diaz", "frank.diaz@gmial.com", "+15550188010", 44),                 // a typo in the email domain
      row("dq12", "GRACE", "HOPPER", "grace.h@hopper-labs.example.net", "+15550188011", 43),    // a name in capitals
      row("dq13", "Ivy", "Chen", "ivy.chen@mailinator.com", "123", 42),                         // a throwaway address and a number that is too short
      row("dq14", null, null, null, null, 41),                                                  // an empty contact
    ] as never)} on conflict do nothing`;
  }
}
