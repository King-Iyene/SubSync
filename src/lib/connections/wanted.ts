import { choicesOf } from "./ingest";
import { pgIngestStore } from "./ingest-store";
import type { WantedContent } from "./fathom";
import { accessibleAccounts, type Person } from "./person";
import { effectivePolicy, wantedAcrossAccounts } from "./policy";

// What to ask the meeting tool to put in each delivery when a person connects (spec section 8, data minimisation): only what their choices, under the
// rules of every account they can reach, would actually save. Without a transcript choice the transcript is never requested.

export async function wantedForPerson(installationId: string, person: Person): Promise<WantedContent> {
  const store = pgIngestStore();
  const [installed, proven, settings] = await Promise.all([store.installed(installationId), store.provenAccess(installationId, person.userId), store.settings(installationId, person.userId)]);
  const accounts = accessibleAccounts(person, installed, proven);
  const rules = await store.policies(installationId, accounts);
  const policies = accounts.map((id) => effectivePolicy(rules.agency, rules.accounts[id]));
  return wantedAcrossAccounts(choicesOf(settings), settings.masterSwitch, policies);
}
