import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel serverless entry point.
 *
 * It requires the tsc-compiled Nest app from `dist/` (built by `vercel-build`)
 * rather than importing the TypeScript source, because Vercel bundles functions
 * with esbuild, which does not emit the decorator metadata that NestJS DI needs.
 *
 * Set QUEUE_DRIVER=sync so background work runs inline (no persistent worker on
 * serverless).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServer } = require('../dist/serverless');

let serverPromise: Promise<any> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  serverPromise = serverPromise ?? createServer();
  const server = await serverPromise;
  server(req, res);
}
