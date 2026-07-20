import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { User } from '@prisma/client';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { serializeUser } from '../../common/serializers';
import { AuthService } from './auth.service';
import { SuperAdminService } from '../../common/super-admin.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @UseGuards(TokenAuthGuard)
  resendVerification(@CurrentUser() user: User) {
    return this.auth.resendVerification(user);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(TokenAuthGuard)
  logout(@Req() req: Request) {
    return this.auth.logout((req as any).accessTokenId);
  }

  @Get('profile')
  @UseGuards(TokenAuthGuard)
  profile(@CurrentUser() user: User) {
    return {
      user: serializeUser(user, { isSuperAdmin: this.superAdmin.isSuperAdmin(user.email) }),
    };
  }
}
