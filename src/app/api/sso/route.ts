import { NextResponse } from "next/server";
import { decryptSsoPayload, parseSsoUser } from "@/lib/ghl/sso";
import { isInstalled } from "@/lib/ghl/installations";

// The embedded page posts the encrypted user context it received from its parent frame.
// Decryption happens here, server side, so the shared secret never reaches the browser.
export async function POST(request: Request) {
  const sharedSecret = process.env.GHL_SSO_KEY;
  if (!sharedSecret) {
    return NextResponse.json({ error: "SSO is not configured yet" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { payload?: unknown } | null;
  if (!body || typeof body.payload !== "string" || body.payload.length > 10_000) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let user;
  try {
    user = parseSsoUser(decryptSsoPayload(body.payload, sharedSecret));
  } catch {
    return NextResponse.json({ error: "Could not verify the user" }, { status: 401 });
  }
  if (!user.companyId) {
    return NextResponse.json({ error: "No agency in the user context" }, { status: 401 });
  }

  let installed: boolean | null = null;
  try {
    installed = await isInstalled(user.companyId);
  } catch {
    installed = null;
  }

  return NextResponse.json({ user, installed });
}
