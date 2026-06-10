import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { UpdateUserAccessDto } from './dto/admin.dto';

@Controller('admin')
@UseGuards(TokenAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.getOverview();
  }

  @Get('analytics')
  analytics(@Query('days') days = '30') {
    return this.admin.getAnalytics(parseInt(days, 10) || 30);
  }

  @Get('transactions')
  listTransactions(
    @Query('page') page = '1',
    @Query('search') search = '',
    @Query('status') status = '',
  ) {
    return this.admin.listTransactions(parseInt(page, 10) || 1, search ?? '', status ?? '');
  }

  @Get('users')
  listUsers(
    @Query('page') page = '1',
    @Query('search') search = '',
    @Query('status') status = '',
    @Query('plan') plan = '',
  ) {
    return this.admin.listUsers(
      parseInt(page, 10) || 1,
      search ?? '',
      status ?? '',
      plan ?? '',
    );
  }

  @Get('users/:id')
  userDetail(@Param('id', ParseIntPipe) id: number) {
    return this.admin.getUserDetail(id);
  }

  @Patch('users/:id/access')
  updateAccess(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserAccessDto) {
    return this.admin.updateUserAccess(id, dto);
  }
}
