// "Send me a test" on Settings, Connections, Email: ONE handled answer, always, within a few seconds. Never a 5xx for something we can explain.
// Pure: the real send, the clock and the error log are passed in, so every state is tested with a stub that can never send anything.

import { errorRef } from "../people/helpers.ts";

export type EmailTestState = "not_configured" | "dry_run" | "sent" | "rejected" | "error";
export type EmailTestAnswer = {
  ok: boolean;
  state: EmailTestState;
  /** How the card shows it: info for "not switched on yet" and "preview only" (not a failure). */
  tone: "info" | "success" | "danger";
  dryRun: boolean;
  text: string;
  preview: { to: string; subject: string; body: string } | null;
  errorId: string | null;
};
export type SendOutcome = { ok: true; dryRun?: boolean } | { ok: false; permanent: boolean; code: string };

/** The longest the whole test may take. The platform cuts a function off much later, and that shows as a 502. */
export const EMAIL_TEST_BUDGET_MS = 9000;

/** j***@gmail.com: enough to recognise, not enough to read out. */
export function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** The provider's reason in a few plain words, from the status we got back. Never the body, never a key. */
export function providerReason(code: string): string {
  const status = Number(/^http_(\d+)$/.exec(code)?.[1] ?? 0);
  if (status === 401 || status === 403) return "the mail service refused our key";
  if (status === 422 || status === 400) return "the mail service did not accept the sender or the address";
  if (status === 429) return "the mail service says too many were sent just now";
  if (status >= 500) return "the mail service had a problem on its side";
  if (status === 0) return "the mail service could not be reached";
  return `the mail service answered ${status}`;
}

type Deps = {
  to: string;
  mail: { subject: string; text: string };
  /** Sends through the one switch. It may throw. */
  send: () => Promise<SendOutcome>;
  /** Records the real error where support can find it. May fail: that never matters here. */
  logError: (errorId: string, detail: string) => Promise<void>;
  budgetMs?: number;
};

export async function runEmailTest(d: Deps): Promise<EmailTestAnswer> {
  const preview = { to: d.to, subject: d.mail.subject, body: d.mail.text };
  const failed = async (detail: string): Promise<EmailTestAnswer> => {
    const errorId = errorRef();
    try { await Promise.race([d.logError(errorId, detail), new Promise<void>((r) => setTimeout(r, 1500).unref?.())]); } catch { /* logging must never break the answer */ }
    return { ok: false, state: "error", tone: "danger", dryRun: false, text: `The test email could not be sent. Nothing was changed. If it happens again, send us this code: ${errorId}.`, preview: null, errorId };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let r: SendOutcome | "timeout";
  try {
    r = await Promise.race([d.send(), new Promise<"timeout">((res) => { timer = setTimeout(() => res("timeout"), d.budgetMs ?? EMAIL_TEST_BUDGET_MS); })]);
  } catch (e) {
    return failed(e instanceof Error ? e.message.slice(0, 300) : "send threw");
  } finally { if (timer) clearTimeout(timer); }
  if (r === "timeout") return failed("the send did not finish in time");
  if (r.ok) {
    if (r.dryRun) return { ok: true, state: "dry_run", tone: "info", dryRun: true, text: "Preview only: this is what the test email would say. Sending is switched off for now, so nothing was sent.", preview, errorId: null };
    return { ok: true, state: "sent", tone: "success", dryRun: false, text: `Test sent to ${maskEmail(d.to)}. Check your inbox, and spam, in a minute.`, preview: null, errorId: null };
  }
  if (r.code === "email_not_configured") {
    return { ok: true, state: "not_configured", tone: "info", dryRun: false, text: "Email sending is not switched on yet: your address is saved and alerts will go there once it is.", preview, errorId: null };
  }
  return { ok: false, state: "rejected", tone: "danger", dryRun: false, text: `The test email was not sent: ${providerReason(r.code)}. Nothing was changed.`, preview: null, errorId: null };
}
