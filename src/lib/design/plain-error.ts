// A failed request in plain words. A customer never sees "Request failed (403)": the server's own sentence is used when it sent one (`error` or `message`), and otherwise the status is turned into a sentence.
// Pure and tested.

const BY_STATUS: Record<number, string> = {
  400: "SubSync could not use what was sent. Check it and try again.",
  401: "Your session ended. Reopen SubSync and try again.",
  403: "You are not allowed to do this here. Sending may be switched off for this account, or it needs an administrator.",
  404: "SubSync could not find that. It may have been removed.",
  408: "This is taking too long. Nothing was lost: try again in a moment.",
  409: "This changed while you were looking. Check it and try again.",
  422: "SubSync cannot do this yet. Read the note above and fix it first.",
  429: "Slow down a little and try again in a moment.",
};

export function plainError(status: number, body: Record<string, unknown> | null | undefined): string {
  const own = (k: string) => { const v = body?.[k]; return typeof v === "string" && v.trim() ? v.trim() : null; };
  const said = own("error") ?? own("message");
  if (said) return said;
  if (status === 0) return "SubSync could not be reached. Check your connection and try again.";
  if (BY_STATUS[status]) return BY_STATUS[status];
  return status >= 500 ? "Something went wrong on our side. Nothing was changed. Try again in a moment." : "That did not work. Nothing was changed. Try again.";
}

/** What to say when a send needs a tick that was not given. The words follow the warning that is waiting. */
export function needsTickText(warnings: Array<{ id: string; text?: string }>): string {
  if (warnings.some((w) => w.id === "quiet_hours")) return "Tick the box to confirm you want to send outside 8am-9pm.";
  return "Tick the box to confirm you want to go ahead.";
}
