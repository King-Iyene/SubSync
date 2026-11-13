// The deal Health badge: a plain rule on the score the Pipeline already works out (pipeline3-intel dealHealth). No imports, so the browser can use it. The AI never sets or changes it.
export type HealthBand = "healthy" | "needs_look" | "at_risk";
export const HEALTH_WORDS: Record<HealthBand, string> = { healthy: "Healthy", needs_look: "Needs a look", at_risk: "At risk" };
/** 80 and up Healthy, 50 to 79 Needs a look, under 50 At risk. A closed deal has no score and no badge. */
export const bandOf = (score: number | null | undefined): HealthBand | null => (score === null || score === undefined ? null : score >= 80 ? "healthy" : score >= 50 ? "needs_look" : "at_risk");
export const HEALTH_HOW = "Health starts at 100 and loses points for: nobody owning the deal, no value set, sitting in a step longer than that step usually takes in this account, no activity for more than 14 days, a test-looking deal, or Do Not Disturb. A booked appointment adds a little. 80 and up is Healthy, 50 to 79 Needs a look, under 50 At risk. The AI only explains this badge; it does not change it.";
