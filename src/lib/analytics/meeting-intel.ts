// Meeting notes: turn what a meeting tool sends (Fathom's webhook, a Zoom recording through an
// automation, or a plain form) into one tidy shape, and write a note a person can paste into a contact.
// Pure (no database or network imports) so it can be unit tested. Everything is read defensively because
// every tool names its fields differently.

export type Attendee = { name: string | null; email: string | null };

export type Meeting = {
  source: "fathom" | "zoom" | "other";
  title: string | null;
  startedAt: string | null;
  attendees: Attendee[];
  summary: string | null;
  actionItems: string[];
  transcript: string | null;
  recordingUrl: string | null;
};

const MAX_SUMMARY = 6_000;
const MAX_TRANSCRIPT = 200_000;
const MAX_ITEMS = 20;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
// Strip control characters, trim, and cap the length.
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const first = (o: Record<string, unknown>, keys: string[], max: number): string | null => {
  for (const k of keys) {
    const s = clean(o[k], max);
    if (s) return s;
  }
  return null;
};

function iso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function attendeeFrom(v: unknown): Attendee | null {
  if (typeof v === "string") {
    const s = clean(v, 200);
    if (!s) return null;
    return EMAIL.test(s) ? { name: null, email: s.toLowerCase() } : { name: s, email: null };
  }
  const o = rec(v);
  const email = first(o, ["email", "email_address", "user_email"], 200)?.toLowerCase() ?? null;
  const name = first(o, ["name", "display_name", "user_name", "full_name"], 120);
  if (!email && !name) return null;
  return { name, email: email && EMAIL.test(email) ? email : null };
}

function attendeesOf(body: Record<string, unknown>): Attendee[] {
  const out: Attendee[] = [];
  for (const key of ["attendees", "calendar_invitees", "participants", "invitees", "emails"]) {
    const list = body[key];
    if (Array.isArray(list)) for (const item of list) { const a = attendeeFrom(item); if (a) out.push(a); }
    else if (typeof list === "string") for (const part of list.split(/[,;\n]/)) { const a = attendeeFrom(part); if (a) out.push(a); }
  }
  const by = attendeeFrom(body.recorded_by ?? body.host);
  if (by) out.push(by);
  // One entry per email address; keep a name when any copy has one.
  const seen = new Map<string, Attendee>();
  const nameless: Attendee[] = [];
  for (const a of out) {
    if (!a.email) { nameless.push(a); continue; }
    const prev = seen.get(a.email);
    seen.set(a.email, { email: a.email, name: prev?.name ?? a.name });
  }
  return [...seen.values(), ...nameless].slice(0, 30);
}

function summaryOf(body: Record<string, unknown>): string | null {
  const direct = first(body, ["summary", "ai_summary", "notes", "meeting_summary"], MAX_SUMMARY);
  if (direct) return direct;
  const ds = body.default_summary;
  if (typeof ds === "string") return clean(ds, MAX_SUMMARY);
  return first(rec(ds), ["markdown_formatted", "text", "summary"], MAX_SUMMARY);
}

function itemsOf(v: unknown): string[] {
  const raw: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/) : [];
  const out: string[] = [];
  for (const item of raw) {
    const text = typeof item === "string" ? item : first(rec(item), ["description", "text", "title", "action_item"], 300);
    const s = clean(typeof text === "string" ? text.replace(/^[\s\-*•\d.)]+/, "") : null, 300);
    if (s) out.push(s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function transcriptOf(v: unknown): string | null {
  if (typeof v === "string") return clean(v, MAX_TRANSCRIPT);
  if (!Array.isArray(v)) return null;
  const lines = v.map((seg) => {
    if (typeof seg === "string") return seg;
    const o = rec(seg);
    const who = first(rec(o.speaker), ["display_name", "name"], 80) ?? first(o, ["speaker", "speaker_name"], 80);
    const text = first(o, ["text", "content", "sentence"], 2_000);
    return text ? (who ? `${who}: ${text}` : text) : "";
  }).filter(Boolean);
  return clean(lines.join("\n"), MAX_TRANSCRIPT);
}

function httpsUrl(v: unknown): string | null {
  const s = clean(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseMeeting(input: unknown, hint?: string | null): Meeting | null {
  const body = rec(input);
  const title = first(body, ["title", "meeting_title", "topic", "name", "subject"], 200);
  const summary = summaryOf(body);
  const transcript = transcriptOf(body.transcript ?? body.transcript_text);
  const actionItems = itemsOf(body.action_items ?? body.actionItems ?? body.next_steps);
  if (!title && !summary && !transcript && actionItems.length === 0) return null;
  const recordingUrl = httpsUrl(body.share_url) ?? httpsUrl(body.recording_url) ?? httpsUrl(body.url) ?? httpsUrl(body.link);
  const h = (hint ?? "").toLowerCase();
  const source: Meeting["source"] =
    h === "fathom" || "default_summary" in body || "calendar_invitees" in body || /fathom\./i.test(recordingUrl ?? "") ? "fathom"
    : h === "zoom" || "topic" in body || /zoom\./i.test(recordingUrl ?? "") ? "zoom" : "other";
  return {
    source, title, startedAt: iso(body.started_at ?? body.start_time ?? body.scheduled_start_time ?? body.recording_start ?? body.created_at ?? body.date),
    attendees: attendeesOf(body), summary, actionItems, transcript, recordingUrl,
  };
}

// The first attendee email that belongs to a known contact decides who the meeting was with.
export function matchContact<T extends { email: string | null }>(attendees: Attendee[], contacts: T[]): T | null {
  const by = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  for (const a of attendees) {
    const hit = a.email ? by.get(a.email) : undefined;
    if (hit) return hit;
  }
  return null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "date unknown");

// A note ready to paste into a contact. Summary and action items only: the full transcript stays out.
// The note as it is written into the contact in the CRM: the same text, capped so one long summary cannot flood a contact.
export const CRM_NOTE_MAX = 8000;
export function crmNoteBody(m: Pick<Meeting, "title" | "startedAt" | "attendees" | "summary" | "actionItems" | "recordingUrl">): string {
  const text = noteText(m);
  return text.length <= CRM_NOTE_MAX ? text : text.slice(0, CRM_NOTE_MAX - 1) + "…";
}

export function noteText(m: Pick<Meeting, "title" | "startedAt" | "attendees" | "summary" | "actionItems" | "recordingUrl">): string {
  const lines = [`Meeting: ${m.title ?? "Untitled"} (${when(m.startedAt)})`];
  const who = m.attendees.map((a) => a.name ?? a.email).filter(Boolean);
  if (who.length) lines.push(`With: ${who.join(", ")}`);
  if (m.summary) lines.push("", "Summary", m.summary);
  if (m.actionItems.length) lines.push("", "Action items", ...m.actionItems.map((i) => `- ${i}`));
  if (m.recordingUrl) lines.push("", `Recording: ${m.recordingUrl}`);
  return lines.join("\n").slice(0, 8_000);
}
