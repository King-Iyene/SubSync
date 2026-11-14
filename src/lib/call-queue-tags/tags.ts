// Call queue tags: the tag names that start each call queue in a client account. Pure rules, no database and no network, so every case has a test.
// An account may use its own names (many have a naming convention); anything it has not chosen falls back to the default below.
export type QueueKey = "first_reply" | "no_show" | "call_now" | "call_follow_up";

export const QUEUES: readonly { key: QueueKey; label: string; what: string; defaultTag: string; workflow: string | null }[] = [
  { key: "first_reply", label: "Needs first reply", what: "A new lead nobody has answered yet.", defaultTag: "needs-first-reply", workflow: "Slow first reply call" },
  { key: "no_show", label: "No-show follow-up", what: "Someone who booked and did not show up.", defaultTag: "no-show-follow-up", workflow: "No-show follow-up call" },
  { key: "call_now", label: "Call now", what: "Leads you send to your call queue from Speed to lead.", defaultTag: "call-now", workflow: "Call queue" },
  { key: "call_follow_up", label: "Call follow-up", what: "Leads that need a second call.", defaultTag: "subsync-call-follow-up", workflow: null },
];

export const QUEUE_KEYS: readonly QueueKey[] = QUEUES.map((q) => q.key);
export const isQueueKey = (v: unknown): v is QueueKey => typeof v === "string" && (QUEUE_KEYS as readonly string[]).includes(v);
export const TAG_MAX = 60;
export const defaultTagOf = (k: QueueKey): string => QUEUES.find((q) => q.key === k)!.defaultTag;

/** A tag name is kept as typed (case and spaces inside are the person's own), but must be plain: not empty, at most 60 characters, no commas. */
export function validateTag(v: unknown): { ok: true; tag: string } | { ok: false; message: string } {
  if (typeof v !== "string") return { ok: false, message: "Type a tag name." };
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return { ok: false, message: "Type a tag name." };
  if (t.length > TAG_MAX) return { ok: false, message: `Use at most ${TAG_MAX} characters.` };
  if (t.includes(",")) return { ok: false, message: "A tag name cannot contain a comma." };
  if (/[\u0000-\u001f<>]/.test(t)) return { ok: false, message: "Use plain letters, numbers, spaces, dashes or underscores." };
  return { ok: true, tag: t };
}

export type QueueTags = Record<QueueKey, string>;
/** The tag each queue uses: the account's own choice, else the default. `legacyCallNow` is the tag an account saved earlier in the call queue settings. */
export function resolveTags(overrides: Partial<Record<string, string>> | null | undefined, legacyCallNow?: string | null): QueueTags {
  const o = overrides ?? {};
  const out = {} as QueueTags;
  for (const q of QUEUES) {
    const own = typeof o[q.key] === "string" && validateTag(o[q.key]).ok ? (o[q.key] as string) : null;
    out[q.key] = own ?? (q.key === "call_now" && legacyCallNow && validateTag(legacyCallNow).ok ? legacyCallNow : q.defaultTag);
  }
  return out;
}

export type TagPreview = { key: QueueKey; label: string; from: string; to: string; changed: boolean; line: string };
/** What pressing Save (or Reset) will change, in one line per queue. Nothing is written by this. */
export function previewChange(current: QueueTags, wanted: Partial<Record<QueueKey, string>>): { ok: boolean; rows: TagPreview[]; errors: Partial<Record<QueueKey, string>> } {
  const errors: Partial<Record<QueueKey, string>> = {};
  const rows: TagPreview[] = [];
  for (const q of QUEUES) {
    const w = wanted[q.key];
    if (w === undefined) continue;
    const v = validateTag(w);
    if (!v.ok) { errors[q.key] = v.message; continue; }
    const changed = v.tag !== current[q.key];
    rows.push({ key: q.key, label: q.label, from: current[q.key], to: v.tag, changed, line: changed ? `${q.label}: SubSync will look for the tag "${v.tag}" instead of "${current[q.key]}".` : `${q.label}: no change.` });
  }
  return { ok: Object.keys(errors).length === 0, rows, errors };
}

/** Two queues must not share one tag: one tag would start two call tasks for the same person. Returns the queues that clash. */
export function duplicateTags(t: QueueTags): QueueKey[] {
  const seen = new Map<string, QueueKey>();
  const dup = new Set<QueueKey>();
  for (const q of QUEUES) {
    const k = t[q.key].toLowerCase();
    const prev = seen.get(k);
    if (prev) { dup.add(prev); dup.add(q.key); } else seen.set(k, q.key);
  }
  return [...dup];
}
