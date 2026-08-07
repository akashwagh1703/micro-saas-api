import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CATALOG_STORAGE_PREFIX } from './catalog.constants';

export type CatalogStorageBackend = 'object' | 'local';

export interface CatalogStorageStatus {
  backend: CatalogStorageBackend;
  bucket?: string;
  prefix: string;
  ok: boolean;
  error?: string;
}

/**
 * Catalog media under existing MINIO_BUCKET folders (not per-tenant buckets):
 *   catalog/{userId}/{kind}/{timestamp}_{filename}
 * Falls back to local disk when MinIO env is incomplete.
 *
 * Public HTTPS delivery is via API proxy (/api/public/catalog/media/:id) —
 * raw MinIO endpoints are often private and unsuitable for WhatsApp/browsers.
 */
@Injectable()
export class CatalogStorageService implements OnModuleInit {
  private readonly logger = new Logger(CatalogStorageService.name);
  private readonly backend: CatalogStorageBackend;
  private readonly localRoot: string;
  private s3: any;
  private bucket = '';

  constructor(private readonly config: ConfigService) {
    this.localRoot =
      config.get<string>('CATALOG_STORAGE_PATH') ??
      path.join(process.cwd(), 'storage', 'catalog');

    const bucket =
      config.get<string>('MINIO_BUCKET') ??
      config.get<string>('AWS_S3_BUCKET') ??
      '';
    const accessKey =
      config.get<string>('MINIO_ACCESS_KEY') ??
      config.get<string>('AWS_ACCESS_KEY_ID') ??
      '';
    const secretKey =
      config.get<string>('MINIO_SECRET_KEY') ??
      config.get<string>('AWS_SECRET_ACCESS_KEY') ??
      '';

    const hasObjectStorage = !!(bucket && accessKey && secretKey);
    this.backend = hasObjectStorage ? 'object' : 'local';

    if (this.backend === 'object') {
      this.bucket = bucket;
      const endpoint =
        config.get<string>('MINIO_ENDPOINT') ??
        config.get<string>('S3_ENDPOINT') ??
        undefined;
      const forcePathStyle = this.resolvePathStyle(config, endpoint);
      const region =
        config.get<string>('MINIO_REGION') ??
        config.get<string>('AWS_REGION') ??
        'us-east-1';

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { S3Client } = require('@aws-sdk/client-s3');
      this.s3 = new S3Client({
        region,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        ...(endpoint ? { endpoint, forcePathStyle } : {}),
      });
      this.logger.log(
        `CatalogStorage: MinIO bucket="${this.bucket}" prefix="${CATALOG_STORAGE_PREFIX}/" endpoint="${endpoint ?? 'default'}"`,
      );
    } else {
      if (!fs.existsSync(this.localRoot)) {
        fs.mkdirSync(this.localRoot, { recursive: true });
      }
      this.logger.log(
        'CatalogStorage: local filesystem — set MINIO_BUCKET + keys for object storage',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.backend !== 'object') return;
    const status = await this.getStorageStatus();
    if (!status.ok) {
      this.logger.warn(`CatalogStorage startup: ${status.error}`);
    }
  }

  isObjectStorage(): boolean {
    return this.backend === 'object';
  }

  tenantPrefix(userId: number): string {
    return `${CATALOG_STORAGE_PREFIX}/${userId}`;
  }

  /** Ensures local tenant dirs exist; object storage uses key prefixes (no mkdir). */
  ensureTenantFolder(userId: number): string {
    const prefix = this.tenantPrefix(userId);
    if (this.backend === 'local') {
      const dir = path.join(this.localRoot, String(userId));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      for (const kind of ['image', 'document']) {
        const kindDir = path.join(dir, kind);
        if (!fs.existsSync(kindDir)) {
          fs.mkdirSync(kindDir, { recursive: true });
        }
      }
    }
    return prefix;
  }

  async getStorageStatus(): Promise<CatalogStorageStatus> {
    if (this.backend === 'local') {
      try {
        if (!fs.existsSync(this.localRoot)) {
          fs.mkdirSync(this.localRoot, { recursive: true });
        }
        return { backend: 'local', prefix: CATALOG_STORAGE_PREFIX, ok: true };
      } catch (e: any) {
        return {
          backend: 'local',
          prefix: CATALOG_STORAGE_PREFIX,
          ok: false,
          error: e.message,
        };
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { HeadBucketCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return {
        backend: 'object',
        bucket: this.bucket,
        prefix: CATALOG_STORAGE_PREFIX,
        ok: true,
      };
    } catch (e: any) {
      return {
        backend: 'object',
        bucket: this.bucket,
        prefix: CATALOG_STORAGE_PREFIX,
        ok: false,
        error: e.message,
      };
    }
  }

  async saveBuffer(
    userId: number,
    kind: string,
    fileName: string,
    buffer: Buffer,
    mimeType?: string,
  ): Promise<{ storageKey: string; objectKey: string }> {
    this.ensureTenantFolder(userId);
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${this.tenantPrefix(userId)}/${kind}/${Date.now()}_${safeName}`;

    if (this.backend === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: buffer,
          ContentType: mimeType || this.inferMime(fileName),
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return {
        storageKey: `s3://${this.bucket}/${objectKey}`,
        objectKey,
      };
    }

    const dir = path.join(this.localRoot, String(userId), kind);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, `${Date.now()}_${safeName}`);
    await fs.promises.writeFile(fullPath, buffer);
    return { storageKey: fullPath, objectKey };
  }

  async readBuffer(storageKey: string): Promise<Buffer | null> {
    if (!storageKey?.trim()) return null;
    try {
      if (storageKey.startsWith('s3://')) {
        const withoutScheme = storageKey.replace('s3://', '');
        const slash = withoutScheme.indexOf('/');
        const bucket = withoutScheme.slice(0, slash);
        const key = withoutScheme.slice(slash + 1);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        const { Body } = await this.s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const chunks: Buffer[] = [];
        for await (const chunk of Body as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      }

      if (fs.existsSync(storageKey)) {
        return fs.promises.readFile(storageKey);
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`CatalogStorage readBuffer failed: ${e.message}`);
      return null;
    }
  }

  async deleteFile(storageKey: string): Promise<void> {
    if (!storageKey?.trim()) return;
    try {
      if (storageKey.startsWith('s3://')) {
        const withoutScheme = storageKey.replace('s3://', '');
        const slash = withoutScheme.indexOf('/');
        const bucket = withoutScheme.slice(0, slash);
        const key = withoutScheme.slice(slash + 1);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return;
      }
      if (fs.existsSync(storageKey)) {
        await fs.promises.unlink(storageKey);
      }
    } catch (e: any) {
      this.logger.warn(`CatalogStorage delete failed: ${e.message}`);
    }
  }

  private resolvePathStyle(config: ConfigService, endpoint?: string): boolean {
    const explicit = config.get<string>('MINIO_FORCE_PATH_STYLE');
    if (explicit != null && String(explicit).length) {
      return String(explicit).toLowerCase() === 'true' || String(explicit) === '1';
    }
    return !!endpoint;
  }

  private inferMime(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
    };
    return map[ext] ?? 'application/octet-stream';
  }
}
