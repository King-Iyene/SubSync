import { coverageFor } from "./health";
import { EMPTY_COUNTS, accountRow, gapAlertDrafts, type AccountRow, type OutcomeCounts } from "./outcomes";
import { outcomeCounts } from "./outcomes-db";
import { accountNames, loadItems } from "./store";

/** The alert drafts for a company's gaps, used by the hourly sweep. Rows come from the same functions the page uses, so an alert and the page can never disagree. */
export async function gapDraftsFor(installationId: string, now: number) {
  const accounts = (await accountNames(installationId, null)).filter((a) => !a.ignored);
  const [counts, { items }] = await Promise.all([outcomeCounts(installationId, accounts.map((a) => a.locationId), new Date(now)), loadItems(installationId, null)]);
  if (!counts) return { rows: [] as AccountRow[], drafts: [] as ReturnType<typeof gapAlertDrafts>, counts: new Map<string, OutcomeCounts>() };
  const known = new Set(items.map((w) => w.locationId));
  const rows = accounts.map((a) => accountRow(a, counts.get(a.locationId) ?? EMPTY_COUNTS, { known: known.has(a.locationId), have: known.has(a.locationId) ? coverageFor(a.locationId, items).have : [] }));
  return { rows, drafts: gapAlertDrafts(rows), counts };
}
