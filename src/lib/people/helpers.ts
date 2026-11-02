// Small pure helpers for the People module (stage F10): days for a tag's per-day counts, the hard-timeout error, call messages from the CRM and the
// words for a call result. Pure, so they are unit tested.

const DAY_MS = 86_400_000;

/** One entry per calendar day (UTC) from `from` to `to` inclusive, with the count for that day (0 when the day has none). Capped at 400 days. */
export function fillDays(rows: ReadonlyArray<{ day: string; n: number }>, from: string, to: string): Array<{ day: string; n: number }> {
  const by = new Map(rows.map((r) => [r.day, r.n]));
  const out: Array<{ day: string; n: number }> = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out;
  for (let t = start, i = 0; t <= end && i < 400; t += DAY_MS, i++) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, n: by.get(day) ?? 0 });
  }
  return out;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ---------------- the hard timeout ----------------

/** The database stops a query that runs too long with code 57014. */
export const isQueryTimeout = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "57014";

/** How long a People or Call lists query may run before the database stops it. Under the hosting limit, so the person gets a message and not a bare 504. */
export const QUERY_TIMEOUT_MS = 8000;

export const TIMEOUT_MESSAGE = "This is taking too long. Narrow the filters (pick one client account, or add a tag) or try again.";

/** A short reference the person can quote to support. Letters and digits only, so it can be read out. */
export function errorRef(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `E-${s}`;
}

// ---------------- calls from the CRM ----------------

export type CrmCall = { at: number; direction: "inbound" | "outbound" | null; status: string | null; durationSeconds: number | null; userId: string | null };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * One call from a conversation's messages, or null when the message is not a call. The CRM records a call as a message of type TYPE_CALL; the status and
 * length are read from where the documentation says (the message's own status, or meta.call), and any of them may be missing. NOT VERIFIED LIVE: the real
 * shape could not be read from this machine, so every field is optional and nothing is invented.
 */
export function mapCallMessage(raw: unknown): CrmCall | null {
  const o = rec(raw);
  const type = String(o.messageType ?? o.type ?? "");
  if (!/call/i.test(type)) return null;
  const t = o.dateAdded ?? o.createdAt ?? o.date;
  const at = typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : typeof t === "string" ? Date.parse(t) : NaN;
  if (!Number.isFinite(at)) return null;
  const d = typeof o.direction === "string" ? o.direction.toLowerCase() : "";
  const call = rec(rec(o.meta).call);
  const status = [o.status, call.status].find((s) => typeof s === "string" && s.trim()) as string | undefined;
  const dur = [call.duration, o.duration].map(Number).find((n) => Number.isFinite(n) && n >= 0);
  return {
    at, direction: d === "inbound" || d === "outbound" ? d : null, status: status ? status.trim().toLowerCase().slice(0, 30) : null,
    durationSeconds: dur === undefined ? null : Math.round(dur), userId: typeof o.userId === "string" && o.userId ? o.userId.slice(0, 64) : null,
  };
}

/** A call result in plain words. */
export function callResultLabel(status: string | null, durationSeconds: number | null): string {
  const s = (status ?? "").replace(/[_-]/g, " ");
  if (s === "completed") return durationSeconds && durationSeconds > 0 ? `Answered, ${durationSeconds < 90 ? `${durationSeconds} sec` : `${Math.round(durationSeconds / 60)} min`}` : "Answered";
  if (s === "no answer") return "No answer";
  if (s === "busy") return "Busy";
  if (s === "voicemail") return "Voicemail";
  if (s === "failed") return "Did not connect";
  if (s === "canceled" || s === "cancelled") return "Cancelled";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Result not recorded";
}
