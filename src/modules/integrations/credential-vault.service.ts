import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IntegrationCredential } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  applyResponseMapping,
  resolveTemplateObject,
  resolveTemplateString,
} from '../../common/template-variables.util';

const NAME_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/i;
const AUTH_TYPES = new Set(['bearer', 'header', 'basic', 'api_key']);

export interface CredentialListItem {
  id: number;
  name: string;
  label: string | null;
  auth_type: string;
  header_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface UpsertCredentialInput {
  name: string;
  label?: string | null;
  auth_type?: string;
  secret: string;
  header_name?: string | null;
}

@Injectable()
export class CredentialVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async list(userId: number): Promise<CredentialListItem[]> {
    const rows = await this.prisma.integrationCredential.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async upsert(userId: number, input: UpsertCredentialInput): Promise<CredentialListItem> {
    const name = input.name.trim();
    if (!NAME_PATTERN.test(name)) {
      throw new UnprocessableEntityException({
        message: 'Invalid credential name. Use letters, numbers, underscores (2–63 chars).',
      });
    }

    const authType = (input.auth_type ?? 'bearer').trim().toLowerCase();
    if (!AUTH_TYPES.has(authType)) {
      throw new UnprocessableEntityException({ message: 'Unsupported auth_type' });
    }

    const secret = input.secret?.trim();
    if (!secret) {
      throw new UnprocessableEntityException({ message: 'Secret is required' });
    }

    const row = await this.prisma.integrationCredential.upsert({
      where: { userId_name: { userId, name } },
      update: {
        label: input.label?.trim() || null,
        authType,
        secret: this.crypto.encrypt(secret),
        headerName: input.header_name?.trim() || null,
      },
      create: {
        userId,
        name,
        label: input.label?.trim() || null,
        authType,
        secret: this.crypto.encrypt(secret),
        headerName: input.header_name?.trim() || null,
      },
    });

    return this.serialize(row);
  }

  async remove(userId: number, name: string): Promise<void> {
    const deleted = await this.prisma.integrationCredential.deleteMany({
      where: { userId, name },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Credential not found');
    }
  }

  async resolveSecret(userId: number, name: string): Promise<string | null> {
    const row = await this.prisma.integrationCredential.findUnique({
      where: { userId_name: { userId, name } },
    });
    if (!row) {
      return null;
    }
    return this.crypto.decrypt(row.secret);
  }

  async buildAuthHeaders(
    userId: number,
    authRef: string | null | undefined,
  ): Promise<Record<string, string>> {
    if (!authRef?.trim()) {
      return {};
    }

    const row = await this.prisma.integrationCredential.findUnique({
      where: { userId_name: { userId, name: authRef.trim() } },
    });
    if (!row) {
      throw new BadRequestException(`Unknown credential "${authRef}"`);
    }

    const secret = this.crypto.decrypt(row.secret);
    if (!secret) {
      throw new BadRequestException(`Credential "${authRef}" could not be decrypted`);
    }

    switch (row.authType) {
      case 'bearer':
        return { Authorization: `Bearer ${secret}` };
      case 'header': {
        const headerName = row.headerName?.trim() || 'X-Api-Key';
        return { [headerName]: secret };
      }
      case 'api_key':
        return { 'X-Api-Key': secret };
      case 'basic': {
        const [username, password] = secret.includes(':')
          ? secret.split(':', 2)
          : [secret, ''];
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      default:
        return {};
    }
  }

  createVaultResolver(userId: number) {
    return async (name: string) => this.resolveSecret(userId, name);
  }

  async resolveTemplateString(userId: number, text: string, variables: Record<string, unknown>) {
    return resolveTemplateString(text, variables, this.createVaultResolver(userId));
  }

  async resolveTemplateObject(userId: number, data: unknown, variables: Record<string, unknown>) {
    return resolveTemplateObject(data, variables, this.createVaultResolver(userId));
  }

  mapResponse(data: unknown, mapping: Record<string, string> | null | undefined) {
    return applyResponseMapping(data, mapping);
  }

  generateWebhookToken(): string {
    return randomBytes(24).toString('hex');
  }

  private serialize(row: IntegrationCredential): CredentialListItem {
    return {
      id: row.id,
      name: row.name,
      label: row.label,
      auth_type: row.authType,
      header_name: row.headerName,
      created_at: row.createdAt?.toISOString() ?? null,
      updated_at: row.updatedAt?.toISOString() ?? null,
    };
  }
}
