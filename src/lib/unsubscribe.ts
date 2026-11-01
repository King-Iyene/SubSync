import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// The "stop these emails" link in every weekly and alert email. The token names the installation and the address it was sent to, signed
// with a key derived from TOKEN_ENCRYPTION_KEY, so nobody can make one for another company and a link for an old address stops working
// once the address is changed. Pure apart from the key; unit tested.

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing environment variable TOKEN_ENCRYPTION_KEY");
  const material = Buffer.from(raw, "base64");
  if (material.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), "subsync-unsubscribe-v1", 32));
}

const emailTag = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("base64url").slice(0, 16);

export type Unsubscribe = { installationId: string; emailTag: string };

export function signUnsubscribe(installationId: string, email: string): string {
  const body = b64(JSON.stringify({ i: installationId, e: emailTag(email) }));
  return `${body}.${b64(createHmac("sha256", key()).update(body).digest())}`;
}

/** The installation and address tag a valid token names, or null for anything else (wrong signature, damaged, empty). */
export function readUnsubscribe(token: unknown): Unsubscribe | null {
  if (typeof token !== "string" || token.length > 400 || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  try {
    const want = createHmac("sha256", key()).update(body).digest();
    const got = Buffer.from(sig, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { i?: unknown; e?: unknown };
    return typeof p.i === "string" && typeof p.e === "string" ? { installationId: p.i, emailTag: p.e } : null;
  } catch {
    return null;
  }
}

/** Is this token for this address? (A link sent to an old address no longer matches after the address is changed.) */
export const matchesEmail = (u: Unsubscribe, email: string | null | undefined) => Boolean(email) && u.emailTag === emailTag(email as string);

export const unsubscribeUrl = (appUrl: string, installationId: string, email: string) => `${appUrl.replace(/\/+$/, "")}/api/email/unsubscribe?t=${signUnsubscribe(installationId, email)}`;
