// The ONE place that decides whether SubSync may do something outward (DRY-RUN MODE, docs/OVERNIGHT_RULES.md section 3).
//
// Four switches, all read from environment variables, all OFF unless the variable is exactly "true". Nothing in this file is a secret: the
// names are committed and so are the defaults (off). With a switch off, `outward` builds the whole request, writes one "WOULD ..." line
// (ids and field names only: never a token, a message, a note or a summary) to the audit table and the log, and sends NOTHING. With it on,
// it runs the real call. No other file may decide dry-run for itself: code that wants to send an email, post to Slack, write to the CRM or
// create or delete a meeting-tool subscription goes through `outward`.

export const LIVE_FLAGS = ["SEND_EMAIL_LIVE", "SEND_SLACK_LIVE", "WRITE_GHL_LIVE", "FATHOM_WEBHOOK_LIVE"] as const;
export type LiveFlag = (typeof LIVE_FLAGS)[number];

type Env = Record<string, string | undefined>;

/** True only when the variable is exactly "true". Missing, empty, "1", "yes" and "TRUE" all mean off, so a typo can never switch anything on. */
export const isLive = (flag: LiveFlag, env: Env = process.env): boolean => env[flag] === "true";

export const liveFlags = (env: Env = process.env): Record<LiveFlag, boolean> =>
  Object.fromEntries(LIVE_FLAGS.map((f) => [f, isLive(f, env)])) as Record<LiveFlag, boolean>;

export type Verb = "SEND" | "WRITE" | "CREATE" | "DELETE";

/** What would happen, described with ids and field names only. */
export type OutwardAction = {
  flag: LiveFlag;
  verb: Verb;
  /** A short machine name such as "crm.note.create" or "fathom.webhook.delete". Never user text. */
  what: string;
  /** Ids only (contact id, location id, meeting id, connection id). A value that does not look like an id is replaced, so text can never be logged by mistake. */
  ids?: Record<string, string | number | null | undefined>;
  /** Names of the fields that would be written (never their values). */
  fields?: string[];
  /** The installation the line is recorded against. Without one the line goes to the log only. */
  installationId?: string | null;
};

const ID = /^[A-Za-z0-9_:.-]{1,80}$/;
const FIELD = /^[A-Za-z0-9_.-]{1,60}$/;

/** The only thing that is ever written down about a dry-run: what, to which ids, which field names. */
export function describeDryRun(a: OutwardAction): { action: string; detail: Record<string, unknown> } {
  const ids: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.ids ?? {})) {
    if (!FIELD.test(k) || v === null || v === undefined) continue;
    const s = String(v);
    ids[k] = ID.test(s) ? s : "[not an id]";
  }
  const fields = (a.fields ?? []).filter((f) => FIELD.test(f)).slice(0, 40);
  return {
    action: a.verb === "SEND" ? "dry_run.would_send" : "dry_run.would_write",
    detail: { what: FIELD.test(a.what) ? a.what : "unknown", verb: a.verb, flag: a.flag, ids, fields },
  };
}

export type Deps = {
  env?: Env;
  /** Writes the audit row. The default writes to audit_log through the database. Tests pass a recorder. */
  audit?: (row: { installationId: string; action: string; detail: Record<string, unknown> }) => Promise<void>;
  log?: (...args: unknown[]) => void;
};

export type Outcome<T> = { live: true; result: T } | { live: false; dryRun: true; line: string };

async function defaultAudit(row: { installationId: string; action: string; detail: Record<string, unknown> }): Promise<void> {
  const { sql } = await import("./db");
  const db = sql();
  await db`insert into audit_log (installation_id, actor, action, detail) values (${row.installationId}, null, ${row.action}, ${db.json(row.detail as never)})`;
}

/**
 * Run `send` only when the switch for this action is on. Otherwise record the dry-run line and return without calling `send`.
 * The line is "WOULD WRITE crm.note.create contactId=... locationId=... fields=body" and nothing else.
 */
export async function outward<T>(action: OutwardAction, send: () => Promise<T>, deps: Deps = {}): Promise<Outcome<T>> {
  if (isLive(action.flag, deps.env ?? process.env)) return { live: true, result: await send() };
  const d = describeDryRun(action);
  const idText = Object.entries(d.detail.ids as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(" ");
  const fieldText = (d.detail.fields as string[]).length ? ` fields=${(d.detail.fields as string[]).join(",")}` : "";
  const line = `WOULD ${action.verb === "SEND" ? "SEND" : "WRITE"} ${action.what}${idText ? " " + idText : ""}${fieldText}`;
  (deps.log ?? console.log)(line);
  if (action.installationId) {
    try {
      await (deps.audit ?? defaultAudit)({ installationId: action.installationId, action: d.action, detail: d.detail });
    } catch {
      // The record is best effort: a failed audit write must never turn a dry run into an error for the person.
    }
  }
  return { live: false, dryRun: true, line };
}
