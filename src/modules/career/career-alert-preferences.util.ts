import { Prisma } from '@prisma/client';

export const ALERT_PREFERENCES_KEY = 'alert_preferences';

export interface CareerAlertPreferences {
  whatsapp: boolean;
  email: boolean;
  in_app: boolean;
  /** Reserved for future mobile push (FCM/APNs). */
  push: boolean;
}

export const DEFAULT_ALERT_PREFERENCES: CareerAlertPreferences = {
  whatsapp: true,
  email: true,
  in_app: true,
  push: false,
};

export function readAlertPreferences(onboardingData: unknown): CareerAlertPreferences {
  const data = (onboardingData as Record<string, unknown>) ?? {};
  const raw = data[ALERT_PREFERENCES_KEY] as Partial<CareerAlertPreferences> | undefined;

  return {
    whatsapp: raw?.whatsapp !== false,
    email: raw?.email !== false,
    in_app: raw?.in_app !== false,
    push: raw?.push === true,
  };
}

export function mergeAlertPreferencesPatch(
  existingData: unknown,
  patch: Partial<CareerAlertPreferences>,
): Prisma.InputJsonValue {
  const data = (existingData as Record<string, unknown>) ?? {};
  const current = readAlertPreferences(existingData);
  return {
    ...data,
    [ALERT_PREFERENCES_KEY]: { ...current, ...patch },
  } as Prisma.InputJsonValue;
}

export function formatAlertPreferencesWhatsApp(
  prefs: CareerAlertPreferences,
  hasEmail: boolean,
  digestOptOut: boolean,
): string {
  if (digestOptOut) {
    return [
      '*Alert settings* 🔕',
      '',
      'All job alerts are *paused* (instant + daily digest).',
      'Reply *START DIGEST* to re-enable WhatsApp alerts.',
    ].join('\n');
  }

  const lines = [
    '*Alert settings* 🔔',
    '',
    `WhatsApp: ${prefs.whatsapp ? 'ON ✅' : 'OFF'}`,
    `Email: ${hasEmail ? (prefs.email ? 'ON ✅' : 'OFF') : '— (add email to your profile)'}`,
    `In-app portal: ${prefs.in_app ? 'ON ✅' : 'OFF'}`,
    '',
    'Reply *ALERT EMAIL ON* or *ALERT EMAIL OFF* to toggle email.',
    'Reply *STOP DIGEST* to pause all alerts.',
    'Reply *PORTAL LINK* for your candidate web portal.',
  ];
  return lines.join('\n');
}
