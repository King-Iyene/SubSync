import { refreshInsights } from "../analytics/service";
import { currentVersion } from "../analytics/definitions";
import { sql } from "../db";
import { applyLeadRules } from "../sync/lead-rules-apply";
import { checkDomain, type DnsResolver } from "../dns/email-auth";

// Demo data: a fictional agency with 14 client accounts of deliberately different health, so
// every feature has something realistic to show. All names, emails and numbers are invented
// (example.com addresses and 555 phone numbers). Never mixed with real data: it lives under its
// own installation (company id "demo-agency") and the app only serves it when DEMO_MODE=true.

export const DEMO_COMPANY_ID = "demo-agency";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The new fields are derived from the loop counters (never from r()) so adding them does not change
// any of the existing random demo numbers.
// What each fictional client does, typed the way an agency would type it.
const INDUSTRY: Record<string, string> = {
  "Blue Door Realty": "Real estate", "Bright Smile Dental": "Dental", "Green Leaf Landscaping": "Landscaping", "Harbor Law Group": "Law firm",
  "Metro Auto Repair": "Auto repair", "Northside Chiropractic": "Chiropractic", "Oak & Ember Bistro": "Restaurant", "Paws & Claws Vet": "Veterinary clinic",
  "Peak Fitness Studio": "Fitness studio", "Pure Glow Med Spa": "Med spa", "Starlight Cleaning": "Cleaning", "Summit HVAC Services": "HVAC", "Sunrise Roofing Co": "Roofing",
};
const SOURCES = ["Facebook Ads", "Google Search", "Referral", "Website form", "Facebook Ads", "Walk-in", "Google Search"];
const TEAM = ["user-4a1c", "user-9b2e", "user-c3d7", "user-e5f0"];
const FIRST = ["Ava", "Liam", "Noah", "Emma", "Olivia", "Mason", "Sophia", "Lucas", "Mia", "Ethan", "Isabella", "Logan", "Amelia", "James", "Harper", "Henry", "Evelyn", "Jack", "Ella", "Owen", "Grace", "Leo", "Chloe", "Ryan", "Zoe", "Dylan", "Nora", "Aaron", "Lily", "Caleb"];
const LAST = ["Walker", "Hughes", "Patel", "Nguyen", "Brooks", "Rivera", "Foster", "Bennett", "Coleman", "Reyes", "Shaw", "Hayes", "Murray", "Price", "Ward", "Cole", "Jensen", "Park", "Santos", "Reid", "Khan", "Morgan", "Fisher", "Ortiz", "Lane", "Dunn", "Webb", "Hale", "Stone", "Bell"];
const TAGS = ["lead", "customer", "vip", "newsletter", "referral", "follow-up"];
const STAGES = [
  { id: "s1", name: "New Lead" },
  { id: "s2", name: "Contacted" },
  { id: "s3", name: "Appointment Set" },
  { id: "s4", name: "Proposal Sent" },
  { id: "s5", name: "Negotiation" },
];

type Scenario = "good" | "no_dmarc" | "dmarc_none" | "no_spf" | "open_spf";
type Trend = "up" | "flat" | "down" | "dead";
type Profile = {
  name: string; slug: string; contacts: number; quality: number; activeDays: number; newPerMonth: number;
  open: number; won: number; lost: number; staleShare: number; value: [number, number];
  unread: number; unanswered: number; calendars: number; pipelines: number; trend: Trend;
  ignored?: boolean; owner?: string; domain?: Scenario; dupes?: number;
};

