// The small piece of the documentation the APP needs: which public page explains an in-app guide. Kept apart from docs.ts so the app screens do not pull in all
// the page text. Written once here and checked against docs.ts by src/lib/__tests__/site-docs.test.ts (every guide id maps to a page that exists).
export const GUIDE_DOC: Readonly<Record<string, string>> = {
  today: "today", speed: "speed-to-lead", appointments: "appointments", clients: "clients", payments: "money-and-wallet", people: "find-a-lead", audit: "account-audit",
  cleanup: "clean-up", team: "team", pipeline: "funnel-and-pipeline", meetings: "meeting-notes", workflows: "workflows", "data-health": "data-health", settings: "settings",
  "conn-email": "email-sender-health", "conn-calendars": "calendars", "conn-slack": "connections", "conn-fathom": "connections", "conn-ai": "connections",
  "what-is-speed-to-lead": "what-is-speed-to-lead", "show-rate": "show-rate", "stale-deals": "stale-deals", "duplicate-certainty": "duplicate-certainty", roles: "roles",
  "call-queue-tags": "call-queue-tags", "pipeline-replay": "pipeline-replay", "pipeline-river": "pipeline-river", alerts: "alerts", "report-sharing": "report-sharing",
  "print-and-pdf": "print-and-pdf", "fathom-unmatched": "fathom-unmatched", safety: "safety-and-sending", permissions: "permissions",
  "settings-replies": "settings-replies", "settings-brand": "settings-brand", "settings-notifications": "settings-notifications", "settings-integrations": "settings-integrations",
  "settings-team": "settings-team", "settings-data": "settings-data", "settings-sync": "settings-sync", "settings-advanced": "settings-advanced",
  "billing-and-plans": "billing-and-plans", feedback: "feedback", "whats-new": "whats-new",
};

/** The public page for an in-app guide (with the guide as the anchor), or null when it has none. */
export const guideDocHref = (guideId: string): string | null => (GUIDE_DOC[guideId] ? `/support/${GUIDE_DOC[guideId]}#${guideId}` : null);
