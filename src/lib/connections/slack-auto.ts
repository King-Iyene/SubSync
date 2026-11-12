import type { Destination } from "../notifications/slack.ts";

// Automatic Slack routing (Automation pass). Plain rules, no AI. Pure: given the connected channels and one message, who gets it. Rules:
//  - agency-wide messages (cross-account digest, breach and save-account alerts, the morning brief) go ONLY to company channels (locationId null);
//  - a client's own alert goes to that client's own channel, plus the company channel if there is one; never to another client's channel;
//  - a meeting-added notice goes to the person's own channel only (a personal destination), never a shared one;
//  - "pause all", a per-account mute and quiet hours stop a post (a critical alert may bypass quiet hours when the person allows it).

export type Scope = "agency" | "account" | "person";
export type Msg = { scope: Scope; locationId: string | null; ownerUserId?: string | null; critical?: boolean };
export type Dest = Destination & { ownerUserId?: string | null };
export type Prefs = { pauseAll: boolean; mutedLocations: readonly string[]; quietOn: boolean; quietStart: number; quietEnd: number; criticalBypass: boolean };

export const DEFAULT_PREFS: Prefs = { pauseAll: false, mutedLocations: [], quietOn: true, quietStart: 21, quietEnd: 7, criticalBypass: true };

export const inQuiet = (hour: number, p: Pick<Prefs, "quietStart" | "quietEnd">): boolean =>
  p.quietStart === p.quietEnd ? false : p.quietStart < p.quietEnd ? hour >= p.quietStart && hour < p.quietEnd : hour >= p.quietStart || hour < p.quietEnd;

export type Verdict = { send: boolean; why: "ok" | "paused" | "muted" | "quiet" };

export function mayPost(m: Msg, p: Prefs, hour: number): Verdict {
  if (p.pauseAll) return { send: false, why: "paused" };
  if (m.locationId && p.mutedLocations.includes(m.locationId)) return { send: false, why: "muted" };
  if (p.quietOn && inQuiet(hour, p) && !(m.critical && p.criticalBypass)) return { send: false, why: "quiet" };
  return { send: true, why: "ok" };
}

export function routeTo(all: readonly Dest[], m: Msg): Dest[] {
  const live = all.filter((d) => d.status === "connected");
  if (m.scope === "agency") return live.filter((d) => d.locationId === null && !d.ownerUserId);
  if (m.scope === "person") return live.filter((d) => !!m.ownerUserId && d.ownerUserId === m.ownerUserId);
  if (!m.locationId) return [];
  return live.filter((d) => !d.ownerUserId && (d.locationId === null || d.locationId === m.locationId));
}

/** Default channel names to create or pick on connect. One agency channel; one per client account only when that client connects its own Slack. */
export const AGENCY_CHANNEL = "subsync-agency";
export const clientChannel = (name: string) => "subsync-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** What is subscribed with no setup once a channel connects. */
export function autoSubscriptions(d: Pick<Dest, "locationId" | "ownerUserId">): string[] {
  if (d.ownerUserId) return ["meeting_added", "meeting_needs_matching"];
  if (d.locationId === null) return ["daily_brief", "weekly_summary", "speed_breach", "silent_failure", "other_alerts"];
  return ["speed_breach", "unmarked_appointments", "silent_failure", "other_alerts"];
}

export const meetingSlackText = (added: boolean, name: string | null, title: string | null) =>
  added ? `Meeting with ${name ?? "a contact"} was added to their contact.` : `The meeting "${title ?? "Untitled"}" is waiting for you to pick the contact.`;