const PROFILES: Profile[] = [
  { name: "Bright Smile Dental", slug: "brightsmile", contacts: 540, quality: 0.92, activeDays: 0, newPerMonth: 38, open: 24, won: 41, lost: 14, staleShare: 0.1, value: [800, 4500], unread: 3, unanswered: 0, calendars: 3, pipelines: 2, trend: "up", owner: "Sam", domain: "good" },
  { name: "Peak Fitness Studio", slug: "peakfitness", contacts: 420, quality: 0.85, activeDays: 1, newPerMonth: 30, open: 18, won: 33, lost: 12, staleShare: 0.15, value: [300, 1800], unread: 2, unanswered: 0, calendars: 2, pipelines: 1, trend: "flat", owner: "Sam", domain: "good" },
  { name: "Harbor Law Group", slug: "harborlaw", contacts: 260, quality: 0.8, activeDays: 2, newPerMonth: 14, open: 16, won: 12, lost: 9, staleShare: 0.35, value: [2500, 15000], unread: 4, unanswered: 1, calendars: 2, pipelines: 1, trend: "flat", owner: "Priya", domain: "dmarc_none" },
  { name: "Sunrise Roofing Co", slug: "sunriseroofing", contacts: 380, quality: 0.7, activeDays: 16, newPerMonth: 4, open: 30, won: 28, lost: 22, staleShare: 0.62, value: [4000, 22000], unread: 0, unanswered: 0, calendars: 1, pipelines: 1, trend: "down", owner: "Priya", domain: "no_dmarc" },
  { name: "Green Leaf Landscaping", slug: "greenleaf", contacts: 310, quality: 0.65, activeDays: 21, newPerMonth: 3, open: 14, won: 10, lost: 8, staleShare: 0.45, value: [600, 5200], unread: 0, unanswered: 0, calendars: 1, pipelines: 1, trend: "down", owner: "Jordan" },
  { name: "Metro Auto Repair", slug: "metroauto", contacts: 450, quality: 0.74, activeDays: 1, newPerMonth: 26, open: 20, won: 36, lost: 15, staleShare: 0.2, value: [250, 3200], unread: 9, unanswered: 7, calendars: 2, pipelines: 1, trend: "flat", owner: "Jordan", domain: "good" },
  { name: "Blue Door Realty", slug: "bluedoor", contacts: 600, quality: 0.88, activeDays: 0, newPerMonth: 44, open: 35, won: 19, lost: 17, staleShare: 0.18, value: [5000, 45000], unread: 5, unanswered: 1, calendars: 3, pipelines: 2, trend: "up", owner: "Sam", domain: "good" },
  { name: "Oak & Ember Bistro", slug: "oakember", contacts: 190, quality: 0.35, activeDays: 12, newPerMonth: 5, open: 4, won: 3, lost: 1, staleShare: 0.5, value: [150, 900], unread: 0, unanswered: 0, calendars: 0, pipelines: 1, trend: "down", owner: "Jordan", dupes: 6, domain: "no_spf" },
  { name: "Pure Glow Med Spa", slug: "pureglow", contacts: 330, quality: 0.9, activeDays: 1, newPerMonth: 28, open: 22, won: 30, lost: 8, staleShare: 0.12, value: [400, 3800], unread: 2, unanswered: 0, calendars: 3, pipelines: 2, trend: "up", owner: "Priya", domain: "good" },
  { name: "Summit HVAC Services", slug: "summithvac", contacts: 280, quality: 0.6, activeDays: 71, newPerMonth: 0, open: 11, won: 9, lost: 6, staleShare: 1, value: [1200, 9000], unread: 0, unanswered: 0, calendars: 1, pipelines: 1, trend: "dead", owner: "Sam" },
  { name: "Paws & Claws Vet", slug: "pawsclaws", contacts: 360, quality: 0.82, activeDays: 2, newPerMonth: 18, open: 9, won: 21, lost: 5, staleShare: 0.22, value: [120, 1400], unread: 3, unanswered: 1, calendars: 2, pipelines: 1, trend: "flat", owner: "Priya", dupes: 4, domain: "dmarc_none" },
  { name: "Northside Chiropractic", slug: "northside", contacts: 24, quality: 0.5, activeDays: 9, newPerMonth: 6, open: 3, won: 0, lost: 0, staleShare: 0, value: [200, 800], unread: 0, unanswered: 0, calendars: 0, pipelines: 0, trend: "up", owner: "Jordan" },
  { name: "Starlight Cleaning", slug: "starlight", contacts: 150, quality: 0.55, activeDays: 38, newPerMonth: 2, open: 6, won: 7, lost: 6, staleShare: 0.83, value: [90, 700], unread: 0, unanswered: 0, calendars: 1, pipelines: 1, trend: "dead", owner: "Sam", domain: "open_spf" },
  { name: "Template Account (Test)", slug: "template", contacts: 12, quality: 0.3, activeDays: 120, newPerMonth: 0, open: 0, won: 0, lost: 0, staleShare: 0, value: [0, 0], unread: 0, unanswered: 0, calendars: 0, pipelines: 0, trend: "dead", ignored: true },
];

function scenarioResolver(s: Scenario): DnsResolver {
  const apex: Record<Scenario, string[]> = {
    good: ["v=spf1 include:mailgun.org -all"],
    no_dmarc: ["v=spf1 include:mailgun.org ~all"],
    dmarc_none: ["v=spf1 include:mailgun.org -all"],
    no_spf: [],
    open_spf: ["v=spf1 +all"],
  };
  const dmarc: Record<Scenario, string[] | null> = {
    good: ["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"],
    no_dmarc: null,
    dmarc_none: ["v=DMARC1; p=none; rua=mailto:dmarc@example.com"],
    no_spf: null,
    open_spf: ["v=DMARC1; p=quarantine"],
  };
  return {
    async txt(name) {
      if (name.startsWith("_dmarc.")) {
        const d = dmarc[s];
        if (!d) throw new Error("ENODATA");
        return d;
      }
      if (name.includes("._domainkey.")) {
        if (s === "no_spf" || s === "no_dmarc") throw new Error("ENODATA");
        if (name.startsWith("mta.")) return ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3"];
        throw new Error("ENODATA");
      }
      return apex[s];
    },
    async mx() {
      return [{ exchange: "mx.example.com", priority: 10 }];
    },
  };
}

// Used by the demo installation so "re-check" never touches the network.
export async function demoDomainReport(domain: string) {
  let h = 0;
  for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const scenarios: Scenario[] = ["good", "no_dmarc", "dmarc_none", "no_spf", "open_spf"];
  return checkDomain(domain, scenarioResolver(scenarios[h % scenarios.length]));
}

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const DAY = 86_400_000;

