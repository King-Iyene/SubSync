// How a person or a contact is named on screen. Pure (no database, no network), so it is unit tested.
//
// Two rules came out of the review (N21, N30, S3-a): a screen never shows a raw user id or a placeholder such as "Team member ZWol", and a name typed
// in lower case in the CRM ("abbi", "the real estate blueprint") is shown in proper case. A person who replied is named from the team list the app
// reads from the CRM and keeps; when that list cannot name them, the screen says why in words.

const SMALL = new Set(["and", "or", "of", "the", "de", "da", "di", "del", "la", "le", "van", "von", "der", "den", "du", "al", "el", "bin", "ibn", "at", "in", "on", "for", "to", "a"]);

const cap = (w: string) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1));

// Names that are all lower case or all upper case are title-cased; a name with mixed case ("McDonald", "DeShawn", "KD Squares") was typed on purpose and
// is left alone. Phone numbers and email addresses have nothing to fix. Small joining words stay lower case in the middle of a name.
export function properCase(input: string | null | undefined): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text === "" || /@/.test(text) || !/[a-z]/i.test(text)) return text;
  const hasLower = /[a-z]/.test(text), hasUpper = /[A-Z]/.test(text);
  if (hasLower && hasUpper) return text;
  const words = text.toLowerCase().split(" ");
  return words.map((word, i) => {
    if (i > 0 && SMALL.has(word)) return word;
    // Capitalise after a hyphen or an apostrophe too: "mary-jane" and "o'brien".
    return word.split("-").map((part) => part.split("'").map(cap).join("'")).join("-");
  }).join(" ");
}

export type UsersState = "ok" | "needs_permission" | "error" | null | undefined;
export type KnownUser = { name: string; photoUrl?: string | null };
export type PersonState = "named" | "former" | "needs_permission" | "unavailable";
export type PersonLabel = { label: string; state: PersonState; photoUrl: string | null; initials: string };

export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} '-]/gu, " ").split(/[ -]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0], last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export const FORMER_TEAM_MEMBER = "Former team member";
export const NEEDS_PERMISSION_LABEL = "Needs permission: reconnect";
export const NAME_NOT_LOADED = "Name not loaded yet";

// Who a user id is. `known` is the app's saved list of team names (read from the CRM's users list, or typed by the owner); `usersAccess` is how the last
// read of that list went for the account the person belongs to. A user the list does not know is a former team member when the list was read fine (the CRM
// no longer has them), and a permission problem when it could not be read. Never the id itself.
export function resolveUser(userId: string, known: ReadonlyMap<string, KnownUser>, usersAccess: UsersState): PersonLabel {
  const hit = known.get(userId);
  if (hit && hit.name.trim() !== "") {
    const label = properCase(hit.name);
    return { label, state: "named", photoUrl: hit.photoUrl ?? null, initials: initialsOf(label) };
  }
  if (usersAccess === "needs_permission") return { label: NEEDS_PERMISSION_LABEL, state: "needs_permission", photoUrl: null, initials: "?" };
  if (usersAccess === "ok") return { label: FORMER_TEAM_MEMBER, state: "former", photoUrl: null, initials: "?" };
  return { label: NAME_NOT_LOADED, state: "unavailable", photoUrl: null, initials: "?" };
}

// A photo address is only passed to the browser when it is a plain https address (the CRM's own picture host); anything else is dropped.
export function safePhotoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 500) return null;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null; } catch { return null; }
}
