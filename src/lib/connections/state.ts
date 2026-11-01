import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// The "state" value carried through a sign-in with Slack, Fathom or Zoom. It is signed, expires in ten
// minutes, and names the install it was started from, so the page the provider sends the person back to
// knows which agency or business the connection belongs to without any cookie.

export type Provider = "slack" | "fathom" | "zoom";
export const PROVIDERS: Provider[] = ["slack", "fathom", "zoom"];
export const isProvider = (v: unknown): v is Provider => typeof v === "string" && (PROVIDERS as string[]).includes(v);

export type OAuthState = {
  provider: Provider;
  installationId: string;
  /** Set for a single business: everything the connection does stays inside this account. */
  onlyLocationId: string | null;
  actor: string | null;
  /** Set when a person connects their OWN tool (Fathom, Zoom): who they are, taken from the signed session when the sign-in started. A workspace tool (Slack) has none. */
  person?: { userId: string; companyKey: string; name: string | null; home: string | null; role: string | null };
};

const TTL_SECONDS = 10 * 60;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing environment variable TOKEN_ENCRYPTION_KEY");
  const material = Buffer.from(raw, "base64");
  if (material.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), "subsync-oauth-state-v1", 32));
}

const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

export function signState(state: OAuthState, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...state, n: randomBytes(8).toString("base64url"), exp: Math.floor(now / 1000) + TTL_SECONDS })).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verifyState(token: string | null | undefined, expected: Provider, now = Date.now()): OAuthState | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const want = mac(body);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState & { exp: number };
    if (s.provider !== expected || typeof s.installationId !== "string" || !s.installationId) return null;
    if (typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    const p = s.person as Record<string, unknown> | undefined;
    const person = p && typeof p.userId === "string" && p.userId && typeof p.companyKey === "string" && p.companyKey
      ? { userId: p.userId, companyKey: p.companyKey, name: typeof p.name === "string" ? p.name : null, home: typeof p.home === "string" ? p.home : null, role: typeof p.role === "string" ? p.role : null }
      : undefined;
    return { provider: s.provider, installationId: s.installationId, onlyLocationId: typeof s.onlyLocationId === "string" ? s.onlyLocationId : null, actor: typeof s.actor === "string" ? s.actor : null, ...(person ? { person } : {}) };
  } catch {
    return null;
  }
}
