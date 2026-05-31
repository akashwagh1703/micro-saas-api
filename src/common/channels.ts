/** Messaging channel identifiers (Phase 1 — Instagram + WhatsApp). */
export const CHANNEL_WHATSAPP = 'whatsapp';
export const CHANNEL_INSTAGRAM = 'instagram';

export const MESSAGING_CHANNELS = [CHANNEL_WHATSAPP, CHANNEL_INSTAGRAM] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export function isMessagingChannel(value: string): value is MessagingChannel {
  return (MESSAGING_CHANNELS as readonly string[]).includes(value);
}
