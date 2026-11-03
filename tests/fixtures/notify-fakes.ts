// Fakes for the notification tests: an in-memory ledger that behaves like the database one (unique per installation, dedupe key, channel and place),
// transports that record what they are asked to send, and builders for contexts and preferences. No database, no network, no clock but the one passed in.

import { CATALOG, NOTIFICATION_TYPES, type NotificationType } from "../../src/lib/notifications/catalog.ts";
import type { Mail } from "../../src/lib/notifications/compose.ts";
import { localDate } from "../../src/lib/notifications/timing.ts";
import { defaultPref, type DestinationRef, type Legacy, type Pref } from "../../src/lib/notifications/prefs.ts";
import type { Destination } from "../../src/lib/notifications/slack.ts";
import type { Channel, Context, Ledger, NewRow, Patch, Row, SendResult, Transports } from "../../src/lib/notifications/dispatcher.ts";

export class FakeLedger implements Ledger {
  rows: Row[] = [];
  sentAt = new Map<string, number>();
  openAlerts = new Set<string>();
  private n = 0;

  async insert(row: NewRow, now: number): Promise<Row | null> {
    if (this.rows.some((r) => r.installationId === row.installationId && r.dedupeKey === row.dedupeKey && r.channel === row.channel && r.target === row.target)) return null;
    const made: Row = { ...row, reason: row.reason ?? null, id: `row-${++this.n}`, attempts: 0, nextAttemptAt: null, createdAt: now };
    this.rows.push(made);
    if (row.alertId) this.openAlerts.add(row.alertId);
    return made;
  }
  async due(installationId: string, now: number, limit: number): Promise<Row[]> {
    return this.rows.filter((r) => r.installationId === installationId && (r.status === "held" || r.status === "pending") && (r.nextAttemptAt === null || r.nextAttemptAt <= now)).slice(0, limit);
  }
  async update(id: string, p: Patch): Promise<void> {
    const r = this.rows.find((x) => x.id === id)!;
    r.status = p.status;
    if (p.reason !== undefined) r.reason = p.reason;
    if (p.attempts !== undefined) r.attempts = p.attempts;
    if (p.nextAttemptAt !== undefined) r.nextAttemptAt = p.nextAttemptAt;
    if (p.sentAt) this.sentAt.set(id, p.sentAt);
  }
  async lastSentDate(installationId: string, type: NotificationType, channel: Channel, target: string, zone: string): Promise<string | null> {
    const times = this.rows.filter((r) => r.installationId === installationId && r.type === type && r.channel === channel && r.target === target && (r.status === "sent" || r.status === "dry_run")).map((r) => this.sentAt.get(r.id) ?? 0);
    if (times.length === 0) return null;
    return localDate(new Date(Math.max(...times)), zone);
  }
  async alertOpen(alertId: string): Promise<boolean> {
    return this.openAlerts.has(alertId);
  }
  byStatus(status: Row["status"]) { return this.rows.filter((r) => r.status === status); }
}

export type Sent = { channel: Channel; target: string; subject?: string; text?: string; rows: Row[] };

export class FakeTransports implements Transports {
  sent: Sent[] = [];
  /** Results to hand out in order per channel; when empty the channel succeeds. A function decides per call. */
  script: Partial<Record<Channel, Array<SendResult | (() => SendResult)>>> = {};
  calls = 0;
  private next(channel: Channel): SendResult {
    this.calls++;
    const s = this.script[channel]?.shift();
    return typeof s === "function" ? s() : s ?? { ok: true };
  }
  async inApp(row: Row): Promise<SendResult> {
    const r = this.next("in_app");
    if (r.ok) this.sent.push({ channel: "in_app", target: row.target, rows: [row] });
    return r;
  }
  async email(to: string, mail: Mail, rows: Row[]): Promise<SendResult> {
    const r = this.next("email");
    if (r.ok && !r.dryRun) this.sent.push({ channel: "email", target: to, subject: mail.subject, text: mail.text, rows });
    return r;
  }
  async slack(d: Destination, text: string, rows: Row[]): Promise<SendResult> {
    const r = this.next("slack");
    if (r.ok && !r.dryRun) this.sent.push({ channel: "slack", target: d.id, text, rows });
    return r;
  }
  to(channel: Channel, target?: string) { return this.sent.filter((s) => s.channel === channel && (target === undefined || s.target === target)); }
}

export const LEGACY: Legacy = { slackConfigured: false, digestEnabled: false, digestEmail: null, digestHour: null, digestTimezone: null, alertQuietHours: true };

export type Overrides = Partial<Record<NotificationType, Omit<Partial<Pref>, "timing"> & { timing?: Partial<Pref["timing"]> }>>;

/** A context where every kind has its default preference, with some changed. `legacy` and `destinations` feed the defaults like the real loader does. */
export function makeContext(o: { destinations?: Destination[]; legacy?: Partial<Legacy>; overrides?: Overrides; mode?: "agency" | "business"; zone?: string | null; onFail?: (id: string, code: string) => void } = {}): Context {
  const legacy = { ...LEGACY, ...(o.legacy ?? {}) };
  const dests = o.destinations ?? [];
  const refs: DestinationRef[] = dests.filter((d) => d.status === "connected").map((d) => ({ id: d.id, locationId: d.locationId }));
  const prefs = Object.fromEntries(NOTIFICATION_TYPES.map((t) => {
    const base = defaultPref(t, legacy, refs);
    const ov = o.overrides?.[t] ?? {};
    return [t, { ...base, ...ov, timing: { ...base.timing, ...(ov.timing ?? {}) } }];
  })) as Record<NotificationType, Pref>;
  return {
    installationId: "inst-1", mode: o.mode ?? "agency", company: "Acme Agency", appUrl: "https://app.example.test", fallbackZone: o.zone === undefined ? "UTC" : o.zone,
    pref: (t) => prefs[t], destinations: dests, stopUrl: (email) => `https://app.example.test/api/email/unsubscribe?t=tok-${email}`,
    onDestinationFailed: async (id, code) => { o.onFail?.(id, code); },
  };
}

export const slackDest = (id: string, locationId: string | null = null, status = "connected"): Destination => ({ id, label: `#${id}`, locationId, status, pendingSince: null });

export const T = (iso: string) => Date.parse(iso);
export { CATALOG };
