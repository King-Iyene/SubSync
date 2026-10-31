// Every API route and page, and the guard that protects it. "No route without a guard": tests/unit/route-registry.test.ts
// walks the source tree and fails for any route missing here or from docs/TENANCY.md.
export type GuardKind = "session" | "signature" | "secret" | "token" | "state" | "api_key" | "redirect_only" | "public_by_design" | "public_static";
export type RouteGuard = { route: string; kind: GuardKind; guard: string };

export const ROUTE_GUARDS: RouteGuard[] = [
  { route: "api/app/[...path]", kind: "session", guard: "Signed session from /api/sso (HMAC, one hour). Every call is checked against the route policy for its kind (agency, business, client); every query is scoped by the installation id from the session and, for business and client sessions, by one location id. No id from the request is trusted." },
  { route: "api/sso", kind: "signature", guard: "The user context is decrypted with the app's shared secret; a payload that does not decrypt is refused. The role comes only from that payload. Staff and unknown roles are refused." },
  { route: "api/webhooks/ghl", kind: "signature", guard: "Ed25519 signature on the raw body; duplicates dropped by webhook id. Unsigned or wrongly signed requests get 401 and change nothing." },
  { route: "api/hooks/zoom", kind: "signature", guard: "Zoom's signature over the body with the app's secret token, with a freshness window; unsigned requests refused." },
  { route: "api/hooks/fathom/[key]", kind: "token", guard: "A long random key per connection plus the provider's signature. An unknown key returns 404." },
  { route: "api/hooks/meeting/[token]", kind: "token", guard: "A private address token stored only as a hash; an unknown token returns 404." },
  { route: "api/integrations/[provider]/callback", kind: "state", guard: "A signed, expiring state value tied to the installation that started the sign-in; a forged state returns 400." },
  { route: "api/oauth/callback", kind: "state", guard: "The one-time authorization code from the platform; tokens are stored encrypted for the company in the code's own response." },
  { route: "api/oauth/install", kind: "redirect_only", guard: "Redirects to the platform's install screen. Reads and returns no data." },
  { route: "api/mcp", kind: "api_key", guard: "A per-installation API key, stored hashed; every tool is scoped to that installation." },
  { route: "api/cron/sync", kind: "secret", guard: "Bearer CRON_SECRET; refuses when the secret is missing or wrong. Does nothing while the kill switch is on." },
  { route: "api/cron/daily", kind: "secret", guard: "Bearer CRON_SECRET. Does nothing while the kill switch is on." },
  { route: "api/cron/digest", kind: "secret", guard: "Bearer CRON_SECRET." },
  { route: "api/cron/weekly", kind: "secret", guard: "Bearer CRON_SECRET. Does nothing while the kill switch is on." },
  { route: "/audit/[id]", kind: "public_by_design", guard: "A shared audit snapshot: a 192-bit random id, expires after 30 days, shows totals and finding titles only with account names removed." },
  { route: "/", kind: "public_static", guard: "Marketing page; no tenant data." },
  { route: "/app", kind: "public_static", guard: "The app shell; contains no data. All data comes from /api/app with a signed session." },
  { route: "/installed", kind: "public_static", guard: "Static confirmation page." },
  { route: "/installed/error", kind: "public_static", guard: "Static error page." },
  { route: "/privacy", kind: "public_static", guard: "Static legal page." },
  { route: "/support", kind: "public_static", guard: "Static page." },
  { route: "/terms", kind: "public_static", guard: "Static legal page." },
];
