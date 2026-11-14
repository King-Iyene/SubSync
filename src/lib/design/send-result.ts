/** The one line shown after a change. A message is "Sent." or "Not sent: sending is switched off." (the server's own reason follows when it gave one); never blank. */
export function resultText(kind: string, dry: boolean, message?: string, summary?: string): string {
  const rest = (summary ?? "").trim();
  if (kind === "message") {
    if (dry) {
      // The server's own "Preview only: ..." sentence already says everything: show it as it is.
      if (/^preview only/i.test(message?.trim() ?? "")) return (message as string).trim();
      const why = message?.trim() ? message.trim().replace(/^not sent:?\s*/i, "").replace(/^nothing was sent\.?\s*/i, "sending is switched off. ") : "sending is switched off.";
      return `Not sent: ${why} ${rest}`.replace(/\s+/g, " ").trim();
    }
    return `Sent. ${rest}`.trim();
  }
  if (dry) return `${message?.trim() || "Nothing was sent."} ${rest}`.trim();
  return `Done. ${rest}`.trim();
}
