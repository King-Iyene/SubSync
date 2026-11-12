import { NextResponse, type NextRequest } from "next/server";
import { proofGate } from "@/lib/proof-gate";

// Runs before a page is drawn. Today it has one job: the public monthly report at /proof/<token> answers a real 404 for any link that does not open (see src/lib/proof-gate.ts).
export async function proxy(request: NextRequest) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const stop = await proofGate(request.nextUrl.pathname, ip);
  return stop ?? NextResponse.next();
}

export const config = { matcher: ["/proof", "/proof/:path*"] };
