import { entitlements, type Plan } from "../entitlements";
import { getInstallation } from "../ghl/installations";
import { bearerToken, verifySession, type Session } from "../session";

export type AuthContext = {
  session: Session;
  installationId: string;
  plan: Plan;
  demo: boolean;
  entitlements: ReturnType<typeof entitlements>;
};

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const demoEnabled = () => process.env.DEMO_MODE === "true";

// Resolve the caller from the signed Bearer session, then load their installation.
// Everything downstream is scoped by the installation id returned here.
export async function authenticate(request: Request): Promise<AuthContext | Response> {
  let session: Session | null = null;
  try {
    session = verifySession(bearerToken(request));
  } catch {
    return json({ error: "Sign-in is not configured" }, 503);
  }
  if (!session) return json({ error: "Please sign in again" }, 401);

  if (session.demo) {
    if (!demoEnabled()) return json({ error: "Demo mode is off" }, 403);
    const { ensureDemo } = await import("../demo/seed");
    const installationId = await ensureDemo();
    return { session, installationId, plan: "paid", demo: true, entitlements: entitlements("paid") };
  }

  const installation = await getInstallation(session.companyId);
  if (!installation) return json({ error: "SubSync is not installed for this agency" }, 403);
  return {
    session,
    installationId: installation.id,
    plan: installation.plan,
    demo: false,
    entitlements: entitlements(installation.plan),
  };
}

export function isResponse(value: AuthContext | Response): value is Response {
  return value instanceof Response;
}
