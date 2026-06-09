import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface CareerPortalTokenPayload {
  profileId: number;
  userId: number;
  exp: number;
}

/** Signed magic-link tokens for the candidate-facing web portal (no login). */
@Injectable()
export class CareerPortalShareService {
  private readonly secret: string;
  private readonly portalUrl: string;
  private readonly defaultTtlDays: number;

  constructor(private readonly config: ConfigService) {
    const shareSecret = config.get<string>('CAREER_SHARE_SECRET')?.trim();
    const encryptionKey = config.get<string>('APP_ENCRYPTION_KEY')?.trim();
    const isProd = config.get<string>('NODE_ENV') === 'production';

    if (shareSecret) {
      this.secret = shareSecret;
    } else if (encryptionKey) {
      this.secret = encryptionKey;
    } else if (isProd) {
      throw new Error('Set CAREER_SHARE_SECRET or APP_ENCRYPTION_KEY in production');
    } else {
      this.secret = 'dev-insecure-share-key';
    }

    this.portalUrl = (
      config.get<string>('PORTAL_URL') ??
      config.get<string>('CORS_ORIGINS')?.split(',')[0]?.trim() ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    this.defaultTtlDays = parseInt(config.get<string>('CAREER_PORTAL_TOKEN_DAYS') ?? '30', 10);
  }

  createToken(profileId: number, userId: number, ttlDays?: number): string {
    const exp = Date.now() + (ttlDays ?? this.defaultTtlDays) * 24 * 3600 * 1000;
    const payload = `portal:${profileId}:${userId}:${exp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
  }

  verifyToken(token: string): CareerPortalTokenPayload | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const lastColon = decoded.lastIndexOf(':');
      if (lastColon <= 0) return null;

      const payload = decoded.slice(0, lastColon);
      const sig = decoded.slice(lastColon + 1);
      const expected = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
      if (sig.length !== expected.length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

      const [kind, profileIdRaw, userIdRaw, expRaw] = payload.split(':');
      if (kind !== 'portal' || !profileIdRaw || !userIdRaw || !expRaw) return null;

      const exp = parseInt(expRaw, 10);
      if (Date.now() > exp) return null;

      return {
        profileId: parseInt(profileIdRaw, 10),
        userId: parseInt(userIdRaw, 10),
        exp,
      };
    } catch {
      return null;
    }
  }

  buildPortalUrl(profileId: number, userId: number, ttlDays?: number): string {
    const token = this.createToken(profileId, userId, ttlDays);
    return `${this.portalUrl}/career/seeker?token=${encodeURIComponent(token)}`;
  }
}
