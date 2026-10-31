// Two switches that must be impossible to get wrong. Pure (they take the environment as an argument), so they are tested
// directly. See docs/features/S0.1.md.
export type Env = Record<string, string | undefined>;

// Production by either signal. A preview build has NODE_ENV=production, so it counts too.
export const isProduction = (env: Env): boolean => env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

// The demo login (sample data, no real sign-in). Exact value only, and never in production.
export const demoAllowed = (env: Env): boolean => env.DEMO_MODE === "true" && !isProduction(env);

// The kill switch. While on: no job is queued or run, no emails go out, sign-in and data calls answer 503.
// Install and uninstall bookkeeping keeps running so an uninstall during maintenance still removes data.
export const maintenanceOn = (env: Env): boolean => env.APP_MODE === "maintenance";

export const MAINTENANCE_MESSAGE = "SubSync is down for a short maintenance. It will be back shortly.";
