// Facts the three legal pages share. Wording that needs a lawyer or a fact check is listed in docs/LEGAL_REVIEW_TODO.md, not on the pages.
export const LEGAL_UPDATED = "13 November 2026";

/**
 * Governing law and where disputes are heard. NOT decided: it must be confirmed by a lawyer. While this is null the Terms page leaves the clause out entirely
 * (it never prints a placeholder). It is a blocking item in docs/SITE.md and docs/LEGAL_REVIEW_TODO.md. Set it to the real sentence when it is known.
 */
export const GOVERNING_LAW: string | null = null;

/** Where the data sits. Database region VERIFIED in docs/QA_ROUND3.md (AWS us-east-1); the app's own region is the hosting default. Re-check before launch (docs/SITE.md TODO). */
export const DATA_LOCATION = "Our database runs in the United States (Amazon Web Services, us-east-1), and the app runs on our hosting provider's default United States region.";
