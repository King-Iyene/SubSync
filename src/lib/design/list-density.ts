// How dense the Unanswered list is. "compact" is one row of about 40 pixels (a table: name, client, owner, channel, wait, flags); "comfortable" keeps a second line under the name.
// Pure, so the choice, the row heights the screen promises and what is kept in the browser are unit tested. Kept per browser (a per-person convenience, never customer data).
export type Density = "compact" | "comfortable";
export const DENSITIES: readonly Density[] = ["compact", "comfortable"];
export const DEFAULT_DENSITY: Density = "compact";
export const DENSITY_KEY = "subsync.unanswered.density";
/** The row heights in pixels on a desktop (a phone shows two small lines at 44 or more). The e2e check measures a real row against these. */
export const ROW_HEIGHT: Record<Density, { min: number; max: number }> = { compact: { min: 36, max: 44 }, comfortable: { min: 52, max: 72 } };
/** A phone row: two lines, never under the 44-pixel tap height, never tall. */
export const PHONE_ROW_HEIGHT = { min: 44, max: 72 };
export const parseDensity = (v: unknown): Density => (v === "comfortable" ? "comfortable" : DEFAULT_DENSITY);
