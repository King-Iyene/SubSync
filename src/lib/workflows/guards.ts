// Workflows module: the guardrails of every write. Pure, so each rule has a test.
import { createHmac, timingSafeEqual } from "node:crypto";

export type WriteKind = "rename" | "publish" | "unpublish" | "delete" | "clone" | "install";
export const WRITE_SCOPES: Record<WriteKind, string[]> = {
  rename: ["workflows.readonly", "workflows.write"],
  publish: ["workflows.publish"],
  unpublish: ["workflows.publish"],
  delete: ["workflows.delete", "workflows.readonly"],
  clone: ["workflows.readonly", "workflows.write"],
  install: ["workflows.readonly", "workflows.write"],
};
export const CAPS = { perRequest: 50, deletesPerDay: 5, writesPerDay: 100, tokenMinutes: 15 } as const;

/** Names the permissions that are missing, or null when all are granted. `granted` null means not known (demo): nothing is blocked. */
export function missingScopes(kind: WriteKind, granted: string[] | null): string[] | null {
  if (granted === null) return null;
  const miss = WRITE_SCOPES[kind].filter((s) => !granted.includes(s));
  return miss.length ? miss : null;
}

export type Actor = { kind: "agency" | "business" | "client"; role: string | null; isOwnerOrAdmin: boolean };
/** Only an agency owner or admin, or a business administrator, may change workflows. A client's staff and agency staff never. */
export const mayWrite = (a: Actor): boolean => a.kind !== "client" && a.isOwnerOrAdmin;

export type CapState = { deletesToday: number; writesToday: number };
export function capProblem(kind: WriteKind, count: number, st: CapState): string | null {
  if (count < 1) return "Nothing was picked.";
  if (count > CAPS.perRequest) return `At most ${CAPS.perRequest} workflows at a time.`;
  if (st.writesToday + count > CAPS.writesPerDay) return `The daily limit of ${CAPS.writesPerDay} changes was reached. Try again tomorrow.`;
  if (kind === "delete" && st.deletesToday + count > CAPS.deletesPerDay) return `At most ${CAPS.deletesPerDay} workflows can be deleted per day (${st.deletesToday} already today).`;
  return null;
}

const DAY = 86_400_000;
/** Could contacts still be inside it? An estimate from the last 30 days of logs: a published workflow that ran in the last week, or one whose recent history is not known. */
export function mayHaveActive(w: { status: string; lastRunAt: number | null; runs30d: number | null }, now: number): boolean {
  if (w.status !== "published") return false;
  if (w.runs30d === null) return true;
  return w.runs30d > 0 && (w.lastRunAt === null || now - w.lastRunAt < 7 * DAY);
}

/** The typed confirmation for a delete: the exact name for one workflow, the word DELETE plus the count for several. */
export function deletePhrase(names: string[]): string {
  return names.length === 1 ? names[0] : `DELETE ${names.length}`;
}
export const phraseMatches = (typed: unknown, names: string[]) => typeof typed === "string" && typed.trim() === deletePhrase(names);

// A confirm token ties a preview to the company, the person, the kind and the exact list of changes, for 15 minutes. Nothing is stored: the
// server recomputes it from the confirm request, so a changed id, a changed name or another company's token simply does not match.
const secret = () => process.env.TOKEN_ENCRYPTION_KEY || "dev-only-workflows-secret";
export function digest(parts: unknown): string {
  return createHmac("sha256", secret()).update(JSON.stringify(parts)).digest("hex");
}
export function makeToken(scope: { installationId: string; actor: string; kind: WriteKind; changes: unknown }, now: number): string {
  const exp = now + CAPS.tokenMinutes * 60_000;
  return `${exp}.${digest({ ...scope, exp })}`;
}
export function checkToken(token: unknown, scope: { installationId: string; actor: string; kind: WriteKind; changes: unknown }, now: number): "ok" | "expired" | "invalid" {
  if (typeof token !== "string") return "invalid";
  const [exp, mac] = token.split(".");
  const e = Number(exp);
  if (!Number.isFinite(e) || !mac) return "invalid";
  const want = Buffer.from(digest({ ...scope, exp: e }));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "invalid";
  return now > e ? "expired" : "ok";
}

/** One key per change per confirmed token, so pressing Confirm twice does nothing the second time. */
export const opKey = (token: string, kind: WriteKind, locationId: string, workflowId: string) => digest({ token, kind, locationId, workflowId }).slice(0, 40);