export async function seedDemo(): Promise<{ installationId: string; accounts: number; contacts: number }> {
  const db = sql();
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY);

  await db`delete from installations where company_id = ${DEMO_COMPANY_ID}`;
  const [inst] = await db`
    insert into installations (company_id, company_name, plan, is_demo, installed_at)
    values (${DEMO_COMPANY_ID}, 'Demo Company', 'paid', true, ${ago(90)}) returning id`;
  const installationId = inst.id as string;
  await db`insert into settings (installation_id) values (${installationId})`;
  // So the "Data sync" card shows a recent completed sync instead of "never".
  await db`
    insert into sync_jobs (installation_id, type, status, started_at, finished_at)
    values (${installationId}, 'locations', 'done', ${ago(0.01)}, ${ago(0.008)})`;

  // An account with fresh unread inbound messages is, by definition, active today.
  const profiles = PROFILES.map((p) => (p.unread > 0 ? { ...p, activeDays: 0 } : p));

  let totalContacts = 0;
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const r = rng(1000 + i * 77);
    const locationId = `demo-loc-${i + 1}`;
    const domain = `${p.slug}-demo.com`;

    await db`
      insert into locations (installation_id, location_id, name, email, phone, website, timezone, address, ignored, owner,
        calendar_count, pipeline_count, installed_at, structure_synced_at, contacts_synced_at, opportunities_synced_at, conversations_synced_at, last_synced_at)
      values (${installationId}, ${locationId}, ${p.name}, ${"info@" + domain}, ${"+1555" + String(2000000 + i * 1111).slice(0, 7)},
        ${"https://" + domain}, 'America/New_York', 'Austin, TX, US', ${p.ignored ?? false}, ${p.owner ?? null},
        ${p.calendars}, ${p.pipelines}, ${ago(60)}, ${ago(0)}, ${ago(0)}, ${ago(0)}, ${ago(0)}, ${ago(0)})`;

    if (p.pipelines > 0) {
      await db`
        insert into pipelines (installation_id, location_id, pipeline_id, name, stages)
        values (${installationId}, ${locationId}, ${`pipe-${locationId}`}, 'Sales Pipeline', ${db.json(STAGES)})`;
    }

    // contacts
    const newCount = p.activeDays < 30 ? Math.round(p.newPerMonth * (1 - p.activeDays / 30)) : 0;
    const contacts: Record<string, unknown>[] = [];
    for (let j = 0; j < p.contacts; j++) {
      const first = FIRST[Math.floor(r() * FIRST.length)];
      const last = LAST[Math.floor(r() * LAST.length)];
      const isNew = j < newCount;
      const addedDaysAgo = j === newCount ? p.activeDays : isNew ? p.activeDays + r() * Math.max(1, 29 - p.activeDays) : p.activeDays + 30 + Math.pow(r(), 1.4) * 420;
      const added = ago(addedDaysAgo);
      const active = r() < 0.55;
      const lastActivityDays = active ? Math.max(p.activeDays, addedDaysAgo - r() * addedDaysAgo * 0.6) : null;
      const hasEmail = r() < p.quality;
      const hasPhone = r() < p.quality * 0.95;
      contacts.push({
        installation_id: installationId,
        location_id: locationId,
        contact_id: `${locationId}-c${j + 1}`,
        first_name: first,
        last_name: last,
        // A few deliberately bad values so the data quality view has something real to show.
        email: hasEmail ? (j % 61 === 7 ? `${first}${j}-at-example` : j % 83 === 11 ? `temp${j}@mailinator.com` : `${first}.${last}${j}@example.com`.toLowerCase()) : null,
        phone: hasPhone ? (j % 97 === 5 ? "12345" : `+1555${String(1000000 + Math.floor(r() * 8999999))}`) : null,
        tags: r() < p.quality * 0.8 ? [TAGS[Math.floor(r() * TAGS.length)]] : [],
        date_added: added,
        last_activity_at: lastActivityDays !== null ? ago(lastActivityDays) : null,
        updated_remote_at: added,
        source: SOURCES[(j * 5 + (j % 3)) % SOURCES.length],
        dnd: j % 29 === 3,
        birth_date: j % 5 === 0 ? `19${70 + (j % 30)}-${String(1 + (j % 12)).padStart(2, "0")}-${String(1 + ((j * 3) % 28)).padStart(2, "0")}` : null,
        assigned_to: TEAM[j % TEAM.length],
      });
    }
    // deliberate duplicates (same email within the account)
    for (let d = 0; d < (p.dupes ?? 0); d++) {
      const src = contacts[10 + d] as Record<string, unknown> | undefined;
      if (src?.email) {
        contacts.push({ ...src, contact_id: `${locationId}-dup${d + 1}`, first_name: String(src.first_name), date_added: ago(5 + d) });
      }
    }
    for (const part of chunk(contacts, 500)) await db`insert into cached_contacts ${db(part as never)}`;
    totalContacts += contacts.length;

    // opportunities
    const opps: Record<string, unknown>[] = [];
    const mk = (status: string, k: number, lastChangeDays: number) => {
      const [lo, hi] = p.value;
      opps.push({
        installation_id: installationId, location_id: locationId, opportunity_id: `${locationId}-o${status}${k}`,
        pipeline_id: `pipe-${locationId}`, stage_id: STAGES[Math.floor(r() * STAGES.length)].id,
        contact_id: `${locationId}-c${1 + Math.floor(r() * Math.max(1, p.contacts))}`,
        contact_name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
        name: `${["Consultation", "Install", "Service plan", "Annual contract", "Package"][Math.floor(r() * 5)]} #${k + 1}`,
        // Messy on purpose (runbook test data kit): about one open deal in seven has no value.
        monetary_value: status === "open" && k % 7 === 6 ? 0 : Math.round(lo + r() * (hi - lo)), status,
        last_stage_change_at: ago(lastChangeDays), last_action_at: ago(lastChangeDays), last_status_change_at: ago(lastChangeDays),
        created_remote_at: ago(lastChangeDays + 20 + r() * 60), updated_remote_at: ago(lastChangeDays),
        assigned_to: k % 5 === 4 ? null : TEAM[k % TEAM.length], source: SOURCES[k % SOURCES.length],
      });
    };
    if (p.pipelines > 0) {
      for (let k = 0; k < p.open; k++) {
        const stale = r() < p.staleShare;
        mk("open", k, stale ? Math.max(35, p.activeDays) + r() * 90 : Math.max(p.activeDays, r() * 25));
      }
      // Closed deals count as activity, so they are never newer than the account's last activity.
      for (let k = 0; k < p.won; k++) mk("won", k, p.activeDays + 5 + r() * 150);
      for (let k = 0; k < p.lost; k++) mk("lost", k, p.activeDays + 5 + r() * 150);
    }
    // One $1,000,000 outlier in the first account with an open pipeline, so the outlier note and the guards are always exercised.
    const firstOpen = i === profiles.findIndex((q) => q.pipelines > 0 && q.open > 2) ? opps.find((o) => o.status === "open") : undefined;
    if (firstOpen) { firstOpen.monetary_value = 1_000_000; firstOpen.assigned_to = TEAM[0]; }
    for (const part of chunk(opps, 500)) await db`insert into cached_opportunities ${db(part as never)}`;
    // a little recent movement for the activity log
    const moves = opps.slice(0, 8).map((o, i) => ({
      installation_id: installationId, location_id: locationId, opportunity_id: o.opportunity_id,
      kind: o.status === "open" ? "stage" : "status", from_value: o.status === "open" ? STAGES[0].id : "open",
      to_value: o.status === "open" ? o.stage_id : o.status, value: o.monetary_value, at: ago(1 + i * 2),
    }));
    if (moves.length) await db`insert into deal_events ${db(moves as never)}`;
    for (const [i, name] of ["Dana Brooks", "Marcus Lee", "Priya Shah"].entries()) {
      await db`insert into team_names (installation_id, user_id, name) values (${installationId}, ${TEAM[i]}, ${name}) on conflict do nothing`;
    }

    if (INDUSTRY[p.name]) {
      await db`insert into account_profiles (installation_id, location_id, industry) values (${installationId}, ${locationId}, ${INDUSTRY[p.name]}) on conflict do nothing`;
    }

    // appointments, derived from counters (never from r()) so no existing demo number moves. One account
    // is left as "needs approval" to show what an install that predates the new permission sees.
    if (i === 5 || p.ignored) {
      await db`update locations set appointments_access = 'needs_permission', users_access = 'needs_permission' where installation_id = ${installationId} and location_id = ${locationId}`;
    } else {
      const total = Math.min(60, Math.max(4, Math.round(p.contacts / 14)));
      const bias = (i * 3) % 5; // more no-shows in some accounts than others
      const now = Date.now();
      const appts: Record<string, unknown>[] = [];
      for (let k = 0; k < total; k++) {
        const startMs = now - (82 - Math.floor((k * 100) / total)) * 86_400_000 + (k % 8) * 3_600_000;
        const past = startMs < now - 3 * 3_600_000;
        let status: string;
        if (past) {
          const m = (k * 7 + i) % 20;
          status = m < 11 - bias ? "showed" : m < 16 - Math.floor(bias / 2) ? "noshow" : m < 18 ? "cancelled" : "confirmed";
        } else {
          status = k % 3 === 0 ? "new" : k % 7 === 0 ? "cancelled" : "confirmed";
        }
        appts.push({
          installation_id: installationId, location_id: locationId, appointment_id: `${locationId}-ap${k}`, calendar_id: `${locationId}-cal${k % 3}`,
          calendar_name: ["Free consultation", "Estimate visit", "Follow-up call"][k % 3], contact_id: `${locationId}-c${1 + ((k * 11) % Math.max(1, p.contacts))}`,
          title: "Appointment", status, start_at: new Date(startMs), end_at: new Date(startMs + 1_800_000), assigned_to: TEAM[k % 4], created_remote_at: new Date(startMs - 3 * 86_400_000),
        });
      }
      await db`insert into cached_appointments ${db(appts as never)}`;
      await db`update locations set appointments_access = 'ok', users_access = 'ok', appointments_synced_at = now() where installation_id = ${installationId} and location_id = ${locationId}`;
    }

    // conversations (summaries only)
    const convs: Record<string, unknown>[] = [];
    const total = p.activeDays > 30 ? 6 : 24 + Math.floor(r() * 25);
    for (let k = 0; k < total; k++) {
      const waiting = k < p.unanswered;
      const unread = !waiting && k < p.unanswered + p.unread;
      const quiet = p.activeDays > 30;
      // Nothing is newer than the account's last activity, so quiet accounts really look quiet.
      const floorHours = p.activeDays * 24;
      const hoursAgo = waiting ? Math.max(floorHours, 6) + r() * 40 : quiet ? 24 * (p.activeDays + r() * 20) : unread ? floorHours + 0.5 + r() * 3 : floorHours + 5 + r() * 24 * 20;
      // Everything else was answered (the agency spoke last); only fresh or deliberately waiting threads are inbound.
      const inbound = waiting || unread;
      convs.push({
        installation_id: installationId, location_id: locationId, conversation_id: `${locationId}-v${k + 1}`,
        contact_id: `${locationId}-c${1 + Math.floor(r() * Math.max(1, p.contacts))}`,
        contact_name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
        last_message_type: ["TYPE_SMS", "TYPE_EMAIL", "TYPE_FB", "TYPE_CALL"][Math.floor(r() * 4)],
        last_message_direction: inbound ? "inbound" : "outbound",
        last_message_at: new Date(now - hoursAgo * 3_600_000),
        unread_count: unread || (waiting && r() < 0.6) ? 1 + Math.floor(r() * 3) : 0,
      });
    }
    for (const part of chunk(convs, 500)) await db`insert into cached_conversations ${db(part as never)}`;

    // 30 days of score history shaped by the account's trend
    const current = { up: 84, flat: 70, down: 44, dead: 12 }[p.trend];
    const start = { up: 58, flat: 70, down: 82, dead: 55 }[p.trend];
    const history: Record<string, unknown>[] = [];
    // Ramp the other trend lines toward what is really stored, so charts join up with today.
    const [real] = await db`
      select
        count(*) filter (where status = 'open')::int as open_n,
        coalesce(sum(monetary_value) filter (where status = 'open'), 0)::float8 as open_v
      from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId}`;
    const [mix] = await db`
      select
        count(*)::float8 as n,
        count(*) filter (where nullif(email, '') is not null)::float8 as e,
        count(*) filter (where nullif(phone, '') is not null)::float8 as p,
        count(*) filter (where cardinality(tags) > 0)::float8 as t
      from cached_contacts where installation_id = ${installationId} and location_id = ${locationId}`;
    const realCompleteness = mix.n > 0 ? ((mix.e + mix.p + mix.t) / (3 * mix.n)) * 100 : 0;
    const valueStart = { up: 0.7, flat: 0.95, down: 1.1, dead: 1.0 }[p.trend];
    for (let d = 30; d >= 1; d--) {
      const t = (30 - d) / 29;
      const score = Math.max(0, Math.min(100, Math.round(start + (current - start) * t + (r() - 0.5) * 4)));
      history.push({
        installation_id: installationId, location_id: locationId, day: new Date(now - d * DAY).toISOString().slice(0, 10),
        contacts: Math.round(p.contacts * (0.9 + 0.1 * t)),
        // Declining accounts used to bring in far more new contacts than they do now.
        new_contacts_30d: Math.round(p.newPerMonth * (p.trend === "down" ? 6 - 5 * t : 0.6 + 0.4 * t)),
        open_opportunities: real.open_n,
        open_value: Math.round(real.open_v * (valueStart + (1 - valueStart) * t) * (1 + (r() - 0.5) * 0.04)),
        stale_opportunities: Math.round(real.open_n * p.staleShare), unread_conversations: p.unread,
        completeness_pct: Math.round(realCompleteness * (0.93 + 0.07 * t)), engagement_score: score,
        // The history is made up under today's counting rules, so it is comparable with today (definitions.ts).
        definition_version: currentVersion(0),
      });
    }
    if (history.length) await db`insert into account_metrics_daily ${db(history as never)}`;

    if (p.domain) {
      const report = await checkDomain(domain, scenarioResolver(p.domain));
      await db`
        insert into domain_checks (installation_id, location_id, domain, status, result)
        values (${installationId}, ${locationId}, ${domain}, ${report.status}, ${db.json(report as never)})`;
    }
  }

  await refreshInsights(installationId);
  return { installationId, accounts: profiles.length, contacts: totalContacts };
}

