import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { serializeUser } from '../../common/serializers';
import { BillingService } from '../billing/billing.service';
import { SuperAdminService } from '../../common/super-admin.service';
import { AuthMailService } from './auth-mail.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const TOKEN_TYPE_VERIFY = 'email_verification';
const TOKEN_TYPE_RESET = 'password_reset';
const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly billing: BillingService,
    private readonly superAdmin: SuperAdminService,
    private readonly authMail: AuthMailService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password_confirmation !== undefined && dto.password_confirmation !== dto.password) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { password: ['The password confirmation does not match.'] },
      });
    }

    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { email: ['The email has already been taken.'] },
      });
    }

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email,
        password: await this.crypto.hashPassword(dto.password),
        trialEndsAt: this.billing.trialEndsAtForNewUser(),
        subscriptionStatus: 'trial',
      },
    });

    const verifyPlain = await this.issueAuthToken(user.id, TOKEN_TYPE_VERIFY, VERIFY_TTL_MS);
    void this.authMail.sendWelcome({
      to: user.email,
      name: user.name,
      verifyUrl: this.authMail.verifyEmailUrl(verifyPlain),
    });

    const token = await this.createToken(user.id);
    return {
      user: serializeUser(user, { isSuperAdmin: this.superAdmin.isSuperAdmin(user.email) }),
      token,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = user && (await this.crypto.verifyPassword(dto.password, user.password));

    if (!user || !valid) {
      // Fallback for legacy mixed-case emails
      const legacy = await this.prisma.user.findFirst({
        where: { email: { equals: dto.email.trim(), mode: 'insensitive' } },
      });
      const legacyValid =
        legacy && (await this.crypto.verifyPassword(dto.password, legacy.password));
      if (!legacy || !legacyValid) {
        throw new UnprocessableEntityException({
          message: 'The given data was invalid.',
          errors: { email: ['The provided credentials are incorrect.'] },
        });
      }
      return this.finishLogin(legacy);
    }

    return this.finishLogin(user);
  }

  private async finishLogin(user: User) {
    if (this.emailVerificationRequired() && !user.emailVerifiedAt) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: {
          email: [
            'Please verify your email before signing in. Check your inbox for a confirmation link.',
          ],
        },
      });
    }

    const token = await this.createToken(user.id);
    return {
      user: serializeUser(user, { isSuperAdmin: this.superAdmin.isSuperAdmin(user.email) }),
      token,
    };
  }

  async logout(accessTokenId: number | undefined) {
    if (accessTokenId) {
      await this.prisma.personalAccessToken.deleteMany({ where: { id: accessTokenId } });
    }
    return { message: 'Logged out' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const message = 'If the email exists, a reset link has been sent.';
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: dto.email.trim(), mode: 'insensitive' } },
    });

    if (user) {
      const plain = await this.issueAuthToken(user.id, TOKEN_TYPE_RESET, RESET_TTL_MS);
      void this.authMail.sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl: this.authMail.resetPasswordUrl(plain),
      });
    }

    return { message };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password_confirmation !== undefined && dto.password_confirmation !== dto.password) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { password: ['The password confirmation does not match.'] },
      });
    }

    const row = await this.consumeAuthToken(dto.token, TOKEN_TYPE_RESET);
    await this.prisma.user.update({
      where: { id: row.userId },
      data: { password: await this.crypto.hashPassword(dto.password) },
    });
    // Invalidate other outstanding reset tokens for this user
    await this.prisma.authEmailToken.updateMany({
      where: {
        userId: row.userId,
        type: TOKEN_TYPE_RESET,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    return { message: 'Your password has been reset. You can sign in with your new password.' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const row = await this.consumeAuthToken(dto.token, TOKEN_TYPE_VERIFY);
    const user = await this.prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: new Date() },
    });
    await this.prisma.authEmailToken.updateMany({
      where: {
        userId: row.userId,
        type: TOKEN_TYPE_VERIFY,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    return {
      message: 'Email verified successfully.',
      user: serializeUser(user, { isSuperAdmin: this.superAdmin.isSuperAdmin(user.email) }),
    };
  }

  async resendVerification(user: User) {
    if (user.emailVerifiedAt) {
      return { message: 'Email is already verified.' };
    }

    const plain = await this.issueAuthToken(user.id, TOKEN_TYPE_VERIFY, VERIFY_TTL_MS);
    void this.authMail.sendEmailVerification({
      to: user.email,
      name: user.name,
      verifyUrl: this.authMail.verifyEmailUrl(plain),
    });

    return { message: 'If your email needs verification, a new confirmation link has been sent.' };
  }

  private emailVerificationRequired(): boolean {
    const raw = this.config.get<string>('EMAIL_VERIFICATION_REQUIRED')?.trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private async issueAuthToken(
    userId: number,
    type: string,
    ttlMs: number,
  ): Promise<string> {
    // Invalidate previous unused tokens of this type
    await this.prisma.authEmailToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { plainText, hash } = this.crypto.generateToken();
    await this.prisma.authEmailToken.create({
      data: {
        userId,
        type,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return plainText;
  }

  private async consumeAuthToken(plainToken: string, type: string) {
    const tokenHash = this.crypto.hashToken(plainToken.trim());
    const row = await this.prisma.authEmailToken.findUnique({ where: { tokenHash } });
    if (!row || row.type !== type) {
      throw new BadRequestException('This link is invalid or has already been used.');
    }
    if (row.usedAt) {
      throw new BadRequestException('This link has already been used.');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This link has expired. Please request a new one.');
    }

    await this.prisma.authEmailToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

    return row;
  }

  private async createToken(userId: number): Promise<string> {
    const { plainText, hash } = this.crypto.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    await this.prisma.personalAccessToken.create({
      data: { userId, name: 'auth', token: hash, expiresAt },
    });
    return plainText;
  }
}
