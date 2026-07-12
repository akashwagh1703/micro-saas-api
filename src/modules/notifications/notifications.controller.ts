import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OwnerNotificationsService } from './owner-notifications.service';

class RegisterPushTokenDto {
  @IsString()
  @MaxLength(255)
  expo_push_token!: string;

  @IsString()
  @IsIn(['android', 'ios', 'web'])
  platform!: string;
}

@Controller('notifications')
@UseGuards(TokenAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: OwnerNotificationsService) {}

  @Get()
  list(
    @CurrentUser('id') userId: number,
    @Query('unread_only') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(userId, {
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('id') userId: number) {
    return this.notifications.unreadCount(userId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser('id') userId: number) {
    return this.notifications.markAllRead(userId);
  }

  @Post('push-token')
  registerPushToken(@CurrentUser('id') userId: number, @Body() dto: RegisterPushTokenDto) {
    return this.notifications.registerPushToken(userId, dto.expo_push_token, dto.platform);
  }
}
