import { outward, type Deps } from "../live-flags";
import { appUrl, startLink } from "./flow";
import { connectError } from "./messages";
import { createFathomWebhook, exchangeCode, fetchZoomUser, keysFor, redirectUri, testFathom, type Failed } from "./oauth";
import { accessTokenFor, dropProviderSide, newPublicKey, saveConnection, startPending, type SecretRow } from "./personal";
import { sql } from "../db";
import type { Role } from "../identity";
import type { Person } from "./person";
import type { OAuthState } from "./state";

// Connecting your OWN tool (INTEGRATIONS_SPEC section 2). The person is named by the signed session when the sign-in starts, carried through the
// provider in the signed state, and checked again when the provider sends them back. Nothing here takes a person, an account or an id from the
// browser. A person's connection works for every account they can open: it is never tied to one client account.

export type PersonalProviderNow = "fathom" | "zoom";
export const START_PROVIDERS: readonly PersonalProviderNow[] = ["fathom", "zoom"];

export async function startPersonal(person: Person, installationId: string, provider: PersonalProviderNow): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const link = startLink(provider, {
    provider, installationId, onlyLocationId: person.homeLocationId, actor: person.userId,
    person: { userId: person.userId, companyKey: person.companyKey, name: person.name, home: person.homeLocationId, role: person.role },
  });
  if (!link.ok) return link;
  await startPending(person, installationId, provider);
  return link;
}

type Done = { ok: true; message: string } | Failed;

const ROLES: readonly Role[] = ["agency_owner", "agency_admin", "agency_staff", "account_admin", "account_user"];
/** The role the signed state carried. Anything unknown is the least privileged one. */
const roleFrom = (v: string | null): Role => (ROLES.find((r) => r === v) ?? "account_user");

/**
 * The provider sent the person back with a code. Exchange it, find out which account they signed in with, create the delivery subscription (only when
 * the meeting-tool switch is on: otherwise it is recorded as a dry run and no real subscription exists), and save everything for THIS person.
 */
export async function completePersonal(provider: PersonalProviderNow, code: string, s: OAuthState, f: typeof fetch = fetch, deps: Deps = {}): Promise<Done> {
  const who = s.person;
  if (!who) return connectError("P-STATE", provider === "fathom" ? "Fathom" : "Zoom");
  const keys = keysFor(provider);
  const base = appUrl();
  if (!keys || !base) return connectError("P-OFF", provider === "fathom" ? "Fathom" : "Zoom");
  const person: Person = { companyKey: who.companyKey, userId: who.userId, name: who.name, role: roleFrom(who.role), kind: who.home ? "client" : "agency", homeLocationId: who.home };

  const got = await exchangeCode(provider, code, keys, redirectUri(base, provider), f);
  if (!got.ok) return got;

  let accountEmail: string | null = null;
  if (provider === "zoom") {
    const user = await fetchZoomUser(got.tokens.accessToken, f);
    if (!user.ok) return user;
    accountEmail = user.email;
  }

  let hook: { id: string; secret: string } | null = null;
  let publicKey: string | null = null;
  let deliveryOn = false;
  if (provider === "fathom") {
    const key = newPublicKey();
    const made = await outward(
      { flag: "FATHOM_WEBHOOK_LIVE", verb: "CREATE", what: "fathom.webhook.create", installationId: s.installationId, ids: { userId: who.userId } },
      () => createFathomWebhook(got.tokens.accessToken, `${base}/api/hooks/fathom/${key}`, f), deps,
    );
    if (made.live) {
      if (!made.result.ok) return made.result;
      hook = { id: made.result.id, secret: made.result.secret };
      publicKey = key;
      deliveryOn = true;
    }
  }

  const saved = await saveConnection({ person, installationId: s.installationId, provider, tokens: got.tokens, accountEmail, hook, publicKey });
  // An older connection of the same person (for example from another install) loses its provider-side subscription.
  if (saved.previous?.webhookId) {
    await dropProviderSide({ id: saved.previous.id, installationId: saved.previous.installationId, provider, webhookId: saved.previous.webhookId, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, ghlUserId: who.userId, homeLocationId: who.home, status: "connected" }, f, deps).catch(() => undefined);
  }
  if (provider === "fathom") {
    return { ok: true, message: deliveryOn ? "Connected. New Fathom meetings will arrive for you only." : "Connected. Meetings will start arriving once SubSync's meeting delivery is switched on, which is still being set up." };
  }
  return { ok: true, message: "Connected. Meetings with an AI summary will arrive for you only." };
}

/**
 * "Test connection": ask the provider for something small with this person's own access. A refusal marks the connection as needing a reconnect.
 * The answer is words and a code only: never a token, an email or any meeting content.
 */
export async function testPersonal(row: SecretRow, f: typeof fetch = fetch): Promise<{ ok: true; message: string } | { ok: false; error: string; code?: string }> {
  const name = row.provider === "fathom" ? "Fathom" : "Zoom";
  const token = await accessTokenFor(row, f);
  if (!token) return { ok: false, error: `${name} no longer accepts this connection. Connect again.`, code: "P-AUTH" };
  const result = row.provider === "fathom" ? await testFathom(token, f) : await fetchZoomUser(token, f);
  if (!result.ok) {
    const refused = "status" in result ? result.status === 401 || result.status === 403 : true;
    if (refused) await sql()`update user_connections set status = 'needs_reconnect', last_error_code = 'P-AUTH', updated_at = now() where id = ${row.id}`;
    return { ok: false, error: refused ? `${name} no longer accepts this connection. Connect again.` : `We could not reach ${name}. Try again in a moment.`, code: refused ? "P-AUTH" : "P-NET" };
  }
  await sql()`update user_connections set last_ok_at = now(), last_error_code = null, updated_at = now() where id = ${row.id} and status = 'connected'`;
  return { ok: true, message: `${name} answered. The connection works.` };
}
