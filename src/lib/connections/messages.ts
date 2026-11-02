// What a person reads when a connection does not work, in plain words, with a short code they can send us (INTEGRATIONS_SPEC section 12, N91, N92).
// The real provider error is logged by code only (`providerCodeOf`): never a token, a secret, an email or a message. A person never sees
// internal wording such as "did not say who signed in".

/** A pending connection ("Waiting for you...") gives up after this long and offers Try again (N92). */
export const PENDING_MS = 2 * 60_000;

export type ConnectCode = "Z-IDENT" | "S-REDIRECT" | "P-AUTH" | "F-HOOK" | "P-NET" | "P-DENIED" | "P-STATE" | "P-OFF";

export type ConnectError = { ok: false; code: ConnectCode; error: string; /** The provider's own error code or HTTP status, for the log only. */ providerCode?: string };

const withCode = (text: string, code: ConnectCode) => `${text} If it happens again, send us this code: ${code}.`;

export const MESSAGE = {
  pendingExpired: "This did not finish. Try again.",
  needsPermission: "Needs permission: reconnect.",
  notAvailable: (provider: string) => `Not available from ${provider} yet.`,
  noContact: "Nobody in this meeting is in your contacts. It is in your Meeting inbox for 14 days.",
  cancelled: "The request was cancelled, so nothing was changed.",
  expiredLink: "This link has expired. Go back to SubSync and press Connect again.",
} as const;

/** The error for one failed step, by code. `provider` is the display name. */
export function connectError(code: ConnectCode, provider: string, providerCode?: string): ConnectError {
  const base = { ok: false as const, code, providerCode };
  switch (code) {
    case "Z-IDENT": return { ...base, error: withCode(`We could not confirm which ${provider} account you used. Try again.`, code) };
    case "S-REDIRECT": return { ...base, error: `${provider} refused the connection. This is a setup problem on our side, not yours. Contact us and we will fix it within 24 hours. Code: ${code}.` };
    case "P-AUTH": return { ...base, error: withCode(`${provider} did not accept the sign-in. Try again.`, code) };
    case "F-HOOK": return { ...base, error: withCode(`${provider} signed you in, but we could not set up delivery of your meetings. Nothing was saved.`, code) };
    case "P-NET": return { ...base, error: withCode(`We could not reach ${provider}. Try again in a moment.`, code) };
    case "P-DENIED": return { ...base, error: MESSAGE.cancelled };
    case "P-STATE": return { ...base, error: MESSAGE.expiredLink };
    case "P-OFF": return { ...base, error: `Connecting ${provider} is not switched on yet. It needs the ${provider} app set up first.` };
  }
}

/** Slack's own names for "the return address was not on the app". Any of these means the setup is wrong on our side. */
export const SLACK_REDIRECT_ERRORS = new Set(["bad_redirect_uri", "redirect_uri_mismatch", "invalid_redirect_uri"]);

/** The one thing worth logging about a provider's answer: a short machine code (Slack's `error`, Zoom's numeric `code`, or the HTTP status). */
export function providerCodeOf(status: number, json: Record<string, unknown>): string {
  const own = json.error ?? json.code;
  const text = typeof own === "string" || typeof own === "number" ? String(own) : "";
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : `http_${status}`;
}

/** What a person sees for a stored status, and whether the pending state has run out. */
export type Shown = "not_connected" | "waiting" | "expired" | "connected" | "needs_reconnect" | "revoked" | "error";

export function shownStatus(status: string | null, pendingSince: Date | number | null, now = Date.now()): Shown {
  if (status === null) return "not_connected";
  if (status === "pending") {
    const since = pendingSince instanceof Date ? pendingSince.getTime() : pendingSince;
    return since !== null && now - since < PENDING_MS ? "waiting" : "expired";
  }
  if (status === "connected" || status === "needs_reconnect" || status === "revoked" || status === "error") return status;
  return "error";
}

/** The words for each shown status. `revoked` says what to do, and who did it is never named. */
export const STATUS_WORDS: Record<Shown, string> = {
  not_connected: "Not connected",
  waiting: "Waiting for you...",
  expired: "This did not finish. Try again.",
  connected: "Connected",
  needs_reconnect: "Needs reconnect",
  revoked: "Disconnected by your admin. Connect again to continue.",
  error: "Something went wrong",
};
