import { NextResponse } from "next/server";
import { completeAiSignIn } from "@/lib/api/ai-routes";
import { featureOn } from "@/lib/flags";
import { safeError } from "@/lib/safe-log";

// Where OpenRouter (and, once approved, OpenAI) send a person back after they approve or refuse. Opened in a small window from Settings. The single-use state made when the person pressed
// Connect names the company and the person, so no login cookie is needed. The page says what happened, tells Settings, and closes itself. It never shows a key.
export const maxDuration = 30;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(ok: boolean, title: string, message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f6f3ec;color:#262421}main{max-width:26rem;margin:1rem;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}h1{font-size:1.25rem;margin:.5rem 0}p{color:#5e5a53;line-height:1.5}</style></head>
<body><main><div style="font-size:2rem">${ok ? "&#10003;" : "!"}</div><h1>${esc(title)}</h1><p>${esc(message)}</p><p><small>You can close this window and go back.</small></p></main>
<script>try{if(window.opener){window.opener.postMessage({subsync:"connection",provider:"ai",ok:${ok ? "true" : "false"}},location.origin)}}catch(e){}${ok ? "setTimeout(function(){window.close()},1800)" : ""}</script></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: Request) {
  if (!(await featureOn("ai_byo"))) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return page(false, "AI was not connected", "The sign-in was cancelled. Nothing was changed.");
  try {
    const done = await completeAiSignIn(url.searchParams.get("state"), url.searchParams.get("code"));
    return done.ok ? page(true, "AI connected", done.message) : page(false, "AI was not connected", done.error);
  } catch (error) {
    console.error("AI sign-in failed", safeError(error));
    return page(false, "AI was not connected", "Something went wrong on our side. Nothing was changed. Try again in a moment.");
  }
}
