/**
 * AutoWave v4 rollout flags — off by default until each release is ready.
 * See v4-implementation.md Phase 0 / Phase 4 / Phase 10.
 */
export interface V4FeatureFlags {
  v4_catalog_enabled: boolean;
  v4_availability_enabled: boolean;
}

function envFlag(key: string): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return false;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function getV4FeatureFlags(): V4FeatureFlags {
  return {
    v4_catalog_enabled: envFlag('V4_CATALOG_ENABLED'),
    v4_availability_enabled: envFlag('V4_AVAILABILITY_ENABLED'),
  };
}

export function isV4CatalogEnabled(): boolean {
  return getV4FeatureFlags().v4_catalog_enabled;
}

export function isV4AvailabilityEnabled(): boolean {
  return getV4FeatureFlags().v4_availability_enabled;
}
