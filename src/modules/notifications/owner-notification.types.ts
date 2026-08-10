/** Canonical owner notification `type` values stored on OwnerNotification. */
export const OwnerNotificationType = {
  BOOKING_REQUESTED: 'booking_requested',
  BOOKING_CREATED: 'booking_created',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_CANCELLED: 'booking_cancelled',
  LEAD_CREATED: 'lead_created',
  PAYMENT_RECEIVED: 'payment_received',
  SUBSCRIPTION_ACTIVATED: 'subscription_activated',
  SUBSCRIPTION_EXPIRING: 'subscription_expiring',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  CATALOG_ORDER_PAYMENT_SUBMITTED: 'catalog_order_payment_submitted',
  CATALOG_ORDER_CONFIRMED: 'catalog_order_confirmed',
  CATALOG_ORDER_REJECTED: 'catalog_order_rejected',
} as const;


export type OwnerNotificationTypeValue =
  (typeof OwnerNotificationType)[keyof typeof OwnerNotificationType];

/** Android / Expo notification channel IDs (must match mobile channel setup). */
export const PushChannel = {
  BOOKINGS: 'bookings',
  LEADS: 'leads',
  BILLING: 'billing',
} as const;

export type PushChannelId = (typeof PushChannel)[keyof typeof PushChannel];

export function pushChannelForType(type: string): PushChannelId {
  if (type === OwnerNotificationType.LEAD_CREATED || type.startsWith('lead_')) {
    return PushChannel.LEADS;
  }
  if (
    type === OwnerNotificationType.PAYMENT_RECEIVED ||
    type === OwnerNotificationType.SUBSCRIPTION_ACTIVATED ||
    type.startsWith('subscription_') ||
    type.startsWith('payment_')
  ) {
    return PushChannel.BILLING;
  }
  if (type.startsWith('catalog_order_')) {
    return PushChannel.LEADS;
  }
  return PushChannel.BOOKINGS;
}
