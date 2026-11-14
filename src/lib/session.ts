import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { Role } from "./identity.ts";

// Short-lived signed session issued after the host page proves who the user is (SSO).
// The embedded page keeps it in memory and sends it as a Bearer token, because third-party
// cookies are unreliable inside an iframe. Key is derived from TOKEN_ENCRYPTION_KEY.

export type Session = {
  companyId: string;
  userId: string | null;
  role: string | null;
  userName: string | null;
  demo: boolean;
  /** "agency" when absent (older sessions). A business or client session is limited to one account. */
  kind?: "agency" | "business" | "client";
  locationId?: string | null;
  /** True only for the person who may delete all the data (see mayDeleteData in access.ts). Missing means no. */
  dataOwner?: boolean;
  /** True only for the platform owner (PLATFORM_OWNER_COMPANY_IDS or PLATFORM_OWNER_EMAILS, agency sessions only). Decided at sign-in from the verified payload. Missing means no. Opens the owner-only Feedback inbox; everyone else gets 404 there. */
  platformOwner?: boolean;
  /** The role sign-in worked out from the verified payload (agency owner, administrator, staff, account administrator or user). Connections decide who may see and revoke from it. Missing on older sessions, which then get the least privileged reading of the raw role. */
  personRole?: Role;
  exp: number;
};

const DEFAULT_TTL_SECONDS = 60 * 60;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing environment variable TOKEN_ENCRYPTION_KEY");
  const material = Buffer.from(raw, "base64");
  if (material.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), "subsync-session-v1", 32));
}

function mac(body: string): Buffer {
  return createHmac("sha256", key()).update(body).digest();
}

export function signSession(
  session: Omit<Session, "exp">,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = Date.now(),
): string {
  const payload: Session = { ...session, exp: Math.floor(now / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verifySession(token: string | null | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const expected = mac(body);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof session.companyId !== "string" || !session.companyId) return null;
    if (typeof session.exp !== "number" || session.exp * 1000 < now) return null;
    return session;
  } catch {
    return null;
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}
