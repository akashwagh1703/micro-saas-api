/** Cleans Meta Graph API tokens pasted from docs, Graph Explorer, or curl. */
export function normalizeMetaAccessToken(raw: string | null | undefined): string {
  if (!raw) {
    return '';
  }

  let token = String(raw).trim();
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }

  token = token.replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  return token;
}

export function normalizeMetaPageId(raw: string | null | undefined): string {
  if (!raw) {
    return '';
  }
  return String(raw).trim().replace(/\D/g, '');
}

export function metaAccessTokenHint(message: string | undefined): string | undefined {
  if (!message) {
    return message;
  }
  const lower = message.toLowerCase();
  if (lower.includes('cannot parse access token') || lower.includes('invalid oauth access token')) {
    return (
      'Invalid Page access token. Use a long-lived Facebook Page token (not a User token or App token). ' +
      'Paste only the token string — no "Bearer " prefix, quotes, or JSON. Save credentials, then Test again.'
    );
  }
  return message;
}
