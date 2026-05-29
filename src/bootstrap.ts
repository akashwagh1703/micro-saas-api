import { INestApplication } from '@nestjs/common';
import { buildValidationPipe } from './common/validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Shared app configuration used by both the standalone server and the serverless handler. */
export function configureApp(app: INestApplication): void {
  app.enableCors({ origin: true, credentials: false });
  app.setGlobalPrefix('api', { exclude: ['up'] });
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
