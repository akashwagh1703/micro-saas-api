/**
 * Fail fast on boot when required production configuration is missing or unsafe.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = String(config.NODE_ENV ?? 'development');
  const isProd = nodeEnv === 'production';
  const errors: string[] = [];

  if (!config.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }

  if (isProd) {
    if (!config.APP_ENCRYPTION_KEY) {
      errors.push('APP_ENCRYPTION_KEY is required in production');
    }

    const queueDriver = String(config.QUEUE_DRIVER ?? 'pgboss');
    if (queueDriver !== 'pgboss') {
      errors.push(
        'QUEUE_DRIVER must be pgboss in production (sync runs webhooks inline and causes timeouts)',
      );
    }

    if (!config.APP_URL) {
      errors.push('APP_URL is required in production (webhooks, signed download links)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }

  return config;
}