// The demo account that business and client demo sessions are limited to (the largest one).
export async function demoFirstLocation(): Promise<string> {
  const installationId = await ensureDemo();
  const [row] = await sql()`
    select l.location_id from locations l
    left join (select location_id, count(*) n from cached_contacts where installation_id = ${installationId} group by location_id) c on c.location_id = l.location_id
    where l.installation_id = ${installationId} order by coalesce(c.n, 0) desc, l.location_id limit 1`;
  return row.location_id as string;
}

// Speed-to-lead sample data, added to a demo that does not have it yet. Built from counters only (no random
// numbers), so nothing else in the demo moves. Some accounts answer in minutes, some in over an hour, a few
// leads are never answered, and one account is left as "needs permission".
async function ensureSpeedDemo(installationId: string): Promise<void> {
  const db = sql();
  const [have] = await db`select count(*)::int n from lead_touches where installation_id = ${installationId}`;
  if (have.n > 0) return;
  const locs = await db`select location_id, ignored from locations where installation_id = ${installationId} order by location_id`;
  const now = Date.now();
  const rows: Record<string, unknown>[] = [];
  let live = -1;
  for (const l of locs) {
    if (l.ignored) continue;
    live += 1;
    const i = live;
    if (i === 5) {
      await db`update locations set speed_access = 'needs_permission' where installation_id = ${installationId} and location_id = ${l.location_id}`;
      continue;
    }
    const base = [4, 18, 75][i % 3];
    for (let k = 0; k < 30; k++) {
      const leadAt = now - (25 + k * 660 + i * 37) * 60_000;
      const never = k % (6 + (i % 3)) === 0;
      const reply = (base + ((k * 5) % 23)) * 60_000;
      rows.push({
        installation_id: installationId, location_id: l.location_id, contact_id: `${l.location_id}-c${1 + k}`, conversation_id: `${l.location_id}-sp${k}`,
        lead_at: new Date(leadAt), touch_at: never ? null : new Date(leadAt + reply), touch_user_id: never ? null : TEAM[(k + i) % TEAM.length],
      });
    }
    await db`update locations set speed_access = 'ok', speed_synced_at = now() where installation_id = ${installationId} and location_id = ${l.location_id}`;
  }
  for (let i = 0; i < rows.length; i += 400) await db`insert into lead_touches ${db(rows.slice(i, i + 400) as never)}`;

  // Messy contacts on purpose (runbook test data kit): in every live account, three of the 30 leads are a spam tag, a test name
  // and a CSV import, and one is a repeat of the first contact's email. They must be left out of every speed figure.
  const live2 = locs.filter((l) => !l.ignored).map((l) => l.location_id as string);
  for (const loc of live2) {
    await db`update cached_contacts set tags = array['spam'] where installation_id = ${installationId} and location_id = ${loc} and contact_id = ${loc + "-c27"}`;
    await db`update cached_contacts set first_name = 'Test', last_name = 'Lead' where installation_id = ${installationId} and location_id = ${loc} and contact_id = ${loc + "-c28"}`;
    await db`update cached_contacts set source = 'CSV import' where installation_id = ${installationId} and location_id = ${loc} and contact_id = ${loc + "-c30"}`;
    await db`update cached_contacts d set email = f.email, date_added = f.date_added + interval '1 hour'
      from cached_contacts f where d.installation_id = ${installationId} and d.location_id = ${loc} and d.contact_id = ${loc + "-c26"}
        and f.installation_id = d.installation_id and f.location_id = d.location_id and f.contact_id = ${loc + "-c1"} and nullif(f.email, '') is not null`;
  }
  // The real estate sample: Blue Door Realty gets the sources a real estate team really sees, and its appointments are showings.
  const [blue] = await db`select location_id from locations where installation_id = ${installationId} and name = 'Blue Door Realty'`;
  if (blue) {
    await db`update cached_contacts set source = (array['Facebook Lead Form', 'Instagram Lead Ad', 'Zillow Premier Agent', 'Open House Sign-in', 'Realtor.com Lead', 'Website form', 'Facebook Lead Form'])[1 + (substring(contact_id from '[0-9]+$')::int % 7)]
      where installation_id = ${installationId} and location_id = ${blue.location_id} and contact_id ~ '-c[0-9]+$' and substring(contact_id from '[0-9]+$')::int <= 30`;
    await db`update cached_appointments set title = 'Showing' where installation_id = ${installationId} and location_id = ${blue.location_id}`;
  }
  for (const loc of live2) await applyLeadRules(installationId, loc).catch(() => undefined);
}

