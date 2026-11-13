import { createHmac, timingSafeEqual } from "node:crypto";

// Slack signs every request it sends: X-Slack-Signature = "v0=" + HMAC-SHA256(signing secret, "v0:" + X-Slack-Request-Timestamp + ":" + raw body).
// A request is accepted only when the signature matches AND the timestamp is within five minutes (so a captured request cannot be replayed later).

export const MAX_SKEW_SECONDS = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: "no_secret" | "missing" | "stale" | "mismatch" };

export function signSlack(secret: string, timestamp: string, body: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
}

export function verifySlackSignature(p: { secret: string | undefined; timestamp: string | null; signature: string | null; body: string; nowMs?: number }): SignatureCheck {
  if (!p.secret) return { ok: false, reason: "no_secret" };
  if (!p.timestamp || !p.signature || !/^\d{9,12}$/.test(p.timestamp)) return { ok: false, reason: "missing" };
  const now = Math.floor((p.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(p.timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  const want = Buffer.from(signSlack(p.secret, p.timestamp, p.body));
  const got = Buffer.from(p.signature);
  return want.length === got.length && timingSafeEqual(want, got) ? { ok: true } : { ok: false, reason: "mismatch" };
}
