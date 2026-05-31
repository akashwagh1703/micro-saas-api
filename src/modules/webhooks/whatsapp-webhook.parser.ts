/** Extracts display text from inbound WhatsApp Cloud API message objects. */

export function extractWhatsAppInboundText(message: Record<string, unknown>): string | null {
  const type = String(message.type ?? 'text');

  if (type === 'text') {
    const body = (message.text as { body?: string } | undefined)?.body?.trim();
    return body || null;
  }

  if (type === 'image') {
    const caption = (message.image as { caption?: string } | undefined)?.caption?.trim();
    return caption || '[Image]';
  }

  if (type === 'video') {
    const caption = (message.video as { caption?: string } | undefined)?.caption?.trim();
    return caption || '[Video]';
  }

  if (type === 'audio') {
    return '[Voice message]';
  }

  if (type === 'document') {
    const caption = (message.document as { caption?: string; filename?: string } | undefined);
    return caption?.caption?.trim() || caption?.filename?.trim() || '[Document]';
  }

  if (type === 'sticker') {
    return '[Sticker]';
  }

  if (type === 'location') {
    return '[Location]';
  }

  return null;
}
