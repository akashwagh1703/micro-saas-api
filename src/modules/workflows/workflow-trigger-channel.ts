import { CHANNEL_INSTAGRAM, CHANNEL_WHATSAPP } from '../../common/channels';

/** Trigger node channel filter — `both` runs on WhatsApp and Instagram. */
export type TriggerChannelFilter = 'both' | typeof CHANNEL_WHATSAPP | typeof CHANNEL_INSTAGRAM;

export function normalizeTriggerChannelFilter(raw: unknown): TriggerChannelFilter {
  const v = String(raw ?? 'both').toLowerCase();
  if (v === CHANNEL_WHATSAPP || v === CHANNEL_INSTAGRAM) {
    return v;
  }
  return 'both';
}

export function triggerChannelMatches(
  triggerData: Record<string, unknown> | undefined,
  messageChannel: string,
): boolean {
  const filter = normalizeTriggerChannelFilter(triggerData?.channel);
  if (filter === 'both') {
    return true;
  }
  const channel = messageChannel || CHANNEL_WHATSAPP;
  return filter === channel;
}

export function resolveLeadApiChannelFromTrigger(
  triggerData: Record<string, unknown> | undefined,
): 'whatsapp' | 'instagram' | 'both' {
  return normalizeTriggerChannelFilter(triggerData?.channel);
}

export function triggerChannelSummary(channel: TriggerChannelFilter): string {
  switch (channel) {
    case CHANNEL_INSTAGRAM:
      return 'Instagram DMs only';
    case CHANNEL_WHATSAPP:
      return 'WhatsApp messages only';
    default:
      return 'WhatsApp or Instagram DMs';
  }
}
