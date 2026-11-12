// "Try again" on a slow screen: how many times it may be pressed and what the person sees after each press. Pure, so it is unit tested.
export const MAX_RETRIES = 3;
/** How long one retry is given before the screen says it is still slow (milliseconds). */
export const RETRY_WAIT_MS = 15_000;

export type RetryView = { kind: "ask" | "progress" | "giveup"; title: string; body: string; button: string | null };

/** `tries` = presses so far; `waiting` = a retry is on its way and has not yet had its time. */
export function retryView(tries: number, waiting: boolean): RetryView {
  if (waiting) return { kind: "progress", title: `Trying again (${tries} of ${MAX_RETRIES})...`, body: "Asking for the numbers again. This can take a few seconds.", button: null };
  if (tries >= MAX_RETRIES) return { kind: "giveup", title: "This is still not loading", body: "Nothing was lost. The numbers are probably being worked out. Wait a minute and reload the page, and tell support if it keeps happening.", button: null };
  return { kind: "ask", title: "This is taking longer than usual", body: "Nothing was lost. The numbers are still being worked out.", button: "Try again" };
}
