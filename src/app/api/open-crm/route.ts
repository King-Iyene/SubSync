import { NextResponse } from "next/server";
import { crmTarget, readLanding } from "@/lib/install-landing";

// "Open SubSync in your CRM" on the install page points here, so the page itself never contains the CRM's address. The signed details from the install are
// checked, the destination is built by the one link helper (the company's own domain, the default host only when none is known), and the person is sent on.
// Nothing here reads the database or needs a sign-in, and no token is ever in the address.
export function GET(request: Request) {
  let landing = null;
  try { landing = readLanding(new URL(request.url).searchParams.get("v")); } catch { landing = null; }
  return NextResponse.redirect(crmTarget(landing).href, 302);
}