// Messy inbox cases on purpose (runbook test data kit), added once to the first live account: the customer wrote last on five channels
// (four are past the 4 hour target, one is still inside it), a thread nobody answered for 40 days (dead, not waiting), an automatic
// reply after the customer, and an internal note. Only the four past the target are waiting.
async function ensureInboxDemo(installationId: string): Promise<void> {
  const db = sql();
  // The sample threads are re-made on every demo load so their ages stay what their names say (2 hours stays 2 hours, not 10 hours a day later).
  await db`delete from cached_conversations where installation_id = ${installationId} and conversation_id like 'inbox-sample-%'`;
  const [loc] = await db`select location_id from locations where installation_id = ${installationId} and not ignored order by location_id limit 1`;
  if (!loc) return;
  const now = Date.now();
  const h = (hours: number) => new Date(now - hours * 3_600_000);
  const rows: Array<[string, string, string | null, Date | null, number, string]> = [
    ["inbox-sample-1", "TYPE_SMS", "inbound", h(30), 1, "Inbox sample: text, 30 hours"],
    ["inbox-sample-2", "TYPE_EMAIL", "inbound", h(6), 1, "Inbox sample: email, 6 hours"],
    ["inbox-sample-3", "TYPE_WHATSAPP", "inbound", h(2), 1, "Inbox sample: WhatsApp, 2 hours (inside the target)"],
    ["inbox-sample-4", "TYPE_FB", "inbound", h(50), 2, "Inbox sample: Facebook, 50 hours"],
    ["inbox-sample-5", "TYPE_IG", "inbound", h(5 * 24), 1, "Inbox sample: Instagram, 5 days"],
    ["inbox-sample-6", "TYPE_SMS", "inbound", h(40 * 24), 0, "Inbox sample: text, 40 days (dead)"],
    ["inbox-sample-7", "TYPE_SMS", "outbound", h(3), 0, "Inbox sample: automatic reply after the customer"],
    ["inbox-sample-8", "TYPE_INTERNAL_COMMENT", null, h(5), 0, "Inbox sample: internal note"],
  ];
  await db`insert into cached_conversations ${db(rows.map(([id, type, dir, at, unread, name]) => ({
    installation_id: installationId, location_id: loc.location_id, conversation_id: id, contact_id: `${loc.location_id}-c${rows.findIndex((r) => r[0] === id) + 1}`,
    contact_name: name, last_message_type: type, last_message_direction: dir, last_message_at: at, unread_count: unread, synced_at: new Date(),
  })) as never)}`;
}

