// What a company chose for each kind of message (N79): where it goes, when, to whom, in which words. Pure: it reads the stored JSON defensively, falls
// back to defaults for anything missing or invalid, and checks every change before it is saved. Defaults are built from the settings people already
// have (the Slack channel, the daily-brief switch and time, the email address, quiet hours), so alerts work with zero setup and nothing changes on the
// day this ships for a company that already set those up.

import { validEmail } from "../analytics/weekly-email.ts";
import { CATALOG, NOTIFICATION_TYPES, isNotificationType, type Frequency, type NotificationType } from "./catalog.ts";
import { checkTemplate } from "./copy.ts";
import { DEFAULT_QUIET, isHour, isWeekday, validZone, type Timing } from "./timing.ts";

export const MAX_RECIPIENTS = 10;
export const MAX_DESTINATIONS = 10;
/** The id of the Slack channel set up before destinations existed (the saved webhook in the settings). It is a destination like any other. */
export const LEGACY_DESTINATION = "legacy";

export type Pref = {
  type: NotificationType;
  enabled: boolean;
  inApp: boolean;
  email: boolean;
  recipients: string[];
  slackDestinations: string[];
  timing: Timing;
  /** The person's own wording, or null for the default. */
  copy: { title: string | null; body: string | null };
};

/** What the older settings already say. */
export type Legacy = { slackConfigured: boolean; digestEnabled: boolean; digestEmail: string | null; digestHour: number | null; digestTimezone: string | null; alertQuietHours: boolean };
/** The Slack channels that are connected, and which of them are company-wide (usable for a message about no one account). */
export type DestinationRef = { id: string; locationId: string | null };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function defaultPref(type: NotificationType, legacy: Legacy, destinations: DestinationRef[]): Pref {
  const info = CATALOG[type];
  const recipients = legacy.digestEmail && validEmail(legacy.digestEmail) ? [legacy.digestEmail.toLowerCase()] : [];
  // Slack goes where it already went: every connected channel (a channel for one account only ever receives that account's messages), else the older saved one.
  const dests = destinations.length ? destinations.map((d) => d.id) : legacy.slackConfigured ? [LEGACY_DESTINATION] : [];
  const slackWanted = type === "daily_brief" ? legacy.digestEnabled : info.defaults.slack;
  return {
    type, enabled: info.active,
    inApp: info.defaults.inApp,
    email: info.defaults.email && recipients.length > 0,
    recipients,
    slackDestinations: slackWanted ? dests : [],
    timing: {
      frequency: info.defaultFrequency, hour: isHour(legacy.digestHour) ? legacy.digestHour : 8, weekday: "Mon", timezone: validZone(legacy.digestTimezone) ? legacy.digestTimezone : null,
      quietOn: legacy.alertQuietHours, quietStart: DEFAULT_QUIET.start, quietEnd: DEFAULT_QUIET.end, criticalBypass: true,
    },
    copy: { title: null, body: null },
  };
}

export type Stored = { enabled?: unknown; channels?: unknown; recipients?: unknown; timing?: unknown; copy?: unknown } | null | undefined;

/** The preference in force: what was saved, over the defaults. A saved piece that is damaged or no longer valid is ignored, never used. */
export function resolvePref(type: NotificationType, stored: Stored, legacy: Legacy, destinations: DestinationRef[]): Pref {
  const base = defaultPref(type, legacy, destinations);
  if (!stored) return base;
  const info = CATALOG[type];
  const ch = rec(stored.channels);
  const t = rec(stored.timing);
  const c = rec(stored.copy);
  const frequency = (info.frequencies as string[]).includes(t.frequency as string) ? (t.frequency as Frequency) : base.timing.frequency;
  return {
    type,
    enabled: info.active && typeof stored.enabled === "boolean" ? stored.enabled : base.enabled,
    inApp: typeof ch.inApp === "boolean" ? ch.inApp : base.inApp,
    email: typeof ch.email === "boolean" ? ch.email : base.email,
    recipients: Array.isArray(stored.recipients) ? [...new Set(strings(stored.recipients).filter(validEmail).map((e) => e.toLowerCase()))].slice(0, MAX_RECIPIENTS) : base.recipients,
    slackDestinations: Array.isArray(ch.slackDestinations) ? [...new Set(strings(ch.slackDestinations))].slice(0, MAX_DESTINATIONS) : base.slackDestinations,
    timing: {
      frequency,
      hour: isHour(t.hour) ? t.hour : base.timing.hour,
      weekday: isWeekday(t.weekday) ? t.weekday : base.timing.weekday,
      timezone: t.timezone === null ? null : validZone(t.timezone) ? t.timezone : base.timing.timezone,
      quietOn: typeof t.quietOn === "boolean" ? t.quietOn : base.timing.quietOn,
      quietStart: isHour(t.quietStart) ? t.quietStart : base.timing.quietStart,
      quietEnd: isHour(t.quietEnd) ? t.quietEnd : base.timing.quietEnd,
      criticalBypass: typeof t.criticalBypass === "boolean" ? t.criticalBypass : base.timing.criticalBypass,
    },
    copy: {
      title: typeof c.title === "string" && c.title.trim() && checkTemplate(type, "title", c.title).ok ? c.title : null,
      body: typeof c.body === "string" && checkTemplate(type, "body", c.body).ok ? c.body : null,
    },
  };
}

