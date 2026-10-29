// Minimal GHL OAuth client. Token endpoint is form-encoded; locationToken takes JSON.
// Never log request bodies or tokens.

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
  isBulkInstallation?: boolean;
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

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${GHL_API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  if (!response.ok) throw new GhlError(response.status, await response.text());
  return (await response.json()) as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken({
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
  return postToken({
    client_id: required("GHL_CLIENT_ID"),
    client_secret: required("GHL_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Company",
  });
}

// Exchange the agency (Company) token for a token scoped to one client account.
export async function getLocationToken(
  companyAccessToken: string,
  companyId: string,
  locationId: string,
): Promise<TokenResponse> {
  const response = await fetch(`${GHL_API}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${companyAccessToken}`,
      Version: API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ companyId, locationId }),
    cache: "no-store",
  });
  if (!response.ok) throw new GhlError(response.status, await response.text());
  return (await response.json()) as TokenResponse;
}