// Messy pipeline cases on purpose (stage 'F1', N38 and N45), added once and left alone after that: counted deals in a stage named "Disqualified"
// and in a pipeline named "Legacy pipeline [Not IN USE]" (neither may count as open pipeline, stale or dead), and a cold list: about half of one
// account's contacts carry the tag "cold email outreach" and never replied. Built from counters, so no other demo number moves except what these
// deals take out of the totals. Skipped when it was already added.
async function ensureStageDemo(installationId: string): Promise<void> {
  const db = sql();
  const [metro] = await db`select location_id from locations where installation_id = ${installationId} and name = 'Metro Auto Repair'`;
  if (!metro) return;
  const [has] = await db`select 1 from pipelines where installation_id = ${installationId} and location_id = ${metro.location_id} and stages @> '[{"id":"s6"}]'::jsonb`;
  if (has) return;
  await db`update pipelines set stages = stages || '[{"id":"s6","name":"Disqualified"}]'::jsonb where installation_id = ${installationId} and location_id = ${metro.location_id}`;
  await db`update cached_opportunities set stage_id = 's6' where installation_id = ${installationId} and location_id = ${metro.location_id} and opportunity_id in (
    select opportunity_id from cached_opportunities where installation_id = ${installationId} and location_id = ${metro.location_id} and status = 'open'
      and monetary_value > 0 and assigned_to is not null order by opportunity_id limit 3)`;
  const [peak] = await db`select location_id from locations where installation_id = ${installationId} and name = 'Peak Fitness Studio'`;
  if (peak) {
    await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${installationId}, ${peak.location_id}, ${"legacy-" + peak.location_id}, 'Legacy pipeline [Not IN USE]', ${db.json([{ id: "l1", name: "Old lead" }, { id: "l2", name: "Old proposal" }] as never)}) on conflict do nothing`;
    const now = Date.now();
    const rows = [1, 2, 3].map((k) => ({
      installation_id: installationId, location_id: peak.location_id, opportunity_id: `${peak.location_id}-legacy${k}`, pipeline_id: `legacy-${peak.location_id}`, stage_id: k === 3 ? "l2" : "l1",
      contact_id: `${peak.location_id}-c${k}`, contact_name: "Legacy Contact", name: `Legacy deal #${k}`, monetary_value: 1500 * k, status: "open", assigned_to: TEAM[k % TEAM.length],
      last_stage_change_at: new Date(now - 200 * DAY), last_action_at: new Date(now - 200 * DAY), last_status_change_at: new Date(now - 200 * DAY), created_remote_at: new Date(now - 260 * DAY), updated_remote_at: new Date(now - 200 * DAY),
    }));
    await db`insert into cached_opportunities ${db(rows as never)} on conflict do nothing`;
  }
  await refreshInsights(installationId);
}

// The cold list part of the stage demo is its own idempotent step, so it is applied even to a demo whose pipelines were added earlier.
async function ensureColdDemo(installationId: string): Promise<void> {
  const db = sql();
  const [green] = await db`select location_id from locations where installation_id = ${installationId} and name = 'Green Leaf Landscaping'`;
  if (green) {
    await db`update cached_contacts set tags = array['cold email outreach'] where installation_id = ${installationId} and location_id = ${green.location_id}
      and contact_id ~ '-c[0-9]+$' and substring(contact_id from '[0-9]+$')::int >= 150 and tags is distinct from array['cold email outreach']`;
  }
}

