import { NextResponse } from "next/server";
import { exchangeCode, GhlError } from "@/lib/ghl/client";
import { saveInstallation } from "@/lib/ghl/installations";

export async function GET(request: Request) {
  const done = (path: string) => NextResponse.redirect(new URL(path, request.url));

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return done("/installed/error");

  try {
    const tokens = await exchangeCode(code);
    await saveInstallation(tokens);
    return done("/installed");
  } catch (error) {
    // Log what failed without echoing tokens, codes or request bodies.
    if (error instanceof GhlError) {
      console.error("OAuth code exchange failed", { status: error.status, detail: error.detail });
    } else {
      console.error("Install failed", error instanceof Error ? error.message : "unknown error");
    }
    return done("/installed/error");
  }
}
