// Minimal GHL OAuth client, written against the published OpenAPI spec (apps/oauth.json):
// /oauth/token and /oauth/locationToken take form-encoded bodies; /oauth/installedLocations
// is a GET. Never log request bodies or tokens.

export const GHL_API = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  planId?: string;
  isBulkInstallation?: boolean;
  approvedLocations?: string[];
  approveAllLocations?: boolean;
  installToFutureLocations?: boolean;
};

export type InstalledLocation = {
  _id: string;
  name?: string;
  address?: string;
  isInstalled?: boolean;
  versionId?: string;
  installedAt?: string;
};

export type InstalledLocationsPage = {
  locations: InstalledLocation[];
  count: number;
  installToFutureLocations?: boolean;
};

export class GhlError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`GHL request failed with status ${status}`);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function postForm<T>(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${GHL_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...headers,
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (!response.ok) throw new GhlError(response.status, await response.text());
  return (await response.json()) as T;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return postForm<TokenResponse>("/oauth/token", {
    client_id: required("GHL_CLIENT_ID"),
    client_secret: required("GHL_CLIENT_SECRET"),
    grant_type: "authorization_code",
    code,
    user_type: "Company",
    redirect_uri: required("GHL_REDIRECT_URI"),
  });
}

// Every refresh returns a NEW refresh token and invalidates the old one.
export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return postForm<TokenResponse>("/oauth/token", {
    client_id: required("GHL_CLIENT_ID"),
    client_secret: required("GHL_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Company",
  });
}

// Exchange the agency (Company) token for a token scoped to one client account.
// Needs the oauth.write scope.
export function getLocationToken(
  companyAccessToken: string,
  companyId: string,
  locationId: string,
): Promise<TokenResponse> {
  return postForm<TokenResponse>(
    "/oauth/locationToken",
    { companyId, locationId },
    { Authorization: `Bearer ${companyAccessToken}`, Version: API_VERSION },
  );
}

// List the client accounts where this app is installed. Needs the oauth.readonly scope.
export async function getInstalledLocations(
  companyAccessToken: string,
  companyId: string,
  appId: string,
  page: { skip: number; limit: number },
): Promise<InstalledLocationsPage> {
  const params = new URLSearchParams({
    companyId,
    appId,
    isInstalled: "true",
    skip: String(page.skip),
    limit: String(page.limit),
  });
  const response = await fetch(`${GHL_API}/oauth/installedLocations?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${companyAccessToken}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new GhlError(response.status, await response.text());
  return (await response.json()) as InstalledLocationsPage;
}