// The demo's made-up history was written before snapshots carried a definition version. It is generated under today's counting rules by
// construction, so it is stamped with the current version (real accounts are never touched: their old rows stay "older rules" on purpose).
async function stampDemoHistory(installationId: string): Promise<void> {
  const [s] = await sql()`select deal_rules_revision from settings where installation_id = ${installationId}`;
  await sql()`update account_metrics_daily set definition_version = ${currentVersion((s?.deal_rules_revision as number | undefined) ?? 0)} where installation_id = ${installationId} and definition_version is null`;
}

// The Clients page of the demo (stage C1, KF-7): realistic fees, renewal dates, industries, a few logged conversations and an onboarding setup, so the
// screen looks like an agency that has been using it for a while instead of a page of "not set". Added once (the marker is the template named below),
// built from the account names and fixed offsets only (no random numbers), so nothing else in the demo moves, and written with plain inserts that cannot
// fail on a second run. Only the demo installation ever reaches this function. It writes only what a person types on the Clients page; no CRM data.
const DEMO_FEES: Record<string, { fee: number; renewIn: number; spoke: number | null; industry?: string; notes?: string }> = {
  "Bright Smile Dental": { fee: 2500, renewIn: 140, spoke: 3, industry: "Medical and dental", notes: "Wants a monthly recall report. Owner prefers email over calls." },
  "Peak Fitness Studio": { fee: 1800, renewIn: 75, spoke: 8, industry: "Fitness and beauty" },
  "Harbor Law Group": { fee: 3500, renewIn: 200, spoke: 5, industry: "Legal and finance", notes: "Intake form changes need sign-off from the managing partner." },
  "Sunrise Roofing Co": { fee: 2200, renewIn: 24, spoke: 21, industry: "Home services (roofing, HVAC, cleaning)", notes: "Unhappy about slow follow-up on storm leads. Renewal at risk." },
  "Green Leaf Landscaping": { fee: 1500, renewIn: 52, spoke: 17, industry: "Home services (roofing, HVAC, cleaning)" },
  "Metro Auto Repair": { fee: 1900, renewIn: 310, spoke: 6, industry: "Auto repair" },
  "Blue Door Realty": { fee: 4000, renewIn: 88, spoke: 2, industry: "Real estate", notes: "Three agents share the inbox. Wants speed-to-lead numbers per agent." },
  "Oak & Ember Bistro": { fee: 900, renewIn: -6, spoke: 40, industry: "Restaurant", notes: "Contract lapsed last week; verbal yes to renew, paperwork pending." },
  "Pure Glow Med Spa": { fee: 2800, renewIn: 165, spoke: 4, industry: "Fitness and beauty" },
  "Summit HVAC Services": { fee: 2000, renewIn: 33, spoke: null, industry: "Home services (roofing, HVAC, cleaning)", notes: "Nothing has happened in their account for two months." },
  "Paws & Claws Vet": { fee: 1600, renewIn: 120, spoke: 11, industry: "Medical and dental" },
  "Northside Chiropractic": { fee: 1200, renewIn: 340, spoke: 1, industry: "Medical and dental" },
  "Starlight Cleaning": { fee: 1100, renewIn: 61, spoke: 29, industry: "Home services (roofing, HVAC, cleaning)" },
};
// How long ago each client was added, so onboarding shows a mix: some new, one stuck, most finished long ago.
const DEMO_ADDED: Record<string, number> = { "Northside Chiropractic": 9, "Starlight Cleaning": 20, "Oak & Ember Bistro": 35, "Green Leaf Landscaping": 41, "Paws & Claws Vet": 12 };
const DEMO_LOG: Array<{ client: string; kind: "conversation" | "note" | "decision"; ago: number; by: string; body: string }> = [
  { client: "Sunrise Roofing Co", kind: "conversation", ago: 21, by: "Priya Shah", body: "Call with the owner. He is frustrated that storm leads sit for hours. Promised a reply-time report by the end of the month." },
  { client: "Sunrise Roofing Co", kind: "decision", ago: 20, by: "Priya Shah", body: "Move first reply to a text-back workflow, review again after two weeks." },
  { client: "Bright Smile Dental", kind: "conversation", ago: 3, by: "Dana Brooks", body: "Monthly check-in. Happy with bookings; asked for a recall campaign for patients not seen in six months." },
  { client: "Blue Door Realty", kind: "conversation", ago: 2, by: "Dana Brooks", body: "Walked the team through the speed-to-lead page. They want it split by agent." },
  { client: "Blue Door Realty", kind: "note", ago: 14, by: "Marcus Lee", body: "Zillow leads arrive in bursts on Mondays. Staff the inbox before 9am." },
  { client: "Harbor Law Group", kind: "conversation", ago: 5, by: "Marcus Lee", body: "Quarterly review booked for next month. Send the review pack a week before." },
  { client: "Oak & Ember Bistro", kind: "note", ago: 40, by: "Priya Shah", body: "Last real conversation was about the holiday menu campaign." },
  { client: "Peak Fitness Studio", kind: "conversation", ago: 8, by: "Dana Brooks", body: "Trial-class follow-up is working. Asked about a referral offer for members." },
];

