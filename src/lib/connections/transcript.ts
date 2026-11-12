// A call's transcript, read on demand from the person's OWN meeting tool (CLAUDE.md rule 12). Pure shaping plus one small fetch. Nothing here stores anything:
// the words go from the provider to this one answer and on to the screen of the person who connected the tool. Administrators read counts and status, never this.

export type TranscriptLine = { speaker: string; text: string; at: string | null };
export type TranscriptAnswer =
  | { state: "available"; lines: TranscriptLine[]; truncated: boolean }
  | { state: "unavailable"; reason: "no_tool" | "not_supported" | "not_returned" | "reconnect" | "unreachable"; message: string };

export const MAX_LINES = 2_000;
export const UNAVAILABLE_WORDS: Record<Extract<TranscriptAnswer, { state: "unavailable" }>["reason"], string> = {
  no_tool: "Transcript not available from your meeting tool.",
  not_supported: "Transcript not available from your meeting tool.",
  not_returned: "Transcript not available from your meeting tool. It may still be processing, or the recording has none.",
  reconnect: "Needs permission: reconnect your meeting tool, then open this call again.",
  unreachable: "Your meeting tool did not answer. Try again in a moment.",
};
export const unavailable = (reason: keyof typeof UNAVAILABLE_WORDS): TranscriptAnswer => ({ state: "unavailable", reason, message: UNAVAILABLE_WORDS[reason] });

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Fathom answers `{ transcript: [{ speaker: { display_name }, text, timestamp }] }`. Anything else is "not returned": never a guess. */
export function shapeTranscript(body: unknown): TranscriptAnswer {
  const list = body && typeof body === "object" ? (body as { transcript?: unknown }).transcript : null;
  if (!Array.isArray(list)) return unavailable("not_returned");
  const lines: TranscriptLine[] = [];
  for (const raw of list.slice(0, MAX_LINES)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { speaker?: unknown; text?: unknown; timestamp?: unknown };
    const text = str(r.text, 4_000);
    if (!text) continue;
    const sp = r.speaker && typeof r.speaker === "object" ? str((r.speaker as { display_name?: unknown }).display_name, 120) : "";
    lines.push({ speaker: sp || "Speaker", text, at: str(r.timestamp, 20) || null });
  }
  return lines.length === 0 ? unavailable("not_returned") : { state: "available", lines, truncated: list.length > MAX_LINES };
}

type Fetch = typeof fetch;
const FATHOM_API = "https://api.fathom.ai/external/v1";
/** Asks Fathom for one recording's transcript with the person's own access token. A 401 or 403 means "reconnect"; anything else that fails means "try again". */
export async function fetchFathomTranscript(accessToken: string, recordingId: string, f: Fetch = fetch): Promise<TranscriptAnswer> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(recordingId)) return unavailable("not_returned");
  try {
    const r = await f(`${FATHOM_API}/recordings/${encodeURIComponent(recordingId)}/transcript`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401 || r.status === 403) return unavailable("reconnect");
    if (r.status === 404) return unavailable("not_returned");
    if (!r.ok) return unavailable("unreachable");
    return shapeTranscript(await r.json().catch(() => null));
  } catch { return unavailable("unreachable"); }
}

/** What the panel shows for a transcript answer, in one place so the screen and the tests agree. */
export function transcriptView(answer: TranscriptAnswer | null, isOwner: boolean): { kind: "hidden" | "loading" | "lines" | "message"; text: string | null; lines: TranscriptLine[] } {
  if (!isOwner) return { kind: "hidden", text: "Only the person who connected the meeting tool can read a transcript. Administrators see counts, never what was said.", lines: [] };
  if (answer === null) return { kind: "loading", text: null, lines: [] };
  return answer.state === "available" ? { kind: "lines", text: null, lines: answer.lines } : { kind: "message", text: answer.message, lines: [] };
}
