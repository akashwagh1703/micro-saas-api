import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export type StorageBackend = 'object' | 'local';

export interface StorageStatus {
  backend: StorageBackend;
  bucket?: string;
  ok: boolean;
  error?: string;
}

/**
 * Resume and generated document storage via MinIO (S3-compatible API).
 * Set MINIO_* env vars to enable; otherwise falls back to local disk.
 */
@Injectable()
export class CareerStorageService implements OnModuleInit {
  private readonly logger = new Logger(CareerStorageService.name);
  private readonly backend: StorageBackend;
  private readonly localRoot: string;
  private s3: any;
  private bucket = '';

  constructor(private readonly config: ConfigService) {
    this.localRoot =
      config.get<string>('CAREER_STORAGE_PATH') ?? path.join(process.cwd(), 'storage', 'career');

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
        ...(endpoint
          ? {
              endpoint,
              forcePathStyle,
            }
          : {}),
      });

      this.logger.log(`CareerStorage: using MinIO bucket="${this.bucket}" endpoint="${endpoint ?? 'default'}"`);
    } else {
      if (!fs.existsSync(this.localRoot)) {
        fs.mkdirSync(this.localRoot, { recursive: true });
      }
      this.logger.log(
        'CareerStorage: using local filesystem — set MINIO_BUCKET + MINIO_ACCESS_KEY + MINIO_SECRET_KEY for durable storage',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.backend !== 'object') {
      return;
    }
    await this.ensureBucket();
  }

  /** Verifies MinIO/S3 connectivity — used by portal health check. */
  async getStorageStatus(): Promise<StorageStatus> {
    if (this.backend === 'local') {
      return { backend: 'local', ok: true };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { HeadBucketCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { backend: 'object', bucket: this.bucket, ok: true };
    } catch (e: any) {
      return {
        backend: 'object',
        bucket: this.bucket,
        ok: false,
        error: e.message,
      };
    }
  }

  private async ensureBucket(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (e: any) {
        const status = e.$metadata?.httpStatusCode;
        const missing = e.name === 'NotFound' || status === 404 || status === 403;
        if (!missing) {
          throw e;
        }
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created MinIO bucket "${this.bucket}"`);
      }
      this.logger.log(`MinIO bucket "${this.bucket}" is ready`);
    } catch (e: any) {
      this.logger.error(
        `MinIO startup check failed: ${e.message}. ` +
          'Use MINIO_ENDPOINT with the S3 API port (9000), not the console port (9001).',
      );
    }
  }

  /** True when files are stored in MinIO (not local disk). */
  isS3(): boolean {
    return this.backend === 'object';
  }

  isObjectStorage(): boolean {
    return this.backend === 'object';
  }

  tenantDir(userId: number): string {
    const dir = path.join(this.localRoot, String(userId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async saveBuffer(
    userId: number,
    subfolder: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `career/${userId}/${subfolder}/${Date.now()}_${safeName}`;

    if (this.backend === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: this.inferMime(fileName),
        }),
      );
      return `s3://${this.bucket}/${key}`;
    }

    const dir = path.join(this.tenantDir(userId), subfolder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, `${Date.now()}_${safeName}`);
    await fs.promises.writeFile(fullPath, buffer);
    return fullPath;
  }

  async saveText(userId: number, subfolder: string, fileName: string, text: string): Promise<string> {
    return this.saveBuffer(userId, subfolder, fileName, Buffer.from(text, 'utf8'));
  }

  async deleteFile(storagePath: string): Promise<void> {
    if (!storagePath?.trim()) {
      return;
    }
    try {
      if (storagePath.startsWith('s3://')) {
        const withoutScheme = storagePath.replace('s3://', '');
        const slash = withoutScheme.indexOf('/');
        const bucket = withoutScheme.slice(0, slash);
        const key = withoutScheme.slice(slash + 1);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return;
      }

      if (fs.existsSync(storagePath)) {
        await fs.promises.unlink(storagePath);
      }
    } catch (e: any) {
      this.logger.warn(`deleteFile failed for ${storagePath}: ${e.message}`);
    }
  }

  async readBuffer(storagePath: string): Promise<Buffer | null> {
    try {
      if (storagePath.startsWith('s3://')) {
        const withoutScheme = storagePath.replace('s3://', '');
        const slash = withoutScheme.indexOf('/');
        const bucket = withoutScheme.slice(0, slash);
        const key = withoutScheme.slice(slash + 1);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        const { Body } = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const chunks: Buffer[] = [];
        for await (const chunk of Body as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      }

      if (fs.existsSync(storagePath)) {
        return fs.readFileSync(storagePath);
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`readBuffer failed for ${storagePath}: ${e.message}`);
      return null;
    }
  }

  /** @deprecated Use readBuffer — kept for backward compatibility. */
  readFile(absolutePath: string): Buffer | null {
    if (absolutePath.startsWith('s3://')) {
      this.logger.warn('readFile called with MinIO path — use readBuffer instead');
      return null;
    }
    try {
      return fs.readFileSync(absolutePath);
    } catch (e: any) {
      this.logger.warn(`Could not read file ${absolutePath}: ${e.message}`);
      return null;
    }
  }

  relativeUrl(absolutePath: string): string {
    return absolutePath.replace(this.localRoot, '').replace(/\\/g, '/');
  }

  private resolvePathStyle(config: ConfigService, endpoint?: string): boolean {
    const raw =
      config.get<string>('MINIO_FORCE_PATH_STYLE') ??
      config.get<string>('S3_FORCE_PATH_STYLE');
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return !!endpoint;
  }

  private inferMime(fileName: string): string {
    if (fileName.endsWith('.pdf')) return 'application/pdf';
    if (fileName.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (fileName.endsWith('.txt')) return 'text/plain';
    return 'application/octet-stream';
  }
}
