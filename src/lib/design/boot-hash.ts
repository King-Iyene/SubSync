// The address the app was opened with, kept before the shell rewrites it. A link from a message can carry an extra instruction (for example "open this source's
// bad records"); the shell keeps only the parts it knows when it rewrites the address, so a page that wants such an instruction reads it from here, once.

export const BOOT_HASH: string = typeof window === "undefined" ? "" : window.location.hash;

let used = false;
/** The extra address parts for one page, once: the first page that asks for this view gets them, and nothing later re-opens it. */
export function takeBootParams(view: string): URLSearchParams | null {
  if (used || typeof window === "undefined") return null;
  const raw = BOOT_HASH.replace(/^#/, "");
  const q = raw.indexOf("?");
  if (q === -1 || raw.slice(0, q) !== view) return null;
  used = true;
  return new URLSearchParams(raw.slice(q + 1));
}
