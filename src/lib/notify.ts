import { isSlackWebhook } from "./analytics/derive";

// Post a plain message to a Slack incoming webhook. Only hooks.slack.com URLs are allowed, so a
// saved setting can never make the server call an arbitrary address.
export async function postToSlack(url: string | null | undefined, text: string): Promise<boolean> {
  if (!isSlackWebhook(url)) return false;
  try {
    const response = await fetch(url as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
