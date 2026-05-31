/** Normalized inbound Instagram DM from Meta webhook payloads. */
export interface ParsedInstagramInboundMessage {
  senderId: string;
  recipientId: string;
  messageId: string;
  text: string;
  timestamp?: number;
  raw: Record<string, unknown>;
}

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
  };
}

/**
 * Parses Meta Instagram / Page messaging webhook payloads.
 * Supports object "instagram" and "page" with entry[].messaging[].
 */
export function parseInstagramWebhookPayload(payload: unknown): ParsedInstagramInboundMessage[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const body = payload as { object?: string; entry?: unknown[] };
  const objectType = body.object ?? '';
  if (objectType !== 'instagram' && objectType !== 'page') {
    return [];
  }

  const results: ParsedInstagramInboundMessage[] = [];

  for (const entry of body.entry ?? []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const messaging = (entry as { messaging?: MessagingEvent[] }).messaging ?? [];
    for (const event of messaging) {
      const parsed = parseMessagingEvent(event);
      if (parsed) {
        results.push(parsed);
      }
    }
  }

  return results;
}

function parseMessagingEvent(event: MessagingEvent): ParsedInstagramInboundMessage | null {
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  const message = event.message;

  if (!senderId || !message?.mid) {
    return null;
  }

  if (message.is_echo || message.is_deleted) {
    return null;
  }

  const text = message.text?.trim() ?? '';
  if (!text) {
    return null;
  }

  return {
    senderId,
    recipientId: recipientId ?? '',
    messageId: message.mid,
    text,
    timestamp: event.timestamp,
    raw: event as Record<string, unknown>,
  };
}
