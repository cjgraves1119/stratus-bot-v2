/**
 * Gmail API ingestion — polling with historyId cursor.
 *
 * Why polling and not Pub/Sub for POC: Pub/Sub adds GCP infra (subscription,
 * service account, push endpoint auth, ack/retry, message-loss reconciliation).
 * Polling at 60s is enough for OOO use cases and is one less moving part.
 * Dev can swap to watch() + Pub/Sub later — interface is the same envelope.
 *
 * Cursor persistence: KV key `cursor:<path>` stores the last seen historyId.
 * On worker cold start with no cursor, we bootstrap from `users.getProfile`.
 *
 * Reconciliation: if Gmail returns historyId-too-old (404), we fall back to
 * listing messages received in the last 10 minutes and dedupe via KV.
 */

import { getAccessToken } from "./gmail-oauth.js";
import { parseEnvelope } from "./envelope.js";

const PATH_TO_USER = {
  ai_alias: "AI_ALIAS_EMAIL",
  chris_ooo: "CHRIS_EMAIL",
};

const PATH_TO_REFRESH_TOKEN = {
  ai_alias: "GOOGLE_REFRESH_TOKEN_AI",
  chris_ooo: "GOOGLE_REFRESH_TOKEN_CHRIS",
};

export async function pollMailbox(env, path) {
  const userEmail = env[PATH_TO_USER[path]];
  const refreshToken = env[PATH_TO_REFRESH_TOKEN[path]];
  if (!userEmail || !refreshToken) {
    throw new Error(`missing creds for path ${path}`);
  }

  const accessToken = await getAccessToken(env, refreshToken);

  const cursorKey = `cursor:${path}`;
  let cursor = await env.STATE_KV.get(cursorKey);

  // Bootstrap cursor on first run
  if (!cursor) {
    const profile = await gmailFetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/profile`,
      accessToken,
    );
    cursor = String(profile.historyId);
    await env.STATE_KV.put(cursorKey, cursor);
    return []; // first tick: just record the cursor, don't backfill
  }

  // Walk history forward with pagination — DON'T drop messages past first page.
  // Cap at 10 pages per tick to bound work; remaining pages picked up next tick.
  const newMessageIds = new Set();
  let pageToken = null;
  let latestHistoryId = cursor;
  let pages = 0;
  const MAX_PAGES = 10;

  while (pages < MAX_PAGES) {
    let history;
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/history` +
      `?startHistoryId=${cursor}&historyTypes=messageAdded` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    try {
      history = await gmailFetch(url, accessToken);
    } catch (err) {
      // 404: cursor expired (Gmail history retention is ~7d). Fall back to recent messages.
      if (/404|history not found|invalid.*historyId/i.test(err.message)) {
        return fallbackRecentMessages(env, path, userEmail, accessToken);
      }
      throw err;
    }

    for (const h of history.history || []) {
      for (const m of h.messagesAdded || []) {
        if (m.message?.id) newMessageIds.add(m.message.id);
      }
    }
    if (history.historyId) latestHistoryId = String(history.historyId);

    pageToken = history.nextPageToken || null;
    pages += 1;
    if (!pageToken) break;
  }

  // Only advance cursor when we've drained pagination — otherwise next tick re-picks up
  if (!pageToken) {
    await env.STATE_KV.put(cursorKey, latestHistoryId);
  }

  const envelopes = [];
  for (const id of newMessageIds) {
    const msg = await fetchMessage(userEmail, id, accessToken);
    if (msg) envelopes.push(parseEnvelope(msg, { path, recipient: userEmail }));
  }
  return envelopes;
}

async function fallbackRecentMessages(env, path, userEmail, accessToken) {
  // 10-minute window. Combined with KV dedupe, this is safe.
  const tenMinAgo = Math.floor(Date.now() / 1000) - 600;
  const search = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages?q=newer_than:1h&maxResults=50`,
    accessToken,
  );
  const envelopes = [];
  for (const m of search.messages || []) {
    const full = await fetchMessage(userEmail, m.id, accessToken);
    if (!full) continue;
    if ((full.internalDate || 0) / 1000 < tenMinAgo) continue;
    envelopes.push(parseEnvelope(full, { path, recipient: userEmail }));
  }
  // Update cursor to current historyId so we don't re-walk
  const profile = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/profile`,
    accessToken,
  );
  await env.STATE_KV.put(`cursor:${path}`, String(profile.historyId));
  return envelopes;
}

async function fetchMessage(userEmail, id, accessToken) {
  try {
    return await gmailFetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/${id}?format=full`,
      accessToken,
    );
  } catch (err) {
    console.warn(`[intake] message ${id} fetch failed: ${err.message}`);
    return null;
  }
}

async function gmailFetch(url, accessToken) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gmail ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}
