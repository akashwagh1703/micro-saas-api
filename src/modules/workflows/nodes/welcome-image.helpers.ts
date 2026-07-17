import { SettingsService } from '../../settings/settings.service';

const APPOINTMENT_SOURCES = new Set(['appointment_services', 'salon_services']);

/** Resolve HTTPS image URL for booking welcome (node override → tenant setting). */
export async function resolveWelcomeImageUrl(
  settings: SettingsService,
  userId: number,
  nodeData: Record<string, unknown>,
): Promise<string | null> {
  if (!shouldAttachWelcomeImage(nodeData)) {
    return null;
  }

  const nodeUrl = String(nodeData.welcome_image_url ?? '').trim();
  if (nodeUrl) {
    return normalizeHttpsImageUrl(nodeUrl);
  }

  const globalUrl = (await settings.get(userId, 'welcome_image_url'))?.trim();
  return globalUrl ? normalizeHttpsImageUrl(globalUrl) : null;
}

export function shouldAttachWelcomeImage(nodeData: Record<string, unknown>): boolean {
  if (nodeData.include_welcome_image === false) {
    return false;
  }
  const mode = String(nodeData.mode ?? 'static');
  if (mode === 'date_quick_pick' || mode === 'time_period_pick') {
    return false;
  }
  const source = String(nodeData.options_source ?? '');
  if (APPOINTMENT_SOURCES.has(source)) {
    return true;
  }
  if (nodeData.send_welcome_image === true) {
    return true;
  }
  return false;
}

export function normalizeHttpsImageUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
