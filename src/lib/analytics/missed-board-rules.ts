// Missed calls and missed replies: the written rules, pure (no database), mirrored exactly by the SQL in missed-board.ts. Definitions: docs/METRICS.md "Missed calls and missed replies".
// A PERSON's follow-up is an outbound call or message that is not automatic and did not fail, or a call result logged in Call mode. An automatic text-back is NOT a person.

export const BUCKETS = ["lt1h", "h1to4", "h4to24", "gt24h"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = { lt1h: "Under 1 hour", h1to4: "1 to 4 hours", h4to24: "4 to 24 hours", gt24h: "Over 24 hours" };
const H = 3_600_000;
export function bucketOf(waitMs: number): Bucket {
  return waitMs < H ? "lt1h" : waitMs < 4 * H ? "h1to4" : waitMs < 24 * H ? "h4to24" : "gt24h";
}

export type Followup = { at: number; direction: "inbound" | "outbound"; automated: boolean; kind: string };
/** none: nothing came after. auto: only an automatic message did. person: a person called or wrote (or a call result was logged). */
export type FollowState = "none" | "auto" | "person";
export function followState(missedAt: number, later: readonly Followup[], loggedOutcomeAfter = false): FollowState {
  let auto = false;
  for (const e of later) {
    if (e.at <= missedAt || e.direction !== "outbound" || e.kind === "failed") continue;
    if (!e.automated) return "person";
    auto = true;
  }
  if (loggedOutcomeAfter) return "person";
  return auto ? "auto" : "none";
}
/** Still waiting for a person. */
export const isWaiting = (s: FollowState) => s !== "person";

export const VIEWS = ["waiting", "none", "auto", "person", "all"] as const;
export type View = (typeof VIEWS)[number];
export const isView = (v: unknown): v is View => (VIEWS as readonly string[]).includes(v as string);
export const isBucket = (v: unknown): v is Bucket => (BUCKETS as readonly string[]).includes(v as string);
export const REPLY_CHANNELS = ["sms", "email", "whatsapp", "chat"] as const;
export type ReplyChannel = (typeof REPLY_CHANNELS)[number];
export const isChannel = (v: unknown): v is ReplyChannel => (REPLY_CHANNELS as readonly string[]).includes(v as string);
