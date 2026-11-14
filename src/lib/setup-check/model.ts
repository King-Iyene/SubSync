// Account setup: pure rules, no network and no database, so every sentence and status is unit tested (docs/METRICS.md, "Account setup").
// The reads (read.ts) turn the platform's answers into COUNTS before they get here: no names, no text, no phone numbers (only the last four digits).

export type Status = "set_up" | "attention" | "permission" | "unavailable" | "empty" | "error";

/** One read of the platform, already reduced to counts. */
export type Read<T> = { state: "ok"; value: T } | { state: "permission" } | { state: "unavailable" } | { state: "error" };

export type Capped = { count: number; capped: boolean };
export type Reads = {
  pipelines: Read<{ pipelines: number; stages: number; thin: number }>;
  objects: Read<{ objects: number }>;
  /** Null when there are no custom objects to count records in. */
  records: Read<Capped> | null;
  customValues: Read<Capped>;
  templates: Read<Capped>;
  tasks: Read<{ open: number; overdue: number; capped: boolean }>;
  files: Read<Capped>;
  emailBuilder: Read<Capped>;
  emailSchedule: Read<Capped>;
  numbers: Read<Capped & { last4: string[] }>;
  pools: Read<{ pools: number; numbers: number }>;
  resources: Read<{ rooms: number; equipment: number }>;
  /** Our own DNS check of the sending domains (read from SubSync's own table), or null when none was run. */
  domains: { total: number; passing: number; attention: number } | null;
};

export type Group = "Sales" | "Content" | "Tasks" | "Email" | "Phone" | "Calendar" | "Account";
export type Row = {
  id: string; group: Group; label: string;
  /** What SubSync uses the permission for, in plain words (shown so a reviewer or an owner can see why it is asked). */
  why: string;
  status: Status;
  count: number | null;
  /** The count as shown ("500+" when the read stopped at its limit). */
  countText: string | null;
  detail: string | null;
  /** One plain line: what to do next. */
  next: string;
  /** Phone numbers only: the last four digits, never the whole number. */
  samples?: string[];
};

export const STATUS_WORDS: Record<Status, string> = {
  set_up: "Set up", attention: "Needs attention", permission: "Needs permission: reconnect", unavailable: "Not available from the platform yet", empty: "Nothing here yet", error: "Could not read just now",
};

/** The scope each read uses. Names come from the platform's published API description (docs/features/ACCOUNT_SETUP.md). */
export const SCOPE_OF = {
  pipelines: "opportunities.readonly", objects: "objects/schema.readonly", records: "objects/record.readonly", customValues: "locations/customValues.readonly", templates: "locations/templates.readonly",
  tasks: "locations/tasks.readonly", files: "medias.readonly", emailBuilder: "emails/builder.readonly", emailSchedule: "emails/schedule.readonly", numbers: "phonenumbers.read", pools: "numberpools.read", resources: "calendars/resources.readonly",
} as const;

/** What a refusal or a missing answer means. A permission the install never granted is "needs permission"; a refusal despite the permission is the platform's own limit. */
export function classifyStatus(status: number, scopeGranted: boolean | null): "ok" | "permission" | "unavailable" | "error" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return scopeGranted === true ? "unavailable" : "permission";
  if (status === 404 || status === 405 || status === 410 || status === 422) return "unavailable";
  return "error";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const countText = (c: Capped) => (c.capped ? `${c.count.toLocaleString("en-US")}+` : c.count.toLocaleString("en-US"));
