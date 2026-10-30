import { createHmac, timingSafeEqual } from "node:crypto";

// Checks that a webhook really came from Fathom or Zoom, using the raw request body. Pure (no database
// or network) so it can be unit tested. A request outside the time window is refused even if signed.

export const TOLERANCE_SECONDS = 5 * 60;

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

function fresh(timestamp: string | null, now: number): boolean {
  if (!timestamp || !/^\d{9,12}$/.test(timestamp)) return false;
  return Math.abs(Math.floor(now / 1000) - Number(timestamp)) <= TOLERANCE_SECONDS;
}

// Fathom signs the way the Standard Webhooks spec describes: HMAC-SHA256 over "<id>.<timestamp>.<body>",
// keyed by the base64 part of the "whsec_..." secret, sent as a space-separated list of "v1,<base64>".
export function verifyFathom(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now?: number }): boolean {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !signature || !fresh(timestamp, input.now ?? Date.now())) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const sig = part.split(",").pop();
    if (!sig) return false;
    try {
      return same(Buffer.from(sig, "base64"), expected);
    } catch {
      return false;
    }
  });
}

// Zoom signs "v0:<timestamp>:<body>" with the app's secret token and sends "v0=<hex>".
export function verifyZoom(input: { secretToken: string; timestamp: string | null; signature: string | null; body: string; now?: number }): boolean {
  const { secretToken, timestamp, signature, body } = input;
  if (!secretToken || !signature || !fresh(timestamp, input.now ?? Date.now())) return false;
  const expected = "v0=" + createHmac("sha256", secretToken).update(`v0:${timestamp}:${body}`).digest("hex");
  return same(Buffer.from(signature), Buffer.from(expected));
}

// The answer Zoom expects when it first checks the notification address.
export function zoomChallenge(plainToken: string, secretToken: string): { plainToken: string; encryptedToken: string } {
  return { plainToken, encryptedToken: createHmac("sha256", secretToken).update(plainToken).digest("hex") };
}
