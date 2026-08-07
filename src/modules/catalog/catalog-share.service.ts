import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface CatalogMediaSharePayload {
  mediaId: number;
  userId: number;
  exp: number;
}

/**
 * Time-limited signed URLs for catalog media (WhatsApp image send, document links).
 * Stable public page images use /api/public/catalog/media/:id instead.
 */
@Injectable()
export class CatalogShareService {
  private readonly secret: string;
  private readonly appUrl: string;
  private readonly defaultTtlHours: number;

  constructor(private readonly config: ConfigService) {
    const shareSecret = config.get<string>('CATALOG_SHARE_SECRET')?.trim();
    const encryptionKey = config.get<string>('APP_ENCRYPTION_KEY')?.trim();
    const isProd = config.get<string>('NODE_ENV') === 'production';

    if (shareSecret) {
      this.secret = shareSecret;
    } else if (encryptionKey) {
      this.secret = encryptionKey;
    } else if (isProd) {
      throw new Error('Set CATALOG_SHARE_SECRET or APP_ENCRYPTION_KEY in production');
    } else {
      this.secret = 'dev-insecure-catalog-share-key';
    }

    this.appUrl = (config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    this.defaultTtlHours = parseInt(
      config.get<string>('CATALOG_SHARE_TTL_HOURS') ?? '72',
      10,
    );
  }

  createToken(mediaId: number, userId: number, ttlHours?: number): string {
    const exp = Date.now() + (ttlHours ?? this.defaultTtlHours) * 3600 * 1000;
    const payload = `media:${mediaId}:${userId}:${exp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
  }

  verifyToken(token: string): CatalogMediaSharePayload | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const lastColon = decoded.lastIndexOf(':');
      if (lastColon <= 0) return null;

      const payload = decoded.slice(0, lastColon);
      const sig = decoded.slice(lastColon + 1);
      const expected = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
      if (sig.length !== expected.length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

      const [kind, mediaIdRaw, userIdRaw, expRaw] = payload.split(':');
      if (kind !== 'media' || !mediaIdRaw || !userIdRaw || !expRaw) return null;

      const exp = parseInt(expRaw, 10);
      if (!Number.isFinite(exp) || Date.now() > exp) return null;

      return {
        mediaId: parseInt(mediaIdRaw, 10),
        userId: parseInt(userIdRaw, 10),
        exp,
      };
    } catch {
      return null;
    }
  }

  buildSignedUrl(mediaId: number, userId: number, ttlHours?: number): string {
    const token = this.createToken(mediaId, userId, ttlHours);
    return `${this.appUrl}/api/public/catalog/file?token=${encodeURIComponent(token)}`;
  }

  buildPublicMediaUrl(mediaId: number): string {
    return `${this.appUrl}/api/public/catalog/media/${mediaId}`;
  }

  appBaseUrl(): string {
    return this.appUrl;
  }
}
