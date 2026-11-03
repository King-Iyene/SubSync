import { EMPTY_FILTER, filterFromLink, filterToLink, type FilterValue } from "./filters.ts";

// The address of a page inside the app, kept in the part after the # so the browser's Back button, a reload and a pasted link all land where
// the person was, with the same filter (N7, N8). Pure; the shell reads and writes it.
//   #speed                         a page
//   #account=abc123                one client account
//   #speed?industry=clinic&hideTest=1   a page with its filter
export type ViewState = { id: string; locationId?: string };

export function parseHash(hash: string, validIds: readonly string[]): { view: ViewState; filter: FilterValue } {
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const head = q === -1 ? raw : raw.slice(0, q);
  const filter = q === -1 ? EMPTY_FILTER : filterFromLink(raw.slice(q + 1));
  if (head.startsWith("account=") && head.length > 8) {
    let id = "";
    try { id = decodeURIComponent(head.slice(8)); } catch { id = ""; }
    if (/^[A-Za-z0-9_-]{3,64}$/.test(id)) return { view: { id: "account", locationId: id }, filter };
    return { view: { id: "today" }, filter };
  }
  return { view: { id: validIds.includes(head) ? head : "today" }, filter };
}

// `ranges` is the card ranges (`r.speed-trend=30d.prev`, see range.ts) to keep when only the filter changes.
export function buildHash(view: ViewState, filter: FilterValue, ranges = ""): string {
  const head = view.id === "account" && view.locationId ? `account=${encodeURIComponent(view.locationId)}` : view.id;
  const q = [filterToLink(filter), ranges].filter(Boolean).join("&");
  return `#${head}${q ? `?${q}` : ""}`;
}

export const sameView = (a: ViewState, b: ViewState) => a.id === b.id && (a.locationId ?? "") === (b.locationId ?? "");
