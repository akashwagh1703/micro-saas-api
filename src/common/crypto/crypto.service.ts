import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;
  private readonly rounds: number;

  constructor(private readonly config: ConfigService) {
    this.key = this.resolveKey(config.get<string>('APP_ENCRYPTION_KEY'));
    this.rounds = Number(config.get('BCRYPT_ROUNDS') ?? 12);
  }

  private resolveKey(raw?: string): Buffer {
    const isDev = this.config.get<string>('NODE_ENV') === 'development';

    if (!raw) {
      if (!isDev) {
        throw new Error(
          'APP_ENCRYPTION_KEY is required outside development. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
        );
      }
      this.logger.warn(
        'APP_ENCRYPTION_KEY is not set. Falling back to an insecure development key.',
      );
      return crypto.createHash('sha256').update('insecure-development-key').digest();
    }
    // Accept a raw 32-byte base64 or hex key; otherwise derive a 32-byte key via SHA-256.
    for (const encoding of ['base64', 'hex'] as const) {
      try {
        const buf = Buffer.from(raw, encoding);
        if (buf.length === 32) {
          return buf;
        }
      } catch {
        // try next encoding
      }
    }
    return crypto.createHash('sha256').update(raw).digest();
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) {
      return false;
    }
    return bcrypt.compare(plain, hash);
  }

  /** Encrypts a string and returns base64(iv | authTag | ciphertext). */
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  /** Reverses {@link encrypt}. Returns null if the payload cannot be decrypted. */
  decrypt(payload: string | null | undefined): string | null {
    if (!payload) {
      return null;
    }
    try {
      const raw = Buffer.from(payload, 'base64');
      const iv = raw.subarray(0, 12);
      const authTag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }

  /** Generates an opaque access token: plaintext returned to client, sha256 hash stored in DB. */
  generateToken(): { plainText: string; hash: string } {
    const plainText = crypto.randomBytes(32).toString('hex');
    return { plainText, hash: this.hashToken(plainText) };
  }

  hashToken(plainText: string): string {
    return crypto.createHash('sha256').update(plainText).digest('hex');
  }
}
