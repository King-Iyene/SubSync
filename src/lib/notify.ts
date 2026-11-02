import { isSlackWebhook } from "./analytics/derive";
import { outward } from "./live-flags";

// Post a plain message to a Slack incoming webhook. Only hooks.slack.com URLs are allowed, so a
// saved setting can never make the server call an arbitrary address.
// Every Slack post in the app goes through the SEND_SLACK_LIVE switch (src/lib/live-flags.ts): with it off the request is described in the log and the audit
// table ("WOULD SEND ...", no text) and nothing is sent. A dry run answers true, so the caller carries on as if it had been posted.
export async function postToSlack(url: string | null | undefined, text: string, opts: { installationId?: string | null; what?: string } = {}): Promise<boolean> {
  if (!isSlackWebhook(url)) return false;
  const out = await outward({ flag: "SEND_SLACK_LIVE", verb: "SEND", what: opts.what ?? "slack.post", installationId: opts.installationId ?? null }, async () => {
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
  });
  return out.live ? out.result : true;
}
