// "Send me a test" (KF-5), and the one live exception of the overnight run (docs/OVERNIGHT_RULES.md section 3): while SEND_EMAIL_LIVE is off, a transactional
// test email may really be sent to ONE allowlisted address and to no other, at most TEST_EMAIL_CAP times in 24 hours. Every other address gets a dry run
// (the request is built and a "WOULD SEND" line is recorded, nothing leaves the server). Pure: the real transport is passed in, so the guard is tested
// with a fake that fails the test if it is ever called for the wrong address.

import { validEmail } from "../analytics/weekly-email.ts";

/** The only address a live test email may go to while sending is switched off. A code-level list, not a setting. */
export const TEST_EMAIL_ALLOWLIST: readonly string[] = ["king@kdsquares.com"];
/** At most this many live test emails in any 24 hours. */
export const TEST_EMAIL_CAP = 5;

/** Exactly one address, exactly an allowlisted one. A list ("a@b.com, king@kdsquares.com"), a display name, a longer domain or different case tricks are all refused. */
export function allowlisted(address: unknown): address is string {
  if (typeof address !== "string") return false;
  if (address !== address.trim() || /[\s,;<>"'()[\]\\]/.test(address)) return false;
  if (address.split("@").length !== 2) return false;
  return TEST_EMAIL_ALLOWLIST.includes(address.toLowerCase());
}

/** Defence in depth: the real transport calls this itself and throws for anything not on the list. */
export function assertAllowlisted(address: unknown): asserts address is string {
  if (!allowlisted(address)) throw new Error("Refused: a live test email may only go to an allowlisted address.");
}

export type MailLike = { subject: string; text: string; html: string };
export type SendResult = { ok: true; dryRun?: boolean } | { ok: false; permanent: boolean; code: string };

export type TestSendDeps = {
  /** Is SEND_EMAIL_LIVE on? Then there is no exception: the normal path is live for everyone. */
  switchOn: () => boolean;
  /** The real send, called ONLY for an allowlisted address while the switch is off. */
  liveSend: (to: string, mail: MailLike) => Promise<SendResult>;
  /** Can a real email be sent at all (the mail service is configured)? When it cannot, nothing is counted against the cap and the test is a dry run. Defaults to yes. */
  liveReady?: () => boolean;
  /** The normal path: through the dry-run gate (a dry run while the switch is off, a real send when it is on). */
  gatedSend: (to: string, mail: MailLike) => Promise<SendResult>;
  /** How many live test emails were sent in the last 24 hours. */
  usedInLast24h: () => Promise<number>;
  /** Count one use. Called BEFORE the send, so a failed attempt still counts and a retry loop cannot go past the cap. */
  recordUse: () => Promise<void>;
};

export type TestOutcome =
  | { status: "sent_live" }
  | { status: "sent" }
  | { status: "dry_run" }
  | { status: "failed"; code: string }
  | { status: "refused"; reason: "not_a_recipient" | "invalid_address" | "cap" };

/**
 * Send one test email to an address that is one of the company's saved recipients. Where it goes depends on the address and the switch:
 *   switch on                    normal live send (anyone's own saved address)
 *   switch off, allowlisted      a real send, counted against the cap of 5 in 24 hours
 *   switch off, anyone else      a dry run (recorded, not sent)
 */
export async function sendTestMail(to: string, saved: readonly string[], mail: MailLike, deps: TestSendDeps): Promise<TestOutcome> {
  if (!validEmail(to)) return { status: "refused", reason: "invalid_address" };
  if (!saved.map((s) => s.toLowerCase()).includes(to.toLowerCase())) return { status: "refused", reason: "not_a_recipient" };
  if (deps.switchOn()) {
    const r = await deps.gatedSend(to, mail);
    return r.ok ? { status: r.dryRun ? "dry_run" : "sent" } : { status: "failed", code: r.code };
  }
  if (allowlisted(to) && (deps.liveReady?.() ?? true)) {
    if ((await deps.usedInLast24h()) >= TEST_EMAIL_CAP) return { status: "refused", reason: "cap" };
    await deps.recordUse();
    const r = await deps.liveSend(to, mail);
    return r.ok ? { status: "sent_live" } : { status: "failed", code: r.code };
  }
  const r = await deps.gatedSend(to, mail);
  return r.ok ? { status: "dry_run" } : { status: "failed", code: r.code };
}

/** What the screen says for each outcome. */
export function testOutcomeText(o: TestOutcome, to: string): { ok: boolean; text: string } {
  switch (o.status) {
    case "sent_live": case "sent": return { ok: true, text: `A test email was sent to ${to}. Check your inbox (and spam) in a minute.` };
    case "dry_run": return { ok: true, text: `Test mode: the email to ${to} was prepared and logged, but sending is switched off on this server, so nothing was sent.` };
    case "failed": return { ok: false, text: `The test email could not be sent. If it happens again, send us this code: ${o.code}.` };
    case "refused":
      return { ok: false, text: o.reason === "cap" ? "Too many test emails today. Try again tomorrow." : o.reason === "not_a_recipient" ? "Add this address to the recipients and save first, then send the test." : "That is not an email address." };
  }
}
