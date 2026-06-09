import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export type CareerShareDocKind = 'resume-version' | 'cover-letter' | 'resume';

export interface CareerSharePayload {
  kind: CareerShareDocKind;
  id: number;
  userId: number;
  exp: number;
}

/** Time-limited public download links for CareerAI documents stored in MinIO/local disk. */
@Injectable()
export class CareerDocumentShareService {
  private readonly secret: string;
  private readonly appUrl: string;
  private readonly defaultTtlHours: number;

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
    this.appUrl = (config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    this.defaultTtlHours = parseInt(config.get<string>('CAREER_SHARE_TTL_HOURS') ?? '72', 10);
  }

  createToken(kind: CareerShareDocKind, id: number, userId: number, ttlHours?: number): string {
    const exp = Date.now() + (ttlHours ?? this.defaultTtlHours) * 3600 * 1000;
    const payload = `${kind}:${id}:${userId}:${exp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
  }

  verifyToken(token: string): CareerSharePayload | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const lastColon = decoded.lastIndexOf(':');
      if (lastColon <= 0) return null;

      const payload = decoded.slice(0, lastColon);
      const sig = decoded.slice(lastColon + 1);
      const expected = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
      if (sig.length !== expected.length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

      const [kind, idRaw, userIdRaw, expRaw] = payload.split(':');
      if (!kind || !idRaw || !userIdRaw || !expRaw) return null;

      const exp = parseInt(expRaw, 10);
      if (Date.now() > exp) return null;

      return {
        kind: kind as CareerShareDocKind,
        id: parseInt(idRaw, 10),
        userId: parseInt(userIdRaw, 10),
        exp,
      };
    } catch {
      return null;
    }
  }

  buildShareUrl(kind: CareerShareDocKind, id: number, userId: number, ttlHours?: number): string {
    const token = this.createToken(kind, id, userId, ttlHours);
    return `${this.appUrl}/api/career/public/download?token=${encodeURIComponent(token)}`;
  }
}
