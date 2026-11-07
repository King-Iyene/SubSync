// Workflow provisioner naming (white-label safe). The names a customer sees in their CRM (folder, workflow, tag) never carry the product or the platform's name.
// The internal template key lives only in our own table, so a person renaming a folder or a workflow breaks nothing.
export const DEFAULT_FOLDER = "Lead Response Automations";
export const DEFAULT_CALL_TAG = "call-now";
const VENDOR = /sub\s*sync|go\s*high\s*level|high\s*level|\bghl\b|lead\s*connector/i;
export const hasVendorWord = (s: string): boolean => VENDOR.test(s);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 &'._-]{1,58}$/;

/** A name is usable when it is plain text of a sane length and carries no vendor word. */
export const neutralName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return NAME_RE.test(t) && !hasVendorWord(t) ? t : null;
};

/** The folder name: a name typed for the account wins, then "<Brand> Automations" when the company has its own brand switched on, then the plain default. */
export function folderNameFor(o: { custom?: string | null; brand?: { whiteLabel: boolean; name: string | null } | null }): string {
  const custom = neutralName(o.custom);
  if (custom) return custom;
  if (o.brand?.whiteLabel && o.brand.name) {
    const b = neutralName(`${o.brand.name} Automations`);
    if (b) return b;
  }
  return DEFAULT_FOLDER;
}
