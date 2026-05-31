/** Instagram Messaging API — 24-hour customer care window after last inbound DM. */

export const INSTAGRAM_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinInstagramMessagingWindow(lastIncomingAt: Date | null | undefined): boolean {
  if (!lastIncomingAt) {
    return false;
  }
  return Date.now() - lastIncomingAt.getTime() < INSTAGRAM_MESSAGING_WINDOW_MS;
}

export const INSTAGRAM_MESSAGING_WINDOW_ERROR =
  'Instagram only allows replies within 24 hours of the customer\'s last message. Ask them to DM you again.';
