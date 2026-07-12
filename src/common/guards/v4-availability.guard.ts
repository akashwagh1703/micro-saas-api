import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { isV4AvailabilityEnabled } from '../../platform/v4-feature-flags';

/** Gates availability routes until Release B rollout (V4_AVAILABILITY_ENABLED). */
@Injectable()
export class V4AvailabilityGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (!isV4AvailabilityEnabled()) {
      throw new NotFoundException('Availability API is not enabled');
    }
    return true;
  }
}
