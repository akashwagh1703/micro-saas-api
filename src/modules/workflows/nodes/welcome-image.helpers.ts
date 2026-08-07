import { SettingsService } from '../../settings/settings.service';
import { substituteContext } from './booking-node.helpers';

const APPOINTMENT_SOURCES = new Set(['appointment_services', 'salon_services']);

/**
 * Resolve HTTPS image URL for interactive pick headers.
 * Catalog flows: use_catalog_wa_logo + {{catalog_wa_logo_url}} (never booking welcome image).
 * Booking flows: node override → tenant welcome_image_url setting.
 */
export async function resolveWelcomeImageUrl(
  settings: SettingsService,
  userId: number,
  nodeData: Record<string, unknown>,
  context?: Record<string, unknown>,
): Promise<string | null> {
  if (!shouldAttachWelcomeImage(nodeData)) {
    return null;
  }

  const ctx = context ?? {};

  // Catalog WhatsApp logo — never fall back to booking welcome image.
  if (nodeData.use_catalog_wa_logo === true) {
    const fromPlaceholder = substituteContext(
      String(nodeData.welcome_image_url ?? '{{catalog_wa_logo_url}}'),
      ctx,
    ).trim();
    const fromContext = String(ctx.catalog_wa_logo_url ?? '').trim();
    return (
      normalizeHttpsImageUrl(fromPlaceholder.includes('{{') ? '' : fromPlaceholder) ??
      normalizeHttpsImageUrl(fromContext)
    );
  }

  const rawNodeUrl = String(nodeData.welcome_image_url ?? '').trim();
  const nodeUrl = substituteContext(rawNodeUrl, ctx).trim();
  if (nodeUrl && !nodeUrl.includes('{{')) {
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
