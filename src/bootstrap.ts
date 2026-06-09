import { INestApplication, Logger } from '@nestjs/common';
import { buildValidationPipe } from './common/validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const corsLogger = new Logger('CORS');

/** Allowed browser origins for the portal (app.*) and explicit CORS_ORIGINS / PORTAL_URL. */
function resolveCorsOrigins(): string[] {
  const origins = new Set<string>();

  for (const part of (process.env.CORS_ORIGINS ?? '').split(',')) {
    const value = part.trim().replace(/\/$/, '');
    if (value) origins.add(value);
  }

  const portal = process.env.PORTAL_URL?.trim().replace(/\/$/, '');
  if (portal) origins.add(portal);

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      // api.autowave.playltp.in → also allow app.autowave.playltp.in
      if (parsed.hostname.startsWith('api.')) {
        const portalHost = `app.${parsed.hostname.slice(4)}`;
        origins.add(`${parsed.protocol}//${portalHost}`);
      }
    } catch {
      // ignore invalid APP_URL
    }
  }

  return [...origins];
}

/** Shared app configuration used by both the standalone server and the serverless handler. */
export function configureApp(app: INestApplication): void {
  const allowedOrigins = resolveCorsOrigins();

  if (allowedOrigins.length === 0) {
    corsLogger.warn('CORS_ORIGINS / PORTAL_URL not set — allowing all origins (dev only)');
    app.enableCors({
      origin: true,
      credentials: false,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
      optionsSuccessStatus: 204,
    });
  } else {
    corsLogger.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
    app.enableCors({
      origin: allowedOrigins,
      credentials: false,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
      optionsSuccessStatus: 204,
    });
  }
  app.setGlobalPrefix('api', { exclude: ['up', 'up/ready'] });
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