export type Update = {
  enabled?: boolean; inApp?: boolean; email?: boolean; recipients?: string[]; slackDestinations?: string[];
  timing?: Partial<Timing>;
};
export type Parsed = { ok: true; update: Update } | { ok: false; error: string };

/** Check a change from the screen. Only known fields are read; anything wrong is refused with a sentence the person can act on. */
export function parseUpdate(type: NotificationType, body: unknown, knownDestinations: ReadonlySet<string>): Parsed {
  const info = CATALOG[type];
  if (!info.active) return { ok: false, error: `${info.label} is not available yet, so it cannot be changed.` };
  const b = rec(body);
  const out: Update = {};
  if ("enabled" in b) { if (typeof b.enabled !== "boolean") return { ok: false, error: "Say whether this is on or off." }; out.enabled = b.enabled; }
  if ("inApp" in b) { if (typeof b.inApp !== "boolean") return { ok: false, error: "Say whether the in-app bell is on or off." }; out.inApp = b.inApp; }
  if ("email" in b) { if (typeof b.email !== "boolean") return { ok: false, error: "Say whether email is on or off." }; out.email = b.email; }
  if ("recipients" in b) {
    if (!Array.isArray(b.recipients) || b.recipients.some((x) => typeof x !== "string")) return { ok: false, error: "Recipients must be a list of email addresses." };
    const list = [...new Set((b.recipients as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const bad = list.find((e) => !validEmail(e));
    if (bad) return { ok: false, error: `"${bad.slice(0, 60)}" is not an email address.` };
    if (list.length > MAX_RECIPIENTS) return { ok: false, error: `Up to ${MAX_RECIPIENTS} email addresses.` };
    out.recipients = list;
  }
  if ("slackDestinations" in b) {
    if (!Array.isArray(b.slackDestinations) || b.slackDestinations.some((x) => typeof x !== "string")) return { ok: false, error: "Pick Slack channels from the list." };
    const ids = [...new Set(b.slackDestinations as string[])];
    if (ids.length > MAX_DESTINATIONS) return { ok: false, error: `Up to ${MAX_DESTINATIONS} Slack channels.` };
    if (ids.some((id) => !knownDestinations.has(id))) return { ok: false, error: "That Slack channel is not connected. Connect it first." };
    out.slackDestinations = ids;
  }
  const t = rec(b.timing);
  if (b.timing !== undefined) {
    const timing: Partial<Timing> = {};
    if ("frequency" in t) {
      if (!(info.frequencies as string[]).includes(t.frequency as string)) return { ok: false, error: `${info.label} can be sent: ${info.frequencies.map((f) => (f === "immediate" ? "as it happens" : f === "daily" ? "once a day" : "once a week")).join(" or ")}.` };
      timing.frequency = t.frequency as Frequency;
    }
    if ("hour" in t) { if (!isHour(t.hour)) return { ok: false, error: "The hour must be a whole number from 0 to 23." }; timing.hour = t.hour; }
    if ("weekday" in t) { if (!isWeekday(t.weekday)) return { ok: false, error: "Pick a day of the week." }; timing.weekday = t.weekday; }
    if ("timezone" in t) {
      if (t.timezone !== null && !validZone(t.timezone)) return { ok: false, error: `"${String(t.timezone).slice(0, 40)}" is not a time zone. Use a name like Africa/Lagos, or press Use mine.` };
      timing.timezone = t.timezone as string | null;
    }
    if ("quietOn" in t) { if (typeof t.quietOn !== "boolean") return { ok: false, error: "Say whether quiet hours are on or off." }; timing.quietOn = t.quietOn; }
    if ("quietStart" in t) { if (!isHour(t.quietStart)) return { ok: false, error: "Quiet hours start at a whole hour from 0 to 23." }; timing.quietStart = t.quietStart; }
    if ("quietEnd" in t) { if (!isHour(t.quietEnd)) return { ok: false, error: "Quiet hours end at a whole hour from 0 to 23." }; timing.quietEnd = t.quietEnd; }
    if ("criticalBypass" in t) { if (typeof t.criticalBypass !== "boolean") return { ok: false, error: "Say whether critical alerts skip quiet hours." }; timing.criticalBypass = t.criticalBypass; }
    out.timing = timing;
  }
  return { ok: true, update: out };
}

/** The new stored form of a preference after a change. */
export function applyUpdate(current: Pref, u: Update): Pref {
  return {
    ...current,
    enabled: u.enabled ?? current.enabled,
    inApp: u.inApp ?? current.inApp,
    email: u.email ?? current.email,
    recipients: u.recipients ?? current.recipients,
    slackDestinations: u.slackDestinations ?? current.slackDestinations,
    timing: { ...current.timing, ...(u.timing ?? {}) },
  };
}

/** The JSON columns a preference is saved as. */
export const toStored = (p: Pref) => ({
  enabled: p.enabled,
  channels: { inApp: p.inApp, email: p.email, slackDestinations: p.slackDestinations },
  recipients: p.recipients,
  timing: p.timing,
  copy: p.copy,
});

export const allTypes = (): NotificationType[] => [...NOTIFICATION_TYPES];
export { isNotificationType };
