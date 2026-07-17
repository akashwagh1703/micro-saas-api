import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsService } from './settings.service';

const WELCOME_IMAGE_URL_KEY = 'welcome_image_url';
const WELCOME_IMAGE_TOKEN_KEY = 'welcome_image_token';
const WELCOME_IMAGE_MIME_KEY = 'welcome_image_mime';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class TenantBrandingService {
  private readonly logger = new Logger(TenantBrandingService.name);
  private readonly root: string;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {
    this.root =
      config.get<string>('BRANDING_STORAGE_PATH') ??
      path.join(process.cwd(), 'storage', 'branding');
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  async getWelcomeImageMeta(userId: number): Promise<{
    welcome_image_url: string | null;
    has_welcome_image: boolean;
  }> {
    const welcome_image_url = (await this.settings.get(userId, WELCOME_IMAGE_URL_KEY)) ?? null;
    return {
      welcome_image_url,
      has_welcome_image: !!welcome_image_url?.trim(),
    };
  }

  async saveWelcomeImage(
    userId: number,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ welcome_image_url: string }> {
    const mime = mimeType.trim().toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { file: ['Use a JPEG, PNG, or WebP image (max 5 MB).'] },
      });
    }
    if (!buffer?.length || buffer.length > MAX_BYTES) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { file: ['Image must be between 1 byte and 5 MB.'] },
      });
    }

    let token = (await this.settings.get(userId, WELCOME_IMAGE_TOKEN_KEY))?.trim();
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      await this.settings.set(userId, WELCOME_IMAGE_TOKEN_KEY, token);
    }

    const dir = path.join(this.root, String(userId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'welcome');
    await fs.promises.writeFile(filePath, buffer);

    await this.settings.set(userId, WELCOME_IMAGE_MIME_KEY, mime);
    const welcome_image_url = this.buildPublicUrl(userId, token);
    await this.settings.set(userId, WELCOME_IMAGE_URL_KEY, welcome_image_url);

    this.logger.log(`Welcome image saved for tenant ${userId}`);
    return { welcome_image_url };
  }

  async clearWelcomeImage(userId: number): Promise<void> {
    await this.settings.set(userId, WELCOME_IMAGE_URL_KEY, null);
    await this.settings.set(userId, WELCOME_IMAGE_TOKEN_KEY, null);
    await this.settings.set(userId, WELCOME_IMAGE_MIME_KEY, null);
    const filePath = path.join(this.root, String(userId), 'welcome');
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Could not delete welcome image file for ${userId}: ${message}`);
    }
  }

  async readWelcomeImageIfAuthorized(
    userId: number,
    token: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const expected = (await this.settings.get(userId, WELCOME_IMAGE_TOKEN_KEY))?.trim();
    if (!expected || expected !== token.trim()) {
      return null;
    }
    const filePath = path.join(this.root, String(userId), 'welcome');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const buffer = await fs.promises.readFile(filePath);
    const mimeType =
      (await this.settings.get(userId, WELCOME_IMAGE_MIME_KEY))?.trim() || 'image/jpeg';
    return { buffer, mimeType };
  }

  private buildPublicUrl(userId: number, token: string): string {
    const base = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/api/public/branding/${userId}/${token}/welcome`;
  }
}
