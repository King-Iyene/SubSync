import { isLive } from "../live-flags.ts";
import { noteInputOf, type InboxStore, type StoredMeeting } from "./inbox.ts";
import { deliverNotes, planFor, settle, type PersonalConnection, type Writer } from "./ingest.ts";
import type { InboxReason } from "./meeting-plan.ts";

// Looking again at the calls that wait in a person's private Meeting inbox (CLAUDE.md principles 12, 13 and 14). A contact may have been created, synced or corrected since the call
// arrived, so a waiting call is planned again with exactly the rules a new call gets (planFor/planMeeting): ONE exact email on ONE contact in an account the person can open is
// certain and the note is added; anything else changes nothing. Run after a contact sync and every night. It is safe to run twice, or two at once:
//   - the call is claimed in the database first (one winner), and every part of a note is claimed too, so nothing is written twice;
//   - the notes go through the same writer (WRITE_GHL_LIVE, the account's own opt-in, the dry run) and are logged in crm_writes, so they never count as a reply, as activity or as
//     engagement (our own writes must never change our own numbers);
//   - a call that cannot be added yet still remembers who it WAS matched to ("will be added when notes are switched on"), so nothing is lost.

/** The waiting reasons a new look can change. A call the person is holding for a first-note OK, or one that is being worked on, is left alone. */
export const REMATCH_REASONS: ReadonlySet<string> = new Set<InboxReason>([
  "no_match", "duplicate_contact", "cross_account", "writes_off", "provider_not_allowed", "over_daily_cap", "needs_permission", "no_external_attendee",
]);

export type RematchResult = { checked: number; added: number; matchedWaiting: number; unchanged: number };

const DAY = 86_400_000;

export async function rematchWaiting(store: InboxStore, conn: PersonalConnection, write: Writer, options: { limit?: number } = {}): Promise<RematchResult> {
  const { person, installationId } = conn;
  const result: RematchResult = { checked: 0, added: 0, matchedWaiting: 0, unchanged: 0 };
  if (!store.claimWaiting) return result;
  const waiting = (await store.listWaiting(installationId, person.userId))
    .filter((m) => m.status === "needs_contact" && m.reason !== null && REMATCH_REASONS.has(m.reason) && m.attendeeEmails.length > 0)
    .slice(0, options.limit ?? 50);
  const live = isLive("WRITE_GHL_LIVE");
  let writtenNow = 0;

  for (const m of waiting) {
    result.checked++;
    const ctx = await planFor(conn, m.attendeeEmails, {}, store);
    const plan = ctx.plan;

    if (plan.kind === "write" && ctx.canWrite) {
      const auto = ctx.settings.autoNotes?.on === true && ctx.settings.autoNotes.acceptedAt !== null;
      const first = plan.targets[0];
      if (ctx.settings.previewConfirmedAt === null && !auto) {
        // Certain, but the first note waits for the person's OK (the same rule a new call follows): remember who, and say why it waits.
        await remember(store, m, first, "preview_needed", ctx.waitDays);
        result.matchedWaiting++;
        continue;
      }
      if (!(await store.claimWaiting(installationId, person.userId, m.id, m.reason))) { result.unchanged++; continue; }
      let finished = false;
      try {
        const { done } = await deliverNotes({
          shortNote: auto, conn, meetingId: m.id, targets: plan.targets, input: noteInputOf(m, person.name), store, write, sentToday: ctx.today.user + writtenNow,
          capFor: (loc) => ctx.policies[loc]?.dailyCapPerUser ?? 50,
        });
        const end = settle(done, live);
        await store.updateMeeting(m.id, end.holdInInbox || end.status === "failed" ? "needs_contact" : end.status, end.reason, end.holdInInbox ? store.now() + ctx.waitDays * DAY : null);
        finished = true;
        if (first) await quietly(store.noteDetails?.(m.id, { durationMinutes: null, talkPct: null, matched: { locationId: first.locationId, contactId: first.contactId } }));
        if (end.holdInInbox || end.status === "failed") { result.matchedWaiting++; continue; }
        writtenNow++;
        result.added++;
        await store.bump(conn.id, "saved");
        if (auto) {
          const hit = done.find((d) => d.outcome === "written" || (!live && d.outcome === "dry_run"));
          if (hit) await store.notify?.({ installationId, userId: person.userId, meetingId: m.id, kind: "added", title: m.title, contactName: null, locationId: hit.locationId, contactId: hit.contactId });
        }
      } finally {
        // A pass that stopped halfway gives the call back with its old reason, so it is looked at again next time.
        if (!finished) await store.updateMeeting(m.id, "needs_contact", m.reason).catch(() => undefined);
        // (if even the give-back fails the call keeps reason "rematching": it is still in the inbox and the person can link it by hand)
      }
      continue;
    }

    // Not written: either nothing is certain (a reason may have changed, for example a duplicate was merged), or it is certain but a rule, a limit or a missing permission holds it.
    const certain = plan.kind === "inbox" ? plan.matched?.[0] : plan.kind === "write" ? plan.targets[0] : undefined;
    const reason: InboxReason | null = plan.kind === "inbox" ? plan.reason : plan.kind === "write" ? "needs_permission" : null;
    if (certain) { await remember(store, m, certain, reason ?? m.reason ?? "no_match", ctx.waitDays, false); result.matchedWaiting++; }
    else if (reason && reason !== m.reason) { await remember(store, m, undefined, reason, ctx.waitDays, false); result.unchanged++; }
    else result.unchanged++;
  }
  return result;
}

const quietly = async (p: Promise<void> | undefined): Promise<void> => { try { await p; } catch { /* best effort: the list simply lacks this fact */ } };

/** Records who a waiting call was matched to with certainty and why it still waits. Never changes its expiry unless asked (a held call gets a fresh wait). */
async function remember(store: InboxStore, m: StoredMeeting, target: { locationId: string; contactId: string } | undefined, reason: string, waitDays: number, fresh = true): Promise<void> {
  if (reason !== m.reason) await store.updateMeeting(m.id, "needs_contact", reason, fresh ? store.now() + waitDays * DAY : undefined);
  if (target) await quietly(store.noteDetails?.(m.id, { durationMinutes: null, talkPct: null, matched: { locationId: target.locationId, contactId: target.contactId } }));
}
