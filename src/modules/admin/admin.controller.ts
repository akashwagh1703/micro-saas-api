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

  @Get('users')
  listUsers(@Query('page') page = '1', @Query('search') search = '') {
    return this.admin.listUsers(parseInt(page, 10) || 1, search ?? '');
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
