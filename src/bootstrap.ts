import { INestApplication } from '@nestjs/common';
import { buildValidationPipe } from './common/validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

function resolveCorsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const portal = process.env.PORTAL_URL?.trim();
  if (portal && !fromEnv.includes(portal)) {
    fromEnv.push(portal);
  }
  return fromEnv;
}

/** Shared app configuration used by both the standalone server and the serverless handler. */
export function configureApp(app: INestApplication): void {
  const allowedOrigins = resolveCorsOrigins();
  if (allowedOrigins.length === 0) {
    app.enableCors({ origin: true, credentials: false });
  } else {
    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      },
      credentials: false,
    });
  }
  app.setGlobalPrefix('api', { exclude: ['up'] });
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
