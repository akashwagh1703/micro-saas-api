import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

/**
 * Builds (once) and caches an Express instance wrapping the Nest app, for use in
 * a serverless function. Compiled by `nest build` into dist/serverless.js so the
 * thin api/index.ts handler can require already-emitted JS (preserving the
 * decorator metadata that NestJS DI needs).
 */
let cachedApp: express.Express | null = null;

export async function createServer(): Promise<express.Express> {
  if (cachedApp) {
    return cachedApp;
  }

  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    rawBody: true,
  });

  configureApp(app);
  await app.init();

  cachedApp = expressApp;
  return expressApp;
}
