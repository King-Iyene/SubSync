import { createHmac, timingSafeEqual } from "node:crypto";
import { fixName, fixPhone, protectedReason, type DhContact } from "./rules.ts";

export const FIX_CAPS = { perRequest: 100, perDay: 200, tokenMinutes: 15, undoHours: 24 } as const;
export type FixKind = "phone" | "name";
export type Change = { contactId: string; locationId: string; field: "phone" | "firstName" | "lastName"; before: string; after: string };
export type Plan = { changes: Change[]; skipped: Array<{ contactId: string; reason: string }>; cut: boolean };

/** Standardise phone format and name capitalisation only. Protected contacts are skipped and listed. No merge, no delete. */
export function planFixes(contacts: DhContact[], kinds: FixKind[], region: string, room: number): Plan {
  const changes: Change[] = [], skipped: Plan["skipped"] = [];
  const limit = Math.max(0, Math.min(room, FIX_CAPS.perRequest));
  let cut = false;
  for (const c of contacts) {
    const one: Change[] = [];
    if (kinds.includes("phone")) { const a = fixPhone(c.phone, region); if (a) one.push({ contactId: c.contactId, locationId: c.locationId, field: "phone", before: c.phone ?? "", after: a }); }
    if (kinds.includes("name")) {
      const f = fixName(c.firstName), l = fixName(c.lastName);
      if (f) one.push({ contactId: c.contactId, locationId: c.locationId, field: "firstName", before: c.firstName ?? "", after: f });
      if (l) one.push({ contactId: c.contactId, locationId: c.locationId, field: "lastName", before: c.lastName ?? "", after: l });
    }
    if (!one.length) continue;
    const why = protectedReason(c);
    if (why) { skipped.push({ contactId: c.contactId, reason: why }); continue; }
    if (changes.length + one.length > limit) { cut = true; break; }
    changes.push(...one);
  }
  return { changes, skipped, cut };
}

const secret = () => process.env.TOKEN_ENCRYPTION_KEY || "dev-only-data-health-secret";
const mac = (p: unknown) => createHmac("sha256", secret()).update(JSON.stringify(p)).digest("hex");
type Scope = { installationId: string; actor: string; locationId: string; changes: unknown };
export const makeFixToken = (s: Scope, now: number) => { const exp = now + FIX_CAPS.tokenMinutes * 60_000; return `${exp}.${mac({ ...s, exp })}`; };
export function checkFixToken(t: unknown, s: Scope, now: number): "ok" | "expired" | "invalid" {
  if (typeof t !== "string") return "invalid";
  const [e, m] = t.split(".");
  const exp = Number(e);
  if (!Number.isFinite(exp) || !m) return "invalid";
  const a = Buffer.from(mac({ ...s, exp })), b = Buffer.from(m);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";
  return now > exp ? "expired" : "ok";
}
export const fixOpKey = (token: string, c: Change) => mac({ token, c }).slice(0, 40);
export const undoable = (at: number, now: number) => now - at <= FIX_CAPS.undoHours * 3_600_000;
