import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/** Local file storage for CareerAI resumes and generated documents (S3-ready abstraction). */
@Injectable()
export class CareerStorageService {
  private readonly logger = new Logger(CareerStorageService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = config.get<string>('CAREER_STORAGE_PATH') ?? path.join(process.cwd(), 'storage', 'career');
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  tenantDir(userId: number): string {
    const dir = path.join(this.root, String(userId));
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
    const dir = path.join(this.tenantDir(userId), subfolder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = path.join(dir, `${Date.now()}_${safeName}`);
    await fs.promises.writeFile(fullPath, buffer);
    return fullPath;
  }

  async saveText(userId: number, subfolder: string, fileName: string, text: string): Promise<string> {
    return this.saveBuffer(userId, subfolder, fileName, Buffer.from(text, 'utf8'));
  }

  relativeUrl(absolutePath: string): string {
    return absolutePath.replace(this.root, '').replace(/\\/g, '/');
  }

  readFile(absolutePath: string): Buffer | null {
    try {
      return fs.readFileSync(absolutePath);
    } catch (e: any) {
      this.logger.warn(`Could not read file ${absolutePath}: ${e.message}`);
      return null;
    }
  }
}
