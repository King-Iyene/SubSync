import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { parseSubscription, verifyCall } from "@/lib/workflow-module/core";
import { saveSubscription, tenantOf } from "@/lib/workflow-module/store";
import { wfModuleOn } from "@/lib/workflow-module/runtime";

// The CRM tells SubSync where to send a trigger when a customer adds, edits or removes it in a workflow (the trigger's "Subscription URL").
export const maxDuration = 15;

export async function POST(request: Request) {
  if (maintenanceOn(process.env)) return NextResponse.json({ ok: false }, { status: 503 });
  const text = await request.text();
  if (text.length > 50_000) return NextResponse.json({ ok: false }, { status: 413 });
  const v = verifyCall(request.headers, text, process.env);
  if (!v.ok) return NextResponse.json({ ok: false }, { status: v.status });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const sub = parseSubscription(body); // the address must be https on the CRM's workflow host, or this is null
  if (!sub) return NextResponse.json({ ok: false, message: "Not understood." }, { status: 400 });
  try {
    const tenant = await tenantOf(sub.locationId);
    if (!tenant) return NextResponse.json({ ok: false, message: "This account is not set up in SubSync." }, { status: 403 });
    if (!(await wfModuleOn(tenant.installationId))) return NextResponse.json({ ok: false }, { status: 404 });
    const saved = await saveSubscription(tenant.installationId, sub);
    return NextResponse.json({ ok: saved });
  } catch (error) {
    console.error("Workflow subscription failed", safeError(error));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
