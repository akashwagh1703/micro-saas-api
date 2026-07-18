import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class PaymentProofStorageService {
  private readonly logger = new Logger(PaymentProofStorageService.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root =
      config.get<string>('PAYMENT_PROOF_STORAGE_PATH') ??
      path.join(process.cwd(), 'storage', 'payment-proofs');
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  generateToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async saveProof(
    userId: number,
    submissionId: number,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ token: string }> {
    const mime = mimeType.trim().toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new Error('Invalid proof image type');
    }

    const token = this.generateToken();
    const dir = path.join(this.root, String(userId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(path.join(dir, `${submissionId}-${token}`), buffer);
    return { token };
  }

  async readProof(
    userId: number,
    submissionId: number,
    token: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const filePath = path.join(this.root, String(userId), `${submissionId}-${token.trim()}`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const buffer = await fs.promises.readFile(filePath);
    return { buffer, mimeType: this.guessMime(buffer) };
  }

  private guessMime(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
    return 'image/jpeg';
  }
}
