import type { Account } from "./config.js";

type Cached = { token: string; expiresAt: number };
const cache = new Map<string, Cached>();

/**
 * Trades the stored refresh token for a short-lived access token.
 * The cache only lives as long as the process (one warm serverless instance).
 */
export async function getAccessToken(account: Account): Promise<string> {
  if (!account.oauth) throw new Error(`account "${account.id}" has no oauth settings`);
  const hit = cache.get(account.id);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: account.oauth.clientId,
    refresh_token: account.oauth.refreshToken,
    scope: account.oauth.scope,
  });
  if (account.oauth.clientSecret) body.set("client_secret", account.oauth.clientSecret);

  const res = await fetch(account.oauth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `OAuth token refresh failed for "${account.id}": ${json.error ?? res.status} ${json.error_description ?? ""}`.trim(),
    );
  }
  cache.set(account.id, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}
