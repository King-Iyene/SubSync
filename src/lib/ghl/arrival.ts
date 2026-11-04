import { loadConfigs, writeEnabledFor } from "../analytics/cleanup-config";
import { checkArrival } from "../analytics/prevention";
import { locationAccessToken } from "../sync/engine";
import { safeError } from "../safe-log";
import { tagPossibleDuplicate } from "./crm-gateway";

// What happens when the platform says a contact was created (stage CLEANUP, round 2): the newcomer is compared with the account's contacts within the time of the webhook answer;
// a likely or sure match is remembered (alert and card), and only if this account allowed changes AND turned prevention on does the write gateway add the tag "possible-duplicate".
// Never throws and never delays the answer for more than a couple of seconds.

export async function onContactCreated(installationId: string, companyId: string, locationId: string, body: unknown, actor: string | null = "SubSync"): Promise<void> {
  try {
    const found = await checkArrival(installationId, locationId, body);
    if (!found || found.tier === "maybe") return;
    const cfg = (await loadConfigs(installationId, [locationId])).get(locationId);
    if (!cfg?.preventTag) return;
    const c = (body && typeof body === "object" ? (body as Record<string, unknown>) : {}) as Record<string, unknown>;
    const contactId = String(((c.contact as Record<string, unknown> | undefined)?.id ?? c.id ?? c.contactId ?? ""));
    if (!contactId) return;
    await tagPossibleDuplicate({ installationId, locationId, contactId, actor, optedIn: await writeEnabledFor(installationId, locationId), preventTag: true, token: () => locationAccessToken(companyId, locationId) });
  } catch (error) {
    console.error("Prevention check failed", safeError(error));
  }
}
