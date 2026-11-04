// Reading a contact-created webhook body. Pure.
import type { Person } from "./dedupe.ts";

export type Incoming = { contactId: string; name: string; email: string | null; phone: string | null; tags: string[]; source: string | null; createdAt: string | null };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Reads the contact out of a contact-created webhook body, defensively (the platform nests it differently across event versions). Null when there is no usable contact. */
export function incomingFrom(body: unknown): Incoming | null {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const c = (o.contact && typeof o.contact === "object" ? o.contact : o) as Record<string, unknown>;
  const id = text(c.id) ?? text(c.contactId);
  if (!id) return null;
  const name = text(c.name) ?? text(c.fullName) ?? [text(c.firstName), text(c.lastName)].filter(Boolean).join(" ");
  const tags = Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [];
  const when = text(c.dateAdded) ?? text(c.createdAt);
  return { contactId: id, name: name || "Unnamed contact", email: text(c.email), phone: text(c.phone), tags, source: text(c.source), createdAt: when && Number.isFinite(Date.parse(when)) ? new Date(when).toISOString() : new Date().toISOString() };
}

export const asPerson = (i: Incoming): Person => ({ contactId: i.contactId, name: i.name, email: i.email, phone: i.phone, tags: i.tags, createdAt: i.createdAt, lastActivityAt: null, source: i.source, openDeals: 0, wonDeals: 0, hasConversation: false });

