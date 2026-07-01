import {
  Body,
  Controller,
  Get,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { serializeUser } from '../../common/serializers';
import { SettingsService } from './settings.service';
import {
  ChangePasswordDto,
  UpdateIntegrationsDto,
  UpdateProfileDto,
} from './dto/settings.dto';

@Controller('settings')
@UseGuards(TokenAuthGuard)
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
  ) {}

  @Get('profile')
  profile(@CurrentUser() user: User) {
    return { user: serializeUser(user) };
  }

  @Put('profile')
  async updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    if (dto.email && dto.email !== user.email) {
      const exists = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: user.id } },
      });
      if (exists) {
        throw new UnprocessableEntityException({
          message: 'The given data was invalid.',
          errors: { email: ['The email has already been taken.'] },
        });
      }
    }

    const data: { name?: string; email?: string } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;

    const updated = await this.prisma.user.update({ where: { id: user.id }, data });
    return { user: serializeUser(updated) };
  }

  @Put('password')
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    if (dto.password_confirmation !== undefined && dto.password_confirmation !== dto.password) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { password: ['The password confirmation does not match.'] },
      });
    }

    const valid = await this.crypto.verifyPassword(dto.current_password, user.password);
    if (!valid) {
      throw new UnprocessableEntityException({ message: 'Current password is incorrect' });
    }

    const password = await this.crypto.hashPassword(dto.password);
    await this.prisma.user.update({ where: { id: user.id }, data: { password } });
    return { message: 'Password updated' };
  }

  @Get('business-profile')
  async getBusinessProfile(@CurrentUser('id') userId: number) {
    return this.settings.getBusinessProfile(userId);
  }

  @Get('integrations')
  async getIntegrations(@CurrentUser('id') userId: number) {
    const keys = ['openrouter_api_key', 'openai_api_key', 'ai_provider', 'ai_model'];
    const settings = await this.settings.getMany(userId, keys);

    return {
      ai_provider: settings.ai_provider ?? 'openrouter',
      ai_model: settings.ai_model ?? 'openai/gpt-4o-mini',
      has_openrouter_key: !!settings.openrouter_api_key,
      has_openai_key: !!settings.openai_api_key,
    };
  }

  @Put('integrations')
  async updateIntegrations(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateIntegrationsDto,
  ) {
    for (const [key, value] of Object.entries(dto)) {
      if (value !== null && value !== undefined && value !== '') {
        await this.settings.set(userId, key, value as string);
      }
    }
    return { message: 'Settings saved' };
  }
}
