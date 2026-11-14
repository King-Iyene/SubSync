// Sends one email through Resend. It does nothing, and says so, until RESEND_API_KEY and EMAIL_FROM are set.
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export type Mail = { subject: string; text: string; html: string; headers?: Record<string, string> };
type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

// The headers that make "unsubscribe" a button in the mail app (one click, no sign-in).
export const unsubscribeHeaders = (url: string): Record<string, string> => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

// One retry, after a pause, for a network failure, a rate limit or a server error: a mail provider hiccup should not lose an alert. Anything
// else (a bad address, a bad key) fails at once. A false result means "not sent", and the caller leaves the work to be tried on its next run.
//
// LOW LEVEL: this really sends. It does not look at the SEND_EMAIL_LIVE switch. Application code must not call it: the dispatcher's email transport
// (src/lib/notifications/transports.ts) calls it through `outward()`, and the allowlisted test path (src/lib/notifications/test-send.ts) is the only
// other caller. A test (tests/unit/f9-no-ungated-sends.test.ts) fails if any other file imports it.
export type EmailResult = { ok: true } | { ok: false; status: number; permanent: boolean };

export async function sendEmailResult(to: string, m: Mail, deps: { fetch?: FetchLike; wait?: (ms: number) => Promise<void> } = {}): Promise<EmailResult> {
  if (!emailConfigured()) return { ok: false, status: 0, permanent: false };
  // A hard limit on each call: a mail service that never answers must not hold the function until the platform cuts it off (a 502).
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(4000) }));
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: m.subject, text: m.text, html: m.html, ...(m.headers ? { headers: m.headers } : {}) }),
  };
  let status = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch("https://api.resend.com/emails", init);
      if (res.ok) return { ok: true };
      status = res.status;
      // A refusal (a bad address, a bad key) cannot be fixed by trying again.
      if (res.status !== 429 && res.status < 500) return { ok: false, status, permanent: true };
    } catch { status = 0; /* network failure: try once more */ }
    if (attempt === 0) await wait(1500);
  }
  return { ok: false, status, permanent: false };
}

export async function sendEmail(to: string, m: Mail, deps: { fetch?: FetchLike; wait?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  return (await sendEmailResult(to, m, deps)).ok;
}