export const lastFour = (v: unknown): string | null => {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

type Spec = { id: string; group: Group; label: string; why: string };
// A read that did not give a number becomes a row with the right words. Returns null when the read is ok.
function notOk(spec: Spec, r: Read<unknown>, next: { permission?: string; error?: string } = {}): Row | null {
  if (r.state === "ok") return null;
  const base = { ...spec, count: null, countText: null, detail: null };
  if (r.state === "permission") return { ...base, status: "permission", next: next.permission ?? "Reconnect SubSync from your CRM and accept the permission when it asks." };
  if (r.state === "unavailable") return { ...base, status: "unavailable", next: "Nothing to do. SubSync shows it as soon as the platform allows it." };
  return { ...base, status: "error", next: next.error ?? "Press Check again in a minute." };
}

function counted(spec: Spec, r: Read<Capped>, o: { noun: string; none: string; nextNone: string; nextOk?: string; plural?: string }): Row {
  const bad = notOk(spec, r);
  if (bad) return bad;
  const c = (r as { value: Capped }).value;
  if (c.count === 0) return { ...spec, status: "empty", count: 0, countText: "0", detail: o.none, next: o.nextNone };
  return { ...spec, status: "set_up", count: c.count, countText: countText(c), detail: `${countText(c)} ${c.count === 1 && !c.capped ? o.noun : o.plural ?? `${o.noun}s`} found.`, next: o.nextOk ?? "Nothing to do." };
}

const S = {
  pipelines: { id: "pipelines", group: "Sales", label: "Pipelines and stages", why: "Shows how many pipelines and stages the account has, so we can tell when a deal has nowhere to move to." },
  objects: { id: "objects", group: "Sales", label: "Custom objects and records", why: "Counts the extra record types the account made (for example Properties or Vehicles) and the records in them." },
  notes: { id: "notes", group: "Content", label: "Notes", why: "SubSync never reads or keeps note text." },
  customValues: { id: "customValues", group: "Content", label: "Custom values", why: "Counts the saved values (for example your business hours or booking link) the account's templates can use." },
  templates: { id: "templates", group: "Content", label: "Text and email templates", why: "Counts saved templates, to see whether follow-ups can be sent quickly." },
  files: { id: "files", group: "Content", label: "Files", why: "Counts the files in the account's file storage. SubSync never opens a file." },
  tasks: { id: "tasks", group: "Tasks", label: "Tasks", why: "Counts open and overdue tasks, never what they say." },
  recurring: { id: "recurring", group: "Tasks", label: "Repeating tasks", why: "Would count repeating tasks." },
  emailBuilder: { id: "emailBuilder", group: "Email", label: "Email builder designs", why: "Counts saved email designs." },
  emailSchedule: { id: "emailSchedule", group: "Email", label: "Scheduled and sent email campaigns", why: "Counts email campaigns, not who got them." },
  domainPlatform: { id: "domainPlatform", group: "Email", label: "Sending domain verification (from the platform)", why: "Would show whether the platform has verified the sending domain." },
  domainDns: { id: "domainDns", group: "Email", label: "Sending domain records (SubSync's own check)", why: "SubSync looks up the public DNS records (SPF, DKIM, DMARC) of the domains it found on the account." },
  numbers: { id: "numbers", group: "Phone", label: "Phone numbers", why: "Counts the account's phone numbers. SubSync shows only the last four digits." },
  pools: { id: "pools", group: "Phone", label: "Number pools", why: "Counts number pools and the numbers in them. SubSync shows only counts." },
  resources: { id: "resources", group: "Calendar", label: "Rooms and equipment", why: "Counts the rooms and equipment that appointments can book." },
  saas: { id: "saas", group: "Account", label: "Plan billed through your company (SaaS mode)", why: "Would show whether your company bills this account through its own plan." },
  features: { id: "features", group: "Account", label: "Features switched on in the account", why: "Would list which features the account has switched on." },
} satisfies Record<string, Spec>;

const unavailable = (spec: Spec, detail: string, next = "Nothing to do. SubSync shows it as soon as the platform allows it."): Row => ({ ...spec, status: "unavailable", count: null, countText: null, detail, next });

/** The whole checklist, in the order it is shown. */
export function buildChecklist(r: Reads): Row[] {
  const rows: Row[] = [];

  // Pipelines
  {
    const bad = notOk(S.pipelines, r.pipelines);
    if (bad) rows.push(bad);
    else {
      const v = (r.pipelines as { value: { pipelines: number; stages: number; thin: number } }).value;
      if (v.pipelines === 0) rows.push({ ...S.pipelines, status: "attention", count: 0, countText: "0", detail: "No pipelines found.", next: "Create a pipeline in your CRM so deals have a place to move through." });
      else if (v.thin > 0) rows.push({ ...S.pipelines, status: "attention", count: v.pipelines, countText: String(v.pipelines), detail: `${plural(v.pipelines, "pipeline")}, ${plural(v.stages, "stage")}. ${plural(v.thin, "pipeline")} ${v.thin === 1 ? "has" : "have"} fewer than two stages.`, next: "Add the missing stages to those pipelines, so a deal can move forward." });
      else rows.push({ ...S.pipelines, status: "set_up", count: v.pipelines, countText: String(v.pipelines), detail: `${plural(v.pipelines, "pipeline")}, ${plural(v.stages, "stage")}.`, next: "Nothing to do." });
    }
  }

  // Custom objects and their records
  {
    const bad = notOk(S.objects, r.objects);
    if (bad) rows.push(bad);
    else {
      const n = (r.objects as { value: { objects: number } }).value.objects;
      if (n === 0) rows.push({ ...S.objects, status: "empty", count: 0, countText: "0", detail: "No custom objects.", next: "Nothing to do unless you need to track more than contacts and deals." });
      else {
        let records = "Record counts are not read yet.";
        if (r.records?.state === "ok") records = `${countText(r.records.value)} ${r.records.value.count === 1 && !r.records.value.capped ? "record" : "records"} in total.`;
        else if (r.records?.state === "permission") records = "Record counts: Needs permission: reconnect.";
        else if (r.records?.state === "unavailable") records = "Record counts: Not available from the platform yet.";
        else if (r.records?.state === "error") records = "Record counts could not be read just now.";
        rows.push({ ...S.objects, status: "set_up", count: n, countText: String(n), detail: `${plural(n, "custom object")}. ${records}`, next: r.records?.state === "permission" ? "Reconnect SubSync and accept the permission to count the records." : "Nothing to do." });
      }
    }
  }

  rows.push(unavailable(S.notes, "The platform can list notes one contact at a time, not across a whole account, so SubSync does not count them.", "Nothing to do. Open a contact in your CRM to see its notes."));
  rows.push(counted(S.customValues, r.customValues, { noun: "custom value", none: "No custom values.", nextNone: "Nothing to do unless your templates should use saved values such as your business hours." }));
  rows.push(counted(S.templates, r.templates, { noun: "template", none: "No saved templates.", nextNone: "Save a text or email template in your CRM so follow-ups are quick to send." }));
  rows.push(counted(S.files, r.files, { noun: "file", none: "No files in storage.", nextNone: "Nothing to do unless you plan to send files or images." }));

  // Tasks
  {
    const bad = notOk(S.tasks, r.tasks);
    if (bad) rows.push(bad);
    else {
      const t = (r.tasks as { value: { open: number; overdue: number; capped: boolean } }).value;
      const plus = t.capped ? "+" : "";
      if (t.open === 0) rows.push({ ...S.tasks, status: "empty", count: 0, countText: "0", detail: "No open tasks.", next: "Nothing to do." });
      else if (t.overdue > 0) rows.push({ ...S.tasks, status: "attention", count: t.open, countText: `${t.open.toLocaleString("en-US")}${plus}`, detail: `${t.open.toLocaleString("en-US")}${plus} open, ${t.overdue.toLocaleString("en-US")}${plus} overdue.`, next: "Open the overdue tasks in your CRM and finish them or move their due date." });
      else rows.push({ ...S.tasks, status: "set_up", count: t.open, countText: `${t.open.toLocaleString("en-US")}${plus}`, detail: `${t.open.toLocaleString("en-US")}${plus} open, none overdue.`, next: "Nothing to do." });
    }
  }
  rows.push(unavailable(S.recurring, "The platform has no way to list repeating tasks, only to make or change one by its id.", "Nothing to do. Repeating tasks are managed in your CRM."));

  rows.push(counted(S.emailBuilder, r.emailBuilder, { noun: "design", none: "No saved email designs.", nextNone: "Nothing to do unless you send designed emails." }));
  rows.push(counted(S.emailSchedule, r.emailSchedule, { noun: "campaign", none: "No email campaigns.", nextNone: "Nothing to do unless you send email campaigns." }));
  rows.push(unavailable(S.domainPlatform, "The platform only checks one email address at a time, not the sending domain, so SubSync cannot read its verification.", "Open the email settings in your CRM to see the domain status. SubSync's own check is the next row."));
  {
    const d = r.domains;
    if (!d || d.total === 0) rows.push({ ...S.domainDns, status: "empty", count: 0, countText: "0", detail: "No sending domain has been checked yet.", next: "Open Email sender health and check the domain." });
    else if (d.attention > 0) rows.push({ ...S.domainDns, status: "attention", count: d.total, countText: String(d.total), detail: `${plural(d.total, "domain")} checked: ${d.passing} passing, ${d.attention} need${d.attention === 1 ? "s" : ""} attention.`, next: "Open Email sender health to see which records to fix." });
    else rows.push({ ...S.domainDns, status: "set_up", count: d.total, countText: String(d.total), detail: `${plural(d.total, "domain")} checked, all passing.`, next: "Nothing to do." });
  }

  // Phone
  {
    const bad = notOk(S.numbers, r.numbers);
    if (bad) rows.push(bad);
    else {
      const v = (r.numbers as { value: Capped & { last4: string[] } }).value;
      if (v.count === 0) rows.push({ ...S.numbers, status: "empty", count: 0, countText: "0", detail: "No phone numbers.", next: "Add a phone number in your CRM if this account should text or call leads." });
      else rows.push({ ...S.numbers, status: "set_up", count: v.count, countText: countText(v), detail: `${countText(v)} ${v.count === 1 && !v.capped ? "number" : "numbers"} found. Only the last four digits are shown.`, next: "Nothing to do.", samples: v.last4.slice(0, 5).map((d) => `ending ${d}`) });
    }
  }
  {
    const bad = notOk(S.pools, r.pools);
    if (bad) rows.push(bad);
    else {
      const v = (r.pools as { value: { pools: number; numbers: number } }).value;
      if (v.pools === 0) rows.push({ ...S.pools, status: "empty", count: 0, countText: "0", detail: "No number pools.", next: "Nothing to do unless you rotate several numbers for outbound texts." });
      else rows.push({ ...S.pools, status: "set_up", count: v.pools, countText: String(v.pools), detail: `${plural(v.pools, "pool")} holding ${plural(v.numbers, "number")}.`, next: "Nothing to do." });
    }
  }

  // Calendar
  {
    const bad = notOk(S.resources, r.resources);
    if (bad) rows.push(bad);
    else {
      const v = (r.resources as { value: { rooms: number; equipment: number } }).value;
      const total = v.rooms + v.equipment;
      if (total === 0) rows.push({ ...S.resources, status: "empty", count: 0, countText: "0", detail: "No rooms or equipment.", next: "Nothing to do unless appointments need a room or a piece of equipment." });
      else rows.push({ ...S.resources, status: "set_up", count: total, countText: String(total), detail: `${plural(v.rooms, "room")}, ${v.equipment.toLocaleString("en-US")} equipment.`, next: "Nothing to do." });
    }
  }

  rows.push(unavailable(S.saas, "The platform gives this only to your company's own login, not to the account's connection, so SubSync cannot read it."));
  rows.push(unavailable(S.features, "The platform has no list of the features an account has switched on.", "Nothing to do. Open the account's settings in your CRM to see its features."));
  return rows;
}

export type Summary = { total: number; setUp: number; attention: number; permission: number; unavailable: number; empty: number; error: number };
export function summarize(rows: Row[]): Summary {
  const s: Summary = { total: rows.length, setUp: 0, attention: 0, permission: 0, unavailable: 0, empty: 0, error: 0 };
  for (const r of rows) {
    if (r.status === "set_up") s.setUp++;
    else if (r.status === "attention") s.attention++;
    else if (r.status === "permission") s.permission++;
    else if (r.status === "unavailable") s.unavailable++;
    else if (r.status === "empty") s.empty++;
    else s.error++;
  }
  return s;
}

/** The one line at the top: what needs doing first. */
export function headline(s: Summary): string {
  if (s.attention > 0) return `${plural(s.attention, "thing")} to fix. Start with the first row marked Needs attention.`;
  if (s.permission > 0) return `${plural(s.permission, "check")} need${s.permission === 1 ? "s" : ""} a permission. Reconnect SubSync from your CRM and accept it.`;
  if (s.error > 0) return "Some checks could not be read just now. Press Check again in a minute.";
  return "Nothing needs fixing in this account.";
}

export type SetupCheckResult = { rows: Row[]; summary: Summary; headline: string; checkedAt: string; cached: boolean; problem: string | null };
export function finish(reads: Reads, now: number, cached = false, problem: string | null = null): SetupCheckResult {
  const rows = buildChecklist(reads);
  const summary = summarize(rows);
  return { rows, summary, headline: headline(summary), checkedAt: new Date(now).toISOString(), cached, problem };
}
