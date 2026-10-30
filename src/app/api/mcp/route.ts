import { demoEnabled } from "@/lib/api/auth";
import { featureOn } from "@/lib/flags";
import { looksLikeKey } from "@/lib/mcp/keys";
import { handleRpc } from "@/lib/mcp/protocol";
import { resolveKey } from "@/lib/mcp/store";
import { buildTools } from "@/lib/mcp/tools";

// Read-only AI connector (Model Context Protocol over HTTP). Authenticated with a personal key
// created in Settings; the key identifies exactly one agency, and every tool is scoped to it.
export const maxDuration = 30;

const unauthorized = (message: string, status = 401) =>
  Response.json({ error: message }, { status, headers: { "WWW-Authenticate": 'Bearer realm="subsync"' } });

// Best-effort per-key rate limit (each server instance keeps its own count).
const windows = new Map<string, { count: number; reset: number }>();
function allowed(keyId: string): boolean {
  const now = Date.now();
  const w = windows.get(keyId);
  if (!w || w.reset < now) {
    windows.set(keyId, { count: 1, reset: now + 60_000 });
    return true;
  }
  return ++w.count <= 60;
}

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!looksLikeKey(key)) return unauthorized("Missing or invalid API key");

  let owner;
  try {
    owner = await resolveKey(key);
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  if (!owner) return unauthorized("Missing or invalid API key");
  if (owner.isDemo && !demoEnabled()) return unauthorized("Demo mode is off", 403);
  if (!(await featureOn("ai"))) return Response.json({ error: "Not found" }, { status: 404 });
  if (!allowed(owner.keyId)) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const response = await handleRpc(body, buildTools(owner.installationId));
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return Response.json({ error: "Use POST with a JSON-RPC body" }, { status: 405, headers: { Allow: "POST" } });
}
