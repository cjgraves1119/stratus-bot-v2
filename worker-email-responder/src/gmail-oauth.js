/**
 * Google OAuth — exchange refresh token for access token.
 * Caches access tokens in KV for the lifetime - 5 min.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function getAccessToken(env, refreshToken) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("missing google oauth client config");
  }
  const cacheKey = `gtoken:${await sha256(refreshToken)}`;
  const cached = await env.STATE_KV.get(cacheKey, "json");
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`google oauth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  await env.STATE_KV.put(
    cacheKey,
    JSON.stringify({ token: data.access_token, expiresAt }),
    { expirationTtl: Math.max(60, data.expires_in - 60) },
  );
  return data.access_token;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
