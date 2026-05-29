import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

/**
 * Replicates Laravel Sanctum's Bearer-token auth. The client sends
 * `Authorization: Bearer <plaintext>`; we hash it and look it up in
 * `personal_access_tokens`, then attach the owning user to the request.
 */
@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['authorization'];

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const plainText = header.substring(7).trim();
    if (!plainText) {
      throw new UnauthorizedException();
    }

    const hash = this.crypto.hashToken(plainText);
    const token = await this.prisma.personalAccessToken.findUnique({
      where: { token: hash },
      include: { user: true },
    });

    if (!token || (token.expiresAt && token.expiresAt < new Date())) {
      throw new UnauthorizedException();
    }

    await this.prisma.personalAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });

    (request as any).user = token.user;
    (request as any).accessTokenId = token.id;
    return true;
  }
}
