import { Controller, Get } from '@nestjs/common';
import { serializePlatformCatalog, CATALOG_VERSION } from './business-verticals.registry';
import { getV4FeatureFlags } from './v4-feature-flags';

@Controller('platform')
export class PlatformController {
  /** Public catalog for portal/mobile onboarding — no secrets, safe to cache. */
  @Get('verticals')
  verticals() {
    return serializePlatformCatalog();
  }

  /** v4 rollout flags — clients can gate UI before catalog v2 ships. */
  @Get('features')
  features() {
    return {
      ...getV4FeatureFlags(),
      catalog_version: CATALOG_VERSION,
    };
  }
}
