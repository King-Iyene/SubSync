// The demo's screens read a remote database and each one needs a dozen scans, so a screen could take 5 to 20 seconds (Today asks for twenty answers at once). The demo's numbers do not
// change while someone is taking screenshots, so every finished GET answer of a DEMO session is kept for a while in this server's memory and a second open is instant.
// Only demo sessions reach this (the demo login is refused in production, see runtime-guards.ts); keys hold the installation and the kind of session, so nothing is ever shared across
// sessions of a different kind; any change made through the app (POST, PUT, DELETE) empties it; "Try again" (_r) bypasses it. Pure in-memory: gone when the server stops.
type Held = { at: number; status: number; type: string; body: string };
const HELD_MS = 20 * 60_000;
const held = new Map<string, Held>();
const running = new Map<string, Promise<Held>>();

export function forgetDemoAnswers(): void { held.clear(); running.clear(); }

export async function demoRead(key: string, bypass: boolean, make: () => Promise<Response>): Promise<Response> {
  const now = Date.now();
  const hit = bypass ? undefined : held.get(key);
  if (hit && now - hit.at < HELD_MS) return reply(hit);
  let p = bypass ? undefined : running.get(key);
  if (!p) {
    p = (async () => {
      const r = await make();
      return { at: Date.now(), status: r.status, type: r.headers.get("Content-Type") ?? "application/json", body: await r.text() };
    })();
    running.set(key, p);
    const done = () => { if (running.get(key) === p) running.delete(key); };
    p.then(done, done);
  }
  const out = await p;
  // Only a good JSON answer is kept (an error, or a file download, is always made again).
  if (out.status === 200 && out.type.includes("json")) held.set(key, out);
  return reply(out);
}

const reply = (h: Held): Response => new Response(h.body, { status: h.status, headers: { "Content-Type": h.type, "Cache-Control": "no-store" } });
