// Safety guard shared by the scale scripts: they write thousands of fake rows, so they only run against a local or CI Postgres, never Supabase.
export function assertThrowawayDb(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("Set DATABASE_URL to a throwaway local/CI Postgres (see docs/QA_SCALE.md).");
  let host = "";
  try { host = new URL(url).hostname; } catch { throw new Error("DATABASE_URL is not a valid URL"); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`Refusing to run: DATABASE_URL host "${host}" is not local. This test writes fake data and must never touch the live database.`);
  if (process.env.DATABASE_SSL !== "off") throw new Error("Set DATABASE_SSL=off (the throwaway Postgres has no TLS).");
  return url;
}

export const SCALE = { companyA: "scale-agency-a", companyB: "scale-agency-b", locsA: ["scaleLocA1", "scaleLocA2", "scaleLocA3"], locB: "scaleLocB1" } as const;
