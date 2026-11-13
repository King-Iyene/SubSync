import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { verifyCall } from "@/lib/workflow-module/core";
import { runAction } from "@/lib/workflow-module/runtime";

// A customer's workflow calls SubSync here (custom workflow actions, flag wf_module, default off). The CRM sends the header we define in the developer portal; see docs/WORKFLOW_MODULE_PORTAL_SHEET.md.
export const maxDuration = 30;
const MAX_BYTES = 50_000;

export async function POST(request: Request) {
  if (maintenanceOn(process.env)) return NextResponse.json({ ok: false, message: "SubSync is paused for maintenance." }, { status: 503 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ ok: false, message: "Too large." }, { status: 413 });
  const v = verifyCall(request.headers, text, process.env);
  if (!v.ok) return NextResponse.json({ ok: false, message: "Not allowed." }, { status: v.status });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ ok: false, message: "Send JSON." }, { status: 400 }); }
  try {
    const r = await runAction(body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    console.error("Workflow action failed", safeError(error));
    return NextResponse.json({ ok: false, result: "failed", message: "SubSync could not finish this. Try again later." }, { status: 500 });
  }
}
