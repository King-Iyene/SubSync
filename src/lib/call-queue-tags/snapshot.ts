import type { AccessKind } from "../access.ts";

// The optional one-click setup card. Only an agency session may see it or fetch its address; an account session (a business or its staff) never does. The address itself lives only in
// the server's environment (SNAPSHOT_SHARE_URL): never in the repository, never in the browser bundle, and only sent to a verified agency session that passes every check below.
export type SnapshotGate = { kind: AccessKind; demo: boolean; flagOn: boolean; companyOn: boolean; url: string | null | undefined };

export function snapshotUrlFrom(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.SNAPSHOT_SHARE_URL ?? "").trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : null;
}

/** Whether the card renders for this session. Reasons are for tests and logs; the screen shows nothing at all when this is false. */
export function snapshotVisible(g: SnapshotGate): { show: boolean; why: "ok" | "not_agency" | "demo" | "flag_off" | "company_off" | "no_url" } {
  if (g.kind !== "agency") return { show: false, why: "not_agency" };
  if (g.demo) return { show: false, why: "demo" };
  if (!g.flagOn) return { show: false, why: "flag_off" };
  if (!g.companyOn) return { show: false, why: "company_off" };
  if (!g.url) return { show: false, why: "no_url" };
  return { show: true, why: "ok" };
}

export const SNAPSHOT_STEPS: readonly string[] = [
  "Open the setup link.",
  "Choose the client account to set up.",
  "Import the ready-made workflows. They arrive switched on.",
  "Come back here and press Check that it worked.",
];
