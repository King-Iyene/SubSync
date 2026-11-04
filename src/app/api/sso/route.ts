import { NextResponse } from "next/server";
import { decideForIdentity, mayDeleteData, type AccessKind } from "@/lib/access";
import { deriveIdentity } from "@/lib/identity";
import { logIdentity } from "@/lib/identity-log";
import { demoEnabled } from "@/lib/api/auth";
import { captureWhitelabelDomain, captureWhitelabelLogo, getSettings } from "@/lib/analytics/queries";
import { resolveEntitlements } from "@/lib/flags";
import { businessInstalled, clientViewOn, getInstallation } from "@/lib/ghl/installations";
import { decryptSsoPayload, parseSsoUser } from "@/lib/ghl/sso";
import { signSession } from "@/lib/session";
import { MAINTENANCE_MESSAGE, maintenanceOn } from "@/lib/runtime-guards";

// The agency's own name and colour, shown in place of ours. Only a plain hex colour is passed on.
async function brandOf(installationId: string) {
  try {
    const s = await getSettings(installationId);
    return { name: s.brandName, color: s.brandColor && /^#[0-9a-f]{6}$/i.test(s.brandColor) ? s.brandColor : null, logoUrl: s.brandLogoUrl };
  } catch {
    return { name: null, color: null, logoUrl: null };
  }
}

// The embedded page posts the encrypted user context it received from its parent frame.
// Decryption happens here, server side, so the shared secret never reaches the browser.
// On success we return a short-lived signed session the page sends with every data request.
//
// Who gets in, and with what (see lib/access.ts):
//   an agency user            -> the agency view (every client account)
//   a client's own staff      -> only their own account: the full tools if their business installed
//                                the app, or a read-only view if their agency switched it on
// Anyone else is refused. The user type comes from the decrypted payload, never from the browser.
export async function POST(request: Request) {
  if (maintenanceOn(process.env)) return NextResponse.json({ error: MAINTENANCE_MESSAGE, maintenance: true }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { payload?: unknown; demo?: unknown; as?: unknown } | null;

  if (body?.demo === true) {
    if (!demoEnabled()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
    const { DEMO_COMPANY_ID, demoFirstLocation } = await import("@/lib/demo/seed");
    // `as` lets demos and screenshots open the limited views: "business", "client", or "location" (an agency person inside one client account).
    const kind: AccessKind = body.as === "business" || body.as === "client" ? body.as : "agency";
    // `as=location`: an agency user who opened SubSync from inside one client account (the platform sends that account with the sign-in).
    const locationId = kind === "agency" ? (body.as === "location" ? await demoFirstLocation() : null) : await demoFirstLocation();
    const user = {
      userId: "demo-user", companyId: DEMO_COMPANY_ID, role: "admin", type: kind === "agency" ? "agency" : "account",
      userName: kind === "agency" ? "Demo Admin" : "Demo Owner", activeLocation: locationId,
    };
    const session = signSession({ companyId: DEMO_COMPANY_ID, userId: user.userId, role: user.role, userName: user.userName, demo: true, kind, locationId, ...(kind === "agency" ? { personRole: "agency_owner" as const } : {}) });
    const demoInstall = await getInstallation(DEMO_COMPANY_ID).catch(() => null);
    const brand = demoInstall ? await brandOf(demoInstall.id) : { name: null, color: null, logoUrl: null };
    return NextResponse.json({ user, installed: true, demo: true, kind, session, entitlements: await resolveEntitlements("pro", undefined, true), brand });
  }

  const sharedSecret = process.env.GHL_SSO_KEY;
  if (!sharedSecret) return NextResponse.json({ error: "SSO is not configured yet" }, { status: 503 });
  if (!body || typeof body.payload !== "string" || body.payload.length > 10_000) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let user;
  let identity;
  try {
    const decrypted = decryptSsoPayload(body.payload, sharedSecret);
    user = parseSsoUser(decrypted);
    identity = deriveIdentity(decrypted);
  } catch {
    return NextResponse.json({ error: "Could not verify the user" }, { status: 401 });
  }
  if (!identity) {
    await logIdentity(null, null, "bad_payload");
    return NextResponse.json({ error: "This user type cannot open SubSync." }, { status: 403 });
  }

  let decision;
  try {
    decision = await decideForIdentity(identity, {
      agencyInstalled: async (companyId) => (await getInstallation(companyId)) !== null,
      businessInstalled,
      clientViewOn,
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the database. Please refresh." }, { status: 503 });
  }
  if (!decision.ok) {
    const known = identity.companyId ? await getInstallation(identity.companyId).catch(() => null) : null;
    await logIdentity(known?.id ?? null, identity, decision.status === 200 ? "not_installed" : "denied");
    // "Not installed" is a normal first-run state the page explains; everything else is a refusal.
    if (decision.status === 200) return NextResponse.json({ user, installed: false });
    return NextResponse.json({ error: decision.message }, { status: 403 });
  }

  let installation;
  try {
    installation = await getInstallation(decision.companyKey);
  } catch {
    return NextResponse.json({ error: "Could not reach the database. Please refresh." }, { status: 503 });
  }
  if (!installation) {
    await logIdentity(null, identity, "not_installed");
    return NextResponse.json({ user, installed: false });
  }
  await logIdentity(installation.id, identity, "ok");
  // An agency that resells the platform under its own domain gets links on that domain.
  if (user.whitelabelDomain) await captureWhitelabelDomain(installation.id, user.whitelabelDomain, "sso").catch(() => undefined);
  if (user.whitelabelLogoUrl) await captureWhitelabelLogo(installation.id, user.whitelabelLogoUrl).catch(() => undefined);

  const session = signSession({
    companyId: decision.companyKey, userId: user.userId, role: user.role, userName: user.userName, demo: false,
    kind: decision.kind, locationId: decision.locationId, dataOwner: mayDeleteData(identity, decision.kind), personRole: identity.role,
  });
  return NextResponse.json({ user, installed: true, kind: decision.kind, session, entitlements: await resolveEntitlements(installation.plan, installation.id), brand: await brandOf(installation.id) });
}
