// Records the role and outcome of each sign-in so the real payload shapes can be seen (CLAUDE.md checklist item 12).
// Deliberately stores no names, emails or person ids. Best effort: a failure here never blocks a sign-in.
import { sql } from "./db";
import type { Identity } from "./identity.ts";

export type SignInOutcome = "ok" | "denied" | "not_installed" | "bad_payload";

export async function logIdentity(installationId: string | null, identity: Identity | null, outcome: SignInOutcome): Promise<void> {
  try {
    await sql()`
      insert into identity_log (installation_id, user_type, role, is_agency_owner, has_location, outcome)
      values (${installationId}, ${identity?.userType ?? null}, ${identity?.role ?? null}, ${identity ? identity.isAgencyOwner : null}, ${identity ? identity.activeLocation !== null : null}, ${outcome})`;
  } catch {
    /* never block a sign-in */
  }
}
