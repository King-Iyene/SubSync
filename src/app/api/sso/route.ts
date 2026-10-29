import { NextResponse } from "next/server";
import { demoEnabled } from "@/lib/api/auth";
import { entitlements } from "@/lib/entitlements";
import { getInstallation } from "@/lib/ghl/installations";
import { decryptSsoPayload, parseSsoUser } from "@/lib/ghl/sso";
import { signSession } from "@/lib/session";

// The embedded page posts the encrypted user context it received from its parent frame.
// Decryption happens here, server side, so the shared secret never reaches the browser.
// On success we return a short-lived signed session the page sends with every data request.
//
// SubSync shows every client account's data, so it is for AGENCY users only: a user who
// belongs to a single client account is refused, even if the payload is otherwise valid.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { payload?: unknown; demo?: unknown } | null;

  if (body?.demo === true) {
    if (!demoEnabled()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
    const { DEMO_COMPANY_ID } = await import("@/lib/demo/seed");
    const user = { userId: "demo-user", companyId: DEMO_COMPANY_ID, role: "admin", type: "agency", userName: "Demo Admin", activeLocation: null };
    const session = signSession({ companyId: DEMO_COMPANY_ID, userId: user.userId, role: user.role, userName: user.userName, demo: true });
    return NextResponse.json({ user, installed: true, demo: true, session, entitlements: entitlements("paid") });
  }

  const sharedSecret = process.env.GHL_SSO_KEY;
  if (!sharedSecret) return NextResponse.json({ error: "SSO is not configured yet" }, { status: 503 });
  if (!body || typeof body.payload !== "string" || body.payload.length > 10_000) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let user;
  try {
    user = parseSsoUser(decryptSsoPayload(body.payload, sharedSecret));
  } catch {
    return NextResponse.json({ error: "Could not verify the user" }, { status: 401 });
  }
  if (!user.companyId) return NextResponse.json({ error: "No agency in the user context" }, { status: 401 });

  if ((user.type ?? "").toLowerCase() !== "agency") {
    return NextResponse.json(
      { error: "SubSync is available to agency users only.", receivedType: user.type ?? null },
      { status: 403 },
    );
  }

  let installation = null;
  try {
    installation = await getInstallation(user.companyId);
  } catch {
    return NextResponse.json({ error: "Could not reach the database. Please refresh." }, { status: 503 });
  }
  if (!installation) return NextResponse.json({ user, installed: false });

  const session = signSession({
    companyId: user.companyId, userId: user.userId, role: user.role, userName: user.userName, demo: false,
  });
  return NextResponse.json({ user, installed: true, session, entitlements: entitlements(installation.plan) });
}
