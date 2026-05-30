import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { serializeUser } from '../../common/serializers';
import { ForgotPasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password_confirmation !== undefined && dto.password_confirmation !== dto.password) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { password: ['The password confirmation does not match.'] },
      });
    }

    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { email: ['The email has already been taken.'] },
      });
    }

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: await this.crypto.hashPassword(dto.password),
      },
    });

    const token = await this.createToken(user.id);
    return { user: serializeUser(user), token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = user && (await this.crypto.verifyPassword(dto.password, user.password));

    if (!user || !valid) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { email: ['The provided credentials are incorrect.'] },
      });
    }

    const token = await this.createToken(user.id);
    return { user: serializeUser(user), token };
  }

  async logout(accessTokenId: number | undefined) {
    if (accessTokenId) {
      await this.prisma.personalAccessToken.deleteMany({ where: { id: accessTokenId } });
    }
    return { message: 'Logged out' };
  }

  async forgotPassword(_dto: ForgotPasswordDto) {
    // Email delivery is environment-dependent; respond without revealing whether the email exists.
    return { message: 'If the email exists, a reset link has been sent.' };
  }

  private async createToken(userId: number): Promise<string> {
    const { plainText, hash } = this.crypto.generateToken();
    await this.prisma.personalAccessToken.create({
      data: { userId, name: 'auth', token: hash },
    });
    return plainText;
  }
}