async function ensureClientsDemo(installationId: string): Promise<void> {
  const db = sql();
  const marker = "Everyone: first 30 days";
  const [done] = await db`select 1 from onboarding_templates where installation_id = ${installationId} and name = ${marker}`;
  if (done) return;
  // Two templates: one for everyone, one for home services (the steps of that industry's playbook).
  const everyone = [{ key: "dm0brand1", label: "Collect logo, colours and photos", howto: "Ask the client for their logo files, brand colours and five good photos. You need them for every page and email." }, { key: "dm0camp02", label: "Client approves the first campaign" }, { key: "dm0check3", label: "Book the 30-day check-in call" }];
  const home = [{ key: "dm0miss04", label: "Missed-call text back is on" }, { key: "dm0estim5", label: "Estimate follow-up at 2, 5 and 10 days" }, { key: "dm0revie6", label: "Review request after every job" }];
  await db`insert into onboarding_templates (installation_id, name, industry_key, steps) values (${installationId}, ${marker}, null, ${db.json(everyone as never)}), (${installationId}, 'Home services onboarding', 'home_services', ${db.json(home as never)})`;
  const locs = await db`select location_id, name from locations where installation_id = ${installationId} and not ignored`;
  const idOf = new Map(locs.map((l) => [l.name as string, l.location_id as string]));
  const now = Date.now();
  const day = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10);
  for (const [name, d] of Object.entries(DEMO_FEES)) {
    const loc = idOf.get(name);
    if (!loc) continue;
    await db`
      insert into account_profiles (installation_id, location_id, monthly_fee, renewal_date, industry, notes, last_contacted_at)
      values (${installationId}, ${loc}, ${d.fee}, ${day(d.renewIn)}::date, ${d.industry ?? null}, ${d.notes ?? null}, ${d.spoke === null ? null : new Date(now - d.spoke * DAY)})
      on conflict (installation_id, location_id) do update set monthly_fee = coalesce(account_profiles.monthly_fee, excluded.monthly_fee),
        renewal_date = coalesce(account_profiles.renewal_date, excluded.renewal_date), industry = coalesce(account_profiles.industry, excluded.industry),
        notes = coalesce(account_profiles.notes, excluded.notes), last_contacted_at = coalesce(account_profiles.last_contacted_at, excluded.last_contacted_at), updated_at = now()`;
  }
  for (const [name, daysAgo] of Object.entries(DEMO_ADDED)) {
    const loc = idOf.get(name);
    if (loc) await db`update locations set installed_at = ${new Date(now - daysAgo * DAY)} where installation_id = ${installationId} and location_id = ${loc}`;
  }
  for (const n of DEMO_LOG) {
    const loc = idOf.get(n.client);
    if (loc) await db`insert into client_notes (installation_id, location_id, kind, body, author, occurred_on) values (${installationId}, ${loc}, ${n.kind}, ${n.body}, ${n.by}, ${day(-n.ago)}::date)`;
  }
  // Some steps are already given to someone, due or finished, with their history.
  const step = async (name: string, key: string, label: string, o: { assignee?: string; dueIn?: number; doneAgo?: number; by?: string }) => {
    const loc = idOf.get(name);
    if (!loc) return;
    const doneAt = o.doneAgo === undefined ? null : new Date(now - o.doneAgo * DAY);
    await db`insert into client_steps (installation_id, location_id, step_key, assignee, due_on, done_at, done_by) values (${installationId}, ${loc}, ${key}, ${o.assignee ?? null}, ${o.dueIn === undefined ? null : day(o.dueIn)}::date, ${doneAt}, ${doneAt ? o.by ?? o.assignee ?? null : null})
      on conflict (installation_id, location_id, step_key) do nothing`;
    if (doneAt) await db`insert into client_step_history (installation_id, location_id, step_key, step_label, event, actor, at) values (${installationId}, ${loc}, ${key}, ${label}, 'done', ${o.by ?? o.assignee ?? null}, ${doneAt})`;
    if (o.assignee) await db`insert into client_step_history (installation_id, location_id, step_key, step_label, event, detail, actor, at) values (${installationId}, ${loc}, ${key}, ${label}, 'assigned', ${o.assignee}, 'Priya Shah', ${new Date(now - (o.doneAgo ?? 3) * DAY - 3_600_000)})`;
  };
  await step("Northside Chiropractic", "tpl:dm0brand1", "Collect logo, colours and photos", { assignee: "Dana Brooks", dueIn: 3 });
  await step("Northside Chiropractic", "manual:kickoff", "Kickoff call completed", { assignee: "Marcus Lee", dueIn: -2 });
  await step("Starlight Cleaning", "tpl:dm0miss04", "Missed-call text back is on", { assignee: "Marcus Lee", dueIn: 1 });
  await step("Starlight Cleaning", "tpl:dm0estim5", "Estimate follow-up at 2, 5 and 10 days", { assignee: "Marcus Lee", doneAgo: 4 });
  await step("Oak & Ember Bistro", "tpl:dm0camp02", "Client approves the first campaign", { assignee: "Priya Shah", dueIn: -9 });
  await step("Paws & Claws Vet", "tpl:dm0check3", "Book the 30-day check-in call", { assignee: "Dana Brooks", dueIn: 14 });
  await step("Paws & Claws Vet", "tpl:dm0brand1", "Collect logo, colours and photos", { assignee: "Dana Brooks", doneAgo: 6 });
  const starlight = idOf.get("Starlight Cleaning");
  if (starlight) await db`insert into onboarding_tasks (installation_id, location_id, task, done, done_at) values (${installationId}, ${starlight}, 'manual:kickoff', true, now()) on conflict do nothing`;
}

export async function ensureDemo(): Promise<string> {
  const [row] = await sql()`select id from installations where company_id = ${DEMO_COMPANY_ID} and is_demo`;
  const id = row ? (row.id as string) : (await seedDemo()).installationId;
  await stampDemoHistory(id);
  await ensureSpeedDemo(id).catch(() => undefined);
  await ensureInboxDemo(id).catch(() => undefined);
  await ensureStageDemo(id).catch(() => undefined);
  await ensureColdDemo(id).catch(() => undefined);
  await ensureClientsDemo(id).catch(() => undefined);
  return id;
}
