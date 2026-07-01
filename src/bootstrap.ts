import { INestApplication, Logger } from '@nestjs/common';
import { buildValidationPipe } from './common/validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const corsLogger = new Logger('CORS');

/** Allowed browser origins for portal, marketing site, and explicit CORS_ORIGINS. */
export function resolveCorsOrigins(): string[] {
  const origins = new Set<string>();

  const add = (raw?: string) => {
    const value = raw?.trim().replace(/\/$/, '');
    if (value) origins.add(value);
  };

  for (const part of (process.env.CORS_ORIGINS ?? '').split(',')) {
    add(part);
  }

  add(process.env.PORTAL_URL);
  add(process.env.WEBSITE_URL);

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      // api.autowave.playltp.in → app.* (portal) + bare domain (marketing site)
      if (parsed.hostname.startsWith('api.')) {
        const baseHost = parsed.hostname.slice(4);
        add(`${parsed.protocol}//app.${baseHost}`);
        add(`${parsed.protocol}//${baseHost}`);
        add(`${parsed.protocol}//www.${baseHost}`);
      }
    } catch {
      // ignore invalid APP_URL
    }
  }

  return [...origins];
}

function isOriginAllowed(origin: string | undefined, allowed: Set<string>): boolean {
  if (!origin) {
    return true;
  }
  return allowed.has(origin.replace(/\/$/, ''));
}

/** Shared app configuration used by both the standalone server and the serverless handler. */
export function configureApp(app: INestApplication): void {
  const allowedList = resolveCorsOrigins();
  const allowed = new Set(allowedList);

  const corsOptions = {
    credentials: false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    optionsSuccessStatus: 204 as const,
  };

  if (allowedList.length === 0) {
    corsLogger.warn('CORS_ORIGINS / PORTAL_URL / APP_URL not set — allowing all origins (dev only)');
    app.enableCors({
      ...corsOptions,
      origin: true,
    });
  } else {
    corsLogger.log(`Allowed origins: ${allowedList.join(', ')}`);
    app.enableCors({
      ...corsOptions,
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (isOriginAllowed(origin, allowed)) {
          callback(null, true);
          return;
        }
        corsLogger.warn(`Blocked CORS origin: ${origin ?? '(none)'}`);
        callback(null, false);
      },
    });
  }
  app.setGlobalPrefix('api', { exclude: ['up', 'up/ready'] });
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
