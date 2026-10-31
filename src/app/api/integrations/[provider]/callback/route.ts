import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { completeSignIn, NAMES } from "@/lib/connections/flow";
import { featureOn } from "@/lib/flags";
import { isProvider, verifyState } from "@/lib/connections/state";

// Where Slack, Fathom and Zoom send a person back after they approve (or refuse) SubSync. This page is
// opened in a small window from Settings. The signed "state" says which install started it, so no login
// cookie is needed. It shows the result and closes itself.
export const maxDuration = 30;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(ok: boolean, title: string, message: string, provider: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f6f3ec;color:#1d2a2a}
main{max-width:26rem;margin:1rem;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}
h1{font-size:1.25rem;margin:.5rem 0}p{color:#516060;line-height:1.5}.mark{font-size:2rem}</style></head>
<body><main><div class="mark">${ok ? "✓" : "!"}</div><h1>${esc(title)}</h1><p>${esc(message)}</p><p><small>You can close this window and go back to SubSync.</small></p></main>
<script>try{if(window.opener){window.opener.postMessage({subsync:"connection",provider:${JSON.stringify(provider)},ok:${ok ? "true" : "false"}},location.origin)}}catch(e){}${ok ? "setTimeout(function(){window.close()},1800)" : ""}</script></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProvider(provider) || !(await featureOn("connections"))) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const state = verifyState(url.searchParams.get("state"), provider);
  if (!state) return page(false, "This link has expired", "Go back to SubSync and press Connect again.", provider);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return page(false, `${NAMES[provider]} was not connected`, "The request was cancelled, so nothing was changed.", provider);
  try {
    const done = await completeSignIn(provider, code, state);
    return done.ok ? page(true, `${NAMES[provider]} connected`, done.message, provider) : page(false, `${NAMES[provider]} was not connected`, done.error, provider);
  } catch (error) {
    console.error("Connecting failed", provider, safeError(error));
    return page(false, `${NAMES[provider]} was not connected`, "Something went wrong on our side. Nothing was changed. Try again in a moment.", provider);
  }
}
