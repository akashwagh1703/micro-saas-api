import { Controller, Get } from '@nestjs/common';
import { serializePlatformCatalog } from './business-verticals.registry';

@Controller('platform')
export class PlatformController {
  /** Public catalog for portal onboarding — no secrets, safe to cache. */
  @Get('verticals')
  verticals() {
    return serializePlatformCatalog();
  }
}
