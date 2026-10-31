import { routeAllowed, type AccessKind } from "../access";
import { demoAllowed, MAINTENANCE_MESSAGE, maintenanceOn } from "../runtime-guards";
import { type entitlements, type Plan } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { clientViewOn, getInstallation } from "../ghl/installations";
import { bearerToken, verifySession, type Session } from "../session";

export type AuthContext = {
  session: Session;
  installationId: string;
  plan: Plan;
  demo: boolean;
  entitlements: ReturnType<typeof entitlements>;
  /** agency (everything), business (one account, full tools) or client (one account, read-only). */
  kind: AccessKind;
  /** For a business or client session, the one account every query is limited to. Otherwise null. */
  limitTo: string | null;
};

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const demoEnabled = () => demoAllowed(process.env);

// Resolve the caller from the signed Bearer session, then load their installation.
// Everything downstream is scoped by the installation id returned here, and for a business or
// client session also by the single account id in `limitTo`.
export async function authenticate(request: Request, segments: string[] = []): Promise<AuthContext | Response> {
  if (maintenanceOn(process.env)) return json({ error: MAINTENANCE_MESSAGE, maintenance: true }, 503);
  let session: Session | null = null;
  try {
    session = verifySession(bearerToken(request));
  } catch {
    return json({ error: "Sign-in is not configured" }, 503);
  }
  if (!session) return json({ error: "Please sign in again" }, 401);

  const kind: AccessKind = session.kind === "business" || session.kind === "client" ? session.kind : "agency";
  const limitTo = kind === "agency" ? null : session.locationId ?? null;
  // A limited session without an account is malformed: refuse rather than fall back to everything.
  if (kind !== "agency" && !limitTo) return json({ error: "Please sign in again" }, 401);
  if (!routeAllowed(kind, request.method, segments)) {
    return json({ error: "This page is not available in your view of SubSync", forbidden: true }, 403);
  }

  if (session.demo) {
    if (!demoEnabled()) return json({ error: "Demo mode is off" }, 403);
    const { ensureDemo } = await import("../demo/seed");
    const installationId = await ensureDemo();
    return { session, installationId, plan: "pro", demo: true, entitlements: await resolveEntitlements("pro", installationId, true), kind, limitTo };
  }

  const installation = await getInstallation(session.companyId);
  if (!installation) return json({ error: "SubSync is not installed for this account", forbidden: true }, 403);
  // The agency can switch a client's view off at any time; do not wait for the session to expire.
  if (kind === "client" && !(await clientViewOn(session.companyId, limitTo as string))) {
    return json({ error: "Your agency has turned this view off", forbidden: true }, 403);
  }
  return {
    session,
    installationId: installation.id,
    plan: installation.plan,
    demo: false,
    entitlements: await resolveEntitlements(installation.plan, installation.id),
    kind,
    limitTo,
  };
}

export function isResponse(value: AuthContext | Response): value is Response {
  return value instanceof Response;
}
