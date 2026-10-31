import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { featureOn } from "@/lib/flags";
import { fetchZoomParticipants } from "@/lib/connections/oauth";
import { accessTokenFor, findZoomByHost, ingestMeeting, removeZoomByHost } from "@/lib/connections/queries";
import { verifyZoom, zoomChallenge } from "@/lib/connections/signatures";
import { parseZoomSummary } from "@/lib/connections/zoom-summary";

// Zoom posts here for every connected person: the one-time address check, "a meeting summary is ready"
// and "someone removed the app". Every real event must carry Zoom's signature made with the app's secret
// token. A summary is saved for each SubSync install that connected the host, so two agencies never see
// each other's meetings.
export const maxDuration = 30;
const MAX_BYTES = 400_000;

export async function POST(request: Request) {
  if (!(await featureOn("connections"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secretToken) return NextResponse.json({ error: "Not switched on" }, { status: 503 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "That is too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }

  // Zoom checks the address once, before it sends anything: answer with the token it expects.
  if (body.event === "endpoint.url_validation") {
    const plain = (body.payload as Record<string, unknown> | undefined)?.plainToken;
    return typeof plain === "string" && plain.length < 200 ? NextResponse.json(zoomChallenge(plain, secretToken)) : NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const h = request.headers;
  if (!verifyZoom({ secretToken, timestamp: h.get("x-zm-request-timestamp"), signature: h.get("x-zm-signature"), body: text })) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  try {
    if (body.event === "app_deauthorized") {
      const userId = (body.payload as Record<string, unknown> | undefined)?.user_id;
      if (typeof userId === "string" && userId) await removeZoomByHost(userId);
      return NextResponse.json({ ok: true });
    }
    const summary = parseZoomSummary(body);
    if (!summary) return NextResponse.json({ ok: true, ignored: true });
    let saved = 0;
    for (const conn of await findZoomByHost(summary.hostId)) {
      // Who joined is a best-effort extra. A demo install never calls out.
      const token = conn.isDemo ? null : await accessTokenFor(conn);
      const attendees = token ? await fetchZoomParticipants(token, summary.uuid, summary.hostEmail) : [];
      const result = await ingestMeeting(conn, { ...summary.meeting, attendees }, `zoom:${summary.uuid}`.slice(0, 200));
      if (result.saved) saved += 1;
    }
    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    console.error("Handling a Zoom event failed", safeError(error));
    return NextResponse.json({ error: "Could not save that. Try again." }, { status: 500 });
  }
}
