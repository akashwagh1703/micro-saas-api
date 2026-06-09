import { Prisma } from '@prisma/client';
import { CareerAlertPreferences, ALERT_PREFERENCES_KEY, readAlertPreferences } from './career-alert-preferences.util';

export const ALERT_STATE_KEY = 'alert_state';
export const MAX_NOTIFIED_JOB_IDS = 500;

export interface CareerAlertState {
  notifiedJobIds: number[];
  lastInstantAlertAt?: string;
  lastDigestAt?: string;
}

export function readAlertState(onboardingData: unknown): CareerAlertState {
  const data = (onboardingData as Record<string, unknown>) ?? {};
  const raw = data[ALERT_STATE_KEY] as Partial<CareerAlertState> | undefined;

  return {
    notifiedJobIds: Array.isArray(raw?.notifiedJobIds)
      ? raw.notifiedJobIds.filter((id): id is number => typeof id === 'number')
      : [],
    lastInstantAlertAt: typeof raw?.lastInstantAlertAt === 'string' ? raw.lastInstantAlertAt : undefined,
    lastDigestAt: typeof raw?.lastDigestAt === 'string' ? raw.lastDigestAt : undefined,
  };
}

export function mergeNotifiedJobIds(existing: number[], added: number[]): number[] {
  const merged = [...new Set([...existing, ...added])];
  return merged.slice(-MAX_NOTIFIED_JOB_IDS);
}

export function buildProfileDataPatch(
  existingData: unknown,
  patch: {
    alertState?: Partial<CareerAlertState>;
    alertPreferences?: Partial<CareerAlertPreferences>;
    jobSessionJobIds?: number[];
  },
): Prisma.InputJsonValue {
  const data = (existingData as Record<string, unknown>) ?? {};
  const next: Record<string, unknown> = { ...data };

  if (patch.alertState) {
    const current = readAlertState(existingData);
    next[ALERT_STATE_KEY] = { ...current, ...patch.alertState };
  }

  if (patch.alertPreferences) {
    const current = readAlertPreferences(existingData);
    next[ALERT_PREFERENCES_KEY] = { ...current, ...patch.alertPreferences };
  }

  if (patch.jobSessionJobIds) {
    next.job_session = {
      jobIds: patch.jobSessionJobIds,
      listedAt: new Date().toISOString(),
    };
  }

  return next as Prisma.InputJsonValue;
}
